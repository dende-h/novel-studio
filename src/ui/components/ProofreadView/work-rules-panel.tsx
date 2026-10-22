import { useEffect, useId, useRef, useState } from 'react'
import { type ProofreadRules, ruleRows } from '@/core/proofread/work-rules'
import { Button } from '@/ui/components/ui/button'

interface WorkRulesPanelProps {
  rules: ProofreadRules | undefined
  /** 決まりを1件戻す（行の id：例外はキー、表記の好みは 'pref:<組>'）。 */
  onRemove: (rowId: string) => void
  /** 提案しない言葉を1件戻す。 */
  onUndecline: (key: string) => void
}

/**
 * 推敲画面の「この作品の決まり」の欄（COT-62 FR-3）。決まりの一覧と「提案しない言葉」を1つのスクロールに収める
 * （見出しが伸びて本文と右の欄を押しつぶさないように）。「戻す」で行が消えたら、次の行の「戻す」へフォーカスを移す
 * （無ければ前の行、どちらも無ければ欄の見出し）。
 */
export function WorkRulesPanel({ rules, onRemove, onUndecline }: WorkRulesPanelProps) {
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ id: string; index: number } | null>(null)
  const rows = ruleRows(rules)
  const declined = rules?.declined ?? []
  const ids = [...rows.map((r) => r.id), ...declined.map((d) => `declined:${d.key}`)]
  const idsKey = ids.join('\n')

  useEffect(() => {
    if (!pending) return
    const now = idsKey ? idsKey.split('\n') : []
    if (now.includes(pending.id)) return // 保存待ち
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-rule-undo]') ?? []
    const next = buttons[pending.index] ?? buttons[pending.index - 1]
    if (next) next.focus()
    else headingRef.current?.focus()
    setPending(null)
  }, [pending, idsKey])

  const undo = (id: string, run: () => void) => {
    setPending({ id, index: ids.indexOf(id) })
    run()
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-3"
    >
      <h3
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="mb-1.5 font-medium text-on-surface text-xs outline-none"
      >
        この作品の決まり
      </h3>
      <div ref={listRef} className="max-h-48 space-y-2 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="py-1 text-on-surface-variant text-xs">
            決まりはまだありません。指摘のカードから作れます。
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-xs hover:bg-surface-container-low"
              >
                <span className="min-w-0 break-words text-on-surface">
                  {r.text}
                  {r.reason ? (
                    <span className="text-[11px] text-on-surface-variant"> — {r.reason}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  data-rule-undo=""
                  aria-label={`${r.text.replace(/[「」]/gu, '')}の決まりを戻す`}
                  onClick={() => undo(r.id, () => onRemove(r.id))}
                >
                  戻す
                </Button>
              </li>
            ))}
          </ul>
        )}
        {declined.length > 0 ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-on-surface-variant">
              提案しない言葉（{declined.length}）
            </summary>
            <ul className="mt-1 space-y-0.5">
              {declined.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-2 px-1.5">
                  <span className="min-w-0 break-words text-on-surface">
                    「{d.label}」
                    <span className="text-[11px] text-on-surface-variant">
                      {' '}
                      — {d.kind === 'exception' ? 'このままの提案' : 'そろえる提案'}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    data-rule-undo=""
                    aria-label={`${d.label}の提案を戻す`}
                    onClick={() => undo(`declined:${d.key}`, () => onUndecline(d.key))}
                  >
                    戻す
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  )
}
