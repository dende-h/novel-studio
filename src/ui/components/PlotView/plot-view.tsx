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
  ChevronRight,
  GripVertical,
  Plus,
  StickyNote,
  Waypoints,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IdeaNote } from '@/core/idea'
import {
  addBeat,
  addLine,
  addSection,
  beatsOfSection,
  countOpenForeshadows,
  type Foreshadow,
  type ForeshadowStatus,
  foreshadowStatus,
  moveBeat,
  nextBeatStatus,
  PLOT_TEMPLATES,
  type Plot,
  type PlotBeat,
  type PlotBeatStatus,
  type PlotLine,
  type PlotSection,
  type PlotTemplate,
  pickPrimaryPlot,
  removeBeat,
  removeForeshadow,
  removeLine,
  removeSection,
  sectionTargetTotal,
  singletonPlotId,
  updateBeat,
  updateLine,
  updateSection,
  upsertForeshadow,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import { countEpisodeChars } from '@/core/stats'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { PlotRepository } from '@/core/storage/plotRepository'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { pickPrimaryStructure, type StructureNode } from '@/core/structure'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { subscribeSyncApplied } from '@/ui/sync/sync-touch'

interface PlotViewProps {
  repo: PlotRepository
  workId: string
  /** 図鑑（視点・登場・舞台チップの解決先）。 */
  glossary: GlossaryEntry[]
  /** 本文の話一覧（ビートと話の紐付け先・実績字数の計数元）。 */
  episodes: Episode[]
  /** ネタ帳（ビートの種の取り込み元）。省略時は取り込み導線を出さない。 */
  ideaRepo?: IdeaRepository
  /** 構造レイヤー（マインドマップ→ビート変換の読み取り元）。省略時は取り込み導線を出さない。 */
  structureRepo?: StructureRepository
  /** 外部（エディタのプロットパネル等）から指定ビートへ着地する。消費後 onConsumeFocus を呼ぶ。 */
  focusBeatId?: string | null
  onConsumeFocus?: () => void
  /** 話を本文エディタで開く。 */
  onOpenEpisode: (episodeId: string) => void
  /** ビートから話を新規作成する（作成した episode id を返す。失敗は null）。 */
  onCreateEpisode?: (title: string) => Promise<string | null>
}

const genId = () => crypto.randomUUID()
const fmt = (n: number) => n.toLocaleString('ja-JP')
/** 空文字は未設定(undefined)へ畳む（スキーマの任意項目を綺麗に保つ）。 */
const emptyToUndef = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim())

/** 状態チップ（画面設計の「✓ 済／✎ 執筆中／？ 検討中／確定」表記）。 */
const STATUS_UI: Record<PlotBeatStatus, { label: string; className: string }> = {
  idea: { label: '？ 検討中', className: 'bg-surface-container-high text-on-surface-variant' },
  fixed: { label: '確定', className: 'bg-secondary-container text-on-secondary-container' },
  writing: { label: '✎ 執筆中', className: 'bg-primary/12 text-primary' },
  done: { label: '✓ 済', className: 'bg-primary text-primary-foreground' },
}

/** プロットラインの色パレット（作成順に循環割当。stripe とグリッドの行ラベルで使う）。 */
const LINE_PALETTE = [
  'var(--forest-400)',
  'var(--wheat-500)',
  'var(--forest-700)',
  'var(--wheat-700)',
  'var(--forest-900)',
]

/** ラインの表示色。保存された color が無い旧データはパレットを index で引く。 */
function lineColorOf(plot: Plot, lineId: string): string {
  const index = plot.lines.findIndex((l) => l.id === lineId)
  const line = index >= 0 ? plot.lines[index] : undefined
  return (
    line?.color ?? LINE_PALETTE[Math.max(0, index) % LINE_PALETTE.length] ?? 'var(--forest-400)'
  )
}

/** ビートの左端ストライプ色＝先頭のプロットライン色（未割当は控えめなグレー）。 */
function beatStripeColor(plot: Plot, beat: PlotBeat): string {
  const first = beat.lineRefs[0]
  return first !== undefined ? lineColorOf(plot, first) : 'var(--outline-variant)'
}

/** このビートを参照する伏線（張る側・回収側の両方）。 */
function foreshadowsOfBeat(plot: Plot, beatId: string): Foreshadow[] {
  return plot.foreshadows.filter((f) => f.plantBeatId === beatId || f.payoffBeatId === beatId)
}

/**
 * プロット（幕×ビートの物語設計）。ビートシート＝カード一覧（左）＋選択ビートの
 * 詳細パネル（右）の 2 カラム。カードをクリックすると右パネルで編集できる。
 * 操作はすべて即時保存（自動同期にもそのまま乗る）。
 * バンドルが重い（dnd-kit）ので default export（遅延ロード）。
 */
export default function PlotView({
  repo,
  workId,
  glossary,
  episodes,
  ideaRepo,
  structureRepo,
  focusBeatId,
  onConsumeFocus,
  onOpenEpisode,
  onCreateEpisode,
}: PlotViewProps) {
  const [plot, setPlot] = useState<Plot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'sheet' | 'grid' | 'foreshadow'>('sheet')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 追加直後のビートはタイトル入力へフォーカスする（リンクで作ってすぐ書ける）。
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  // グリッド・伏線ビューからビートシートの該当カードへ飛ぶための「着地予約」。
  const [scrollToId, setScrollToId] = useState<string | null>(null)
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

  // 同期の pull がローカルを書き換えたら開いたまま反映する（編集の下書きは入力単位の
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

  // ビュー切替後に該当カードへスクロール（グリッド・伏線からのジャンプの着地）。
  useEffect(() => {
    if (view !== 'sheet' || scrollToId === null) return
    const id = scrollToId
    setScrollToId(null)
    requestAnimationFrame(() => {
      document.getElementById(`plot-beat-${id}`)?.scrollIntoView({ block: 'center' })
    })
  }, [view, scrollToId])

  const jumpToBeat = useCallback((beatId: string) => {
    setView('sheet')
    setSelectedId(beatId)
    setFocusTitleId(null)
    setScrollToId(beatId)
  }, [])

  // 外部（エディタのプロットパネル等）からの着地。消費したら呼び出し側の予約を消す。
  useEffect(() => {
    if (focusBeatId == null) return
    jumpToBeat(focusBeatId)
    onConsumeFocus?.()
  }, [focusBeatId, jumpToBeat, onConsumeFocus])

  // 選択が無い／消えた（削除・同期）ときは物語順の先頭ビートを選ぶ＝右パネルが常に生きる。
  useEffect(() => {
    if (!plot) return
    const ordered = plot.sections.flatMap((s) => s.beatIds)
    if (selectedId !== null && ordered.includes(selectedId)) return
    setSelectedId(ordered[0] ?? null)
  }, [plot, selectedId])

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
  const openForeshadows = countOpenForeshadows(plot)
  const selectedBeat = selectedId ? (plot.beats.find((b) => b.id === selectedId) ?? null) : null
  const templateLabel =
    plot.template === undefined
      ? null
      : plot.template === 'custom'
        ? '白紙'
        : PLOT_TEMPLATES[plot.template].label

  /** 新しいビートをリンクから作り、すぐ右パネルのタイトル入力で書き始められる状態にする。 */
  const addNewBeat = (sectionId: string, beat?: Partial<PlotBeat>) => {
    const id = genId()
    void apply((p) =>
      addBeat(p, sectionId, {
        id,
        title: '',
        castRefs: [],
        placeRefs: [],
        lineRefs: [],
        status: 'idea',
        ...beat,
      }),
    )
    setSelectedId(id)
    setFocusTitleId(beat?.title ? null : id)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-9">
      <div className="mx-auto max-w-5xl pb-16">
        <header className="mb-5">
          <h1 className="font-semibold font-serif text-[24px] text-on-surface">プロット</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">
            {plot.beats.length}ビート ・ 済 {doneCount}件
            {totalTarget > 0 ? ` ・ 予定合計 ${fmt(totalTarget)}字` : ''}
          </p>
          {view === 'sheet' ? (
            <p className="mt-1 text-[12px] text-on-surface-variant/70">
              物語の出来事を「ビート」のカードにして幕へ並べます。カードを選ぶと右のパネルで詳しく書けます。
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-1.5">
            <ViewTab active={view === 'sheet'} onClick={() => setView('sheet')}>
              ビートシート
            </ViewTab>
            <ViewTab active={view === 'grid'} onClick={() => setView('grid')}>
              グリッド
            </ViewTab>
            <ViewTab active={view === 'foreshadow'} onClick={() => setView('foreshadow')}>
              伏線
              {openForeshadows > 0 ? (
                <span className="ml-1 inline-flex items-center rounded-full bg-secondary-container px-1.5 font-medium text-[10px] text-on-secondary-container tabular-nums">
                  {openForeshadows}
                </span>
              ) : null}
            </ViewTab>
            {templateLabel ? (
              <span className="ml-auto text-[11.5px] text-on-surface-variant">
                テンプレ: {templateLabel}
              </span>
            ) : null}
          </div>
        </header>

        {view === 'grid' ? (
          <GridView plot={plot} onApply={(fn) => void apply(fn)} onJumpBeat={jumpToBeat} />
        ) : view === 'foreshadow' ? (
          <ForeshadowView plot={plot} onApply={(fn) => void apply(fn)} onJumpBeat={jumpToBeat} />
        ) : (
          <div className="flex items-start gap-6">
            {/* 左：幕見出し＋ビートカードの一覧 */}
            <div className="min-w-0 flex-1">
              <PremiseInput
                value={plot.premise ?? ''}
                onCommit={(v) => void apply((p) => ({ ...p, premise: emptyToUndef(v) }))}
              />
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <div className="mt-4 flex flex-col gap-6">
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
                      structureRepo={structureRepo}
                      selectedId={selectedId}
                      onSelect={(id) => {
                        setSelectedId(id)
                        setFocusTitleId(null)
                      }}
                      onAddBeat={addNewBeat}
                      onApply={(fn) => void apply(fn)}
                      onOpenEpisode={onOpenEpisode}
                    />
                  ))}
                </div>
              </DndContext>

              <button
                type="button"
                onClick={() =>
                  void apply((p) =>
                    addSection(p, {
                      id: genId(),
                      title: `第${p.sections.length + 1}幕`,
                      beatIds: [],
                    }),
                  )
                }
                className="mt-6 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-primary transition-colors hover:bg-surface-container-high"
              >
                <Plus className="size-4" />
                幕を追加
              </button>
            </div>

            {/* 右：選択ビートの詳細パネル（画面設計の常設パネル） */}
            {selectedBeat ? (
              <BeatDetailPanel
                key={selectedBeat.id}
                plot={plot}
                beat={selectedBeat}
                glossary={glossary}
                episodes={episodes}
                autoFocusTitle={focusTitleId === selectedBeat.id}
                onApply={(fn) => void apply(fn)}
                onOpenEpisode={onOpenEpisode}
                onCreateEpisode={onCreateEpisode}
                onShowForeshadows={() => setView('foreshadow')}
                onRequestDelete={() =>
                  setDeleteTarget({
                    id: selectedBeat.id,
                    title: selectedBeat.title || '無題のビート',
                  })
                }
              />
            ) : null}
          </div>
        )}
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
          setSelectedId((cur) => (cur === id ? null : cur))
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
      className="w-full rounded-md border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
    />
  )
}

/** ビュー切替タブ（ビートシート／グリッド／伏線）。 */
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center rounded-full px-3 py-1 font-medium text-[12px] transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      {children}
    </button>
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
  structureRepo?: StructureRepository
  selectedId: string | null
  onSelect: (beatId: string) => void
  /** 「＋ ビートを追加」やネタ帳・マインドマップ取り込みからの新規作成。 */
  onAddBeat: (sectionId: string, beat?: Partial<PlotBeat>) => void
  onApply: (fn: (p: Plot) => Plot) => void
  onOpenEpisode: (episodeId: string) => void
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
  structureRepo,
  selectedId,
  onSelect,
  onAddBeat,
  onApply,
  onOpenEpisode,
}: SectionBlockProps) {
  const beats = beatsOfSection(plot, section.id)
  const target = sectionTargetTotal(plot, section.id)
  const [ideasOpen, setIdeasOpen] = useState(false)
  const [mindmapOpen, setMindmapOpen] = useState(false)

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
          <HoverButton
            label="幕を削除（ビートは隣の幕へ移動）"
            disabled={!canRemove}
            onClick={() => onApply((p) => removeSection(p, section.id))}
          >
            <X className="size-3.5" />
          </HoverButton>
        </span>
      </div>

      <SortableContext items={section.beatIds} strategy={verticalListSortingStrategy}>
        <ul className="mt-2 flex flex-col gap-2">
          {beats.map((beat) => (
            <BeatCard
              key={beat.id}
              plot={plot}
              beat={beat}
              selected={selectedId === beat.id}
              canMoveUp={!isFirst}
              canMoveDown={!isLast}
              glossary={glossary}
              episodes={episodes}
              onSelect={() => onSelect(beat.id)}
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
            />
          ))}
        </ul>
      </SortableContext>

      {/* 追加の入口は常時見える（ホバーで隠すと「何ができるか」が伝わらない）。 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
        <button
          type="button"
          onClick={() => onAddBeat(section.id)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-primary transition-colors hover:bg-surface-container-high"
        >
          <Plus className="size-3.5" />
          ビートを追加
        </button>
        {ideaRepo ? (
          <button
            type="button"
            aria-expanded={ideasOpen}
            onClick={() => {
              setMindmapOpen(false)
              setIdeasOpen((v) => !v)
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
          >
            <StickyNote className="size-3.5" />
            ネタ帳から
          </button>
        ) : null}
        {structureRepo ? (
          <button
            type="button"
            aria-expanded={mindmapOpen}
            onClick={() => {
              setIdeasOpen(false)
              setMindmapOpen((v) => !v)
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
          >
            <Waypoints className="size-3.5" />
            マインドマップから
          </button>
        ) : null}
      </div>

      {ideaRepo && ideasOpen ? (
        <IdeaPickerPanel
          ideaRepo={ideaRepo}
          onPick={(note) => {
            setIdeasOpen(false)
            onAddBeat(section.id, {
              title: ideaTitleOf(note),
              summary: note.text,
              ideaRef: note.id,
            })
          }}
          onClose={() => setIdeasOpen(false)}
        />
      ) : null}

      {structureRepo && mindmapOpen ? (
        <MindmapPickerPanel
          structureRepo={structureRepo}
          workId={plot.workId}
          onPick={(node) => {
            setMindmapOpen(false)
            onAddBeat(section.id, {
              title: clipTitle(node.label),
              // ノートがあれば要約へ。無くてラベルが長い場合は全文を要約に残す（切り捨てない）。
              ...(node.note?.trim()
                ? { summary: node.note }
                : node.label.trim().length > 24
                  ? { summary: node.label.trim() }
                  : {}),
            })
          }}
          onClose={() => setMindmapOpen(false)}
        />
      ) : null}
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
  plot: Plot
  beat: PlotBeat
  selected: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  glossary: GlossaryEntry[]
  episodes: Episode[]
  onSelect: () => void
  onApply: (fn: (p: Plot) => Plot) => void
  /** -1＝前の幕の末尾へ、+1＝次の幕の先頭へ移す。 */
  onMoveToNeighbor: (dir: -1 | 1) => void
  onOpenEpisode: (episodeId: string) => void
}

/**
 * ビートカード（画面設計準拠）：左端にプロットライン色のストライプ、タイトル＋対応話、
 * 要約 1 行、下部にチップ列（視点／伏線 ×n／状態）。クリックで選択→右パネルで編集する。
 * カード全面が選択ボタンで、内側の操作（状態チップ・話リンク等）はその上に重ねる。
 */
function BeatCard({
  plot,
  beat,
  selected,
  canMoveUp,
  canMoveDown,
  glossary,
  episodes,
  onSelect,
  onApply,
  onMoveToNeighbor,
  onOpenEpisode,
}: BeatCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: beat.id,
  })
  const status = STATUS_UI[beat.status]
  const pov = beat.povRef ? glossary.find((g) => g.id === beat.povRef) : undefined
  const episode = beat.episodeRef ? episodes.find((e) => e.id === beat.episodeRef) : undefined
  const foreshadowCount = foreshadowsOfBeat(plot, beat.id).length
  const preview = beat.summary?.trim() || ''

  return (
    <li
      id={`plot-beat-${beat.id}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex overflow-hidden rounded-lg border bg-surface-container-lowest ${
        selected
          ? 'border-primary/60 ring-1 ring-primary/30'
          : beat.status === 'idea'
            ? 'border-outline-variant/40 border-dashed'
            : 'border-outline-variant/30'
      } ${isDragging ? 'opacity-60 shadow-md' : ''}`}
    >
      {/* カード全面の選択ボタン（内側の操作はこの上に pointer-events-auto で重ねる） */}
      <button
        type="button"
        aria-label={`「${beat.title || '無題のビート'}」を選択して詳細を編集`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute inset-0 cursor-pointer"
      />
      {/* プロットライン色のストライプ */}
      <span
        aria-hidden
        className="w-1 shrink-0"
        style={{ background: beatStripeColor(plot, beat) }}
      />
      <div className="pointer-events-none relative min-w-0 flex-1 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="ドラッグで並べ替え"
            className="pointer-events-auto cursor-grab touch-none text-on-surface-variant/40 hover:text-on-surface-variant active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <span className="min-w-0 flex-1 truncate font-medium font-sans text-[14px] text-on-surface">
            {beat.title || '無題のビート'}
          </span>
          {episode ? (
            <button
              type="button"
              onClick={() => onOpenEpisode(episode.id)}
              className="pointer-events-auto flex max-w-40 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
              title="本文エディタで開く"
            >
              <ArrowRight className="size-3.5 shrink-0" />
              <span className="truncate">{episode.title || '無題の話'}</span>
            </button>
          ) : null}
          <span className="pointer-events-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
          </span>
        </div>
        {preview || beat.guide ? (
          <p
            className={`mt-1 truncate pl-6 text-[12px] leading-relaxed ${
              preview ? 'text-on-surface-variant' : 'text-on-surface-variant/50'
            }`}
          >
            {preview || beat.guide}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1.5 pl-6">
          {pov ? (
            <span
              title={pov.summary}
              className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[10.5px] text-accent-foreground"
            >
              視点: {pov.name}
            </span>
          ) : null}
          {foreshadowCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-secondary-container px-2 py-0.5 text-[10.5px] text-on-secondary-container">
              伏線 ×{foreshadowCount}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() =>
              onApply((p) => updateBeat(p, beat.id, { status: nextBeatStatus(beat.status) }))
            }
            title="クリックで状態を切替（検討中→確定→執筆中→済）"
            className={`pointer-events-auto inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10.5px] transition-colors ${status.className}`}
          >
            {status.label}
          </button>
        </div>
      </div>
    </li>
  )
}

interface BeatDetailPanelProps {
  plot: Plot
  beat: PlotBeat
  glossary: GlossaryEntry[]
  episodes: Episode[]
  /** 追加直後だけタイトル入力にフォーカスする。 */
  autoFocusTitle: boolean
  onApply: (fn: (p: Plot) => Plot) => void
  onOpenEpisode: (episodeId: string) => void
  onCreateEpisode?: (title: string) => Promise<string | null>
  /** 伏線ビューへ切り替える（伏線の追加・編集は伏線ビューが担当）。 */
  onShowForeshadows: () => void
  onRequestDelete: () => void
}

/** 選択ビートの詳細パネル（画面設計の右パネル）。テキストは blur で確定、選択系は即時反映。 */
function BeatDetailPanel({
  plot,
  beat,
  glossary,
  episodes,
  autoFocusTitle,
  onApply,
  onOpenEpisode,
  onCreateEpisode,
  onShowForeshadows,
  onRequestDelete,
}: BeatDetailPanelProps) {
  const patch = (p: Partial<Omit<PlotBeat, 'id'>>) => onApply((pl) => updateBeat(pl, beat.id, p))
  const episode = beat.episodeRef ? episodes.find((e) => e.id === beat.episodeRef) : undefined
  const actualChars = episode ? countEpisodeChars(episode) : null
  const target = beat.targetLength ?? 0
  const percent =
    actualChars !== null && target > 0
      ? Math.min(100, Math.round((actualChars / target) * 100))
      : null
  const beatForeshadows = foreshadowsOfBeat(plot, beat.id)

  return (
    <aside className="w-72 shrink-0 max-lg:hidden">
      <div className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col gap-3 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
        <Field label="タイトル">
          <CommitInput
            value={beat.title}
            onCommit={(v) => {
              const t = v.trim()
              if (t !== '') patch({ title: t })
            }}
            placeholder="このビートで何が起きる？"
            ariaLabel="ビートのタイトル"
            autoFocus={autoFocusTitle}
          />
        </Field>
        <Field label="状態">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(STATUS_UI) as PlotBeatStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={beat.status === s}
                onClick={() => patch({ status: s })}
                className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[11px] transition-colors ${
                  beat.status === s
                    ? STATUS_UI[s].className
                    : 'border border-outline-variant/40 text-on-surface-variant/60 hover:bg-surface-container-high'
                }`}
              >
                {STATUS_UI[s].label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="要約（何が起きるか）">
          <CommitTextarea
            value={beat.summary ?? ''}
            onCommit={(v) => patch({ summary: emptyToUndef(v) })}
            placeholder={beat.guide ?? '何が起きるかを数行で'}
            ariaLabel="ビートの要約"
          />
        </Field>

        {/* 使う人だけ開く詳細。空のフィールドが並ぶと書く場所が分からなくなるため畳んでおく。 */}
        <PanelGroup
          title="人物と舞台"
          defaultOpen={Boolean(
            beat.povRef || beat.castRefs.length > 0 || beat.placeRefs.length > 0,
          )}
        >
          {glossary.length > 0 ? (
            <>
              <Field label="視点（だれの目で書くか）">
                <SelectBox
                  value={beat.povRef ?? ''}
                  onChange={(v) => patch({ povRef: v === '' ? undefined : v })}
                  ariaLabel="視点キャラ"
                  options={[
                    { value: '', label: '（未設定）' },
                    ...glossary.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              </Field>
              <RefChips
                label="登場する人物"
                ids={beat.castRefs}
                glossary={glossary}
                onChange={(ids) => patch({ castRefs: ids })}
              />
              <RefChips
                label="舞台（場所）"
                ids={beat.placeRefs}
                glossary={glossary}
                onChange={(ids) => patch({ placeRefs: ids })}
              />
            </>
          ) : (
            <GlossaryHint />
          )}
          <Field label="作中時間">
            <CommitInput
              value={beat.timeLabel ?? ''}
              onCommit={(v) => patch({ timeLabel: emptyToUndef(v) })}
              placeholder="例：三日後の夜"
              ariaLabel="作中時間"
            />
          </Field>
        </PanelGroup>

        <PanelGroup
          title="構成メモ・伏線"
          defaultOpen={Boolean(beat.note || beat.lineRefs.length > 0 || beatForeshadows.length > 0)}
        >
          <Field label="メモ">
            <CommitTextarea
              value={beat.note ?? ''}
              onCommit={(v) => patch({ note: emptyToUndef(v) })}
              placeholder="狙い・代案・保留メモ"
              ariaLabel="ビートのメモ"
            />
          </Field>
          {plot.lines.length > 0 ? (
            <LineChips
              lines={plot.lines}
              ids={beat.lineRefs}
              onChange={(ids) => patch({ lineRefs: ids })}
            />
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[11px] text-on-surface-variant/70 tracking-wide">
              伏線
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {beatForeshadows.map((f) => (
                <span
                  key={f.id}
                  title={f.note}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2 py-0.5 text-[11px] text-on-secondary-container"
                >
                  {f.plantBeatId === beat.id ? '張る' : '回収'}: {f.title}
                </span>
              ))}
              <button
                type="button"
                onClick={onShowForeshadows}
                className="text-[11px] text-primary hover:underline"
              >
                {beatForeshadows.length > 0 ? '伏線ビューで管理' : '＋ 伏線ビューで登録'}
              </button>
            </div>
          </div>
        </PanelGroup>

        <PanelGroup title="執筆と進捗" defaultOpen={Boolean(beat.targetLength || beat.episodeRef)}>
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
          {actualChars !== null && target > 0 ? (
            <div>
              <div className="flex items-baseline justify-between text-[11.5px] text-on-surface-variant tabular-nums">
                <span>
                  実績 {fmt(actualChars)}字 ／ 予定 {fmt(target)}字
                </span>
                <span>{percent}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-container-high">
                <div
                  className="h-1.5 rounded-full bg-[var(--forest-400)]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : null}
          <Field label="対応する話">
            <SelectBox
              value={beat.episodeRef ?? ''}
              onChange={(v) => patch({ episodeRef: v === '' ? undefined : v })}
              ariaLabel="対応する話"
              options={[
                { value: '', label: '（未対応）' },
                ...episodes.map((e) => ({ value: e.id, label: e.title || '無題の話' })),
              ]}
            />
          </Field>
          <div className="flex items-center gap-1.5">
            {episode ? (
              <button
                type="button"
                onClick={() => onOpenEpisode(episode.id)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
              >
                <ArrowRight className="size-3.5" />
                {`${episode.title || '無題の話'}を開く`}
              </button>
            ) : onCreateEpisode ? (
              <button
                type="button"
                title="このビートのタイトルで話を新規作成して紐付ける"
                onClick={() =>
                  void onCreateEpisode(beat.title || '無題のビート').then((episodeId) => {
                    if (episodeId) patch({ episodeRef: episodeId })
                  })
                }
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-primary transition-colors hover:bg-surface-container-high"
              >
                <Plus className="size-3.5" />
                話を作る
              </button>
            ) : null}
            {beat.ideaRef ? (
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-on-surface-variant/70">
                <StickyNote className="size-3" />
                ネタ帳から
              </span>
            ) : null}
          </div>
        </PanelGroup>

        <div className="border-outline-variant/20 border-t pt-2 text-right">
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md px-2 py-1 text-[12px] text-error transition-colors hover:bg-error-container"
          >
            ビートを削除
          </button>
        </div>
      </div>
    </aside>
  )
}

/**
 * グリッド：行＝プロットライン×列＝幕。空セルの点線が
 * 「このサブプロットはこの幕で動いていない」を一目にする。
 */
function GridView({
  plot,
  onApply,
  onJumpBeat,
}: {
  plot: Plot
  onApply: (fn: (p: Plot) => Plot) => void
  onJumpBeat: (beatId: string) => void
}) {
  const [addInput, setAddInput] = useState('')
  const beatsIn = (sectionId: string, lineId: string | null) =>
    beatsOfSection(plot, sectionId).filter((b) =>
      lineId === null ? b.lineRefs.length === 0 : b.lineRefs.includes(lineId),
    )
  const hasUnassigned = plot.beats.some((b) => b.lineRefs.length === 0)

  const submitAdd = () => {
    const title = addInput.trim()
    if (title === '') return
    // 色は作成順にパレットを循環割当（ビートシートのストライプと同じ色で対応が取れる）。
    onApply((p) =>
      addLine(p, { id: genId(), title, color: LINE_PALETTE[p.lines.length % LINE_PALETTE.length] }),
    )
    setAddInput('')
  }

  /** セル＝1枚のカードにビート名を列挙（画面設計準拠）。空は点線プレースホルダ。 */
  const cell = (lineId: string | null, sectionId: string) => {
    const beats = beatsIn(sectionId, lineId)
    if (beats.length === 0) {
      if (lineId === null) return <div className="min-h-12" />
      return (
        <div
          className="grid min-h-12 place-items-center rounded-md border border-dashed text-[10.5px]"
          style={{ borderColor: 'var(--wheat-500)', color: 'var(--wheat-700)' }}
        >
          空白
        </div>
      )
    }
    return (
      <div className="flex min-h-12 flex-col gap-0.5 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-2 py-1.5">
        {beats.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onJumpBeat(b.id)}
            title="ビートシートで開く"
            className="truncate text-left text-[11.5px] text-on-surface transition-colors hover:text-primary"
          >
            {b.title || '無題のビート'}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div>
      {plot.lines.length === 0 ? (
        <p className="mb-4 rounded-lg bg-surface-container-low px-4 py-3 text-[12.5px] text-on-surface-variant leading-relaxed">
          プロットライン（メイン・サブプロット・キャラアークなどの筋）を作ると、幕ごとの動きを表で俯瞰できます。
          ラインへの割り当てはビートシートの右パネルから。
        </p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div
            className="grid min-w-fit items-start gap-1.5"
            style={{
              gridTemplateColumns: `minmax(7rem, 9rem) repeat(${plot.sections.length}, minmax(10rem, 1fr))`,
            }}
          >
            <div />
            {plot.sections.map((s) => (
              <div key={s.id} className="px-1 pb-1">
                <span className="font-medium font-serif text-[13px] text-on-surface">
                  {s.title}
                </span>
                <span className="ml-1.5 text-[10.5px] text-on-surface-variant tabular-nums">
                  {s.beatIds.length}
                </span>
              </div>
            ))}
            {plot.lines.map((line) => (
              <Fragment key={line.id}>
                <div className="group flex items-center gap-1.5 pr-1">
                  <span
                    aria-hidden
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ background: lineColorOf(plot, line.id) }}
                  />
                  <CommitInput
                    value={line.title}
                    onCommit={(v) => {
                      const t = v.trim()
                      if (t !== '') onApply((p) => updateLine(p, line.id, { title: t }))
                    }}
                    ariaLabel="プロットラインの名前"
                  />
                  <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <HoverButton
                      label="ラインを削除（ビートは残ります）"
                      onClick={() => onApply((p) => removeLine(p, line.id))}
                    >
                      <X className="size-3.5" />
                    </HoverButton>
                  </span>
                </div>
                {plot.sections.map((s) => (
                  <div key={s.id}>{cell(line.id, s.id)}</div>
                ))}
              </Fragment>
            ))}
            {hasUnassigned ? (
              <Fragment>
                <div className="pr-1 text-[11.5px] text-on-surface-variant/70">ライン未設定</div>
                {plot.sections.map((s) => (
                  <div key={s.id}>{cell(null, s.id)}</div>
                ))}
              </Fragment>
            ) : null}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 pl-1">
        <Plus className="size-3.5 shrink-0 text-on-surface-variant/50" />
        <input
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitAdd()
            } else if (e.key === 'Escape') {
              setAddInput('')
            }
          }}
          onBlur={submitAdd}
          placeholder="プロットラインを追加（例：メイン、ユキの正体）"
          aria-label="プロットラインを追加"
          className="w-full max-w-sm bg-transparent font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
        />
      </div>
    </div>
  )
}

const FORESHADOW_UI: Record<ForeshadowStatus, { label: string; className: string }> = {
  resolved: { label: '回収済', className: 'bg-primary/12 text-primary' },
  planted: { label: '未回収', className: 'bg-secondary-container text-on-secondary-container' },
  orphan: { label: '根なし', className: 'bg-error-container text-error' },
  unplaced: { label: '未配置', className: 'bg-surface-container-high text-on-surface-variant' },
}

/** 伏線：張る／回収の対応表。回収漏れ（未回収・根なし）の点検が役目。 */
function ForeshadowView({
  plot,
  onApply,
  onJumpBeat,
}: {
  plot: Plot
  onApply: (fn: (p: Plot) => Plot) => void
  onJumpBeat: (beatId: string) => void
}) {
  const [addInput, setAddInput] = useState('')
  // 物語順（幕→幕内の並び）のビート一覧。選択肢と表示の両方で使う。
  const orderedBeats = plot.sections.flatMap((s) => beatsOfSection(plot, s.id))
  const beatOptions = [
    { value: '', label: '（未定）' },
    ...orderedBeats.map((b) => ({ value: b.id, label: b.title || '無題のビート' })),
  ]

  const submitAdd = () => {
    const title = addInput.trim()
    if (title === '') return
    onApply((p) => upsertForeshadow(p, { id: genId(), title }))
    setAddInput('')
  }

  const beatCell = (f: Foreshadow, key: 'plantBeatId' | 'payoffBeatId') => {
    const beatId = f[key]
    // 削除済みビートへの参照は選択肢に無い＝select が（未定）表示に落ちるので、明示的に外す。
    const exists = beatId !== undefined && plot.beats.some((b) => b.id === beatId)
    return (
      <div className="flex items-center gap-1">
        <SelectBox
          value={exists ? (beatId ?? '') : ''}
          onChange={(v) =>
            onApply((p) => upsertForeshadow(p, { ...f, [key]: v === '' ? undefined : v }))
          }
          ariaLabel={key === 'plantBeatId' ? '張るビート' : '回収するビート'}
          options={beatOptions}
        />
        {exists && beatId ? (
          <HoverButton label="ビートシートで開く" onClick={() => onJumpBeat(beatId)}>
            <ArrowRight className="size-3.5" />
          </HoverButton>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      {plot.foreshadows.length === 0 ? (
        <p className="mb-4 rounded-lg bg-surface-container-low px-4 py-3 text-[12.5px] text-on-surface-variant leading-relaxed">
          伏線を登録して「張るビート」と「回収するビート」を結ぶと、回収漏れがここで一目で分かります。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-outline-variant/30">
          <table className="w-full min-w-[36rem] border-collapse bg-surface-container-lowest text-[13px]">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11.5px] text-on-surface-variant">
                <th className="px-3 py-2 font-medium">伏線</th>
                <th className="px-3 py-2 font-medium">張るビート</th>
                <th className="px-3 py-2 font-medium">回収するビート</th>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {plot.foreshadows.map((f) => {
                const ui = FORESHADOW_UI[foreshadowStatus(f, plot)]
                return (
                  <tr key={f.id} className="group border-outline-variant/20 border-t align-middle">
                    <td className="min-w-[10rem] px-3 py-2">
                      <CommitInput
                        value={f.title}
                        onCommit={(v) => {
                          const t = v.trim()
                          if (t !== '') onApply((p) => upsertForeshadow(p, { ...f, title: t }))
                        }}
                        ariaLabel="伏線の名前"
                      />
                    </td>
                    <td className="px-3 py-2">{beatCell(f, 'plantBeatId')}</td>
                    <td className="px-3 py-2">{beatCell(f, 'payoffBeatId')}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[11px] ${ui.className}`}
                      >
                        {ui.label}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <HoverButton
                          label="この伏線を削除"
                          onClick={() => onApply((p) => removeForeshadow(p, f.id))}
                        >
                          <X className="size-3.5" />
                        </HoverButton>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 pl-1">
        <Plus className="size-3.5 shrink-0 text-on-surface-variant/50" />
        <input
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitAdd()
            } else if (e.key === 'Escape') {
              setAddInput('')
            }
          }}
          onBlur={submitAdd}
          placeholder="伏線を追加（例：手紙の署名）"
          aria-label="伏線を追加"
          className="w-full max-w-sm bg-transparent font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
        />
      </div>
    </div>
  )
}

/** プロットラインの複数選択（ビート詳細用）。チップ＋追加セレクト。 */
function LineChips({
  lines,
  ids,
  onChange,
}: {
  lines: PlotLine[]
  ids: string[]
  onChange: (ids: string[]) => void
}) {
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const remaining = lines.filter((l) => !ids.includes(l.id))
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-[11px] text-on-surface-variant/70 tracking-wide">
        プロットライン
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id) => {
          const line = byId.get(id)
          return (
            <span
              key={id}
              title={line?.note}
              className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] text-on-surface"
            >
              {line?.title ?? '（削除済み）'}
              <button
                type="button"
                aria-label={`${line?.title ?? 'このライン'}を外す`}
                onClick={() => onChange(ids.filter((x) => x !== id))}
                className="text-on-surface-variant/60 hover:text-on-surface"
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
            aria-label="プロットラインを追加"
            className="rounded-md border border-outline-variant/30 bg-surface px-1.5 py-0.5 text-[11px] text-on-surface-variant outline-none focus:border-primary/50"
          >
            <option value="">＋ 追加</option>
            {remaining.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
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

/**
 * 詳細パネルの折りたたみグループ。空フィールドの羅列で書く場所が迷子にならないよう、
 * 内容が入っているグループだけ初期展開する（native details＝状態管理いらず）。
 */
function PanelGroup({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group/panel border-outline-variant/20 border-t pt-2">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1 font-medium text-[11.5px] text-on-surface-variant/80 tracking-wide hover:text-on-surface">
        <ChevronRight
          className="size-3 transition-transform group-open/panel:rotate-90"
          aria-hidden
        />
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </details>
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
  autoFocus,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  inputMode?: 'numeric'
  autoFocus?: boolean
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
      // biome-ignore lint/a11y/noAutofocus: 「＋ ビートを追加」直後だけ意図的にタイトルへフォーカスする
      autoFocus={autoFocus}
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
  // 無限に伸びるとパネルが要約だけで埋まるため、上限を超えたら内側スクロールに切り替える。
  const MAX_HEIGHT_PX = 200
  const resizeToContent = (el: HTMLTextAreaElement) => {
    el.style.height = '0'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft の変化で高さを測り直す（resizeToContent は毎レンダー同一の純関数）
  useLayoutEffect(() => {
    const el = ref.current
    if (el) resizeToContent(el)
  }, [draft])
  return (
    <textarea
      ref={ref}
      rows={2}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        resizeToContent(e.target)
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
      className="w-full resize-none rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-[13px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
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
          メモを選ぶと、この幕に「検討中」のビートとして入ります（メモは残ります）
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

/** テキストをビートのタイトル向けに詰める（先頭行・24字まで）。 */
function clipTitle(text: string): string {
  const first = text.split('\n', 1)[0]?.trim() ?? ''
  return first.length > 24 ? `${first.slice(0, 24)}…` : first || '無題のビート'
}

/** ネタ帳メモの先頭行をビートのタイトルにする。 */
function ideaTitleOf(note: IdeaNote): string {
  return clipTitle(note.text)
}

/** マインドマップのノード一覧から 1 件選んでビートの種にする（発想→設計の一方向変換）。 */
function MindmapPickerPanel({
  structureRepo,
  workId,
  onPick,
  onClose,
}: {
  structureRepo: StructureRepository
  workId: string
  onPick: (node: StructureNode) => void
  onClose: () => void
}) {
  const [nodes, setNodes] = useState<StructureNode[] | null>(null)
  useEffect(() => {
    let alive = true
    void structureRepo.listByWork(workId).then((list) => {
      if (!alive) return
      const mindmap = pickPrimaryStructure(list, 'mindmap')
      setNodes(mindmap ? mindmap.nodes.filter((n) => n.label.trim() !== '') : [])
    })
    return () => {
      alive = false
    }
  }, [structureRepo, workId])
  return (
    <div className="mt-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-2">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-[11px] text-on-surface-variant/70">
          ノードを選ぶと、この幕のビートになります（ラベル→タイトル・ノート→要約。ノードは残ります）
        </span>
        <HoverButton label="閉じる" onClick={onClose}>
          <X className="size-3.5" />
        </HoverButton>
      </div>
      {nodes === null ? (
        <p className="px-1 py-2 text-[12px] text-on-surface-variant/60">読み込み中…</p>
      ) : nodes.length === 0 ? (
        <p className="px-1 py-2 text-[12px] text-on-surface-variant/60">
          マインドマップにノードがありません。発想はマインドマップへどうぞ。
        </p>
      ) : (
        <ul className="max-h-48 overflow-y-auto">
          {nodes.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => onPick(node)}
                className="w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-on-surface leading-relaxed transition-colors hover:bg-surface-container-high"
              >
                <span className="block truncate">{node.label}</span>
                {node.note?.trim() ? (
                  <span className="block truncate text-[11px] text-on-surface-variant/70">
                    {node.note}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
