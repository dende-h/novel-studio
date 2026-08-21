import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
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
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { blocksToPlainText } from '@/core/exporter/toPlainText'
import { resolvedNameSet, shouldTriggerSuggest, suggestRefs } from '@/core/glossary'
import type { IdeaNote } from '@/core/idea'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import {
  addBeat,
  addLine,
  addSection,
  beatsOfSection,
  countOpenForeshadows,
  countUnrevealedSecrets,
  type Foreshadow,
  type ForeshadowStatus,
  foreshadowStatus,
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
  removeForeshadow,
  removeLine,
  removeSecret,
  removeSection,
  type SecretStatus,
  secretStatus,
  secretsHiddenAt,
  sectionTargetTotal,
  singletonPlotId,
  updateBeat,
  updateLine,
  updateSection,
  upsertForeshadow,
  upsertSecret,
} from '@/core/plot'
import type { Episode, GlossaryEntry } from '@/core/schema'
import { countEpisodeChars } from '@/core/stats'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { PlotRepository } from '@/core/storage/plotRepository'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { pickPrimaryStructure, type StructureNode } from '@/core/structure'
import { getCaretCoordinates } from '@/ui/_utils/caretCoordinates'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { RefSuggest } from '@/ui/components/EditorPane/ref-suggest'
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
  /**
   * 要約・メモのプレビューで [[用語]] をクリックしたときの通知。
   * 本文編集と同じ図鑑の見え方にするため、App 側の onRefClick をそのまま渡す。
   */
  onRefClick?: (name: string) => void
  /**
   * 図鑑に無い人物・場所をその場で登録する（作成した entry id を返す。失敗は null）。
   * 図鑑を常に正本に保つ＝プロット側に自由記述の別管理を作らない。
   */
  onCreateGlossaryEntry?: (name: string, category: '人物' | '場所') => Promise<string | null>
}

/** 図鑑カテゴリの絞り込み（固定5種＋旧データの自由入力に緩く一致させる）。 */
const PERSON_CATEGORY = /人物|キャラ/
const PLACE_CATEGORY = /場所|舞台/

const genId = () => crypto.randomUUID()

/**
 * 記法（[[用語]]・ルビ・傍点）を剥がした表示用テキスト。
 * カードの要約 1 行など「読むだけ」の場所で、記号がそのまま出るのを防ぐ。
 */
function plainOf(text: string | undefined): string {
  if (!text) return ''
  return blocksToPlainText(parseEpisodeBody(text)).trim()
}
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
  onCreateGlossaryEntry,
  onRefClick,
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
  // 要約・メモのプレビューで [[用語]] を解決/未解決に描き分ける基準（本文プレビューと同じ）。
  const resolvedNames = useMemo(() => resolvedNameSet(glossary), [glossary])

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
  // タブのバッジ＝脱稿前に片付けるべき件数（未回収の伏線＋開示未定の秘密）。
  const openItems = countOpenForeshadows(plot) + countUnrevealedSecrets(plot)
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
    // ページ全体は縦に固定し、一覧とパネルをそれぞれ独立スクロールにする
    // （全体スクロール＋パネル内スクロールの重複で迷子になるため）。
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-6 md:px-9">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-4 shrink-0">
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
              伏線・秘密
              {openItems > 0 ? (
                <span
                  title="未回収の伏線＋開示未定の秘密"
                  className="ml-1 inline-flex items-center rounded-full bg-secondary-container px-1.5 font-medium text-[10px] text-on-secondary-container tabular-nums"
                >
                  {openItems}
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
      </div>

      {view === 'grid' ? (
        <div className="min-h-0 flex-1 overflow-y-auto pb-16">
          <div className="mx-auto w-full max-w-5xl">
            <GridView plot={plot} onApply={(fn) => void apply(fn)} onJumpBeat={jumpToBeat} />
          </div>
        </div>
      ) : view === 'foreshadow' ? (
        <div className="min-h-0 flex-1 overflow-y-auto pb-16">
          <div className="mx-auto w-full max-w-5xl">
            <ForeshadowView plot={plot} onApply={(fn) => void apply(fn)} onJumpBeat={jumpToBeat} />
          </div>
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 items-stretch gap-6 2xl:max-w-[82rem]">
          {/* 左：幕見出し＋ビートカードの一覧（独立スクロール） */}
          <div className="min-w-0 flex-1 overflow-y-auto pr-1 pb-16">
            <PremiseInput
              value={plot.premise ?? ''}
              onCommit={(v) => void apply((p) => ({ ...p, premise: emptyToUndef(v) }))}
            />
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
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
              onCreateGlossaryEntry={onCreateGlossaryEntry}
              resolvedNames={resolvedNames}
              onRefClick={onRefClick}
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
  const firstLineId = beat.lineRefs[0]
  const line = firstLineId !== undefined ? plot.lines.find((l) => l.id === firstLineId) : undefined
  const preview = plainOf(beat.summary)

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
          {line ? (
            <span
              title={line.note}
              className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[10.5px] text-on-surface"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full"
                style={{ background: lineColorOf(plot, line.id) }}
              />
              {line.title}
            </span>
          ) : null}
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
  onCreateGlossaryEntry?: (name: string, category: '人物' | '場所') => Promise<string | null>
  /** 図鑑に居る語の集合（要約・メモのプレビューで解決/未解決を描き分ける）。 */
  resolvedNames: Set<string>
  /** プレビュー内の [[用語]] クリック（図鑑の内容を見る）。 */
  onRefClick?: (name: string) => void
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
  onCreateGlossaryEntry,
  resolvedNames,
  onRefClick,
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
  const revealedHere = plot.secrets.filter((s) => s.revealBeatId === beat.id)
  const stillHidden = secretsHiddenAt(plot, beat.id)

  return (
    // 親（2カラム行）が画面高に固定されているので、パネルは自分の中だけでスクロールする。
    <aside className="min-h-0 w-72 shrink-0 pb-6 max-lg:hidden 2xl:w-[36rem]">
      <div className="flex max-h-full flex-col gap-3 overflow-y-auto rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
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
          <NotationField
            value={beat.summary ?? ''}
            onCommit={(v) => patch({ summary: emptyToUndef(v) })}
            placeholder={beat.guide ?? '何が起きるかを数行で（[[用語]] で図鑑とつながります）'}
            ariaLabel="ビートの要約"
            resolvedNames={resolvedNames}
            glossary={glossary}
            onRefClick={onRefClick}
          />
        </Field>

        {/* 使う人だけ開く詳細。空のフィールドが並ぶと書く場所が分からなくなるため畳んでおく。 */}
        <PanelGroup
          title="人物と舞台"
          defaultOpen={Boolean(
            beat.povRef || beat.castRefs.length > 0 || beat.placeRefs.length > 0,
          )}
        >
          {glossary.length > 0 || onCreateGlossaryEntry ? (
            <>
              <Field label="視点（だれの目で書くか）">
                <GlossaryRefSelect
                  value={beat.povRef}
                  glossary={glossary}
                  categoryRe={PERSON_CATEGORY}
                  ariaLabel="視点キャラ"
                  onChange={(v) => patch({ povRef: v })}
                  onCreate={
                    onCreateGlossaryEntry
                      ? (name) => onCreateGlossaryEntry(name, '人物')
                      : undefined
                  }
                />
              </Field>
              <RefChips
                label="登場する人物"
                ids={beat.castRefs}
                glossary={glossary}
                categoryRe={PERSON_CATEGORY}
                onChange={(ids) => patch({ castRefs: ids })}
                onCreate={
                  onCreateGlossaryEntry ? (name) => onCreateGlossaryEntry(name, '人物') : undefined
                }
              />
              <Field label="舞台（場所）">
                <GlossaryRefSelect
                  value={beat.placeRefs[0]}
                  glossary={glossary}
                  categoryRe={PLACE_CATEGORY}
                  ariaLabel="舞台（場所）"
                  onChange={(v) => patch({ placeRefs: v === undefined ? [] : [v] })}
                  onCreate={
                    onCreateGlossaryEntry
                      ? (name) => onCreateGlossaryEntry(name, '場所')
                      : undefined
                  }
                />
              </Field>
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
          title="メモ・伏線・秘密"
          defaultOpen={Boolean(
            beat.note ||
              beat.lineRefs.length > 0 ||
              beatForeshadows.length > 0 ||
              revealedHere.length > 0,
          )}
        >
          <Field label="メモ">
            <NotationField
              value={beat.note ?? ''}
              onCommit={(v) => patch({ note: emptyToUndef(v) })}
              placeholder="狙い・代案・保留メモ"
              ariaLabel="ビートのメモ"
              resolvedNames={resolvedNames}
              glossary={glossary}
              onRefClick={onRefClick}
            />
          </Field>
          {plot.lines.length > 0 ? (
            <Field label="プロットライン">
              {/* 1ビート＝1ライン（グリッドの分割表・カードの色と一対一で対応させる）。 */}
              <SelectBox
                value={beat.lineRefs[0] ?? ''}
                onChange={(v) => patch({ lineRefs: v === '' ? [] : [v] })}
                ariaLabel="プロットライン"
                options={[
                  { value: '', label: '（なし）' },
                  ...plot.lines.map((l) => ({ value: l.id, label: l.title })),
                ]}
              />
            </Field>
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

          {/* 秘密＝読者の理解の管理。ここで明かす分と、この時点でまだ伏せている分。 */}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[11px] text-on-surface-variant/70 tracking-wide">
              秘密（読者に伏せる情報）
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {revealedHere.map((s) => (
                <span
                  key={s.id}
                  title={s.truth}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary"
                >
                  ここで明かす: {s.title}
                </span>
              ))}
              <button
                type="button"
                onClick={onShowForeshadows}
                className="text-[11px] text-primary hover:underline"
              >
                {revealedHere.length > 0 ? '秘密を管理' : '＋ 秘密を登録'}
              </button>
            </div>
            {stillHidden.length > 0 ? (
              <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
                この時点で読者が知らないこと：{stillHidden.map((s) => s.title).join('、')}
              </p>
            ) : null}
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
 * グリッドのセル間移動（純関数）：幕が変われば末尾へ移し、ラインを落とした列に付け替える。
 * 1ビート＝1ライン運用（未設定列へ落とすと外れる）。
 */
function moveBeatToCell(p: Plot, beatId: string, toSectionId: string, toLine: string | null): Plot {
  let next = p
  const current = next.sections.find((s) => s.beatIds.includes(beatId))
  if (current && current.id !== toSectionId) {
    const target = next.sections.find((s) => s.id === toSectionId)
    if (!target) return p
    next = moveBeat(next, beatId, toSectionId, target.beatIds.length)
  }
  const beat = next.beats.find((b) => b.id === beatId)
  if (!beat) return next
  const lineRefs = toLine === null ? [] : [toLine]
  if (beat.lineRefs.length !== lineRefs.length || beat.lineRefs[0] !== lineRefs[0]) {
    next = updateBeat(next, beatId, { lineRefs })
  }
  return next
}

/**
 * グリッド：縦＝幕（時系列）×横＝プロットライン。幕が増えても縦に伸びるだけで
 * 横スクロールしない。空セルの点線が「この筋はこの幕で動いていない」を一目にする。
 * ビートのチップはドラッグで幕・ラインをまたいで動かせる（クリックはビートシートへ）。
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  // ドラッグ直後の click（pointerup と同時に発火する）でジャンプしないようにする目印。
  const draggedRef = useRef(false)
  const beatsIn = (sectionId: string, lineId: string | null) =>
    beatsOfSection(plot, sectionId).filter((b) =>
      lineId === null ? b.lineRefs.length === 0 : b.lineRefs.includes(lineId),
    )
  const hasUnassigned = plot.beats.some((b) => b.lineRefs.length === 0)
  // 列＝ライン（＋未設定の受け皿）。ラインがまだ無くても、幕またぎのドラッグはできるように出す。
  const columns: Array<{ key: string; lineId: string | null }> = [
    ...plot.lines.map((l) => ({ key: l.id, lineId: l.id as string | null })),
    ...(hasUnassigned || plot.lines.length === 0 ? [{ key: 'none', lineId: null }] : []),
  ]

  const submitAdd = () => {
    const title = addInput.trim()
    if (title === '') return
    // 色は作成順にパレットを循環割当（ビートシートのストライプと同じ色で対応が取れる）。
    onApply((p) =>
      addLine(p, { id: genId(), title, color: LINE_PALETTE[p.lines.length % LINE_PALETTE.length] }),
    )
    setAddInput('')
  }

  const onDragEnd = (e: DragEndEvent) => {
    setTimeout(() => {
      draggedRef.current = false
    }, 0)
    const { active, over } = e
    if (!over) return
    const to = (over.data.current ?? {}) as { sectionId?: string; lineId: string | null }
    if (to.sectionId === undefined) return
    const toSectionId = to.sectionId
    onApply((p) => moveBeatToCell(p, String(active.id), toSectionId, to.lineId ?? null))
  }

  return (
    <div>
      {plot.lines.length === 0 ? (
        <p className="mb-4 rounded-lg bg-surface-container-low px-4 py-3 text-[12.5px] text-on-surface-variant leading-relaxed">
          プロットライン（メイン・サブプロット・キャラアークなどの筋）を作ると、筋ごとの列に分かれて
          「どの幕で止まっているか」が見えるようになります。右上の「＋ ラインを追加」からどうぞ。
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          draggedRef.current = true
        }}
        onDragCancel={() => {
          setTimeout(() => {
            draggedRef.current = false
          }, 0)
        }}
        onDragEnd={onDragEnd}
      >
        <div className="overflow-x-auto pb-2">
          <div
            className="grid min-w-fit items-stretch gap-1.5"
            style={{
              gridTemplateColumns: `minmax(5.5rem, 7rem) repeat(${columns.length}, minmax(13rem, 1fr)) minmax(9rem, 11rem)`,
            }}
          >
            {/* 列見出し＝ライン */}
            <div />
            {columns.map((c) => {
              if (c.lineId === null) {
                return (
                  <div key={c.key} className="flex items-center px-1 pb-1">
                    <span className="text-[11.5px] text-on-surface-variant/70">ライン未設定</span>
                  </div>
                )
              }
              const lineId = c.lineId
              const line = plot.lines.find((l) => l.id === lineId)
              return (
                <div key={c.key} className="group flex items-center gap-1.5 px-1 pb-1">
                  <span
                    aria-hidden
                    className="h-5 w-1 shrink-0 rounded-full"
                    style={{ background: lineColorOf(plot, lineId) }}
                  />
                  <CommitInput
                    value={line?.title ?? ''}
                    onCommit={(v) => {
                      const t = v.trim()
                      if (t !== '') onApply((p) => updateLine(p, lineId, { title: t }))
                    }}
                    ariaLabel="プロットラインの名前"
                  />
                  <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <HoverButton
                      label="ラインを削除（ビートは残ります）"
                      onClick={() => onApply((p) => removeLine(p, lineId))}
                    >
                      <X className="size-3.5" />
                    </HoverButton>
                  </span>
                </div>
              )
            })}
            {/* 横軸＝ラインの並びの右端に「追加」を置く（軸と同じ向きに増やす）。 */}
            <div className="flex items-center gap-1 self-start rounded-md border border-outline-variant/40 border-dashed px-2 py-1">
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
                placeholder="ラインを追加"
                aria-label="プロットラインを追加"
                className="w-full min-w-0 bg-transparent font-sans text-[12px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
              />
            </div>
            {/* 行＝幕（時系列に縦へ） */}
            {plot.sections.map((s) => (
              <Fragment key={s.id}>
                <div className="pt-1 pr-1">
                  <span className="font-medium font-serif text-[13px] text-on-surface">
                    {s.title}
                  </span>
                  <span className="ml-1.5 text-[10.5px] text-on-surface-variant tabular-nums">
                    {s.beatIds.length}
                  </span>
                </div>
                {columns.map((c) => (
                  <GridCell
                    key={c.key}
                    sectionId={s.id}
                    lineId={c.lineId}
                    beats={beatsIn(s.id, c.lineId)}
                    onJumpBeat={(beatId) => {
                      if (!draggedRef.current) onJumpBeat(beatId)
                    }}
                  />
                ))}
                {/* 「追加」列ぶんの空セル（グリッドの行ずれ防止）。 */}
                <div />
              </Fragment>
            ))}
          </div>
        </div>
      </DndContext>
      <p className="mt-2 pl-1 text-[11.5px] text-on-surface-variant/70">
        ビートはドラッグで幕・ラインを移動できます。クリックでビートシートの編集へ。
      </p>
    </div>
  )
}

/** グリッドのチップの状態ドット色（アプリの固有パレットを直接引く）。 */
const STATUS_DOT: Record<PlotBeatStatus, string> = {
  idea: 'bg-[var(--outline-variant)]',
  fixed: 'bg-[var(--wheat-500)]',
  writing: 'bg-[var(--forest-400)]',
  done: 'bg-[var(--forest-700)]',
}

/** グリッドの1セル（ドロップ先）。空でも受け皿として存在し、ドラッグ中は縁が灯る。 */
function GridCell({
  sectionId,
  lineId,
  beats,
  onJumpBeat,
}: {
  sectionId: string
  lineId: string | null
  beats: PlotBeat[]
  onJumpBeat: (beatId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${sectionId}:${lineId ?? 'none'}`,
    data: { sectionId, lineId },
  })
  const empty = beats.length === 0
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-14 flex-col gap-1 rounded-md border p-1.5 transition-colors ${
        isOver
          ? 'border-primary/60 bg-accent'
          : empty
            ? 'grid place-items-center border-dashed'
            : 'border-outline-variant/20 bg-surface-container-low/50'
      }`}
      style={
        !isOver && empty && lineId !== null
          ? { borderColor: 'var(--wheat-500)', color: 'var(--wheat-700)' }
          : !isOver && empty
            ? { borderColor: 'var(--outline-variant)' }
            : undefined
      }
    >
      {empty ? (
        <span className="text-[10.5px]">{lineId !== null ? '空白' : ''}</span>
      ) : (
        beats.map((b) => <GridBeatChip key={b.id} beat={b} lineId={lineId} onJump={onJumpBeat} />)
      )}
    </div>
  )
}

/** グリッドのビートチップ（ドラッグで幕・ライン移動、クリックでビートシートへ）。 */
function GridBeatChip({
  beat,
  lineId,
  onJump,
}: {
  beat: PlotBeat
  lineId: string | null
  onJump: (beatId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: beat.id,
    data: { lineId },
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onJump(beat.id)}
      title="ドラッグで幕・ラインを移動 ・ クリックでビートシートへ"
      style={{
        transform: CSS.Translate.toString(transform),
        ...(isDragging ? { zIndex: 30, position: 'relative' as const } : {}),
      }}
      className={`flex w-full cursor-grab touch-none items-center gap-1.5 rounded-md border border-outline-variant/30 bg-surface-container-lowest px-2 py-1 text-left transition-colors hover:border-primary/40 active:cursor-grabbing ${
        isDragging ? 'opacity-80 shadow-md' : ''
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[beat.status]}`} />
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-on-surface">
        {beat.title || '無題のビート'}
      </span>
    </button>
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
      <h2 className="mb-1 font-semibold font-serif text-[16px] text-on-surface">伏線</h2>
      <p className="mb-2 text-[12px] text-on-surface-variant/70">
        後で効く布石。どこで張って、どこで回収するか。
      </p>
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

      <SecretTable
        plot={plot}
        beatOptions={beatOptions}
        onApply={onApply}
        onJumpBeat={onJumpBeat}
      />
    </div>
  )
}

const SECRET_UI: Record<SecretStatus, { label: string; className: string }> = {
  revealed: { label: '開示予定', className: 'bg-primary/12 text-primary' },
  unrevealed: {
    label: '開示未定',
    className: 'bg-secondary-container text-on-secondary-container',
  },
  kept: { label: '明かさない', className: 'bg-surface-container-high text-on-surface-variant' },
}

/**
 * 秘密：読者に伏せている情報と、それを明かすビートの対応表。
 * 伏線が「布石を回収したか」の点検なのに対し、こちらは「読者がいつ知るか」の設計。
 */
function SecretTable({
  plot,
  beatOptions,
  onApply,
  onJumpBeat,
}: {
  plot: Plot
  beatOptions: Array<{ value: string; label: string }>
  onApply: (fn: (p: Plot) => Plot) => void
  onJumpBeat: (beatId: string) => void
}) {
  const [addInput, setAddInput] = useState('')
  const submitAdd = () => {
    const title = addInput.trim()
    if (title === '') return
    onApply((p) => upsertSecret(p, { id: genId(), title }))
    setAddInput('')
  }

  return (
    <div className="mt-8">
      <h2 className="mb-1 font-semibold font-serif text-[16px] text-on-surface">
        秘密（読者に伏せる情報）
      </h2>
      <p className="mb-2 text-[12px] text-on-surface-variant/70">
        いま読者が知らないこと。真相は作者だけが見る欄で、どのビートで明かすかを決めます。
      </p>
      {plot.secrets.length === 0 ? (
        <p className="mb-4 rounded-lg bg-surface-container-low px-4 py-3 text-[12.5px] text-on-surface-variant leading-relaxed">
          「ユキの正体」「誰が犯人か」のように読者へ伏せていることを登録すると、
          明かし忘れ（開示未定）がここで分かります。最後まで伏せると決めたものは「明かさない」に。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-outline-variant/30">
          <table className="w-full min-w-[38rem] border-collapse bg-surface-container-lowest text-[13px]">
            <thead>
              <tr className="bg-surface-container-low text-left text-[11.5px] text-on-surface-variant">
                <th className="px-3 py-2 font-medium">秘密</th>
                <th className="px-3 py-2 font-medium">真相（作者用メモ）</th>
                <th className="px-3 py-2 font-medium">読者に明かすビート</th>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {plot.secrets.map((s) => {
                const status = secretStatus(s, plot)
                const ui = SECRET_UI[status]
                // 削除済みビートへの参照は選択肢に無い＝select が（未定）に落ちるので明示的に外す。
                const exists =
                  s.revealBeatId !== undefined && plot.beats.some((b) => b.id === s.revealBeatId)
                return (
                  <tr key={s.id} className="group border-outline-variant/20 border-t align-middle">
                    <td className="min-w-[9rem] px-3 py-2">
                      <CommitInput
                        value={s.title}
                        onCommit={(v) => {
                          const t = v.trim()
                          if (t !== '') onApply((p) => upsertSecret(p, { ...s, title: t }))
                        }}
                        ariaLabel="秘密の名前"
                      />
                    </td>
                    <td className="min-w-[11rem] px-3 py-2">
                      <CommitInput
                        value={s.truth ?? ''}
                        onCommit={(v) =>
                          onApply((p) => upsertSecret(p, { ...s, truth: emptyToUndef(v) }))
                        }
                        placeholder="本当は何なのか"
                        ariaLabel="秘密の真相"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <SelectBox
                          value={exists ? (s.revealBeatId ?? '') : ''}
                          onChange={(v) =>
                            onApply((p) =>
                              upsertSecret(p, {
                                ...s,
                                revealBeatId: v === '' ? undefined : v,
                                // 明かすビートを決めたら「明かさない」印は下ろす（矛盾を残さない）。
                                ...(v === '' ? {} : { keepHidden: undefined }),
                              }),
                            )
                          }
                          ariaLabel="読者に明かすビート"
                          options={beatOptions}
                        />
                        {exists && s.revealBeatId ? (
                          <HoverButton
                            label="ビートシートで開く"
                            onClick={() => {
                              if (s.revealBeatId) onJumpBeat(s.revealBeatId)
                            }}
                          >
                            <ArrowRight className="size-3.5" />
                          </HoverButton>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-[11px] ${ui.className}`}
                        >
                          {ui.label}
                        </span>
                        {status !== 'revealed' ? (
                          <button
                            type="button"
                            onClick={() =>
                              onApply((p) =>
                                upsertSecret(p, { ...s, keepHidden: !s.keepHidden || undefined }),
                              )
                            }
                            className="whitespace-nowrap text-[11px] text-primary hover:underline"
                          >
                            {s.keepHidden ? '開示予定に戻す' : '最後まで明かさない'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <HoverButton
                          label="この秘密を削除"
                          onClick={() => onApply((p) => removeSecret(p, s.id))}
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
          placeholder="秘密を追加（例：ユキの正体）"
          aria-label="秘密を追加"
          className="w-full max-w-sm bg-transparent font-sans text-[13px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
        />
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

/**
 * 記法つきの複数行入力（要約・メモ）。「書く」と「プレビュー」を切り替えられる。
 * 本文と同じ記法（[[用語]]・｜漢字《かんじ》・《《傍点》》）が使え、プレビューでは
 * 図鑑に居る語がリンクになる（クリックで図鑑の内容を見る＝本文編集と同じ見方）。
 */
function NotationField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  resolvedNames,
  glossary,
  onRefClick,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** 図鑑に居る語の集合（プレビューの解決/未解決の描き分け）。 */
  resolvedNames: Set<string>
  /** 図鑑（@ / [[ のサジェスト候補）。空ならサジェストしない。 */
  glossary: GlossaryEntry[]
  /** プレビュー内の参照クリック。未指定ならリンクにしない。 */
  onRefClick?: (name: string) => void
}) {
  // 既定はプレビュー（読むのが主・記法の記号を出さない）。空のときだけ編集で開き、
  // すぐ書き始められるようにする。選択ビートが変わるとパネルごと作り直されるのでここへ戻る。
  const [mode, setMode] = useState<'edit' | 'preview'>(value.trim() === '' ? 'edit' : 'preview')
  const html = useMemo(
    () => (mode === 'preview' ? blocksToHtml(parseEpisodeBody(value), resolvedNames) : ''),
    [mode, value, resolvedNames],
  )
  const previewRef = useRef<HTMLDivElement>(null)

  // dangerouslySetInnerHTML で描いた .ref をリンク化してクリックを委譲する（PreviewPane と同じ作法）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は innerHTML 再描画の検知に必要
  useEffect(() => {
    const el = previewRef.current
    if (!el || !onRefClick) return
    for (const ref of el.querySelectorAll<HTMLElement>('.ref[data-ref-name]')) {
      ref.setAttribute('role', 'link')
      ref.tabIndex = 0
    }
    const handle = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ref-name]')
      if (!target) return
      if (e.type === 'keydown') {
        const key = (e as KeyboardEvent).key
        if (key !== 'Enter' && key !== ' ') return
        e.preventDefault()
      }
      onRefClick(target.getAttribute('data-ref-name') ?? '')
    }
    el.addEventListener('click', handle)
    el.addEventListener('keydown', handle)
    return () => {
      el.removeEventListener('click', handle)
      el.removeEventListener('keydown', handle)
    }
  }, [html, onRefClick])

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 self-end">
        <ModeTab active={mode === 'edit'} onClick={() => setMode('edit')}>
          書く
        </ModeTab>
        <ModeTab active={mode === 'preview'} onClick={() => setMode('preview')}>
          プレビュー
        </ModeTab>
      </div>
      {mode === 'edit' ? (
        <CommitTextarea
          value={value}
          onCommit={onCommit}
          placeholder={placeholder}
          ariaLabel={ariaLabel}
          glossary={glossary}
        />
      ) : value.trim() === '' ? (
        <button
          type="button"
          onClick={() => setMode('edit')}
          className="w-full rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-left text-[12px] text-on-surface-variant/50 hover:border-primary/40"
        >
          （まだ書かれていません）クリックで書く
        </button>
      ) : (
        <div
          ref={previewRef}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: core/exporter が全エスケープ済みの安全な HTML
          dangerouslySetInnerHTML={{ __html: html }}
          className="preview plot-notation-preview rounded-md border border-outline-variant/30 bg-surface-variant px-2.5 py-1.5 text-on-surface"
        />
      )}
    </div>
  )
}

/** 「書く／プレビュー」の小さな切替タブ。 */
function ModeTab({
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
      aria-pressed={active}
      className={`rounded px-1.5 py-0.5 text-[10.5px] transition-colors ${
        active
          ? 'bg-surface-container-high font-medium text-on-surface'
          : 'text-on-surface-variant/60 hover:text-on-surface'
      }`}
    >
      {children}
    </button>
  )
}

/** blur で確定する自動伸長テキストエリア。 */
/** @／＠ が図鑑サジェストのトリガ（本文エディタと同じ）。 */
const isSuggestTrigger = (ch: string) => ch === '@' || ch === '＠'

function CommitTextarea({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  glossary,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  ariaLabel: string
  /** 図鑑（@ / [[ のサジェスト候補）。省略・空ならサジェストしない。 */
  glossary?: GlossaryEntry[]
}) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // 図鑑サジェスト（本文エディタと同じ挙動）。at＝トリガ位置、triggerLen＝@:1 / [[:2。
  const [suggest, setSuggest] = useState<{
    at: number
    triggerLen: number
    query: string
    top: number
    left: number
  } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  // IME 変換中は候補を出さない（確定前の文字で絞り込むと候補が暴れる）。
  const composing = useRef(false)
  const listId = useId()
  const optionId = (i: number) => `${listId}-opt-${i}`
  const entries = glossary ?? []
  const candidates = useMemo(
    () => (suggest ? suggestRefs(suggest.query, entries) : []),
    [suggest, entries],
  )
  const open = suggest !== null && candidates.length > 0

  useEffect(() => {
    if (!focused.current) setDraft(value)
  }, [value])
  // 内容の増減に高さを追従させる（scrollHeight を測るため一度 0 にする）。
  // パネル自体が専用スクロールを持つので、内側スクロールは作らない（重複スクロールの排除）。
  const resizeToContent = (el: HTMLTextAreaElement) => {
    el.style.height = '0'
    el.style.height = `${el.scrollHeight}px`
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: draft の変化で高さを測り直す（resizeToContent は毎レンダー同一の純関数）
  useLayoutEffect(() => {
    const el = ref.current
    if (el) resizeToContent(el)
  }, [draft])

  /** キャレット直前を走査してサジェストの開閉・絞り込みを更新する（本文エディタと同じ規則）。 */
  const refresh = (el: HTMLTextAreaElement) => {
    if (entries.length === 0 || composing.current) {
      setSuggest(null)
      return
    }
    const caret = el.selectionStart ?? 0
    const text = el.value
    let at = -1
    let triggerLen = 0
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i] ?? ''
      if (isSuggestTrigger(ch)) {
        at = i
        triggerLen = 1
        break
      }
      // [[ 検出（記法そのもの）。先頭の [ をトリガ位置にする。
      if (ch === '[' && (text[i - 1] ?? '') === '[') {
        at = i - 1
        triggerLen = 2
        break
      }
      // 区切り（空白・改行・] ＝ ref 閉じ）か 32 文字超で打ち切り。
      if (/\s/u.test(ch) || ch === ']' || caret - i > 32) break
    }
    // @ はメールアドレス等と紛れるので core のヒューリスティックで判定。[[ は常に発火。
    if (at < 0 || (triggerLen === 1 && !shouldTriggerSuggest(text.slice(0, at + 1)))) {
      setSuggest(null)
      return
    }
    const c = getCaretCoordinates(el, at)
    setSuggest({
      at,
      triggerLen,
      query: text.slice(at + triggerLen, caret),
      top: el.offsetTop + c.top + c.height,
      left: el.offsetLeft + c.left,
    })
    setActiveIndex(0)
  }

  /** 候補を [[名前]] として挿入する（打ちかけの @クエリ／[[クエリ を置換）。 */
  const commitSuggestion = (index: number) => {
    const el = ref.current
    const picked = candidates[index]
    if (!el || !suggest || !picked) return
    const caret = el.selectionStart ?? 0
    // 記法ボタン等で置いた空枠 [[]] の閉じ括弧を二重にしない。
    const hasCloser = draft.startsWith(']]', caret)
    const end = hasCloser ? caret + 2 : caret
    const start =
      suggest.triggerLen === 1 &&
      hasCloser &&
      suggest.at >= 2 &&
      draft.startsWith('[[', suggest.at - 2)
        ? suggest.at - 2
        : suggest.at
    const inserted = `[[${picked.name}]]`
    const next = draft.slice(0, start) + inserted + draft.slice(end)
    setDraft(next)
    setSuggest(null)
    // 挿入直後のキャレットを閉じ括弧の後ろへ置く（続けて書ける）。
    requestAnimationFrame(() => {
      const pos = start + inserted.length
      el.setSelectionRange(pos, pos)
      el.focus()
      resizeToContent(el)
    })
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={2}
        value={draft}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        onChange={(e) => {
          setDraft(e.target.value)
          resizeToContent(e.target)
          refresh(e.target)
        }}
        onClick={(e) => refresh(e.currentTarget)}
        onCompositionStart={() => {
          composing.current = true
          setSuggest(null)
        }}
        onCompositionEnd={(e) => {
          composing.current = false
          refresh(e.currentTarget)
        }}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          setSuggest(null)
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(e) => {
          if (open) {
            // 候補が出ている間の矢印・Enter・Tab はサジェスト操作に使う（改行させない）。
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActiveIndex((i) => (i + 1) % candidates.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              commitSuggestion(activeIndex)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setSuggest(null)
              return
            }
          }
          if (e.key === 'Escape') setDraft(value)
        }}
        onKeyUp={(e) => {
          // 矢印・Home/End 等でキャレットだけ動いた場合の追従（入力は onChange で拾う）。
          if (!open && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) {
            refresh(e.currentTarget)
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full resize-none overflow-hidden rounded-md border border-outline-variant/30 bg-surface px-2.5 py-1.5 text-[13px] text-on-surface leading-relaxed outline-none placeholder:text-on-surface-variant/45 focus:border-primary/50"
      />
      {open && suggest ? (
        <RefSuggest
          candidates={candidates}
          query={suggest.query}
          showCreate={false}
          activeIndex={activeIndex}
          top={suggest.top}
          left={suggest.left}
          listId={listId}
          optionId={optionId}
          onCommit={commitSuggestion}
          onHover={setActiveIndex}
        />
      ) : null}
    </div>
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

/** 図鑑エントリの複数選択（登場人物用）。カテゴリで絞り、無ければその場で図鑑登録できる。 */
function RefChips({
  label,
  ids,
  glossary,
  categoryRe,
  onChange,
  onCreate,
}: {
  label: string
  ids: string[]
  glossary: GlossaryEntry[]
  categoryRe: RegExp
  onChange: (ids: string[]) => void
  onCreate?: (name: string) => Promise<string | null>
}) {
  const byId = useMemo(() => new Map(glossary.map((g) => [g.id, g])), [glossary])
  const matched = glossary.filter(
    (g) => categoryRe.test((g.category ?? '').trim()) && !ids.includes(g.id),
  )
  const other = glossary.filter((g) => !(g.category ?? '').trim() && !ids.includes(g.id))
  const [creating, setCreating] = useState(false)
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
        {creating && onCreate ? (
          <CreateEntryInline
            onSubmit={async (name) => {
              const id = await onCreate(name)
              if (id && !ids.includes(id)) onChange([...ids, id])
              setCreating(false)
            }}
            onCancel={() => setCreating(false)}
          />
        ) : matched.length > 0 || other.length > 0 || onCreate ? (
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (v === '__create__') setCreating(true)
              else if (v !== '') onChange([...ids, v])
            }}
            aria-label={`${label}を追加`}
            className="rounded-md border border-outline-variant/30 bg-surface px-1.5 py-0.5 text-[11px] text-on-surface-variant outline-none focus:border-primary/50"
          >
            <option value="">＋ 追加</option>
            {matched.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            {other.length > 0 ? (
              <optgroup label="カテゴリ未設定">
                {other.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {onCreate ? <option value="__create__">＋ 図鑑に登録…</option> : null}
          </select>
        ) : null}
      </div>
    </div>
  )
}

/** 図鑑エントリの単一選択（視点・舞台用）。カテゴリで絞り、無ければその場で図鑑登録できる。 */
function GlossaryRefSelect({
  value,
  glossary,
  categoryRe,
  ariaLabel,
  onChange,
  onCreate,
}: {
  value: string | undefined
  glossary: GlossaryEntry[]
  categoryRe: RegExp
  ariaLabel: string
  onChange: (id: string | undefined) => void
  onCreate?: (name: string) => Promise<string | null>
}) {
  const [creating, setCreating] = useState(false)
  const matched = glossary.filter((g) => categoryRe.test((g.category ?? '').trim()))
  const other = glossary.filter((g) => !(g.category ?? '').trim())
  // 現在値が絞り込み外（別カテゴリの旧データ等）でも選択肢に残す＝表示が勝手に消えない。
  const current = value !== undefined ? glossary.find((g) => g.id === value) : undefined
  const currentExtra =
    current && !matched.includes(current) && !other.includes(current) ? current : undefined
  if (creating && onCreate) {
    return (
      <CreateEntryInline
        onSubmit={async (name) => {
          const id = await onCreate(name)
          if (id) onChange(id)
          setCreating(false)
        }}
        onCancel={() => setCreating(false)}
      />
    )
  }
  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value
        if (v === '__create__') setCreating(true)
        else onChange(v === '' ? undefined : v)
      }}
      aria-label={ariaLabel}
      className="w-full rounded-md border border-outline-variant/30 bg-surface px-2 py-1.5 text-[13px] text-on-surface outline-none focus:border-primary/50"
    >
      <option value="">（未設定）</option>
      {matched.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
      {other.length > 0 ? (
        <optgroup label="カテゴリ未設定">
          {other.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {currentExtra ? <option value={currentExtra.id}>{currentExtra.name}</option> : null}
      {onCreate ? <option value="__create__">＋ 図鑑に登録…</option> : null}
    </select>
  )
}

/** その場登録の1行フォーム（名前だけ入れて Enter／登録。詳細はあとで図鑑で書ける）。 */
function CreateEntryInline({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void | Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const submit = () => {
    const t = name.trim()
    if (t !== '') void onSubmit(t)
    else onCancel()
  }
  return (
    <div className="flex w-full items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
        placeholder="名前を入力して図鑑に登録"
        aria-label="図鑑に登録する名前"
        // biome-ignore lint/a11y/noAutofocus: 「＋ 図鑑に登録…」を選んだ直後だけ意図的にフォーカスする
        autoFocus
        className="w-full min-w-0 rounded-md border border-primary/40 bg-surface px-2 py-1 text-[12px] text-on-surface outline-none placeholder:text-on-surface-variant/45"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={submit}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-primary hover:bg-surface-container-high"
      >
        登録
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-md px-1.5 py-1 text-[12px] text-on-surface-variant hover:bg-surface-container-high"
      >
        取消
      </button>
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
