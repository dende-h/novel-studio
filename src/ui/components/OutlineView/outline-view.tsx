import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  Plus,
  X,
} from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  appendNote,
  buildOutlineRows,
  type FlatNote,
  flattenNotes,
  indentNote,
  moveNote,
  type OutlineRow,
  outdentNote,
  rebuildEpisodeNotes,
  removeNoteAt,
  setNoteLabel,
  totalChars,
  writtenCount,
} from '@/core/outline'
import type { Episode } from '@/core/schema'
import type { StructureRepository } from '@/core/storage/structureRepository'
import type { Structure } from '@/core/structure'
import { ensurePrimaryStructure } from '@/ui/structure/ensure-structure'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

interface OutlineViewProps {
  repo: StructureRepository
  workId: string
  /** 本文の話一覧（順序＝双方向同期の真実）。 */
  episodes: Episode[]
  /** 話を本文エディタで開く。 */
  onOpenEpisode: (episodeId: string) => void
  /** 話を指定 id 順へ並べ替える（本文の話順を更新）。 */
  onReorder: (orderedIds: string[]) => void
}

const genId = () => crypto.randomUUID()
const fmt = (n: number) => n.toLocaleString('ja-JP')
/** 階層 1 段ぶんの字下げ幅(px)。 */
const INDENT_PX = 22

/** メモのフラット列への操作。null は no-op（保存しない）。 */
type NotesOp = (flat: FlatNote[]) => FlatNote[] | null

/**
 * アウトライン（構造レイヤー kind:outline）。話は本文と双方向同期するライブビューで、
 * ドラッグ並べ替え＝本文の話順の更新。各話の下に構成メモ（3 段までの階層・複数行）を
 * 書ける。メモはクリックでその場編集。操作はすべて即時保存（自動同期にもそのまま乗る）。
 * バンドルが重い（dnd-kit）ので default export（遅延ロード）。
 */
export default function OutlineView({
  repo,
  workId,
  episodes,
  onOpenEpisode,
  onReorder,
}: OutlineViewProps) {
  const [outline, setOutline] = useState<Structure | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      // 内容優先で 1 つに決める（無ければ決定的 id で生成）。
      const found = await ensurePrimaryStructure(repo, workId, 'outline', 'アウトライン')
      if (alive) setOutline(found)
    })()
    return () => {
      alive = false
    }
  }, [repo, workId])

  // 同期の pull がローカルを書き換えたら開いたまま反映する（メモは即時保存なので
  // 追加入力中のテキスト以外に未保存バッファが無く、常に安全に再読込できる）。
  useEffect(() => {
    return subscribeSyncApplied(() => {
      void ensurePrimaryStructure(repo, workId, 'outline', 'アウトライン').then((found) => {
        setOutline((cur) =>
          cur && found.id === cur.id && found.updatedAt === cur.updatedAt ? cur : found,
        )
      })
    })
  }, [repo, workId])

  const rows = useMemo(() => buildOutlineRows(episodes, outline), [episodes, outline])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const ids = rows.map((r) => r.episodeId)
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from < 0 || to < 0) return
      onReorder(arrayMove(ids, from, to))
    },
    [rows, onReorder],
  )

  // メモ操作の共通経路：フラット化 → 純関数で変換 → 書き戻して保存。no-op(null) は保存しない。
  const mutateNotes = useCallback(
    async (episodeId: string, op: NotesOp) => {
      if (!outline) return
      const next = op(flattenNotes(outline, episodeId))
      if (next === null) return
      setOutline(await repo.save(rebuildEpisodeNotes(outline, episodeId, next)))
    },
    [outline, repo],
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-9">
      <div className="mx-auto max-w-3xl pb-16">
        <header className="mb-5">
          <h1 className="font-semibold font-serif text-[24px] text-on-surface">アウトライン</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">
            {rows.length}話 ・ 執筆中 {writtenCount(rows)}話 ・ 通算 {fmt(totalChars(rows))}字
            <span className="ml-2 text-on-surface-variant/70">
              ドラッグで話順を入れ替えると本文にも反映されます ・ メモはクリックで編集
            </span>
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="py-16 text-center text-on-surface-variant text-sm">
            まだ話がありません。「本文を書く」から話を追加すると、ここに並びます。
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={rows.map((r) => r.episodeId)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2.5">
                {rows.map((row) => (
                  <OutlineItem
                    key={row.episodeId}
                    row={row}
                    onOpen={() => onOpenEpisode(row.episodeId)}
                    onMutateNotes={(op) => void mutateNotes(row.episodeId, op)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}

/** キー操作の凡例。入力・編集にフォーカスがある間だけ出す（求めた瞬間に見える）。 */
function KeyHints({ withMove }: { withMove: boolean }) {
  const Key = ({ children }: { children: ReactNode }) => (
    <kbd className="rounded border border-outline-variant/40 bg-surface-container-high px-1 py-px font-sans text-[10px] text-on-surface-variant">
      {children}
    </kbd>
  )
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-[11px] text-on-surface-variant/80">
      <span>
        <Key>Enter</Key> 確定
      </span>
      <span>
        <Key>Shift+Enter</Key> 改行
      </span>
      <span>
        <Key>Tab</Key> 1段下げる
      </span>
      <span>
        <Key>Shift+Tab</Key> 1段上げる
      </span>
      {withMove ? (
        <span>
          <Key>Alt+↑/↓</Key> 並び替え
        </span>
      ) : null}
      <span>
        <Key>Esc</Key> 取り消し
      </span>
    </p>
  )
}

/** 高さが内容に追従する 1 行起点の textarea（メモの追加・編集用）。 */
function AutoGrowTextarea({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // 内容の増減に高さを追従させる（scrollHeight を測るため一度 0 にする）。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useEffect(() => {
    if (autoFocus) {
      const el = ref.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    }
  }, [autoFocus])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
        const el = e.target
        el.style.height = '0'
        el.style.height = `${el.scrollHeight}px`
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full resize-none overflow-hidden bg-transparent font-sans text-[13px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45"
    />
  )
}

interface OutlineItemProps {
  row: OutlineRow
  onOpen: () => void
  /** この話のメモ列への操作を適用して保存する。 */
  onMutateNotes: (op: NotesOp) => void
}

const PROGRESS_LABEL: Record<OutlineRow['progress'], string> = {
  empty: '未着手',
  writing: '執筆中',
}

function OutlineItem({ row, onOpen, onMutateNotes }: OutlineItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.episodeId,
  })
  const [noteInput, setNoteInput] = useState('')
  // 追加するメモの深さ（Tab/Shift+Tab で調整）。追加欄の字下げでプレビューする。
  const [addDepth, setAddDepth] = useState(0)
  const [addFocused, setAddFocused] = useState(false)
  // インライン編集の対象と下書き。確定＝保存、Esc＝破棄。
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)

  const lastDepth = row.notes[row.notes.length - 1]?.depth ?? -1
  const maxAddDepth = Math.min(lastDepth + 1, 2)
  const clampedAddDepth = Math.max(0, Math.min(addDepth, maxAddDepth))

  const submitNote = () => {
    const label = noteInput.trim()
    if (label === '') return
    onMutateNotes((flat) => appendNote(flat, genId(), label, clampedAddDepth))
    setNoteInput('')
  }

  const confirmEdit = () => {
    if (!editing) return
    const label = editing.draft.trim()
    // 空にして確定は「取り消し」と同じ扱い（削除は ✕ ボタンでだけ起きる）。
    if (label !== '') {
      const id = editing.id
      onMutateNotes((flat) => setNoteLabel(flat, id, label))
    }
    setEditing(null)
  }

  /** 編集中のキー操作。階層・並び替えは下書きを保ったまま即時反映する。 */
  const onEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editing) return
    const id = editing.id
    const draft = editing.draft
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      confirmEdit()
    } else if (e.key === 'Escape') {
      setEditing(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onMutateNotes((flat) => {
        const kept = draft.trim() === '' ? flat : setNoteLabel(flat, id, draft.trim())
        return e.shiftKey ? outdentNote(kept, id) : indentNote(kept, id)
      })
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      onMutateNotes((flat) => moveNote(flat, id, e.key === 'ArrowUp' ? -1 : 1))
    }
  }

  const onAddKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitNote()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setAddDepth(Math.max(0, Math.min(clampedAddDepth + (e.shiftKey ? -1 : 1), maxAddDepth)))
    } else if (e.key === 'Escape') {
      setNoteInput('')
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-outline-variant/30 bg-surface-container-lowest ${
        isDragging ? 'opacity-60 shadow-md' : ''
      }`}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          aria-label="ドラッグで並べ替え"
          className="cursor-grab touch-none text-on-surface-variant/50 hover:text-on-surface-variant active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[11px] ${
            row.progress === 'writing'
              ? 'bg-primary/12 text-primary'
              : 'bg-surface-container-high text-on-surface-variant'
          }`}
        >
          {PROGRESS_LABEL[row.progress]}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium font-sans text-[14px] text-on-surface">
          {row.title || '無題の話'}
        </span>
        <span className="shrink-0 text-[12px] text-on-surface-variant tabular-nums">
          {fmt(row.chars)}字
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
        >
          本文へ
          <ArrowRight className="size-3.5" />
        </button>
      </div>

      {/* 構成メモ（3 段までの階層・クリックで編集） */}
      <div className="border-outline-variant/20 border-t px-3 py-2.5">
        {row.notes.length > 0 ? (
          <ul className="mb-1.5 flex flex-col gap-1">
            {row.notes.map((n) => (
              <li
                key={n.id}
                style={{ paddingLeft: n.depth * INDENT_PX }}
                className="group text-[13px] text-on-surface-variant"
              >
                <div
                  className={`flex items-start gap-2 ${
                    n.depth > 0 ? 'border-outline-variant/30 border-l pl-2.5' : ''
                  }`}
                >
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-on-surface-variant/40" />
                  {editing?.id === n.id ? (
                    <div className="min-w-0 flex-1">
                      <AutoGrowTextarea
                        value={editing.draft}
                        onChange={(v) => setEditing({ id: n.id, draft: v })}
                        onKeyDown={onEditKeyDown}
                        onBlur={confirmEdit}
                        ariaLabel="構成メモを編集"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing({ id: n.id, draft: n.label })}
                      className="min-w-0 flex-1 cursor-text whitespace-pre-wrap break-words rounded text-left leading-relaxed hover:bg-surface-container-high/60"
                      title="クリックで編集"
                    >
                      {n.label}
                    </button>
                  )}
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <NoteButton
                      label="1段上げる（Shift+Tab）"
                      disabled={n.depth === 0}
                      onClick={() => onMutateNotes((flat) => outdentNote(flat, n.id))}
                    >
                      <IndentDecrease className="size-3.5" />
                    </NoteButton>
                    <NoteButton
                      label="1段下げる（Tab）"
                      onClick={() => onMutateNotes((flat) => indentNote(flat, n.id))}
                    >
                      <IndentIncrease className="size-3.5" />
                    </NoteButton>
                    <NoteButton
                      label="上へ移動（Alt+↑）"
                      onClick={() => onMutateNotes((flat) => moveNote(flat, n.id, -1))}
                    >
                      <ArrowUp className="size-3.5" />
                    </NoteButton>
                    <NoteButton
                      label="下へ移動（Alt+↓）"
                      onClick={() => onMutateNotes((flat) => moveNote(flat, n.id, 1))}
                    >
                      <ArrowDown className="size-3.5" />
                    </NoteButton>
                    <NoteButton
                      label="このメモを削除（子は 1 段上がって残る）"
                      onClick={() => onMutateNotes((flat) => removeNoteAt(flat, n.id))}
                    >
                      <X className="size-3.5" />
                    </NoteButton>
                  </span>
                </div>
                {editing?.id === n.id ? <KeyHints withMove /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div
          className="flex items-start gap-1.5"
          style={{ paddingLeft: clampedAddDepth * INDENT_PX }}
        >
          <Plus className="mt-0.5 size-3.5 shrink-0 text-on-surface-variant/50" />
          <AutoGrowTextarea
            value={noteInput}
            onChange={setNoteInput}
            onKeyDown={onAddKeyDown}
            onFocus={() => setAddFocused(true)}
            onBlur={() => {
              setAddFocused(false)
              submitNote() // 書きかけを黙って捨てない（フォーカスが外れたら確定）
            }}
            placeholder="構成メモを追加（Enter で確定）"
            ariaLabel={`${row.title || '無題の話'}に構成メモを追加`}
          />
        </div>
        {addFocused ? <KeyHints withMove={false} /> : null}
      </div>
    </li>
  )
}

/** メモ行のホバー操作ボタン（ツールチップにキー操作を併記）。 */
function NoteButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      // メモ編集中に blur（確定）より先に押下を処理する
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-0.5 text-on-surface-variant/40 transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
