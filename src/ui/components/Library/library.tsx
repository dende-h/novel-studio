import { Plus } from 'lucide-react'
import { useState } from 'react'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
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
          </header>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {state.workList.map((w) => (
              <ProjectCard
                key={w.id}
                summary={w}
                now={now}
                onWrite={() => void handleWrite(w.id)}
                onExport={() => void handleExport(w.id)}
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
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        work={state.work}
        getAllWorks={() => store.getAllWorks()}
      />
    </AppShell>
  )
}
