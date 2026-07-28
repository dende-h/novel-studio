import type { NotationKind } from './editor-pane'

interface NotationBarProps {
  onApply: (kind: NotationKind) => void
}

/** ボタンの見た目は記法そのものを見せる（アイコンより記法を覚えてもらう方が速い）。 */
const ITEMS: { kind: NotationKind; label: string; hint: string }[] = [
  { kind: 'ruby', label: 'ルビ', hint: '｜漢字《かんじ》' },
  { kind: 'dots', label: '傍点', hint: '《《強調》》' },
  // 「図鑑」はナビとパネルのトグルで既に使っているため、挿入されるもの＝参照で呼び分ける。
  { kind: 'ref', label: '参照', hint: '[[用語]]' },
]

/**
 * 狭幅（スマホ）用の記法バー。ソフトキーボードの直上に固定する。
 *
 * bottom の --ns-kb-inset は use-keyboard-inset が実測したキーボード高
 * （iOS はレイアウトビューポートを縮めないため、これが無いとキーボードの裏に入る）。
 * @サジェストのバーと同じ位置なので、サジェストが開いている間は呼び出し側が
 * こちらを出さない（排他）。
 */
export function NotationBar({ onApply }: NotationBarProps) {
  return (
    <div
      role="toolbar"
      aria-label="記法の挿入"
      aria-orientation="horizontal"
      className="fixed inset-x-0 z-30 flex gap-1.5 overflow-x-auto border-outline-variant/30 border-t bg-surface-container-lowest px-2 py-1.5 font-sans shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
      style={{ bottom: 'var(--ns-kb-inset, 0px)' }}
    >
      {ITEMS.map(({ kind, label, hint }) => (
        <button
          key={kind}
          type="button"
          title={hint}
          // タッチでは pointerdown が mousedown より先に走る。両方抑止しないと
          // textarea からフォーカスが外れ、押した瞬間にキーボードが閉じてしまう。
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onApply(kind)}
          className="flex h-11 shrink-0 items-center rounded-full border border-outline-variant/40 px-4 text-on-surface text-sm"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
