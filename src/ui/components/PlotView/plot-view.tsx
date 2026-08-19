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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpToLine,
  GripVertical,
  Plus,
  StickyNote,
  X,
} from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IdeaNote } from '@/core/idea'
import {
  addBeat,
  addSection,
  beatsOfSection,
  moveBeat,
  nextBeatStatus,
  PLOT_TEMPLATES,
  type Plot,
  type PlotBeat,
  type PlotBeatStatus,
  type PlotSection,
  type PlotTemplate,
  pickPrimaryPlot,
  removeBeat,
  removeSection,
  sectionTargetTotal,
  singletonPlotId,
  updateBeat,
  updateSection,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { PlotRepository } from '@/core/storage/plotRepository'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

interface PlotViewProps {
  repo: PlotRepository
  workId: string
  /** 図鑑（視点・登場・舞台チップの解決先）。 */
  glossary: GlossaryEntry[]
  /** 本文の話一覧（ビートと話の紐付け先）。 */
  episodes: Episode[]
  /** ネタ帳（ビートの種の取り込み元）。省略時は取り込み導線を出さない。 */
  ideaRepo?: IdeaRepository
  /** 話を本文エディタで開く。 */
  onOpenEpisode: (episodeId: string) => void
}

const genId = () => crypto.randomUUID()
const fmt = (n: number) => n.toLocaleString('ja-JP')
/** 空文字は未設定(undefined)へ畳む（スキーマの任意項目を綺麗に保つ）。 */
const emptyToUndef = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim())

const STATUS_UI: Record<PlotBeatStatus, { label: string; className: string }> = {
  idea: { label: '検討中', className: 'bg-surface-container-high text-on-surface-variant' },
  fixed: { label: '確定', className: 'bg-secondary-container text-on-secondary-container' },
  writing: { label: '執筆中', className: 'bg-primary/12 text-primary' },
  done: { label: '済', className: 'bg-primary text-primary-foreground' },
}

/**
 * プロット（幕×ビートの物語設計）。ビートシートを縦一列で表示し、カードのクリックで
 * その場編集する。操作はすべて即時保存（自動同期にもそのまま乗る）。
 * バンドルが重い（dnd-kit）ので default export（遅延ロード）。
 */
export default function PlotView({
  repo,
  workId,
  glossary,
  episodes,
  ideaRepo,
  onOpenEpisode,
}: PlotViewProps) {
  const [plot, setPlot] = useState<Plot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    let alive = true
    void repo.listByWork(workId).then((list) => {
      if (!alive) return
      setPlot(pickPrimaryPlot(list) ?? null)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [repo, workId])

  // 同期の pull がローカルを書き換えたら開いたまま反映する（編集の下書きはビート単位の
  // ローカル state に持っており、確定済みデータの再読込とは衝突しない）。
  useEffect(() => {
    return subscribeSyncApplied(() => {
      void repo.listByWork(workId).then((list) => {
        const found = pickPrimaryPlot(list)
        setPlot((cur) =>
          cur && found && found.id === cur.id && found.updatedAt === cur.updatedAt
            ? cur
            : (found ?? null),
        )
      })
    })
  }, [repo, workId])

  // 変更の共通経路：純関数で変換 → 保存（updatedAt 刻印）→ 表示を保存後の状態に揃える。
  const apply = useCallback(
    async (fn: (p: Plot) => Plot) => {
      if (!plot) return
      const next = fn(plot)
      if (next === plot) return // no-op（見つからない等）は保存しない
      setPlot(await repo.save(next))
    },
    [plot, repo],
  )

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!plot || !over || active.id === over.id) return
      // 並べ替えは同一幕内のみ（幕またぎはカードの「前の幕へ／次の幕へ」で行う）。
      const section = plot.sections.find((s) => s.beatIds.includes(String(active.id)))
      if (!section?.beatIds.includes(String(over.id))) return
      const to = section.beatIds.indexOf(String(over.id))
      void apply((p) => moveBeat(p, String(active.id), section.id, to))
    },
    [plot, apply],
  )

  if (!loaded) return null

  if (!plot) {
    return (
      <TemplatePicker
        onPick={async (template) => {
          // 決定的 id＝どの端末が作っても同じレコードへ収束（同期レースで増殖しない）。
          setPlot(await repo.create(workId, template, undefined, singletonPlotId(workId)))
        }}
      />
    )
  }

  const doneCount = plot.beats.filter((b) => b.status === 'done').length
  const totalTarget = plot.beats.reduce((sum, b) => sum + (b.targetLength ?? 0), 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-9">
      <div className="mx-auto max-w-3xl pb-16">
        <header className="mb-5">
          <h1 className="font-semibold font-serif text-[24px] text-on-surface">プロット</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">
            {plot.beats.length}ビート ・ 済 {doneCount}件
            {totalTarget > 0 ? ` ・ 予定合計 ${fmt(totalTarget)}字` : ''}
            <span className="ml-2 text-on-surface-variant/70">
              カードをクリックで編集 ・ ドラッグで並べ替え ・ 状態はチップをクリックで切替
            </span>
          </p>
          <PremiseInput
            value={plot.premise ?? ''}
            onCommit={(v) => void apply((p) => ({ ...p, premise: emptyToUndef(v) }))}
          />
        </header>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <div className="flex flex-col gap-6">
            {plot.sections.map((section, sectionIndex) => (
              <SectionBlock
                key={section.id}
                plot={plot}
                section={section}
                isFirst={sectionIndex === 0}
                isLast={sectionIndex === plot.sections.length - 1}
                canRemove={plot.sections.length > 1}
                glossary={glossary}
                episodes={episodes}
                ideaRepo={ideaRepo}
                expandedId={expandedId}
                onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                onApply={(fn) => void apply(fn)}
                onOpenEpisode={onOpenEpisode}
                onRequestDeleteBeat={(beat) =>
                  setDeleteTarget({ id: beat.id, title: beat.title || '無題のビート' })
                }
              />
            ))}
          </div>
        </DndContext>

        <button
          type="button"
          onClick={() =>
            void apply((p) =>
              addSection(p, { id: genId(), title: `第${p.sections.length + 1}幕`, beatIds: [] }),
            )
          }
          className="mt-6 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-primary transition-colors hover:bg-surface-container-high"
        >
          <Plus className="size-4" />
          幕を追加
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="ビートを削除"
        description={`「${deleteTarget?.title ?? ''}」を削除します。元に戻せません。`}
        onConfirm={() => {
          if (!deleteTarget) return
          const id = deleteTarget.id
          setExpandedId((cur) => (cur === id ? null : cur))
          void apply((p) => removeBeat(p, id))
        }}
      />
    </div>
  )
}

/** ログライン（プロットの一行要約）。blur / Enter で確定する。 */
function PremiseInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  // 同期 pull などで確定値が変わったら下書きも追随させる（編集中は input がフォーカスを持つ）。
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      placeholder="ログライン：この物語を一行で言うと？"
      aria-label="ログライン"
      className="mt-3 w-full rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
    />
  )
}

/** 新規作成時のテンプレート選択。 */
function TemplatePicker({ onPick }: { onPick: (template: PlotTemplate) => void }) {
  const entries = Object.entries(PLOT_TEMPLATES) as Array<
    [Exclude<PlotTemplate, 'custom'>, (typeof PLOT_TEMPLATES)[keyof typeof PLOT_TEMPLATES]]
  >
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-9">
      <div className="mx-auto max-w-2xl pb-16">
        <header className="mt-4 mb-6 text-center">
          <h1 className="font-semibold font-serif text-[24px] text-on-surface">プロットを作る</h1>
          <p className="mt-2 text-[13px] text-on-surface-variant">
            型から始めると、幕とガイド付きのビートが用意されます。あとから自由に組み替えられます。
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map(([key, def]) => (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-container-low"
            >
              <div className="font-medium font-sans text-[15px] text-on-surface">{def.label}</div>
              <p className="mt-1 text-[12px] text-on-surface-variant leading-relaxed">
                {def.description}
              </p>
              <p className="mt-2 text-[11px] text-on-surface-variant/60">
                {def.sections.map((s) => s.title).join(' ・ ')}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onPick('custom')}
            className="rounded-lg border border-outline-variant/30 border-dashed bg-transparent p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-container-low"
          >
            <div className="font-medium font-sans text-[15px] text-on-surface">白紙から</div>
            <p className="mt-1 text-[12px] text-on-surface-variant leading-relaxed">
              幕もビートも自分で組む。空の幕がひとつだけ用意されます。
            </p>
          </button>
        </div>
      </div>
    </div>
  )
}

interface SectionBlockProps {
  plot: Plot
  section: PlotSection
  isFirst: boolean
  isLast: boolean
  canRemove: boolean
  glossary: GlossaryEntry[]
  episodes: Episode[]
  ideaRepo?: IdeaRepository
  expandedId: string | null
  onToggleExpand: (beatId: string) => void
  onApply: (fn: (p: Plot) => Plot) => void
  onOpenEpisode: (episodeId: string) => void
  onRequestDeleteBeat: (beat: PlotBeat) => void
}

function SectionBlock({
  plot,
  section,
  isFirst,
  isLast,
  canRemove,
  glossary,
  episodes,
  ideaRepo,
  expandedId,
  onToggleExpand,
  onApply,
  onOpenEpisode,
  onRequestDeleteBeat,
}: SectionBlockProps) {
  const beats = beatsOfSection(plot, section.id)
  const target = sectionTargetTotal(plot, section.id)
  const [addInput, setAddInput] = useState('')
  const [ideasOpen, setIdeasOpen] = useState(false)

  const submitAdd = () => {
    const title = addInput.trim()
    if (title === '') return
    onApply((p) =>
      addBeat(p, section.id, {
        id: genId(),
        title,
        castRefs: [],
        placeRefs: [],
        lineRefs: [],
        status: 'idea',
      }),
    )
    setAddInput('')
  }

  const onAddKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitAdd()
    } else if (e.key === 'Escape') {
      setAddInput('')
    }
  }

  return (
    <section>
      <div className="group flex items-baseline gap-2">
        <SectionTitleInput
          value={section.title}
          onCommit={(v) => onApply((p) => updateSection(p, section.id, { title: v }))}
        />
        <span className="shrink-0 text-[12px] text-on-surface-variant tabular-nums">
          {beats.length}ビート{target > 0 ? ` ・ 予定 ${fmt(target)}字` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {ideaRepo ? (
            <HoverButton label="ネタ帳からビートを取り込む" onClick={() => setIdeasOpen((v) => !v)}>
              <StickyNote className="size-3.5" />
            </HoverButton>
          ) : null}
          <HoverButton
            label="幕を削除（ビートは隣の幕へ移動）"
            disabled={!canRemove}
            onClick={() => onApply((p) => removeSection(p, section.id))}
          >
            <X className="size-3.5" />
          </HoverButton>
        </span>
      </div>

      {ideaRepo && ideasOpen ? (
        <IdeaPickerPanel
          ideaRepo={ideaRepo}
          onPick={(note) => {
            setIdeasOpen(false)
            onApply((p) =>
              addBeat(p, section.id, {
                id: genId(),
                title: ideaTitleOf(note),
                summary: note.text,
                ideaRef: note.id,
                castRefs: [],
                placeRefs: [],
                lineRefs: [],
                status: 'idea',
              }),
            )
          }}
          onClose={() => setIdeasOpen(false)}
        />
      ) : null}

      <SortableContext items={section.beatIds} strategy={verticalListSortingStrategy}>
        <ul className="mt-2 flex flex-col gap-2">
          {beats.map((beat) => (
            <BeatCard
              key={beat.id}
              beat={beat}
              expanded={expandedId === beat.id}
              canMoveUp={!isFirst}
              canMoveDown={!isLast}
              glossary={glossary}
              episodes={episodes}
              onToggleExpand={() => onToggleExpand(beat.id)}
              onApply={onApply}
              onMoveToNeighbor={(dir) => {
                const sections = plot.sections
                const idx = sections.findIndex((s) => s.id === section.id)
                const neighbor = sections[idx + dir]
                if (!neighbor) return
                // 前の幕へは末尾、次の幕へは先頭に入れる（読み順が繋がる位置）。
                const at = dir === -1 ? neighbor.beatIds.length : 0
                onApply((p) => moveBeat(p, beat.id, neighbor.id, at))
              }}
              onOpenEpisode={onOpenEpisode}
              onRequestDelete={() => onRequestDeleteBeat(beat)}
            />
          ))}
        </ul>
      </SortableContext>

      <div className="mt-2 flex items-center gap-1.5 pl-1">
        <Plus className="size-3.5 shrink-0 text-on-surface-variant/50" />
        <input
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={onAddKeyDown}
          onBlur={submitAdd}
          placeholder="ビートを追加（Enter で確定）"
          aria-label={`${section.title}にビートを追加`}
          className="w-full bg-transparent font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
        />
      </div>
    </section>
  )
}

/** 幕タイトルのその場編集。blur / Enter で確定、空にしたら元へ戻す。 */
function SectionTitleInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        const t = draft.trim()
        if (t === '') setDraft(value)
        else if (t !== value) onCommit(t)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      aria-label="幕のタイトル"
      className="min-w-0 flex-1 bg-transparent font-semibold font-serif text-[17px] text-on-surface outline-none focus:border-primary/50 focus:border-b"
    />
  )
}

interface BeatCardProps {
  beat: PlotBeat
  expanded: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  glossary: GlossaryEntry[]
  episodes: Episode[]
  onToggleExpand: () => void
  onApply: (fn: (p: Plot) => Plot) => void
  /** -1＝前の幕の末尾へ、+1＝次の幕の先頭へ移す。 */
  onMoveToNeighbor: (dir: -1 | 1) => void
  onOpenEpisode: (episodeId: string) => void
  onRequestDelete: () => void
}

function BeatCard({
  beat,
  expanded,
  canMoveUp,
  canMoveDown,
  glossary,
  episodes,
  onToggleExpand,
  onApply,
  onMoveToNeighbor,
  onOpenEpisode,
  onRequestDelete,
}: BeatCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: beat.id,
  })
  const status = STATUS_UI[beat.status]
  const pov = beat.povRef ? glossary.find((g) => g.id === beat.povRef) : undefined
  const episode = beat.episodeRef ? episodes.find((e) => e.id === beat.episodeRef) : undefined
  const preview = beat.summary?.trim() || ''

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group rounded-lg border bg-surface-container-lowest ${
        beat.status === 'idea'
          ? 'border-outline-variant/40 border-dashed'
          : 'border-outline-variant/30'
      } ${isDragging ? 'opacity-60 shadow-md' : ''}`}
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
        <button
          type="button"
          onClick={() =>
            onApply((p) => updateBeat(p, beat.id, { status: nextBeatStatus(beat.status) }))
          }
          title="クリックで状態を切替（検討中→確定→執筆中→済）"
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[11px] transition-colors ${status.className}`}
        >
          {status.label}
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 truncate text-left font-medium font-sans text-[14px] text-on-surface"
          title="クリックで詳細を開閉"
        >
          {beat.title || '無題のビート'}
        </button>
        {pov ? (
          <span
            title={pov.summary}
            className="inline-flex shrink-0 items-center rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground"
          >
            POV: {pov.name}
          </span>
        ) : null}
        {beat.targetLength ? (
          <span className="shrink-0 text-[12px] text-on-surface-variant tabular-nums">
            {fmt(beat.targetLength)}字
          </span>
        ) : null}
        {episode ? (
          <button
            type="button"
            onClick={() => onOpenEpisode(episode.id)}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
          >
            {episode.title || '無題の話'}
            <ArrowRight className="size-3.5" />
          </button>
        ) : null}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <HoverButton
            label="前の幕へ移す"
            disabled={!canMoveUp}
            onClick={() => onMoveToNeighbor(-1)}
          >
            <ArrowUpToLine className="size-3.5" />
          </HoverButton>
          <HoverButton
            label="次の幕へ移す"
            disabled={!canMoveDown}
            onClick={() => onMoveToNeighbor(1)}
          >
            <ArrowDownToLine className="size-3.5" />
          </HoverButton>
          <HoverButton label="このビートを削除" onClick={onRequestDelete}>
            <X className="size-3.5" />
          </HoverButton>
        </span>
      </div>
      {!expanded && (preview || beat.guide) ? (
        <p
          className={`px-10 pb-3 text-[12.5px] leading-relaxed ${
            preview ? 'text-on-surface-variant' : 'text-on-surface-variant/50'
          }`}
        >
          {preview || beat.guide}
        </p>
      ) : null}
      {expanded ? (
        <BeatEditor
          beat={beat}
          glossary={glossary}
          episodes={episodes}
          onApply={onApply}
          onOpenEpisode={onOpenEpisode}
          onRequestDelete={onRequestDelete}
        />
      ) : null}
    </li>
  )
}

interface BeatEditorProps {
  beat: PlotBeat
  glossary: GlossaryEntry[]
  episodes: Episode[]
  onApply: (fn: (p: Plot) => Plot) => void
  onOpenEpisode: (episodeId: string) => void
  onRequestDelete: () => void
}

/** ビートの詳細編集。テキストは blur で確定、選択系は即時反映。 */
function BeatEditor({
  beat,
  glossary,
  episodes,
  onApply,
  onOpenEpisode,
  onRequestDelete,
}: BeatEditorProps) {
  const patch = (p: Partial<Omit<PlotBeat, 'id'>>) => onApply((pl) => updateBeat(pl, beat.id, p))

  return (
    <div className="border-outline-variant/20 border-t px-4 py-3">
      <div className="flex flex-col gap-3">
        <Field label="タイトル">
          <CommitInput
            value={beat.title}
            onCommit={(v) => {
              const t = v.trim()
              if (t !== '') patch({ title: t })
            }}
            ariaLabel="ビートのタイトル"
          />
        </Field>
        <Field label="何が起きるか">
          <CommitTextarea
            value={beat.summary ?? ''}
            onCommit={(v) => patch({ summary: emptyToUndef(v) })}
            placeholder={beat.guide ?? '何が起きるかを数行で'}
            ariaLabel="ビートの要約"
          />
        </Field>
        <Field label="メモ">
          <CommitTextarea
            value={beat.note ?? ''}
            onCommit={(v) => patch({ note: emptyToUndef(v) })}
            placeholder="狙い・代案・保留メモ"
            ariaLabel="ビートのメモ"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="作中時間">
            <CommitInput
              value={beat.timeLabel ?? ''}
              onCommit={(v) => patch({ timeLabel: emptyToUndef(v) })}
              placeholder="例：三日後の夜"
              ariaLabel="作中時間"
            />
          </Field>
          <Field label="予定字数">
            <CommitInput
              value={beat.targetLength ? String(beat.targetLength) : ''}
              onCommit={(v) => {
                const n = Number.parseInt(v.replaceAll(',', ''), 10)
                patch({ targetLength: Number.isFinite(n) && n > 0 ? n : undefined })
              }}
              placeholder="例：8000"
              inputMode="numeric"
              ariaLabel="予定字数"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="視点（POV）">
            {glossary.length > 0 ? (
              <SelectBox
                value={beat.povRef ?? ''}
                onChange={(v) => patch({ povRef: v === '' ? undefined : v })}
                ariaLabel="視点キャラ"
                options={[
                  { value: '', label: '（未設定）' },
                  ...glossary.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            ) : (
              <GlossaryHint />
            )}
          </Field>
          <Field label="対応する話">
            <div className="flex items-center gap-1.5">
              <SelectBox
                value={beat.episodeRef ?? ''}
                onChange={(v) => patch({ episodeRef: v === '' ? undefined : v })}
                ariaLabel="対応する話"
                options={[
                  { value: '', label: '（未対応）' },
                  ...episodes.map((e) => ({ value: e.id, label: e.title || '無題の話' })),
                ]}
              />
              {beat.episodeRef ? (
                <button
                  type="button"
                  onClick={() => beat.episodeRef && onOpenEpisode(beat.episodeRef)}
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
                >
                  開く
                  <ArrowRight className="size-3.5" />
                </button>
              ) : null}
            </div>
          </Field>
        </div>
        {glossary.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <RefChips
              label="登場"
              ids={beat.castRefs}
              glossary={glossary}
              onChange={(ids) => patch({ castRefs: ids })}
            />
            <RefChips
              label="舞台"
              ids={beat.placeRefs}
              glossary={glossary}
              onChange={(ids) => patch({ placeRefs: ids })}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between pt-1">
          {beat.ideaRef ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant/70">
              <StickyNote className="size-3" />
              ネタ帳のメモから作成
            </span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md px-2 py-1 text-[12px] text-error transition-colors hover:bg-error-container"
          >
            ビートを削除
          </button>
        </div>
      </div>
    </div>
  )
}

/** ラベル＋フィールドの縦組み。中の入力は aria-label で名前を持つ（label 要素にしない）。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-[11px] text-on-surface-variant/70 tracking-wide">
        {label}
      </span>
      {children}
    </div>
  )
}

/** blur / Enter で確定する 1 行入力。確定値が外から変わったら（同期 pull）追随する。 */
function CommitInput({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  inputMode,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  inputMode?: 'numeric'
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      inputMode={inputMode}
      className="w-full rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
    />
  )
}

/** blur で確定する自動伸長テキストエリア。 */
function CommitTextarea({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  // 内容の増減に高さを追従させる（scrollHeight を測るため一度 0 にする）。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  return (
    <textarea
      ref={ref}
      rows={2}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const el = e.target
        el.style.height = '0'
        el.style.height = `${el.scrollHeight}px`
      }}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(value)
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full resize-none overflow-hidden rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-[13px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
    />
  )
}

function SelectBox({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  ariaLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="w-full rounded-md border border-outline-variant/30 bg-surface px-2 py-1.5 text-[13px] text-on-surface outline-none focus:border-primary/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** 図鑑エントリの複数選択（登場・舞台）。チップ＋追加セレクト。 */
function RefChips({
  label,
  ids,
  glossary,
  onChange,
}: {
  label: string
  ids: string[]
  glossary: GlossaryEntry[]
  onChange: (ids: string[]) => void
}) {
  const byId = useMemo(() => new Map(glossary.map((g) => [g.id, g])), [glossary])
  const remaining = glossary.filter((g) => !ids.includes(g.id))
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-[11px] text-on-surface-variant/70 tracking-wide">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id) => {
          const entry = byId.get(id)
          return (
            <span
              key={id}
              title={entry?.summary}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground"
            >
              {entry?.name ?? '（削除済み）'}
              <button
                type="button"
                aria-label={`${entry?.name ?? 'この項目'}を外す`}
                onClick={() => onChange(ids.filter((x) => x !== id))}
                className="text-accent-foreground/60 hover:text-accent-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        {remaining.length > 0 ? (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value !== '') onChange([...ids, e.target.value])
            }}
            aria-label={`${label}を追加`}
            className="rounded-md border border-outline-variant/30 bg-surface px-1.5 py-0.5 text-[11px] text-on-surface-variant outline-none focus:border-primary/50"
          >
            <option value="">＋ 追加</option>
            {remaining.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  )
}

function GlossaryHint() {
  return (
    <p className="text-[12px] text-on-surface-variant/60">
      図鑑にキャラ・場所を登録すると、ここで選べるようになります。
    </p>
  )
}

/** ネタ帳のメモ一覧から 1 件選んでビートの種にする。 */
function IdeaPickerPanel({
  ideaRepo,
  onPick,
  onClose,
}: {
  ideaRepo: IdeaRepository
  onPick: (note: IdeaNote) => void
  onClose: () => void
}) {
  const [ideas, setIdeas] = useState<IdeaNote[] | null>(null)
  useEffect(() => {
    let alive = true
    void ideaRepo.list().then((list) => {
      if (alive) setIdeas(list)
    })
    return () => {
      alive = false
    }
  }, [ideaRepo])
  return (
    <div className="mt-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-2">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[11px] text-on-surface-variant/70">
          ネタ帳から選ぶ（メモは残ります）
        </span>
        <HoverButton label="閉じる" onClick={onClose}>
          <X className="size-3.5" />
        </HoverButton>
      </div>
      {ideas === null ? (
        <p className="px-1 py-2 text-[12px] text-on-surface-variant/60">読み込み中…</p>
      ) : ideas.length === 0 ? (
        <p className="px-1 py-2 text-[12px] text-on-surface-variant/60">
          ネタ帳にメモがありません。思いつきはネタ帳へどうぞ。
        </p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {ideas.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => onPick(note)}
                className="w-full whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-left text-[12.5px] text-on-surface leading-relaxed transition-colors hover:bg-surface-container-high"
              >
                {note.text.length > 120 ? `${note.text.slice(0, 120)}…` : note.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** ネタ帳メモの先頭行をビートのタイトルにする（長すぎる場合は詰める）。 */
function ideaTitleOf(note: IdeaNote): string {
  const first = note.text.split('\n', 1)[0]?.trim() ?? ''
  return first.length > 24 ? `${first.slice(0, 24)}…` : first || '無題のビート'
}

/** ホバーで現れる小さな操作ボタン（OutlineView の NoteButton と同じ作法）。 */
function HoverButton({
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded p-0.5 text-on-surface-variant/40 transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
