import type { Block, Inline } from '../schema'
import { isHamelnTagReading } from '../sites/hameln-notation'
import { siteIllustrationTag } from '../sites/illustrations'
import { readLiteralEscape } from '../sites/literal-notation'
import { postingProfile, type SourceNotation } from '../sites/portability'

const commonPatterns = [
  { re: /\[\[rb:([^<>[\]\n]+?)\s*>\s*([^<>[\]\n]+?)\]\]/y, kind: 'ruby' },
  { re: /\[\[emphasismark:([^[\]\n>]+?)\s*>\s*[^>[\]\n]+\]\]/y, kind: 'dots' },
  { re: /#([^#\n]+?)__([^#\n]+?)__#/y, kind: 'ruby' },
  { re: /[｜|]([^｜|《》[\]\n]+)《([^《》\n]+)》/y, kind: 'ruby' },
  { re: /《《([^《》\n]+)》》/y, kind: 'dots' },
] as const

const image =
  /＜i\d+[a-z]*[｜|]\d+＞|<i\d+[a-z]*[｜|]\d+>|\{IMG\d+\}|\[挿絵(?:参照|タグ):[^\]\n]+\]/iy
const knownUnknown = /\[\[[^\n]*?(?:\]\]|$)|\[[a-z][\w-]*:[^\n]*?(?:\]|$)/iy
const untokenizedAngle = /[｜|][^｜|《》[\]\n]*《(?!《)[^《》\n]*(?:》|$)|《《[^《》\n]*(?:》》|$)/y
const kanjiStart = /[\p{Script=Han}々〆ヵヶ]/u

export function parseExternalNotation(text: string, source: SourceNotation = 'auto'): Block[] {
  const profile = source === 'auto' || source === 'literal' ? null : postingProfile(source)
  const parentheses = {
    narou: [
      {
        re: /([\p{Script=Han}々〆ヵヶ]+)（([\p{Script=Hiragana}\p{Script=Katakana}ー]+)）/uy,
        kind: 'ruby',
      },
      {
        re: /([\p{Script=Han}々〆ヵヶ]+)\(([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\)/uy,
        kind: 'ruby',
      },
    ],
    wide: [{ re: /([\p{Script=Han}々〆ヵヶA-Za-z0-9]+)（([^（）\n]+)）/uy, kind: 'ruby' }],
    ascii: [{ re: /([\p{Script=Han}々〆ヵヶ]+)\(([^()\n]+)\)/uy, kind: 'ruby' }],
    akatsuki: [
      {
        re: /([\p{Script=Han}々〆ヵヶ]+)（([\p{Script=Hiragana}\p{Script=Katakana}ー]+)）/uy,
        kind: 'ruby',
      },
      {
        re: /([\p{Script=Han}々〆ヵヶ]+)\(\(([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\)\)/uy,
        kind: 'ruby',
      },
      { re: /〖([^〗\n]+)〗（([^（）\n]+)）/uy, kind: 'ruby' },
    ],
  } as const
  const implicit =
    source === 'novelup'
      ? /([\p{Script=Han}々〆ヵヶA-Za-z0-9]+)《([^《》\n]+)》/uy
      : source === 'narou'
        ? /([\p{Script=Han}々〆ヵヶ]+)《([\p{Script=Hiragana}\p{Script=Katakana}ー]+)》/uy
        : !profile || profile.auto || source === 'tales'
          ? /([\p{Script=Han}々〆ヵヶ]+)《([^《》\n]+)》/uy
          : null
  const patterns = [
    ...commonPatterns,
    ...(implicit ? [{ re: implicit, kind: 'ruby' } as const] : []),
    ...(profile?.parens ? parentheses[profile.parens] : []),
  ]

  return text.split('\n').map((line, index) => {
    const inlines: Inline[] = []
    let buffer = ''
    const flush = () => {
      if (buffer) inlines.push({ type: 'text', text: buffer })
      buffer = ''
    }
    if (source === 'literal') buffer = line
    else
      for (let pos = 0; pos < line.length; ) {
        image.lastIndex = pos
        const artwork = image.exec(line)
        const escaped = readLiteralEscape(line, pos, source === 'auto' ? undefined : source)
        if (escaped) {
          buffer += escaped.text
          pos += escaped.length
          continue
        }
        if (artwork) {
          buffer +=
            artwork[0].startsWith('<') && (source === 'akatsuki' || source === 'narou')
              ? siteIllustrationTag(source, artwork[0])
              : artwork[0]
          pos += artwork[0].length
          continue
        }
        let parsed = false
        for (const { re, kind } of patterns) {
          if (pos && kanjiStart.test(line[pos - 1] ?? '') && re.source.startsWith('([\\p')) continue
          re.lastIndex = pos
          const m = re.exec(line)
          if (!m) continue
          const base = m[1]?.trim()
          const reading = m[2]?.trim()
          if (
            kind === 'ruby' &&
            (!base ||
              !reading ||
              (re.source.startsWith('([') &&
                isHamelnTagReading(reading, line.slice(pos + m[0].length), source === 'hameln')))
          )
            continue
          flush()
          if (kind === 'dots') inlines.push({ type: 'emphasisDots', text: m[1]! })
          else inlines.push({ type: 'ruby', base: base!, reading: reading! })
          pos += m[0].length
          parsed = true
          break
        }
        if (parsed) continue
        knownUnknown.lastIndex = pos
        untokenizedAngle.lastIndex = pos
        const literal =
          knownUnknown.exec(line)?.[0] ?? untokenizedAngle.exec(line)?.[0] ?? line[pos]!
        buffer += literal
        pos += literal.length
      }
    flush()
    return { id: `b${index + 1}`, type: 'paragraph', inlines }
  })
}
