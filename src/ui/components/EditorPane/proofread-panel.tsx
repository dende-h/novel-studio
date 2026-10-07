import type { ProofNotice } from '@/core/proofread'
import { cn } from '@/lib/utils'

export interface ProofreadToggles {
  items: ReadonlyArray<{ id: string; label: string }>
  disabled: ReadonlySet<string>
  onToggle: (id: string) => void
}

interface ProofreadPanelProps {
  title: string
  intro: string
  notices: ProofNotice[]
  onJump: (blockIndex: number) => void
  /** 「確認する項目」の切替。渡したときだけ描く（小説の推敲チェック用。脚本は渡さない）。 */
  toggles?: ProofreadToggles
}

/**
 * 本文の下の確認候補パネル。脚本の書式チェックと小説の推敲チェックが共有する。
 * 候補を押すと該当行を選択するだけで、本文は書き換えない。
 */
export function ProofreadPanel({ title, intro, notices, onJump, toggles }: ProofreadPanelProps) {
  return (
    <details className="shrink-0 border-t border-outline-variant/30 px-4 py-2 text-xs text-on-surface-variant">
      <summary className="cursor-pointer">
        {title}（確認候補 {notices.length}件）
      </summary>
      <p className="my-2">{intro}</p>
      {toggles ? (
        <fieldset className="mb-2 flex flex-wrap items-center gap-1.5 border-0 p-0">
          <legend className="float-left mr-1">確認する項目</legend>
          {toggles.items.map((item) => {
            const on = !toggles.disabled.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggles.onToggle(item.id)}
                className={cn(
                  'min-h-11 rounded-full border px-3 text-xs transition-colors',
                  on
                    ? 'border-transparent bg-primary-container text-on-primary-container'
                    : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low',
                )}
              >
                {item.label}
              </button>
            )
          })}
        </fieldset>
      ) : null}
      <ul className="max-h-32 overflow-y-auto">
        {notices.map((notice) => (
          <li key={`${notice.blockIndex}-${notice.code}-${notice.message}`}>
            <button
              type="button"
              className="min-h-11 w-full py-1 text-left hover:text-primary"
              onClick={() => onJump(notice.blockIndex)}
            >
              {notice.blockIndex + 1}行：{notice.message}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
