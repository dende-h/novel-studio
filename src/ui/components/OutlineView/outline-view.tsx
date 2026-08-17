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
import { ArrowRight, GripVertical, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildOutlineRows, type OutlineRow, totalChars, writtenCount } from '@/core/outline'
import type { Episode } from '@/core/schema'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { addNode, removeNode, type Structure } from '@/core/structure'
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

/**
 * アウトライン（構造レイヤー kind:outline）。話は本文と双方向同期するライブビューで、
 * ドラッグ並べ替え＝本文の話順の更新。各話の下に構成メモ（子ノード）を足せる。
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

  // 同期の pull がローカルを書き換えたら開いたまま反映する（構成メモは即時保存なので
  // 未保存バッファが無く、常に安全に再読込できる）。
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

  const addNote = useCallback(
    async (episodeId: string, label: string) => {
      if (!outline || label.trim() === '') return
      const next = addNode(outline, {
        id: genId(),
        kind: 'note',
        label: label.trim(),
        episodeRef: episodeId,
      })
      setOutline(await repo.save(next))
    },
    [outline, repo],
  )

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!outline) return
      setOutline(await repo.save(removeNode(outline, noteId)))
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
              ドラッグで話順を入れ替えると本文にも反映されます
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
                    onAddNote={(label) => void addNote(row.episodeId, label)}
                    onDeleteNote={(id) => void deleteNote(id)}
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

interface OutlineItemProps {
  row: OutlineRow
  onOpen: () => void
  onAddNote: (label: string) => void
  onDeleteNote: (noteId: string) => void
}

const PROGRESS_LABEL: Record<OutlineRow['progress'], string> = {
  empty: '未着手',
  writing: '執筆中',
}

function OutlineItem({ row, onOpen, onAddNote, onDeleteNote }: OutlineItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.episodeId,
  })
  const [noteInput, setNoteInput] = useState('')

  const submitNote = () => {
    if (noteInput.trim() === '') return
    onAddNote(noteInput)
    setNoteInput('')
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

      {/* 構成メモ（子ノード） */}
      <div className="border-outline-variant/20 border-t px-3 py-2.5">
        {row.notes.length > 0 ? (
          <ul className="mb-1.5 flex flex-col gap-1">
            {row.notes.map((n) => (
              <li
                key={n.id}
                className="group flex items-start gap-2 text-[13px] text-on-surface-variant"
              >
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-on-surface-variant/40" />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{n.label}</span>
                <button
                  type="button"
                  aria-label="このメモを削除"
                  onClick={() => onDeleteNote(n.id)}
                  className="shrink-0 rounded p-0.5 text-on-surface-variant/40 opacity-0 transition-all hover:bg-surface-container-high hover:text-on-surface group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Plus className="size-3.5 shrink-0 text-on-surface-variant/50" />
          <input
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitNote()
              }
            }}
            placeholder="構成メモを追加（Enter）"
            aria-label={`${row.title || '無題の話'}に構成メモを追加`}
            className="w-full bg-transparent font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
          />
        </div>
      </div>
    </li>
  )
}
