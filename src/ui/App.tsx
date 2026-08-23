import { BookMarked, Milestone, Plus, Replace } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDateKey } from '@/core/activity'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { findAppearances, resolvedNameSet, resolveRef } from '@/core/glossary'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { GlossaryEntry } from '@/core/schema'
import { countEpisodeChars, countWorkChars } from '@/core/stats'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { PlotRepository } from '@/core/storage/plotRepository'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { cn } from '@/lib/utils'
import { isPublishAvailable } from '@/ui/_api/publish'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import {
  EditorPane,
  type EditorPaneHandle,
  type NotationKind,
} from '@/ui/components/EditorPane/editor-pane'
import { ReplacePanel } from '@/ui/components/EditorPane/replace-panel'
import { ErrorBoundary } from '@/ui/components/ErrorBoundary/error-boundary'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import {
  GlossaryEntryForm,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryPeek } from '@/ui/components/GlossaryPeek/glossary-peek'
import { GlossaryView } from '@/ui/components/GlossaryView/glossary-view'
import { HistoryPanel } from '@/ui/components/HistoryPanel/history-panel'
import { PlotPeek } from '@/ui/components/PlotPeek/plot-peek'
import { PreviewPane } from '@/ui/components/PreviewPane/preview-pane'
import { ProfileDialog } from '@/ui/components/ProfileDialog/profile-dialog'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { useToast } from '@/ui/components/Toast/toast'
import { Button } from '@/ui/components/ui/button'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { useAutosave } from '@/ui/hooks/use-autosave'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import { useIsNarrow } from '@/ui/hooks/use-narrow'
import type { EditorStore } from '@/ui/store/editorStore'

/** フォーム値の空文字は未設定(undefined)へ畳んでスキーマの任意項目を綺麗に保つ。 */
const emptyToUndef = (s: string): string | undefined => (s.trim() === '' ? undefined : s)

/** GlossaryFormValues → updateGlossaryEntry のフィールドパッチ（name は除外＝改名は別操作）。 */
const toFieldPatch = (v: GlossaryFormValues) => ({
  aliases: v.aliases,
  category: emptyToUndef(v.category),
  reading: emptyToUndef(v.reading),
  summary: emptyToUndef(v.summary),
  body: emptyToUndef(v.body),
  authorNote: emptyToUndef(v.authorNote),
  // サムネは空文字をそのまま渡す（更新時 '' = 削除指示。作成時は addGlossaryEntry が空を弾く）。
  thumbnail: v.thumbnail,
})

interface AppProps {
  store: EditorStore
  /** 入口（ライブラリ）へ戻る */
  onExit?: () => void
  /** 公開ページへ。投稿はダイアログで完結させず、全体を見渡せる一枚に集約する。 */
  onNavigatePublish?: () => void
  /** 執筆の記録（草・ストリーク）へ */
  onNavigateActivity?: () => void
  /** 設定ページへ */
  onNavigateSettings?: () => void
  /** ヘルプページへ */
  onNavigateHelp?: () => void
  /** 執筆活動の読み取り（ステータスバーの「今日 +N字」）。省略時は非表示。 */
  activityRepo?: ActivityRepository
  /** 構造レイヤー（マインドマップ等）のリポジトリ。cloud 会員時のみ渡す。 */
  structureRepo?: StructureRepository
  /** プロット（幕×ビートの物語設計）のリポジトリ。cloud 会員時のみ渡す。 */
  plotRepo?: PlotRepository
  /** cloud 会員か（構造ツールの表示・アクセス可否）。 */
  canUseStructure?: boolean
  /** ネタ帳（マインドマップの取り込み用）。 */
  ideaRepo?: IdeaRepository
}

/** 構造ツール（マインドマップ・相関図＝React Flow、アウトライン＝dnd-kit）は重いので遅延ロードする。 */
const MindmapView = lazy(() => import('@/ui/components/MindmapView/mindmap-view'))
const CorrelationChartView = lazy(
  () => import('@/ui/components/CorrelationChartView/correlation-chart-view'),
)
const OutlineView = lazy(() => import('@/ui/components/OutlineView/outline-view'))
const PlotView = lazy(() => import('@/ui/components/PlotView/plot-view'))

/** エディタツールバーの記法ボタン（ショートカットは EditorPane の SHORTCUTS と対応）。 */
const NOTATION_BUTTONS: { kind: NotationKind; label: string; title: string }[] = [
  { kind: 'ruby', label: 'ルビ', title: 'ルビ ｜漢字《かんじ》（Ctrl/Cmd + I）' },
  { kind: 'dots', label: '傍点', title: '傍点 《《強調》》（Ctrl/Cmd + B）' },
  // 「用語集」はナビ（用語集ページ）とツールバー（用語集パネル）で既に使っているため、
  // 記法ボタンは挿入されるもの＝参照で呼び分ける。
  { kind: 'ref', label: '参照', title: '用語集参照 [[用語]]（Ctrl/Cmd + K）' },
]

/** 自動保存：本文の入力が止まってから保存するまでの待ち時間(ms)。純ローカル処理なので
 * 短くても安い。同期の push 猶予（保存後 1.5 秒）と直列に効くため、ここも短く保つ。 */
const AUTOSAVE_DELAY_MS = 1000

/**
 * 遅延ロードした画面を待つあいだの表示。
 *
 * flex-1 で main の幅いっぱいに広げてから中央へ置く。幅を持たせずに置くと、
 * flex の子は内容幅（数十 px）まで縮んでサイドバーの縁に貼りつき、
 * 中央寄せも効かないまま「サイドバーの下に隠れている」ように見える。
 */
function ScreenLoading() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-on-surface-variant text-sm">
      読み込み中…
    </div>
  )
}

/**
 * 画面の描画が失敗したときに、その画面の場所だけに出す受け皿。
 * 原稿は端末に残っているので、まずそれを伝えてから復帰の手段を出す。
 */
function ScreenFailure({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-[15px] text-on-surface">この画面を表示できませんでした。</p>
      <p className="max-w-md text-[13px] text-on-surface-variant leading-relaxed">
        書いた内容はこの端末に保存されています。もう一度開くか、左のメニューから別の画面へ移れます。
      </p>
      <Button variant="outline" onClick={retry}>
        もう一度開く
      </Button>
    </div>
  )
}

/** 原稿エディタ（サイドバー＋ツールバー＋本文／プレビュー＋用語集パネル／履歴）。 */
export function App({
  store,
  onExit,
  onNavigatePublish,
  onNavigateActivity,
  onNavigateSettings,
  onNavigateHelp,
  activityRepo,
  structureRepo,
  plotRepo,
  canUseStructure,
  ideaRepo,
}: AppProps) {
  const state = useEditorStore(store)
  const { show } = useToast()
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeScreen, setActiveScreen] = useState<
    'episodes' | 'glossary' | 'outline' | 'mindmap' | 'chart' | 'plot'
  >('episodes')
  // プレビューの組み方向（日本語小説の標準＝縦書きが既定。ツールバーで切替）。
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical')
  // 狭幅（lg 未満）で本文とプレビューのどちらを見せるか。縦書きは画面高＝行長のため
  // 上下に分割すると読めなくなる。lg 以上は max-lg: が不活性で従来どおり横並びのまま（D-EDIT-2）。
  const [pane, setPane] = useState<'editor' | 'preview'>('editor')
  // 一括置換パネル（この話の本文だけを対象）。
  const [replaceOpen, setReplaceOpen] = useState(false)
  // 用語集パネル（この話に登場＋選択 entry のチラ見）。@参照クリックでも開く。
  const [glossaryPanelOpen, setGlossaryPanelOpen] = useState(false)
  // 「この話のプロット」パネル（episodeRef が現在話のビート＋実字数/予定字数の進捗）。
  const [plotPanelOpen, setPlotPanelOpen] = useState(false)
  // パネル等からプロット画面へ飛ぶときの着地ビート（PlotView が消費して null に戻す）。
  const [plotFocusBeatId, setPlotFocusBeatId] = useState<string | null>(null)
  // 用語集パネルで選択中の entry（id で引いて常に最新を見る）。
  const [peekId, setPeekId] = useState<string | null>(null)
  // 未解決 @参照クリックで起動するクイック作成（プリフィルする名前。'' は空フォーム）。
  const [quickCreateName, setQuickCreateName] = useState<string | null>(null)
  // 用語集パネルからの編集対象。作成と同じくその場のモーダルで完結させる（本文から離れさせない）。
  const [editEntryId, setEditEntryId] = useState<string | null>(null)
  // ツールバーの記法ボタンから本文へ挿入するためのハンドル（選択範囲は EditorPane が持つ）。
  const editorRef = useRef<EditorPaneHandle>(null)
  const [deleteEpisodeTarget, setDeleteEpisodeTarget] = useState<{
    id: string
    title: string
  } | null>(null)
  const [renameEpisodeTarget, setRenameEpisodeTarget] = useState<{
    id: string
    title: string
  } | null>(null)

  useEffect(() => {
    void store.init()
  }, [store])

  const work = state.work

  // 構造化3機能（アウトライン/相関図/マインドマップ）は PC 専用。dnd-kit / React Flow の
  // ノード・辺の削除が opacity-0 group-hover のみでタッチから到達できないため、狭幅では入口を消す。
  const narrow = useIsNarrow()
  const structureAvailable = Boolean(work && canUseStructure && structureRepo && !narrow)
  const plotAvailable = Boolean(work && canUseStructure && plotRepo && !narrow)
  // 広い画面で構造ツールを開いたまま縮める／回転すると、入口が消えても activeScreen が
  // 残って操作不能な画面に閉じ込められる。CSS では state を戻せないので JS で戻す。
  useEffect(() => {
    if (
      narrow &&
      (activeScreen === 'outline' ||
        activeScreen === 'mindmap' ||
        activeScreen === 'chart' ||
        activeScreen === 'plot')
    ) {
      setActiveScreen('episodes')
    }
  }, [narrow, activeScreen])

  // 辞書 entry の name+aliases から解決済み名の集合を作り、プレビューの ref を
  // 解決（グレーリンク）／未解決（点線）で描き分ける（D-GLOS-PREVIEW-API）。
  const resolvedNames = useMemo(() => resolvedNameSet(work?.glossary ?? []), [work?.glossary])
  const previewHtml = useMemo(
    () => blocksToHtml(parseEpisodeBody(state.draft), resolvedNames),
    [state.draft, resolvedNames],
  )
  // 「この話のプロット」の進捗（実字数）。プレビューと同じ正本パーサで数える。
  const draftChars = useMemo(
    () => countEpisodeChars({ id: '', title: '', blocks: parseEpisodeBody(state.draft) }),
    [state.draft],
  )
  useAutosave(state.draft, state.dirty, () => void store.save(), AUTOSAVE_DELAY_MS)

  const episode = work?.episodes.find((e) => e.id === state.currentEpisodeId) ?? null
  const onEpisodes = activeScreen === 'episodes'

  const openExport = async () => {
    if (episode) await store.save()
    setExportOpen(true)
  }

  // 投稿は作品まるごとを送るので、書き出しと同じく編集中の本文を先に保存してから公開ページへ移る。
  const openPublish = async () => {
    if (episode) await store.save()
    onNavigatePublish?.()
  }

  const getAppearances = useCallback(
    (entry: GlossaryEntry) =>
      work ? findAppearances(work, entry) : { episodeIds: [], refCount: 0 },
    [work],
  )

  // パネルの選択は id 参照で常に最新の entry を引く（改名/削除に追従）。
  const peekEntry = useMemo(
    () => (peekId ? ((work?.glossary ?? []).find((e) => e.id === peekId) ?? null) : null),
    [peekId, work?.glossary],
  )
  // 編集対象も id 参照で引く（改名・削除に追従し、古い値でフォームを開かない）。
  const editEntry = useMemo(
    () => (editEntryId ? ((work?.glossary ?? []).find((e) => e.id === editEntryId) ?? null) : null),
    [editEntryId, work?.glossary],
  )

  /**
   * 用語集 entry の編集確定。改名を先に確定（衝突は reject させてダイアログに出す）、
   * その後フィールドを更新する。用語集ページ（GlossaryView）内の編集と同じ順序。
   */
  const submitEntryEdit = useCallback(
    async (entry: GlossaryEntry, values: GlossaryFormValues) => {
      if (values.name !== entry.name) {
        await store.renameGlossaryEntry(entry.id, values.name, { rewriteBody: false })
      }
      await store.updateGlossaryEntry(entry.id, toFieldPatch(values))
    },
    [store],
  )

  // プレビューの @参照クリック：解決済み→用語集パネルで表示、未解決→当該名でクイック作成。
  const onRefClick = useCallback(
    (name: string) => {
      const entry = resolveRef(name, work?.glossary ?? [])
      if (entry) {
        setHistoryOpen(false)
        setPlotPanelOpen(false)
        setPeekId(entry.id)
        setGlossaryPanelOpen(true)
      } else {
        setQuickCreateName(name)
      }
    },
    [work?.glossary],
  )

  // ステータスバーの「今日 +N字」：保存が確定するたびに当日の執筆活動を読み直す。
  const [todayNet, setTodayNet] = useState<number | null>(null)
  useEffect(() => {
    if (!activityRepo || state.status !== 'saved') return
    let alive = true
    void activityRepo.list().then((days) => {
      if (!alive) return
      const key = localDateKey(Date.now())
      setTodayNet(days.find((d) => d.date === key)?.net ?? 0)
    })
    return () => {
      alive = false
    }
  }, [activityRepo, state.status])

  // ステータスバー用の行数・文字数（旧 EditorPane のチップから移設）。
  const lineCount = state.draft === '' ? 0 : state.draft.split('\n').length
  const charCount = state.draft.length

  return (
    <AppShell
      onBrandClick={onExit}
      workTitle={work?.title}
      saveStatus={{ dirty: state.dirty, status: state.status }}
      onExport={() => void openExport()}
      onPublish={
        isPublishAvailable && work && onNavigatePublish ? () => void openPublish() : undefined
      }
      onToggleHistory={
        episode && onEpisodes
          ? () => {
              setGlossaryPanelOpen(false)
              setPlotPanelOpen(false)
              setHistoryOpen((v) => !v)
            }
          : undefined
      }
      historyOpen={historyOpen}
      onCloseAside={() => {
        setHistoryOpen(false)
        setGlossaryPanelOpen(false)
        setPlotPanelOpen(false)
      }}
      sidebar={
        <SideNav
          workTitle={work?.title}
          workMeta={
            work
              ? `${work.episodes.length}話 ・ ${countWorkChars(work).toLocaleString('ja-JP')}字`
              : undefined
          }
          active={activeScreen}
          onNavigateCollection={() => onExit?.()}
          onNavigateActivity={onNavigateActivity}
          onNavigateSettings={onNavigateSettings}
          onNavigateHelp={onNavigateHelp}
          onNavigateEpisodes={work ? () => setActiveScreen('episodes') : undefined}
          onNavigateGlossary={work ? () => setActiveScreen('glossary') : undefined}
          onNavigateMindmap={structureAvailable ? () => setActiveScreen('mindmap') : undefined}
          onNavigateChart={structureAvailable ? () => setActiveScreen('chart') : undefined}
          onNavigateOutline={structureAvailable ? () => setActiveScreen('outline') : undefined}
          onNavigatePlot={plotAvailable ? () => setActiveScreen('plot') : undefined}
          cta={{
            label: '新しいエピソード',
            onClick: () => setNewEpisodeOpen(true),
            disabled: !work,
          }}
          profile={state.profile}
          onEditProfile={() => setProfileOpen(true)}
          // 執筆中に作品情報（あらすじ・表紙）を直せるようにする。ダイアログは既存のものをそのまま開く。
          onEditWorkMeta={work ? () => setMetaOpen(true) : undefined}
          episodes={work?.episodes.map((e) => ({ id: e.id, title: e.title })) ?? []}
          currentEpisodeId={state.currentEpisodeId}
          onSelectEpisode={(id) => {
            store.openEpisode(id)
            setActiveScreen('episodes')
          }}
          onRenameEpisode={(id) => {
            const ep = work?.episodes.find((e) => e.id === id)
            if (ep) setRenameEpisodeTarget({ id, title: ep.title })
          }}
          onDeleteEpisode={(id) => {
            const ep = work?.episodes.find((e) => e.id === id)
            if (ep) setDeleteEpisodeTarget({ id, title: ep.title })
          }}
        />
      }
      aside={
        onEpisodes && plotPanelOpen && work && plotRepo ? (
          <PlotPeek
            repo={plotRepo}
            workId={work.id}
            episodeId={state.currentEpisodeId}
            actualChars={draftChars}
            onJumpBeat={(beatId) => {
              setPlotFocusBeatId(beatId)
              setActiveScreen('plot')
            }}
            onOpenPlot={() => setActiveScreen('plot')}
            onClose={() => setPlotPanelOpen(false)}
          />
        ) : (onEpisodes || activeScreen === 'plot') && glossaryPanelOpen && work ? (
          <GlossaryPeek
            entries={work.glossary ?? []}
            // プロット画面では「この話に登場」チップの母集団になる本文が無いので空を渡す
            // （選んだ用語の中身＝用語集の見え方は本文編集とまったく同じ）。
            draft={onEpisodes ? state.draft : ''}
            entry={peekEntry}
            appearances={peekEntry ? getAppearances(peekEntry) : null}
            onSelect={(id) => setPeekId(id)}
            onQuickCreate={(name) => setQuickCreateName(name)}
            onClose={() => setGlossaryPanelOpen(false)}
            // 作成と同じくその場のモーダルで編集する（用語集ページへ飛ばさない）。
            // パネルは開いたままにして、編集後にチップ一覧へ自然に戻れるようにする。
            onEdit={() => {
              if (peekEntry) setEditEntryId(peekEntry.id)
            }}
            onNewEntry={() => setQuickCreateName('')}
          />
        ) : historyOpen && episode && onEpisodes ? (
          <HistoryPanel
            snapshots={state.snapshots}
            currentEpisodeId={state.currentEpisodeId}
            currentText={state.draft}
            onRestore={(id) => store.restoreSnapshot(id)}
            onClose={() => setHistoryOpen(false)}
          />
        ) : undefined
      }
    >
      {/*
        画面ごとの描画エラーをここで受け止める。境界がアプリの根元にしか無かったころは、
        1 画面の例外でサイドバーもヘッダーも巻き添えに消え、利用者からは「別の画面へ飛ばされて
        メニューが減った」ようにしか見えなかった（リロードでしか戻れない）。
        activeScreen を key にしているので、別の画面へ移れば境界は張り直される。
      */}
      <ErrorBoundary key={activeScreen} fallback={(retry) => <ScreenFailure retry={retry} />}>
        {activeScreen === 'plot' && work && plotRepo ? (
          <Suspense fallback={<ScreenLoading />}>
            <PlotView
              repo={plotRepo}
              workId={work.id}
              glossary={work.glossary ?? []}
              episodes={work.episodes}
              ideaRepo={ideaRepo}
              structureRepo={structureRepo}
              focusBeatId={plotFocusBeatId}
              onConsumeFocus={() => setPlotFocusBeatId(null)}
              onOpenEpisode={(id) => {
                store.openEpisode(id)
                setActiveScreen('episodes')
              }}
              onCreateEpisode={async (title) => {
                // createEpisode は末尾に追加して id を返さないため、直後の snapshot から引く。
                await store.createEpisode(title)
                const snap = store.getSnapshot()
                const ep = snap.work?.episodes[snap.work.episodes.length - 1]
                return ep && ep.title === title ? ep.id : null
              }}
              onRefClick={onRefClick}
              onCreatePlainGlossaryEntry={async (name) => {
                // サジェストの「＋ 用語集に登録」。本文のクイック作成と同じく分類なしで作る
                // （人物か場所かはここでは決まらないので、後から用語集で付ける）。
                try {
                  return (await store.addGlossaryEntry({ name })).name
                } catch {
                  // 既存と重複（D-GLOS-UNIQUE）ならその既存の表記をそのまま使う。
                  return resolveRef(name, store.getSnapshot().work?.glossary ?? [])?.name ?? null
                }
              }}
              onCreateGlossaryEntry={async (name, category) => {
                try {
                  const entry = await store.addGlossaryEntry({ name, category })
                  return entry.id
                } catch {
                  // 既存と重複（D-GLOS-UNIQUE）なら、その既存エントリを選ぶ。
                  const existing = resolveRef(name, store.getSnapshot().work?.glossary ?? [])
                  return existing?.id ?? null
                }
              }}
            />
          </Suspense>
        ) : activeScreen === 'mindmap' && work && structureRepo ? (
          <Suspense fallback={<ScreenLoading />}>
            <MindmapView repo={structureRepo} workId={work.id} ideaRepo={ideaRepo} />
          </Suspense>
        ) : activeScreen === 'chart' && work && structureRepo ? (
          <Suspense fallback={<ScreenLoading />}>
            <CorrelationChartView
              repo={structureRepo}
              workId={work.id}
              glossary={work.glossary ?? []}
            />
          </Suspense>
        ) : activeScreen === 'outline' && work && structureRepo ? (
          <Suspense fallback={<ScreenLoading />}>
            <OutlineView
              repo={structureRepo}
              workId={work.id}
              episodes={work.episodes}
              onOpenEpisode={(id) => {
                store.openEpisode(id)
                setActiveScreen('episodes')
              }}
              onReorder={(ids) => void store.reorderEpisodes(ids)}
            />
          </Suspense>
        ) : activeScreen === 'glossary' && work ? (
          <GlossaryView
            entries={work.glossary ?? []}
            workTitle={work.title}
            getAppearances={getAppearances}
            onCreate={async (values) => {
              await store.addGlossaryEntry({ name: values.name, ...toFieldPatch(values) })
            }}
            onUpdate={async (id, values) => {
              await store.updateGlossaryEntry(id, toFieldPatch(values))
            }}
            onRename={async (id, newName, opts) => {
              await store.renameGlossaryEntry(id, newName, opts)
            }}
            onDelete={(id) => void store.deleteGlossaryEntry(id)}
          />
        ) : episode ? (
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            {/* エディタツールバー */}
            <div className="flex h-[46px] shrink-0 items-center justify-between gap-3 border-outline-variant/30 border-b bg-surface-container-lowest px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                {/* 狭幅では話タイトルを畳む（ドロワーの話一覧で分かる）。代わりに面の切替を置く。 */}
                <span className="truncate font-medium font-sans text-[13px] text-on-surface max-lg:hidden">
                  {episode.title}
                </span>
                {/* 本文／プレビューの切替（狭幅のみ）。組み方向トグルと同じ視覚言語で揃える。 */}
                <fieldset
                  aria-label="表示する面"
                  className="m-0 flex items-center gap-1 border-0 p-0 lg:hidden"
                >
                  <button
                    type="button"
                    aria-pressed={pane === 'editor'}
                    onClick={() => setPane('editor')}
                    className={cn(
                      'flex h-9 items-center rounded-md px-3 font-sans text-xs transition-colors',
                      pane === 'editor'
                        ? 'bg-primary text-white'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    本文
                  </button>
                  <button
                    type="button"
                    aria-pressed={pane === 'preview'}
                    onClick={() => setPane('preview')}
                    className={cn(
                      'flex h-9 items-center rounded-md px-3 font-sans text-xs transition-colors',
                      pane === 'preview'
                        ? 'bg-primary text-white'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    プレビュー
                  </button>
                </fieldset>
                {/* 記法の挿入（PC のみ。狭幅はキーボード直上の記法バーが担当する）。
                  選択があれば囲み、無ければ空の型を置く。ショートカットは EditorPane 側。 */}
                <div className="flex items-center gap-1 max-lg:hidden">
                  {NOTATION_BUTTONS.map(({ kind, label, title }) => (
                    <button
                      key={kind}
                      type="button"
                      title={title}
                      // クリックで textarea のフォーカス・選択範囲を失うと挿入先が分からなくなる。
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => editorRef.current?.applyNotation(kind)}
                      className="flex h-[26px] items-center rounded-md px-2.5 font-sans text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high hover:text-on-surface"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={replaceOpen}
                  onClick={() => setReplaceOpen((v) => !v)}
                  className={cn(
                    'gap-1.5 text-on-surface-variant hover:text-primary',
                    replaceOpen && 'bg-accent text-primary',
                  )}
                >
                  <Replace className="size-4" aria-hidden />
                  <span className="max-lg:hidden">置換</span>
                </Button>
                {/* 組み方向の切替（プレビュー）。狭幅では本文タブの時に意味を持たないので畳む。 */}
                <fieldset
                  aria-label="本文の組み方向"
                  className={cn(
                    'm-0 flex items-center gap-1 border-0 p-0',
                    pane === 'editor' && 'max-lg:hidden',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={orientation === 'horizontal'}
                    onClick={() => setOrientation('horizontal')}
                    className={cn(
                      'flex h-11 items-center rounded-md px-2.5 font-sans text-xs transition-colors md:h-[26px]',
                      orientation === 'horizontal'
                        ? 'bg-primary text-white'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    横書き
                  </button>
                  <button
                    type="button"
                    aria-pressed={orientation === 'vertical'}
                    onClick={() => setOrientation('vertical')}
                    className={cn(
                      'flex h-11 items-center rounded-md px-2.5 font-sans text-xs transition-colors md:h-[26px]',
                      orientation === 'vertical'
                        ? 'bg-primary text-white'
                        : 'text-on-surface-variant hover:bg-surface-container-high',
                    )}
                  >
                    縦書き
                  </button>
                </fieldset>
                {canUseStructure && plotRepo ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="この話のプロット"
                    aria-pressed={plotPanelOpen}
                    onClick={() => {
                      setHistoryOpen(false)
                      setGlossaryPanelOpen(false)
                      setPlotPanelOpen((v) => !v)
                    }}
                    className={cn(
                      'gap-1.5 text-on-surface-variant hover:text-primary',
                      plotPanelOpen && 'bg-accent text-primary',
                    )}
                  >
                    <Milestone className="size-4" aria-hidden />
                    <span className="max-lg:hidden">プロット</span>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="用語集パネル"
                  aria-pressed={glossaryPanelOpen}
                  onClick={() => {
                    setHistoryOpen(false)
                    setPlotPanelOpen(false)
                    setGlossaryPanelOpen((v) => !v)
                  }}
                  className={cn(
                    'gap-1.5 text-on-surface-variant hover:text-primary',
                    glossaryPanelOpen && 'bg-accent text-primary',
                  )}
                >
                  <BookMarked className="size-4" aria-hidden />
                  <span className="max-lg:hidden">用語集</span>
                </Button>
              </div>
            </div>

            {/* 本文＋プレビュー。lg 以上は従来どおり横並び、lg 未満は pane で切り替える（D-EDIT-2）。 */}
            <div className="flex min-h-0 flex-1">
              <div
                className={cn(
                  'relative flex min-w-0 flex-[1.3_1_0%] flex-col border-outline-variant/30 lg:border-r',
                  pane !== 'editor' && 'max-lg:hidden',
                )}
              >
                <EditorPane
                  ref={editorRef}
                  value={state.draft}
                  onChange={(v) => store.setDraft(v)}
                  glossary={work?.glossary ?? []}
                  onCreateEntry={(name) => store.addGlossaryEntry({ name })}
                />
                {replaceOpen ? (
                  <ReplacePanel
                    value={state.draft}
                    onApply={(next, count) => {
                      store.setDraft(next)
                      setReplaceOpen(false)
                      show(`${count}件を置換しました`)
                    }}
                    onClose={() => setReplaceOpen(false)}
                  />
                ) : null}
              </div>
              <div className={cn('min-w-0 flex-[1_1_0%]', pane !== 'preview' && 'max-lg:hidden')}>
                <PreviewPane html={previewHtml} onRefClick={onRefClick} orientation={orientation} />
              </div>
            </div>

            {/* ステータスバー */}
            <div className="flex h-[38px] shrink-0 items-center justify-between border-outline-variant/30 border-t bg-surface-container-lowest px-4 max-lg:h-7">
              {/* 狭幅は縦を本文に譲る（TopAppBar+ツールバー+ここで既に 120px 超を消費している）。 */}
              <span className="font-sans text-[11px] text-on-surface-variant/60 max-lg:hidden">
                自動保存 ON
              </span>
              <span className="font-sans text-[12px] text-on-surface-variant tabular-nums">
                {lineCount}行 ・ {charCount}文字
                {todayNet !== null
                  ? ` ・ 今日 ${todayNet >= 0 ? '+' : ''}${todayNet.toLocaleString('ja-JP')}字`
                  : ''}
              </span>
            </div>
          </div>
        ) : work ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <button
              type="button"
              onClick={() => setNewEpisodeOpen(true)}
              className="group flex flex-col items-center justify-center rounded-xl border-2 border-outline-variant/50 border-dashed px-12 py-10 font-sans text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-container-highest transition-colors group-hover:bg-primary group-hover:text-on-primary">
                <Plus className="size-5" />
              </div>
              <h3 className="font-semibold font-serif text-lg text-on-surface">
                新しいエピソードを追加
              </h3>
              <p className="text-sm">白紙から書き始める</p>
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-on-surface-variant text-sm">
            ライブラリから作品を開いてください
          </div>
        )}
      </ErrorBoundary>

      <TitlePromptDialog
        open={newEpisodeOpen}
        onOpenChange={setNewEpisodeOpen}
        title="新しいエピソード"
        description="この作品に追加する話のタイトルを入力します。"
        label="話タイトル"
        placeholder={`第${(work?.episodes.length ?? 0) + 1}話`}
        defaultValue={`第${(work?.episodes.length ?? 0) + 1}話`}
        submitLabel="追加"
        onSubmit={(title) => void store.createEpisode(title)}
      />
      {/* 話タイトルの変更（現在のタイトルをプリフィル・本文には影響しない）。 */}
      <TitlePromptDialog
        open={renameEpisodeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setRenameEpisodeTarget(null)
        }}
        title="話のタイトルを変更"
        description="この話の表示名を変更します。本文には影響しません。"
        label="話タイトル"
        defaultValue={renameEpisodeTarget?.title ?? ''}
        submitLabel="変更"
        onSubmit={(title) => {
          if (renameEpisodeTarget) void store.renameEpisode(renameEpisodeTarget.id, title)
        }}
      />
      {/* 用語集パネルからの編集（名前の変更も同じダイアログ。旧名は自動で別名に残る）。 */}
      <GlossaryEntryForm
        open={editEntry !== null}
        onOpenChange={(o) => {
          if (!o) setEditEntryId(null)
        }}
        mode="edit"
        initial={editEntry ?? undefined}
        onSubmit={async (values) => {
          if (editEntry) await submitEntryEdit(editEntry, values)
        }}
      />
      {/* 未解決 @参照クリックからのクイック作成（名前プリフィル）。 */}
      <GlossaryEntryForm
        open={quickCreateName !== null}
        onOpenChange={(o) => {
          if (!o) setQuickCreateName(null)
        }}
        mode="create"
        initial={quickCreateName !== null ? { name: quickCreateName } : undefined}
        onSubmit={async (values) => {
          await store.addGlossaryEntry({ name: values.name, ...toFieldPatch(values) })
        }}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        work={state.work}
        onEditMeta={
          work
            ? () => {
                setExportOpen(false)
                setMetaOpen(true)
              }
            : undefined
        }
      />
      {work ? (
        <WorkMetaDialog
          open={metaOpen}
          onOpenChange={setMetaOpen}
          initial={{
            title: work.title,
            author: work.author,
            description: work.description,
            coverImage: work.coverImage,
          }}
          onSubmit={(values) => void store.updateWorkMeta(work.id, values)}
        />
      ) : null}
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initial={{ penName: state.profile.penName ?? '', avatar: state.profile.avatar ?? '' }}
        onSubmit={(values) => void store.updateProfile(values)}
      />
      <ConfirmDialog
        open={deleteEpisodeTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteEpisodeTarget(null)
        }}
        title="この話を削除しますか？"
        description={
          deleteEpisodeTarget
            ? `「${deleteEpisodeTarget.title}」を削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          if (deleteEpisodeTarget) void store.deleteEpisode(deleteEpisodeTarget.id)
        }}
      />
    </AppShell>
  )
}
