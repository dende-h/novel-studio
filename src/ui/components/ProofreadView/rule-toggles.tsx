import { MORPH_RULES, NOVEL_RULES, type NovelRuleId } from '@/core/proofread/types'
import { cn } from '@/lib/utils'

interface RuleTogglesProps {
  disabled: ReadonlySet<NovelRuleId>
  onToggle: (id: NovelRuleId) => void
  /** くわしい確認（品詞を使う項目）の状態。準備中・使えないときは印を添える。 */
  morph: 'ready' | 'loading' | 'error'
}

/**
 * 「確認する項目」（COT-40。COT-30 の推敲チェックのチップを移したもの）。
 * オン／オフは端末設定（localStorage `ns-proofread-off`）。表記ゆれの自動発見は「表記ゆれ」に含める。
 */
export function RuleToggles({ disabled, onToggle, morph }: RuleTogglesProps) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0">
      <legend className="sr-only">確認する項目</legend>
      {NOVEL_RULES.map((item) => {
        const on = !disabled.has(item.id)
        const tag =
          MORPH_RULES.has(item.id) && morph !== 'ready'
            ? morph === 'loading'
              ? '準備中'
              : '使えません'
            : null
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(item.id)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
              on
                ? 'border-transparent bg-primary-container text-on-primary-container'
                : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low',
            )}
          >
            {item.label}
            {tag ? (
              <span className="rounded-full bg-secondary-container px-1.5 text-[10px] text-on-secondary-container">
                {tag}
              </span>
            ) : null}
          </button>
        )
      })}
    </fieldset>
  )
}
