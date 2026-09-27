import { plainTextOfBlock, plainTextOfInlines } from '../game'
import type { Block, Inline } from '../schema'

export interface ScriptLine {
  kind: 'blank' | 'slug' | 'direction' | 'dialogue' | 'transition'
  speaker?: string
}
const SPEAKER_RE =
  /^([^\s「」『』（）()【】［］[\]《》〈〉｛｝{}]{1,20}(?:（[^（）\r\n]{1,10}）)?)\s*[「『]/u

export function classifyScriptBlock(block: Block): ScriptLine {
  const text = plainTextOfBlock(block)
  if (!text.trim()) return { kind: 'blank' }
  if (text.trim() === '***') return { kind: 'transition' }
  if (/^[○〇]/u.test(text.trimStart())) return { kind: 'slug' }
  if (/^\s/u.test(text)) return { kind: 'direction' }
  if (/^[「『]/u.test(text)) return { kind: 'dialogue' }
  const match = SPEAKER_RE.exec(text)
  return match ? { kind: 'dialogue', speaker: match[1] } : { kind: 'direction' }
}

/** 装飾 inline は分断せず、text の切れ目だけを分割する。 */
export function splitSpeaker(inlines: Inline[]): { speaker: Inline[]; rest: Inline[] } | null {
  const line = classifyScriptBlock({ id: '', type: 'paragraph', inlines })
  if (!line.speaker) return null
  let remaining = line.speaker.length
  const speaker: Inline[] = []
  const rest: Inline[] = []
  for (const inline of inlines) {
    if (remaining <= 0) {
      rest.push(inline)
      continue
    }
    const length = plainTextOfInlines([inline]).length
    if (inline.type === 'text' && length > remaining) {
      speaker.push({ ...inline, text: inline.text.slice(0, remaining) })
      rest.push({ ...inline, text: inline.text.slice(remaining) })
    } else speaker.push(inline)
    remaining -= length
  }
  return { speaker, rest }
}

export function stripLeadingSpace(inlines: Inline[]): Inline[] {
  let leading = true
  return inlines.map((inline) => {
    if (!leading || inline.type !== 'text') {
      leading = false
      return inline
    }
    const text = inline.text.replace(/^\s+/u, '')
    if (text) leading = false
    return { ...inline, text }
  })
}
