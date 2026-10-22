import { MORPH_RULES, NOVEL_RULES, type NovelRuleId } from '@/core/proofread/types'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui/components/ui/tooltip'

interface RuleTogglesProps {
  enabled: ReadonlySet<NovelRuleId>
  onToggle: (id: NovelRuleId) => void
  /** くわしい確認（品詞を使う項目）の状態。準備中・使えないときは印を添える。 */
  morph: 'ready' | 'loading' | 'error'
}

/**
 * 「確認する項目」（COT-40）。最初は何も選ばれておらず、作者が確かめたい項目を選ぶ。
 * 選んだ項目は端末設定（localStorage `ns-proofread-on`）。ホバー・フォーカスで項目の説明を出す。
 * 表記ゆれの自動発見は「表記ゆれ」に含める。
 */
export function RuleToggles({ enabled, onToggle, morph }: RuleTogglesProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <fieldset className="flex flex-wrap items-center gap-1.5 border-0 p-0">
        <legend className="sr-only">確認する項目</legend>
        {NOVEL_RULES.map((item) => {
          const on = enabled.has(item.id)
          const tag =
            MORPH_RULES.has(item.id) && morph !== 'ready'
              ? morph === 'loading'
                ? '準備中'
                : '使えません'
              : null
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(item.id)}
                  // 大きさはプロット画面のタブ（ViewTab）と同じ。選んだ項目は淡い緑で塗る
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium text-[12px] transition-colors',
                    on
                      ? 'border-transparent bg-primary-container text-on-primary-container'
                      : 'border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high',
                  )}
                >
                  {item.label}
                  {tag ? (
                    <span className="rounded-full bg-secondary-container px-1.5 text-[10px] text-on-secondary-container">
                      {tag}
                    </span>
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-72 leading-relaxed">
                {item.description}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </fieldset>
    </TooltipProvider>
  )
}
