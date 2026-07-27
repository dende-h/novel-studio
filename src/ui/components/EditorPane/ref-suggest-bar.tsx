import { Plus } from 'lucide-react'
import type { RefSuggestion } from '@/core/glossary'

interface RefSuggestBarProps {
  candidates: RefSuggestion[]
  /** 絞り込み文字列（クイック作成チップのラベルに使う）。 */
  query: string
  /** クイック作成チップを末尾に出すか。 */
  showCreate: boolean
  listId: string
  optionId: (index: number) => string
  /** 項目の確定（index は候補→作成行の通し番号）。 */
  onCommit: (index: number) => void
}

/**
 * 狭幅（スマホ）用の @ サジェスト。ソフトキーボードの直上に横 1 列で並べる。
 *
 * キャレット追従のポップアップ（RefSuggest）は、画面端でのはみ出し・上下反転・
 * visualViewport 追従をすべて正しく実装しないとキーボードの裏に隠れる。ここでは
 * 座標計算そのものを捨てて画面下端に固定し、堅牢性を取っている（D-EDIT-5）。
 *
 * bottom の --ns-kb-inset は use-keyboard-inset が実測したキーボード高。iOS は
 * レイアウトビューポートを縮めないため、これが無いとバーがキーボードの裏に入る。
 *
 * ハイライト（activeIndex）の概念は持たない＝確定はタップのみ。したがって
 * 呼び出し側は narrow のとき aria-activedescendant を付けないこと。
 */
export function RefSuggestBar({
  candidates,
  query,
  showCreate,
  listId,
  optionId,
  onCommit,
}: RefSuggestBarProps) {
  const createIndex = candidates.length
  return (
    <div
      role="listbox"
      id={listId}
      aria-label="参照候補"
      className="fixed inset-x-0 z-40 flex gap-1.5 overflow-x-auto border-outline-variant/30 border-t bg-surface-container-lowest px-2 py-1.5 font-sans shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
      style={{ bottom: 'var(--ns-kb-inset, 0px)' }}
    >
      {candidates.map((item, i) => (
        <button
          key={`${item.entry.id}::${item.name}`}
          type="button"
          id={optionId(i)}
          role="option"
          tabIndex={-1}
          aria-selected={false}
          // タッチでは mousedown より先に pointerdown が走る。両方抑止して
          // textarea からフォーカスが外れる（＝キーボードが閉じる）のを防ぐ。
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(i)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-outline-variant/40 px-3.5 text-on-surface text-sm"
        >
          <span className="font-serif">{item.name}</span>
          {item.isAlias ? (
            <span className="text-on-surface-variant/50 text-xs">→ {item.entry.name}</span>
          ) : null}
        </button>
      ))}
      {showCreate ? (
        <button
          type="button"
          id={optionId(createIndex)}
          role="option"
          tabIndex={-1}
          aria-selected={false}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit(createIndex)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-wheat-500/50 border-dashed px-3.5 text-sm text-wheat-700"
        >
          <Plus className="size-3.5 shrink-0" aria-hidden />
          <span className="whitespace-nowrap">「{query}」を作成</span>
        </button>
      ) : null}
    </div>
  )
}
