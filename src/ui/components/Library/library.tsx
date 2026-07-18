import {
  Bot,
  CloudUpload,
  Database,
  Download,
  LayoutGrid,
  List,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { cn } from '@/lib/utils'
import { triggerDownload } from '@/ui/_utils/download'
import type { LocalBackupService } from '@/ui/backup/backup-service'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { BackupDialog } from '@/ui/components/BackupDialog/backup-dialog'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import { ImportDialog } from '@/ui/components/ImportDialog/import-dialog'
import { ProfileDialog } from '@/ui/components/ProfileDialog/profile-dialog'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { TrashDialog } from '@/ui/components/TrashDialog/trash-dialog'
import { Button } from '@/ui/components/ui/button'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
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
  /** クラウドバックアップ管理を開く（会員のみ・未指定なら非表示）。 */
  onOpenCloudBackup?: () => void
  /** AI・MCP 接続の管理を開く（会員のみ・未指定なら非表示）。 */
  onOpenMcp?: () => void
  /** 執筆活動（草・ストリーク）ページを開く。 */
  onOpenActivity?: () => void
  /** ネタ帳ページを開く。 */
  onOpenIdeas?: () => void
  /** 設定ページを開く。 */
  onOpenSettings?: () => void
  /** ヘルプページを開く。 */
  onOpenHelp?: () => void
  /** ローカル（ファイル）バックアップ：全状態の書き出し／全置換復元（課金非依存）。 */
  localBackup: LocalBackupService
}

/** データ管理メニューの 1 項目。 */
function DataMenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
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
      {label}
    </button>
  )
}

/** 入口＝マイライブラリ（作品グリッド）。 */
export function Library({
  store,
  onEnterEditor,
  onOpenCloudBackup,
  onOpenMcp,
  onOpenActivity,
  onOpenIdeas,
  onOpenSettings,
  onOpenHelp,
  localBackup,
}: LibraryProps) {
  const state = useEditorStore(store)
  const [newOpen, setNewOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
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
  // 作成しても自動では遷移しない（一覧の先頭に出る）。執筆は「執筆」ボタンから。
  const handleCreate = (title: string) => void store.createWork(title)

  // カード／リストで共有する作品ごとのハンドラ束。
  const itemProps = (w: WorkSummary) => ({
    summary: w,
    now,
    onWrite: () => void handleWrite(w.id),
    onExport: () => void handleExport(w.id),
    onEditMeta: () => setMetaTarget(w),
    onDelete: () => setDeleteTarget(w),
  })

  return (
    <AppShell
      sidebar={
        <SideNav
          active="collection"
          onNavigateCollection={() => {}}
          onNavigateActivity={onOpenActivity}
          onNavigateIdeas={onOpenIdeas}
          onNavigateTrash={state.trashList.length > 0 ? () => setTrashOpen(true) : undefined}
          onNavigateSettings={onOpenSettings}
          onNavigateHelp={onOpenHelp}
          cta={{ label: '新しい作品', onClick: () => setNewOpen(true) }}
          profile={state.profile}
          onEditProfile={() => setProfileOpen(true)}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-9 md:px-10">
        <div className="mx-auto max-w-[1120px] pb-16">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-semibold font-serif text-[26px] text-on-surface">
                マイライブラリ
              </h1>
              <p className="mt-1 text-[13px] text-on-surface-variant">執筆中の原稿と下書き</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* 作品名で検索（タイトル部分一致） */}
              <div className="relative">
                <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-on-surface-variant/60" />
                <input
                  type="search"
                  aria-label="作品名で検索"
                  placeholder="作品名で検索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-[34px] w-[200px] rounded-md border border-outline-variant/40 bg-surface-container-lowest pr-3 pl-8 font-sans text-[13px] text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/50 focus:border-primary"
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
                    </div>
                  </>
                ) : null}
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
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} work={state.work} />
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
        }}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(works) => store.importWorks(works)}
        onRestoreAll={(json) => localBackup.restorePlaintext(json)}
      />
      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initial={{ penName: state.profile.penName ?? '', avatar: state.profile.avatar ?? '' }}
        onSubmit={(values) => void store.updateProfile(values)}
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
    </AppShell>
  )
}
