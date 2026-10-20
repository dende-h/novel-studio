import { formDisplay } from '@/core/proofread/types'
import { type RuleSuggestion, suggestionText } from '@/core/proofread/work-rules'
import { Button } from '@/ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'

interface RuleSuggestionProps {
  /** 出す提案（無ければ入れ物だけを置く）。 */
  suggestion: RuleSuggestion | null
  /** 例外の提案なら引数なし、表記の好みの提案ならそろえる先。 */
  onAccept: (target?: string) => void
  onDecline: () => void
}

/**
 * 決まりの提案（COT-62 FR-4）。`role="status"` の入れ物は常に置き、中身だけを入れ替える
 * （後から要素ごと差し込むと読み上げられないことがあるため）。置き場所は一覧のスクロールの外（proofread-view.tsx）。
 */
export function RuleSuggestionBox({ suggestion, onAccept, onDecline }: RuleSuggestionProps) {
  return (
    <div role="status" aria-live="polite" className="px-4">
      {suggestion ? (
        <div className="mb-2 space-y-2 rounded-lg border border-primary bg-primary-container p-3 text-on-primary-container text-xs leading-relaxed">
          <p>{suggestionText(suggestion)}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestion.kind === 'exception' ? (
              <Button type="button" size="xs" onClick={() => onAccept()}>
                指摘しない
              </Button>
            ) : suggestion.to.length === 1 ? (
              <Button type="button" size="xs" onClick={() => onAccept(suggestion.to[0])}>
                {formDisplay(suggestion.variant, suggestion.to[0] as string)}にそろえる
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="xs">
                    そろえる先を選ぶ
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {suggestion.to.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => onAccept(t)}>
                      {formDisplay(suggestion.variant, t)}にそろえる
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button type="button" size="xs" variant="ghost" onClick={onDecline}>
              提案しない
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
