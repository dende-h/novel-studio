import { cn } from '@/lib/utils'

/**
 * 丸いチップ（用語集画面の絞り込み・対話の選択肢・スキップ）。押されている／主の操作は塗り、
 * それ以外は輪郭だけ。タッチでは 44px 目安のタップ領域を確保し、ポインタ環境では密度を戻す。
 */
export function Pill({
  label,
  note,
  active,
  ghost,
  blank,
  pressed,
  onClick,
  className,
}: {
  label: string
  /** ラベルの右に添える小さな注記（「あとで」「未回答」）。 */
  note?: string
  /** 塗り（絞り込み中・主の操作）。 */
  active?: boolean
  /** 控えめ（スキップ・あとで）。 */
  ghost?: boolean
  /** 未回答の印（破線）。 */
  blank?: boolean
  /** aria-pressed を持つトグル（絞り込みチップ）。 */
  pressed?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-2 font-sans text-[12.5px] transition-colors md:py-1',
        active
          ? 'border-primary bg-primary text-white hover:bg-primary/90'
          : 'border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:border-primary/50 hover:bg-accent',
        ghost && !active && 'text-on-surface-variant',
        blank && 'border-dashed',
        className,
      )}
    >
      {label}
      {note ? <span className="ml-1 text-[10.5px] text-on-surface-variant/70">{note}</span> : null}
    </button>
  )
}
