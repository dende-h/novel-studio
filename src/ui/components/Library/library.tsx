import { Database, LayoutGrid, List, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { cn } from '@/lib/utils'
import { triggerDownload } from '@/ui/_utils/download'
import { worksBundleExport } from '@/ui/_utils/exporters'
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
}

/** 入口＝マイライブラリ（作品グリッド）。 */
export function Library({ store, onEnterEditor }: LibraryProps) {
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
  const now = Date.now()

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
          projectTitle="novel-studio"
          projectSubtitle="ライブラリ"
          active="collection"
          onNavigateCollection={() => {}}
          cta={{ label: '新しいプロジェクト', onClick: () => setNewOpen(true) }}
          profile={state.profile}
          onEditProfile={() => setProfileOpen(true)}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-10 md:px-16">
        <div className="mx-auto max-w-5xl pb-16">
          <header className="mb-10 flex items-end justify-between border-outline-variant/30 border-b pb-4">
            <div>
              <h1 className="mb-1 font-serif text-4xl text-on-surface">マイライブラリ</h1>
              <p className="text-on-surface-variant">執筆中の原稿と下書き</p>
            </div>
            <div className="flex items-center gap-2">
              {state.workList.length > 0 && (
                <div className="flex items-center rounded-md border border-outline-variant/40 p-0.5">
                  <button
                    type="button"
                    aria-label="カード表示"
                    aria-pressed={view === 'card'}
                    onClick={() => changeView('card')}
                    className={cn(
                      'rounded p-1.5 transition-colors',
                      view === 'card'
                        ? 'bg-surface-container-highest text-primary'
                        : 'text-on-surface-variant hover:text-primary',
                    )}
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="リスト表示"
                    aria-pressed={view === 'list'}
                    onClick={() => changeView('list')}
                    className={cn(
                      'rounded p-1.5 transition-colors',
                      view === 'list'
                        ? 'bg-surface-container-highest text-primary'
                        : 'text-on-surface-variant hover:text-primary',
                    )}
                  >
                    <List className="size-4" />
                  </button>
                </div>
              )}
              {state.trashList.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => setTrashOpen(true)}
                  className="gap-2 text-on-surface-variant"
                >
                  <Trash2 className="size-4" />
                  ゴミ箱
                  <span className="rounded-full bg-surface-container-highest px-1.5 text-xs">
                    {state.trashList.length}
                  </span>
                </Button>
              )}
              {state.workList.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setBackupOpen(true)}
                  className="gap-2 text-primary"
                >
                  <Database className="size-4" />
                  バックアップ
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => setImportOpen(true)}
                className="gap-2 text-primary"
              >
                <Upload className="size-4" />
                取り込み
              </Button>
            </div>
          </header>

          {view === 'card' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {state.workList.map((w) => (
                <ProjectCard key={w.id} {...itemProps(w)} />
              ))}

              {/* 新規プロジェクト（カード） */}
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="group flex min-h-[220px] flex-col items-center justify-center rounded-xl border-2 border-outline-variant/50 border-dashed font-sans text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-container-highest transition-colors group-hover:bg-primary group-hover:text-on-primary">
                  <Plus className="size-5" />
                </div>
                <h3 className="font-semibold font-serif text-lg text-on-surface">
                  新規プロジェクト
                </h3>
                <p className="text-sm">白紙から始める</p>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {state.workList.map((w) => (
                <ProjectRow key={w.id} {...itemProps(w)} />
              ))}

              {/* 新規プロジェクト（行） */}
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="group flex items-center justify-center gap-2 rounded-lg border-2 border-outline-variant/50 border-dashed py-3 font-sans text-on-surface-variant transition-colors hover:bg-surface-container-low"
              >
                <Plus className="size-4" />
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
        onExport={async () => triggerDownload(worksBundleExport(await store.getAllWorks()))}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(works) => store.importWorks(works)}
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
