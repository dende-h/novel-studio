import { Database, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { WorkSummary } from '@/core/storage/workRepository'
import { triggerDownload } from '@/ui/_utils/download'
import { worksBundleExport } from '@/ui/_utils/exporters'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { BackupDialog } from '@/ui/components/BackupDialog/backup-dialog'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import { ImportDialog } from '@/ui/components/ImportDialog/import-dialog'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { TrashDialog } from '@/ui/components/TrashDialog/trash-dialog'
import { Button } from '@/ui/components/ui/button'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import { TRASH_TTL_MS } from '@/ui/store/createDefaultStore'
import type { EditorStore } from '@/ui/store/editorStore'
import { ProjectCard } from './project-card'

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
  const [trashOpen, setTrashOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkSummary | null>(null)
  const [metaTarget, setMetaTarget] = useState<WorkSummary | null>(null)
  const now = Date.now()

  const handleWrite = async (id: string) => {
    await store.openWork(id)
    onEnterEditor()
  }
  const handleExport = async (id: string) => {
    await store.openWork(id)
    setExportOpen(true)
  }
  const handleCreate = async (title: string) => {
    await store.createWork(title)
    onEnterEditor()
  }

  return (
    <AppShell
      sidebar={
        <SideNav
          projectTitle="novel-studio"
          projectSubtitle="ライブラリ"
          active="collection"
          onNavigateCollection={() => {}}
          cta={{ label: '新しいプロジェクト', onClick: () => setNewOpen(true) }}
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {state.workList.map((w) => (
              <ProjectCard
                key={w.id}
                summary={w}
                now={now}
                onWrite={() => void handleWrite(w.id)}
                onExport={() => void handleExport(w.id)}
                onEditMeta={() => setMetaTarget(w)}
                onDelete={() => setDeleteTarget(w)}
              />
            ))}

            {/* 新規プロジェクト */}
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="group flex min-h-[220px] flex-col items-center justify-center rounded-xl border-2 border-outline-variant/50 border-dashed font-sans text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-container-highest transition-colors group-hover:bg-primary group-hover:text-on-primary">
                <Plus className="size-5" />
              </div>
              <h3 className="font-semibold font-serif text-lg text-on-surface">新規プロジェクト</h3>
              <p className="text-sm">白紙から始める</p>
            </button>
          </div>
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
        submitLabel="作成して書き始める"
        onSubmit={(title) => void handleCreate(title)}
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
      <WorkMetaDialog
        open={metaTarget !== null}
        onOpenChange={(o) => {
          if (!o) setMetaTarget(null)
        }}
        initial={{
          title: metaTarget?.title,
          author: metaTarget?.author,
          description: metaTarget?.description,
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
