import { type NotationKind, notationItems } from './notation'

interface NotationBarProps {
  onApply: (kind: NotationKind) => void
  items?: ReturnType<typeof notationItems>
}

/**
 * 狭幅（スマホ）用の記法バー。ソフトキーボードの直上に固定する。
 *
 * bottom の --ns-kb-inset は use-keyboard-inset が実測したキーボード高
 * （iOS はレイアウトビューポートを縮めないため、これが無いとキーボードの裏に入る）。
 * @サジェストのバーと同じ位置なので、サジェストが開いている間は呼び出し側が
 * こちらを出さない（排他）。
 * タッチ操作が前提なので、PC ツールバーと違いショートカットキーは表示しない。
 * ソフトキーボードに Tab が無いため、ト書きの字下げと解除はここだけボタンで出す。
 */
export function NotationBar({ onApply, items = notationItems(false, 'mobile') }: NotationBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="記法の挿入"
      aria-orientation="horizontal"
      className="fixed inset-x-0 z-30 flex gap-1.5 overflow-x-auto border-outline-variant/30 border-t bg-surface-container-lowest px-2 py-1.5 font-sans shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
      style={{ bottom: 'var(--ns-kb-inset, 0px)' }}
    >
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          title={item.hint}
          aria-label={item.label}
          // タッチでは pointerdown が mousedown より先に走る。両方抑止しないと
          // textarea からフォーカスが外れ、押した瞬間にキーボードが閉じてしまう。
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApply(item.kind)}
          className="flex h-11 shrink-0 items-center rounded-full border border-outline-variant/40 px-4 text-on-surface text-sm"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
