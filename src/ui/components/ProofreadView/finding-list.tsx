import { plainTextOfBlock } from '@/core/game'
import { type FindingN, findingKey } from '@/core/proofread/decisions'
import { novelRuleLabel } from '@/core/proofread/types'
import type { Block } from '@/core/schema'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/ui/button'

export type FindingFilter = 'pending' | 'fix' | 'keep'

interface FindingListProps {
  filter: FindingFilter
  findings: ReadonlyArray<FindingN>
  /** 未判断の一覧全体（「同じ指摘をすべてこのまま」の件数に使う）。 */
  pending: ReadonlyArray<FindingN>
  blocks: ReadonlyArray<Block>
  activeKey: string | null
  onSelect: (f: FindingN) => void
  onFix: (f: FindingN) => void
  onKeep: (f: FindingN) => void
  onKeepAll: (fs: FindingN[]) => void
  onUndo: (f: FindingN) => void
  onFixInEditor: (f: FindingN) => void
}

const EXCERPT = 20

function Excerpt({ text, f, state }: { text: string; f: FindingN; state: FindingFilter }) {
  const s = Math.max(0, f.start - EXCERPT)
  const e = Math.min(text.length, f.end + EXCERPT)
  return (
    <p className="font-serif text-[13px] text-on-surface leading-relaxed">
      {s > 0 ? '…' : ''}
      {text.slice(s, f.start)}
      <span
        className={cn(
          'font-semibold',
          state === 'pending' &&
            'underline decoration-brand-secondary decoration-wavy underline-offset-4',
          state === 'fix' && 'rounded-sm bg-secondary-container',
        )}
      >
        {text.slice(f.start, f.end)}
      </span>
      {text.slice(f.end, e)}
      {e < text.length ? '…' : ''}
    </p>
  )
}

const EMPTY: Record<FindingFilter, string> = {
  pending: '未判断の指摘はありません',
  fix: '直すと決めた指摘はありません',
  keep: 'このままにした指摘はありません',
}

/** 推敲画面の指摘の一覧（COT-40）。カードを押すと本文の段落へ送る。 */
export function FindingList({
  filter,
  findings,
  pending,
  blocks,
  activeKey,
  onSelect,
  onFix,
  onKeep,
  onKeepAll,
  onUndo,
  onFixInEditor,
}: FindingListProps) {
  if (findings.length === 0) {
    return <p className="p-6 text-center text-on-surface-variant text-sm">{EMPTY[filter]}</p>
  }
  return (
    <ul className="space-y-2">
      {findings.map((f) => {
        const key = findingKey(f)
        const text = plainTextOfBlock(blocks[f.blockIndex] as Block)
        const same =
          filter === 'pending' ? pending.filter((g) => g.code === f.code && g.text === f.text) : []
        return (
          <li
            key={key}
            className={cn(
              'rounded-lg border bg-surface-container-lowest p-3',
              key === activeKey
                ? 'border-primary ring-1 ring-primary'
                : 'border-outline-variant/30',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(f)}
              className="block w-full space-y-1 text-left"
              aria-label={`本文で見る：${novelRuleLabel(f.code)}「${f.text}」`}
            >
              <span className="block text-[11px] text-on-surface-variant">
                {novelRuleLabel(f.code)}
              </span>
              <Excerpt text={text} f={f} state={filter} />
              <span className="block text-on-surface text-xs leading-relaxed">{f.message}</span>
            </button>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {filter === 'pending' ? (
                <>
                  <Button type="button" size="sm" onClick={() => onFix(f)}>
                    直す
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onKeep(f)}>
                    このまま
                  </Button>
                  {same.length >= 2 ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => onKeepAll(same)}>
                      同じ指摘をすべてこのまま（{same.length}件）
                    </Button>
                  ) : null}
                </>
              ) : filter === 'fix' ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onFixInEditor(f)}
                  >
                    本文で直す
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onUndo(f)}>
                    未判断に戻す
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => onUndo(f)}>
                  未判断に戻す
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
