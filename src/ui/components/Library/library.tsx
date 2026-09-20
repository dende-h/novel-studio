import {
  Bot,
  CloudUpload,
  Database,
  Download,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sparkles,
  Undo2,
  Upload,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { localDateKey, summarize } from '@/core/activity'
import { decideBackupNudge, type NudgeDecision } from '@/core/nudge/backup-nudge'
import type { WorkPlatform } from '@/core/schema'
import type { ActivityRepository } from '@/core/storage/activityRepository'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import type { WorkSummary } from '@/core/storage/workRepository'
import { cn } from '@/lib/utils'
import {
  describePublishBlocked,
  hasNovelGameEpisodes,
  isPublishAvailable,
  type NovelGameBundleInput,
  publishWorkToPlatform,
} from '@/ui/_api/publish'
import { triggerDownload } from '@/ui/_utils/download'
import { useAuth } from '@/ui/auth/auth-context'
import type { LocalBackupService } from '@/ui/backup/backup-service'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { BackupDialog } from '@/ui/components/BackupDialog/backup-dialog'
import { BackupNudgeDialog } from '@/ui/components/BackupNudgeDialog/backup-nudge-dialog'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import { ImportDialog } from '@/ui/components/ImportDialog/import-dialog'
import { SaveStateIndicator } from '@/ui/components/SaveStateIndicator/save-state-indicator'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { useToast } from '@/ui/components/Toast/toast'
import { TrashDialog } from '@/ui/components/TrashDialog/trash-dialog'
import { Button } from '@/ui/components/ui/button'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { markLocalBackup, readBackupMarks } from '@/ui/hooks/use-backup-marks'
import { acknowledgeNudge, readNudgeAck } from '@/ui/hooks/use-backup-nudge'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import { useOpenProfile } from '@/ui/hooks/use-pen-name'
import { TRASH_TTL_MS } from '@/ui/store/createDefaultStore'
import type { EditorStore } from '@/ui/store/editorStore'
import { ProjectCard } from './project-card'
import { ProjectRow } from './project-row'

/** カード／リストの表示切替を localStorage に記憶するキー。 */
const VIEW_STORAGE_KEY = 'library-view'
type LibraryView = 'card' | 'list'

interface LibraryProps {
  store: EditorStore
  /** エディタ（/write）へ遷移 */
  onEnterEditor: () => void
  /** 公開ページ（/publish）へ遷移。投稿はダイアログでなく一枚のページで扱う。 */
  onEnterPublish: () => void
  /** クラウドバックアップ管理を開く（会員のみ・未指定なら非表示）。 */
  onOpenCloudBackup?: () => void
  /** AI の変更取り込みを開く（会員のみ・未指定なら非表示）。 */
  onOpenAiPull?: () => void
  /** AI が書いた未取り込みの変更があるか（データ管理ボタンと項目に印を出す）。 */
  aiEditPending?: boolean
  /** AI・MCP 接続の管理を開く（会員のみ・未指定なら非表示）。 */
  onOpenMcp?: () => void
  /** 「同期で退避した版」の一覧を開く（会員のみ・未指定なら非表示）。 */
  onOpenSyncLost?: () => void
  /** 退避されている版の件数（0 なら項目に件数を出さない）。 */
  syncLostCount?: number
  /** 執筆活動（草・ストリーク）ページを開く。 */
  onOpenActivity?: () => void
  /** ネタ帳ページを開く。 */
  onOpenIdeas?: () => void
  /**
   * 掲示板ページを開く。渡されたときだけサイドバーに行が出る。
   * ここだけ onOpen* ではなく onNavigateBoard なのは、掲示板の導線を持つ5画面で
   * props 名を揃え、SideNav へそのまま素通しできるようにするため。
   */
  onNavigateBoard?: () => void
  /** 設定ページを開く。 */
  onOpenSettings?: () => void
  /** ヘルプページを開く。 */
  onOpenHelp?: () => void
  /** ローカル（ファイル）バックアップ：全状態の書き出し／全置換復元（課金非依存）。 */
  localBackup: LocalBackupService
  /** クラウド会員か（案内モーダルは無料の人だけに出す）。 */
  isMember: boolean
  /** 初回説明（タスク2）を見終えたか。終える前は案内モーダルを出さない（順番を守る）。 */
  onboarded: boolean
  /** 執筆日数の集計に使う（案内モーダルの節目判定）。 */
  activityRepo: ActivityRepository
  /** 案内モーダルの「クラウドバックアップを利用する場合はこちら」導線（無料の人向け・未指定なら非表示）。 */
  onOpenCloudPlan?: () => void
  /** 保存済みの演出譜（サウンドノベル書き出し・公開切替の v4 再送に載せる）。 */
  stagingRepo?: Pick<StagingRepository, 'get' | 'listByWork'>
  /** 持ち込み背景（演出が指す分だけ zip・v4 バンドルに同梱される）。 */
  gameAssetRepo?: Pick<GameAssetRepository, 'list'>
}

/** データ管理メニューの 1 項目。 */
function DataMenuItem({
  icon,
  label,
  onClick,
  disabled,
  badge,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  /** 右端の小さな印（「AIの変更が届いています」等の未処理サイン）。 */
  badge?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="rounded-full bg-secondary-container px-1.5 py-0.5 font-medium text-[10px] text-on-secondary-container">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/** 入口＝マイライブラリ（作品グリッド）。 */
export function Library({
  store,
  onEnterEditor,
  onEnterPublish,
  onOpenCloudBackup,
  onOpenAiPull,
  aiEditPending,
  onOpenMcp,
  onOpenSyncLost,
  syncLostCount = 0,
  onOpenActivity,
  onOpenIdeas,
  onNavigateBoard,
  onOpenSettings,
  onOpenHelp,
  localBackup,
  isMember,
  onboarded,
  activityRepo,
  onOpenCloudPlan,
  stagingRepo,
  gameAssetRepo,
}: LibraryProps) {
  const state = useEditorStore(store)
  // コトノハ-grove- への投稿は Clerk JWT で認証する（執筆アカウント＝公開アカウント）。
  const { getToken } = useAuth()
  // プロフィールの編集はアプリに 1 つ（Root が持つ）。ここは開く口を叩くだけ。
  const openProfile = useOpenProfile()
  const { show } = useToast()
  const [newOpen, setNewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  /** 公開切り替えの通信中の作品 id（多重送信を防ぐ）。 */
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [trashOpen, setTrashOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkSummary | null>(null)
  const [metaTarget, setMetaTarget] = useState<WorkSummary | null>(null)
  const [view, setView] = useState<LibraryView>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'card'
    } catch {
      return 'card'
    }
  })
  // 作品名の絞り込み（タイトル部分一致・大文字小文字無視）。
  const [query, setQuery] = useState('')
  const [dataMenuOpen, setDataMenuOpen] = useState(false)
  const dataMenuId = useId()
  const now = Date.now()

  const visibleWorks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return state.workList
    return state.workList.filter((w) => w.title.toLowerCase().includes(q))
  }, [state.workList, query])

  const totalChars = useMemo(
    () => state.workList.reduce((n, w) => n + w.charCount, 0),
    [state.workList],
  )

  // バックアップ案内（タスク4）：マイライブラリを開き、データが揃った“そのとき”に一度だけ判定する。
  // 会員には出さない。初回説明（タスク2）を終える前も出さない（順番を守る）。
  const [nudge, setNudge] = useState<Extract<NudgeDecision, { show: true }> | null>(null)
  const nudgeShownRef = useRef(false)
  useEffect(() => {
    if (nudgeShownRef.current || !onboarded || isMember) return
    let cancelled = false
    void (async () => {
      const days = await activityRepo.list()
      if (cancelled || nudgeShownRef.current) return
      const activeDays = summarize(days, localDateKey(Date.now())).activeDays
      const decision = decideBackupNudge({
        totalChars,
        activeDays,
        marks: readBackupMarks(),
        ack: readNudgeAck(),
        now: Date.now(),
      })
      if (!cancelled && decision.show) {
        nudgeShownRef.current = true // 1 マウントにつき一度だけ開く
        setNudge(decision)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onboarded, isMember, activityRepo, totalChars])

  // 解散（実行・×・背景クリック）：現在レベルを承認済みに繰り上げ、30 日のクールダウンを開始する。
  const dismissNudge = () => {
    if (nudge) acknowledgeNudge(nudge.charLevel, nudge.dayLevel, Date.now())
    setNudge(null)
  }

  const changeView = (next: LibraryView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // localStorage 不可（プライベートモード等）でも表示切替自体は機能させる
    }
  }

  const handleWrite = async (id: string) => {
    await store.openWork(id)
    onEnterEditor()
  }
  const handleExport = async (id: string) => {
    await store.openWork(id)
    setExportOpen(true)
  }
  const handlePublish = async (id: string) => {
    await store.openWork(id)
    onEnterPublish()
  }
  // 作成しても自動では遷移しない（一覧の先頭に出る）。執筆は「執筆」ボタンから。
  const handleCreate = (title: string) => void store.createWork(title)

  /**
   * 投稿済み作品の公開／下書きを、ライブラリから切り替える。
   * コトノハ-grove- は「作品まるごとの再送」で更新する仕様で、再送しても読者の反応は保持されるため、
   * 現在の内容のまま visibility だけ差し替えて送り直す（別の API を用意しない）。
   */
  const handleTogglePublish = async (summary: WorkSummary) => {
    if (publishBusyId !== null) return
    setPublishBusyId(summary.id)
    try {
      await store.openWork(summary.id)
      // openWork の直後は描画前なので、閉じ込めた state ではなく最新スナップショットから取る。
      const work = store.getSnapshot().work
      if (!work) return

      const platform: WorkPlatform = {
        ...work.platform,
        visibility: summary.platform?.visibility === 'public' ? 'draft' : 'public',
      }
      // サウンドノベルにする話がある作品を公開へ戻すときは、プレイヤーも作り直して v4 で送る。
      // 渡さないと v3（先方は据え置き）になり、本文だけ新しくプレイヤーが古いまま残る。
      // 前回は載せたが今は1話も選ばれていない作品でも v4 で送る＝先方が古い分を外せる
      let gameInput: NovelGameBundleInput | undefined
      if (
        platform.visibility === 'public' &&
        (hasNovelGameEpisodes(platform.novelGameEpisodes) || platform.novelGame === true) &&
        stagingRepo &&
        gameAssetRepo
      ) {
        gameInput = {
          stagings: await stagingRepo.listByWork(work.id),
          gameAssets: await gameAssetRepo.list(),
        }
      }
      const res = await publishWorkToPlatform(getToken, { ...work, platform }, gameInput)
      if (!res.ok) {
        show(res.message)
        return
      }
      await store.updateWorkMeta(work.id, {
        platform: {
          ...platform,
          // 誓約欠け・運営の非表示で公開されないことがあるので、記録は実際の結果に合わせる。
          visibility: res.published ? 'public' : 'draft',
          lastPublishedAt: Date.now(),
          manageUrl: res.manageUrl,
          ...(res.workUrl ? { workUrl: res.workUrl } : {}),
        },
      })
      show(
        res.publishBlocked
          ? describePublishBlocked(res.publishBlocked)
          : res.published
            ? '公開しました'
            : '下書きに戻しました',
      )
    } finally {
      setPublishBusyId(null)
    }
  }

  // カード／リストで共有する作品ごとのハンドラ束。
  const itemProps = (w: WorkSummary) => ({
    summary: w,
    now,
    onWrite: () => void handleWrite(w.id),
    onExport: () => void handleExport(w.id),
    onEditMeta: () => setMetaTarget(w),
    onDelete: () => setDeleteTarget(w),
    // 投稿先が未設定（VITE_PLATFORM_ORIGIN なし）のビルドでは投稿の導線ごと出さない。
    onPublish: isPublishAvailable ? () => void handlePublish(w.id) : undefined,
    // 公開／下書きの切り替えは、一度でも投稿できた作品にだけ出す（未投稿は投稿ダイアログから）。
    onTogglePublish:
      isPublishAvailable && w.platform?.lastPublishedAt !== undefined
        ? () => void handleTogglePublish(w)
        : undefined,
    publishBusy: publishBusyId === w.id,
  })

  return (
    <AppShell
      sidebar={
        <SideNav
          active="collection"
          onNavigateCollection={() => {}}
          onNavigateActivity={onOpenActivity}
          onNavigateIdeas={onOpenIdeas}
          onNavigateBoard={onNavigateBoard}
          onNavigateTrash={state.trashList.length > 0 ? () => setTrashOpen(true) : undefined}
          onNavigateSettings={onOpenSettings}
          onNavigateHelp={onOpenHelp}
          cta={{ label: '新しい作品', onClick: () => setNewOpen(true) }}
          profile={state.profile}
          onEditProfile={openProfile}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-9 md:px-10">
        <div className="mx-auto max-w-[1120px] pb-16">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-semibold font-serif text-[26px] text-on-surface">
                マイライブラリ
              </h1>
              <p className="mt-1 text-[13px] text-on-surface-variant">執筆中の原稿と下書き</p>
            </div>
            <div className="flex flex-col items-end gap-3">
              {/* 保存状態インジケータ（全データがスコープ）。ツールバーの上・右寄せで小さく常設。 */}
              <SaveStateIndicator
                lastUpdatedAt={
                  state.workList.reduce(
                    (m, w) => (w.updatedAt && w.updatedAt > m ? w.updatedAt : m),
                    0,
                  ) || null
                }
                onOpenFileBackup={() => setBackupOpen(true)}
                onOpenCloudBackup={onOpenCloudBackup}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* 作品名で検索（タイトル部分一致） */}
                <div className="relative">
                  <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-on-surface-variant/60" />
                  <input
                    type="search"
                    aria-label="作品名で検索"
                    placeholder="作品名で検索"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-[34px] w-[200px] rounded-md border border-outline-variant/40 bg-surface-container-lowest pr-3 pl-8 font-sans text-base text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary md:text-[13px]"
                  />
                </div>
                {state.workList.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="カード表示"
                      aria-pressed={view === 'card'}
                      onClick={() => changeView('card')}
                      className={cn(
                        'flex h-[26px] items-center gap-1 rounded-md px-2.5 font-sans text-xs transition-colors',
                        view === 'card'
                          ? 'bg-primary text-white'
                          : 'text-on-surface-variant hover:bg-surface-container-high',
                      )}
                    >
                      <LayoutGrid className="size-3.5" />
                      カード
                    </button>
                    <button
                      type="button"
                      aria-label="リスト表示"
                      aria-pressed={view === 'list'}
                      onClick={() => changeView('list')}
                      className={cn(
                        'flex h-[26px] items-center gap-1 rounded-md px-2.5 font-sans text-xs transition-colors',
                        view === 'list'
                          ? 'bg-primary text-white'
                          : 'text-on-surface-variant hover:bg-surface-container-high',
                      )}
                    >
                      <List className="size-3.5" />
                      リスト
                    </button>
                  </div>
                )}
                {/* データ管理（バックアップ・取り込み・クラウド・AI 接続をまとめる） */}
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-haspopup="menu"
                    aria-expanded={dataMenuOpen}
                    aria-controls={dataMenuOpen ? dataMenuId : undefined}
                    onClick={() => setDataMenuOpen((v) => !v)}
                    className="gap-2"
                  >
                    <Database className="size-4" />
                    データ管理
                    {aiEditPending ? (
                      // 点は装飾（読み上げはメニュー内の「未取り込み」バッジが担う）。
                      <span aria-hidden className="size-1.5 rounded-full bg-[var(--wheat-500)]" />
                    ) : null}
                  </Button>
                  {dataMenuOpen ? (
                    <>
                      <button
                        type="button"
                        aria-label="メニューを閉じる"
                        tabIndex={-1}
                        onClick={() => setDataMenuOpen(false)}
                        className="fixed inset-0 z-40 cursor-default"
                      />
                      <div
                        role="menu"
                        id={dataMenuId}
                        className="absolute right-0 top-10 z-50 flex w-[230px] flex-col rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-1.5 font-sans shadow-lg"
                      >
                        <DataMenuItem
                          icon={<Download className="size-[15px]" />}
                          label="バックアップを書き出し"
                          disabled={state.workList.length === 0}
                          onClick={() => {
                            setDataMenuOpen(false)
                            setBackupOpen(true)
                          }}
                        />
                        <DataMenuItem
                          icon={<Upload className="size-[15px]" />}
                          label="バックアップを取り込み"
                          onClick={() => {
                            setDataMenuOpen(false)
                            setImportOpen(true)
                          }}
                        />
                        {onOpenCloudBackup ? (
                          <DataMenuItem
                            icon={<CloudUpload className="size-[15px]" />}
                            label="クラウドバックアップ"
                            onClick={() => {
                              setDataMenuOpen(false)
                              onOpenCloudBackup()
                            }}
                          />
                        ) : null}
                        {onOpenAiPull ? (
                          <DataMenuItem
                            icon={<Sparkles className="size-[15px]" />}
                            label="AIの変更を取り込む"
                            badge={aiEditPending ? '未取り込み' : undefined}
                            onClick={() => {
                              setDataMenuOpen(false)
                              onOpenAiPull()
                            }}
                          />
                        ) : null}
                        {onOpenMcp ? (
                          <DataMenuItem
                            icon={<Bot className="size-[15px]" />}
                            label="AI に接続（MCP）"
                            onClick={() => {
                              setDataMenuOpen(false)
                              onOpenMcp()
                            }}
                          />
                        ) : null}
                        {/* 同期が採用しなかった版の置き場所。競合のたびに通知を出す代わりに、
                            「どこに退避したのか」をいつでも辿れる入口をここに常設する。 */}
                        {onOpenSyncLost ? (
                          <DataMenuItem
                            icon={<Undo2 className="size-[15px]" />}
                            label="同期で退避した版"
                            badge={syncLostCount > 0 ? String(syncLostCount) : undefined}
                            onClick={() => {
                              setDataMenuOpen(false)
                              onOpenSyncLost()
                            }}
                          />
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </header>

          {query.trim() !== '' && visibleWorks.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-on-surface-variant">
              「{query.trim()}」に一致する作品がありません。
            </p>
          ) : view === 'card' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-5">
              {visibleWorks.map((w) => (
                <ProjectCard key={w.id} {...itemProps(w)} />
              ))}

              {/* 新規プロジェクト（カード） */}
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="flex min-h-[300px] flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-outline-variant/50 border-dashed font-sans text-on-surface-variant transition-colors hover:border-primary hover:bg-accent hover:text-primary"
              >
                <Plus className="size-[22px]" />
                <span className="font-medium text-[13px]">新規プロジェクト</span>
                <span className="text-[11px] text-on-surface-variant/60">白紙から始める</span>
              </button>
            </div>
          ) : (
            <div className="overflow-visible rounded-lg border border-outline-variant/30 bg-surface-container-lowest">
              {visibleWorks.map((w) => (
                <ProjectRow key={w.id} {...itemProps(w)} />
              ))}

              {/* 新規プロジェクト（行） */}
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="flex w-full items-center justify-center gap-2 py-3.5 font-sans text-[13px] text-on-surface-variant transition-colors hover:bg-accent hover:text-primary"
              >
                <Plus className="size-[15px]" />
                新規プロジェクト
              </button>
            </div>
          )}
        </div>
      </div>

      <TitlePromptDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="新しいプロジェクト"
        description="新しい作品のタイトルを決めましょう。あとから変更できます。"
        label="作品タイトル"
        placeholder="無題の作品"
        defaultValue="無題の作品"
        submitLabel="作成"
        onSubmit={(title) => handleCreate(title)}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        work={state.work}
        stagingRepo={stagingRepo}
        gameAssetRepo={gameAssetRepo}
      />
      <BackupDialog
        open={backupOpen}
        onOpenChange={setBackupOpen}
        workCount={state.workList.length}
        onExport={async () => {
          const json = await localBackup.exportPlaintext()
          triggerDownload({
            filename: `kotonoha-backup-${new Date().toISOString().slice(0, 10)}.json`,
            mime: 'application/json;charset=utf-8',
            data: json,
          })
          // 保存状態インジケータ・執筆量案内が参照する「最後の書き出し日時＋そのときの総文字数」を記録。
          markLocalBackup(
            Date.now(),
            state.workList.reduce((n, w) => n + w.charCount, 0),
          )
        }}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(works) => store.importWorks(works)}
        onRestoreAll={(json) => localBackup.restorePlaintext(json)}
      />
      <WorkMetaDialog
        open={metaTarget !== null}
        onOpenChange={(o) => {
          if (!o) setMetaTarget(null)
        }}
        initial={{
          title: metaTarget?.title,
          author: metaTarget?.author,
          description: metaTarget?.description,
          // 表紙を初期値に含めないと、保存時に '' 扱いとなり既存表紙が消えてしまう。
          coverImage: metaTarget?.coverImage,
        }}
        onSubmit={(values) => {
          if (metaTarget) void store.updateWorkMeta(metaTarget.id, values)
        }}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        title="作品をゴミ箱へ移動しますか？"
        description={
          deleteTarget
            ? `「${deleteTarget.title}」をゴミ箱へ移動します。30日後に自動的に削除されますが、それまでは元に戻せます。`
            : undefined
        }
        confirmLabel="ゴミ箱へ移動"
        destructive={false}
        onConfirm={() => {
          if (deleteTarget) void store.trashWork(deleteTarget.id)
        }}
      />
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        trash={state.trashList}
        now={now}
        ttlMs={TRASH_TTL_MS}
        onRestore={(id) => void store.restoreWork(id)}
        onPurge={(id) => void store.purgeWork(id)}
        onEmpty={() => void store.emptyTrash()}
      />
      {/* バックアップ案内（タスク4）。無料の人にだけ、節目のときだけ。執筆画面には出さない。 */}
      {nudge && (
        <BackupNudgeDialog
          open
          headline={nudge.headline}
          body={nudge.body}
          onClose={dismissNudge}
          onFileBackup={() => setBackupOpen(true)}
          onCloud={onOpenCloudPlan}
        />
      )}
    </AppShell>
  )
}
