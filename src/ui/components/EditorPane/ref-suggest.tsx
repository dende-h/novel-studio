import { Plus } from 'lucide-react'
import type { GlossaryEntry } from '@/core/schema'
import { cn } from '@/lib/utils'

interface RefSuggestProps {
  candidates: GlossaryEntry[]
  /** 絞り込み文字列（クイック作成行のラベルに使う）。 */
  query: string
  /** クイック作成行を末尾に出すか。 */
  showCreate: boolean
  /** ハイライト中の項目（候補 → クイック作成行 の通し番号）。 */
  activeIndex: number
  /** キャレット直下に重ねるための座標（要素内 px）。 */
  top: number
  left: number
  listId: string
  optionId: (index: number) => string
  /** 項目の確定（index は候補→作成行の通し番号）。 */
  onCommit: (index: number) => void
  /** マウスホバーでハイライトを移す。 */
  onHover: (index: number) => void
}

/**
 * @ サジェストのポップアップ（listbox）。候補一覧＋末尾のクイック作成行を描く。
 * 矢印/Enter/Tab/Escape の操作は EditorPane の textarea 側が aria-activedescendant 経由で担うため、
 * 各 option は tabIndex=-1 のボタン（タブ順に入れず、クリックで確定）。
 * クリック時に textarea からフォーカスが外れないよう mousedown を抑止する。
 */
export function RefSuggest({
  candidates,
  query,
  showCreate,
  activeIndex,
  top,
  left,
  listId,
  optionId,
  onCommit,
  onHover,
}: RefSuggestProps) {
  const createIndex = candidates.length
  return (
    <div
      role="listbox"
      id={listId}
      aria-label="参照候補"
      className="absolute z-30 max-h-64 w-64 overflow-auto rounded-md border border-outline-variant/30 bg-surface-container-lowest py-1 font-sans text-sm shadow-lg"
      style={{ top, left }}
    >
      {candidates.map((entry, i) => (
        <button
          key={entry.id}
          type="button"
          id={optionId(i)}
          role="option"
          tabIndex={-1}
          aria-selected={i === activeIndex}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onHover(i)}
          onClick={() => onCommit(i)}
          className={cn(
            'flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-left',
            i === activeIndex ? 'bg-primary/10 text-primary' : 'text-on-surface',
          )}
        >
          <span className="truncate font-serif">{entry.name}</span>
          {entry.reading ? (
            <span className="shrink-0 text-on-surface-variant/60 text-xs">{entry.reading}</span>
          ) : null}
          {entry.category ? (
            <span className="ml-auto shrink-0 text-on-surface-variant/50 text-xs">
              {entry.category}
            </span>
          ) : null}
        </button>
      ))}
      {showCreate ? (
        <button
          type="button"
          id={optionId(createIndex)}
          role="option"
          tabIndex={-1}
          aria-selected={createIndex === activeIndex}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onHover(createIndex)}
          onClick={() => onCommit(createIndex)}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 border-outline-variant/20 px-3 py-1.5 text-left',
            candidates.length > 0 && 'border-t',
            createIndex === activeIndex ? 'bg-primary/10 text-primary' : 'text-on-surface-variant',
          )}
        >
          <Plus className="size-3.5 shrink-0" />
          <span className="truncate">「{query}」を新規作成</span>
        </button>
      ) : null}
    </div>
  )
}
