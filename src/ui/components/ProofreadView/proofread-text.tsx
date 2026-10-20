import { plainTextOfBlock } from '@/core/game'
import { type FindingN, findingKey } from '@/core/proofread/decisions'
import type { Block } from '@/core/schema'
import { cn } from '@/lib/utils'

export type MarkState = 'pending' | 'fix'

interface ProofreadTextProps {
  blocks: ReadonlyArray<Block>
  /** 印を付ける指摘（「このまま」は渡さない＝印なし）。 */
  marks: ReadonlyArray<{ finding: FindingN; state: MarkState }>
  activeKey: string | null
  /** よく使う言葉の印（分析タブで選んだ語）。 */
  word: string | null
  onSelect: (finding: FindingN) => void
}

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'finding'; text: string; finding: FindingN; state: MarkState }
  | { kind: 'word'; text: string }

/** 段落の中の印を、重ならないように左から並べる（先に始まる印を優先）。 */
function segmentsOf(
  text: string,
  marks: ReadonlyArray<{ finding: FindingN; state: MarkState }>,
  word: string | null,
): Segment[] {
  const ranges: { start: number; end: number; seg: Segment }[] = marks.map((m) => ({
    start: m.finding.start,
    end: m.finding.end,
    seg: { kind: 'finding', text: '', finding: m.finding, state: m.state },
  }))
  if (word) {
    let at = text.indexOf(word)
    while (at !== -1) {
      ranges.push({ start: at, end: at + word.length, seg: { kind: 'word', text: '' } })
      at = text.indexOf(word, at + word.length)
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Segment[] = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start < cursor || r.end <= r.start) continue
    if (r.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, r.start) })
    out.push({ ...r.seg, text: text.slice(r.start, r.end) } as Segment)
    cursor = r.end
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
  return out
}

/** 推敲画面の本文（読むだけ）。段落ごとに記法を解いた文字で描き、指摘に印を付ける（COT-40）。 */
export function ProofreadText({ blocks, marks, activeKey, word, onSelect }: ProofreadTextProps) {
  return (
    <div className="preview mx-auto max-w-3xl space-y-1 font-serif text-[16px] text-on-surface leading-[2.1]">
      {blocks.map((block, i) => {
        const text = plainTextOfBlock(block)
        const mine = marks.filter((m) => m.finding.blockIndex === i)
        const activeHere = mine.some((m) => findingKey(m.finding) === activeKey)
        return (
          <p
            key={block.id}
            id={`proofread-p-${i}`}
            data-block-index={i}
            className={cn(
              'min-h-[1em] whitespace-pre-wrap break-all rounded px-1',
              activeHere && 'bg-surface-container-low',
            )}
          >
            {segmentsOf(text, mine, word).map((s, k) => {
              const segKey = `${i}-${k}`
              if (s.kind === 'text') return <span key={segKey}>{s.text}</span>
              if (s.kind === 'word') {
                return (
                  <span
                    key={segKey}
                    data-word-mark=""
                    className="box-decoration-clone bg-[linear-gradient(transparent_55%,var(--word-marker)_55%)]"
                  >
                    {s.text}
                  </span>
                )
              }
              const active = findingKey(s.finding) === activeKey
              return (
                <button
                  key={segKey}
                  type="button"
                  onClick={() => onSelect(s.finding)}
                  aria-label={`指摘を選ぶ：${s.text}`}
                  data-finding-mark={s.state}
                  className={cn(
                    'inline cursor-pointer rounded-sm p-0 align-baseline font-[inherit] text-[inherit] leading-[inherit]',
                    s.state === 'pending'
                      ? 'underline decoration-brand-secondary decoration-wavy underline-offset-[5px]'
                      : 'bg-secondary-container',
                    active && 'outline-2 outline-primary outline-offset-1',
                  )}
                >
                  {s.text}
                </button>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}
