import { BookMarked, Plus, Replace } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDateKey } from '@/core/activity'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { findAppearances, resolvedNameSet, resolveRef } from '@/core/glossary'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { GlossaryEntry } from '@/core/schema'
import { countWorkChars } from '@/core/stats'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import type { IdeaRepository } from '@/core/storage/ideaRepository'
import type { StructureRepository } from '@/core/storage/structureRepository'
import { cn } from '@/lib/utils'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import {
  EditorPane,
  type EditorPaneHandle,
  type NotationKind,
} from '@/ui/components/EditorPane/editor-pane'
import { ReplacePanel } from '@/ui/components/EditorPane/replace-panel'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import {
  GlossaryEntryForm,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryPeek } from '@/ui/components/GlossaryPeek/glossary-peek'
import { GlossaryView } from '@/ui/components/GlossaryView/glossary-view'
import { HistoryPanel } from '@/ui/components/HistoryPanel/history-panel'
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
  // サムネは空文字をそのまま渡す（更新時 '' = 削除指示。作成時は addGlossaryEntry が空を弾く）。
  thumbnail: v.thumbnail,
})

interface AppProps {
  store: EditorStore
  /** 入口（ライブラリ）へ戻る */
  onExit?: () => void
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

/** エディタツールバーの記法ボタン（ショートカットは EditorPane の SHORTCUTS と対応）。 */
const NOTATION_BUTTONS: { kind: NotationKind; label: string; title: string }[] = [
  { kind: 'ruby', label: 'ルビ', title: 'ルビ ｜漢字《かんじ》（Ctrl/Cmd + I）' },
  { kind: 'dots', label: '傍点', title: '傍点 《《強調》》（Ctrl/Cmd + B）' },
  // 「図鑑」はナビ（図鑑ページ）とツールバー（図鑑パネル）で既に使っているため、
  // 記法ボタンは挿入されるもの＝参照で呼び分ける。
  { kind: 'ref', label: '参照', title: '図鑑参照 [[用語]]（Ctrl/Cmd + K）' },
]

/** 自動保存：本文の入力が止まってから保存するまでの待ち時間(ms)。 */
const AUTOSAVE_DELAY_MS = 1500

/** 原稿エディタ（サイドバー＋ツールバー＋本文／プレビュー＋図鑑パネル／履歴）。 */
export function App({
  store,
  onExit,
  onNavigateActivity,
  onNavigateSettings,
  onNavigateHelp,
  activityRepo,
  structureRepo,
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
    'episodes' | 'glossary' | 'outline' | 'mindmap' | 'chart'
  >('episodes')
  // プレビューの組み方向（日本語小説の標準＝縦書きが既定。ツールバーで切替）。
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical')
  // 狭幅（lg 未満）で本文とプレビューのどちらを見せるか。縦書きは画面高＝行長のため
  // 上下に分割すると読めなくなる。lg 以上は max-lg: が不活性で従来どおり横並びのまま（D-EDIT-2）。
  const [pane, setPane] = useState<'editor' | 'preview'>('editor')
  // 一括置換パネル（この話の本文だけを対象）。
  const [replaceOpen, setReplaceOpen] = useState(false)
  // 図鑑パネル（この話に登場＋選択 entry のチラ見）。@参照クリックでも開く。
  const [glossaryPanelOpen, setGlossaryPanelOpen] = useState(false)
  // 図鑑パネルで選択中の entry（id で引いて常に最新を見る）。
  const [peekId, setPeekId] = useState<string | null>(null)
  // 未解決 @参照クリックで起動するクイック作成（プリフィルする名前。'' は空フォーム）。
  const [quickCreateName, setQuickCreateName] = useState<string | null>(null)
  // 図鑑パネルからの編集対象。作成と同じくその場のモーダルで完結させる（本文から離れさせない）。
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
  // 広い画面で構造ツールを開いたまま縮める／回転すると、入口が消えても activeScreen が
  // 残って操作不能な画面に閉じ込められる。CSS では state を戻せないので JS で戻す。
  useEffect(() => {
    if (
      narrow &&
      (activeScreen === 'outline' || activeScreen === 'mindmap' || activeScreen === 'chart')
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
  useAutosave(state.draft, state.dirty, () => void store.save(), AUTOSAVE_DELAY_MS)

  const episode = work?.episodes.find((e) => e.id === state.currentEpisodeId) ?? null
  const onEpisodes = activeScreen === 'episodes'

  const openExport = async () => {
    if (episode) await store.save()
    setExportOpen(true)
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
   * 図鑑 entry の編集確定。改名を先に確定（衝突は reject させてダイアログに出す）、
   * その後フィールドを更新する。図鑑ページ（GlossaryView）内の編集と同じ順序。
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

  // プレビューの @参照クリック：解決済み→図鑑パネルで表示、未解決→当該名でクイック作成。
  const onRefClick = useCallback(
    (name: string) => {
      const entry = resolveRef(name, work?.glossary ?? [])
      if (entry) {
        setHistoryOpen(false)
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
      onToggleHistory={
        episode && onEpisodes
          ? () => {
              setGlossaryPanelOpen(false)
              setHistoryOpen((v) => !v)
            }
          : undefined
      }
      historyOpen={historyOpen}
      onCloseAside={() => {
        setHistoryOpen(false)
        setGlossaryPanelOpen(false)
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
        onEpisodes && glossaryPanelOpen && work ? (
          <GlossaryPeek
            entries={work.glossary ?? []}
            draft={state.draft}
            entry={peekEntry}
            appearances={peekEntry ? getAppearances(peekEntry) : null}
            onSelect={(id) => setPeekId(id)}
            onQuickCreate={(name) => setQuickCreateName(name)}
            onClose={() => setGlossaryPanelOpen(false)}
            // 作成と同じくその場のモーダルで編集する（図鑑ページへ飛ばさない）。
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
            onRestore={(id) => store.restoreSnapshot(id)}
            onClose={() => setHistoryOpen(false)}
          />
        ) : undefined
      }
    >
      {activeScreen === 'mindmap' && work && structureRepo ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-on-surface-variant text-sm">
              読み込み中…
            </div>
          }
        >
          <MindmapView repo={structureRepo} workId={work.id} ideaRepo={ideaRepo} />
        </Suspense>
      ) : activeScreen === 'chart' && work && structureRepo ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-on-surface-variant text-sm">
              読み込み中…
            </div>
          }
        >
          <CorrelationChartView
            repo={structureRepo}
            workId={work.id}
            glossary={work.glossary ?? []}
          />
        </Suspense>
      ) : activeScreen === 'outline' && work && structureRepo ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-on-surface-variant text-sm">
              読み込み中…
            </div>
          }
        >
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
              <Button
                variant="ghost"
                size="sm"
                aria-label="図鑑パネル"
                aria-pressed={glossaryPanelOpen}
                onClick={() => {
                  setHistoryOpen(false)
                  setGlossaryPanelOpen((v) => !v)
                }}
                className={cn(
                  'gap-1.5 text-on-surface-variant hover:text-primary',
                  glossaryPanelOpen && 'bg-accent text-primary',
                )}
              >
                <BookMarked className="size-4" aria-hidden />
                <span className="max-lg:hidden">図鑑</span>
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
      {/* 図鑑パネルからの編集（名前の変更も同じダイアログ。旧名は自動で別名に残る）。 */}
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
