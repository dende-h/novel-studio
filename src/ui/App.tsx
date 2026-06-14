import { useEffect, useMemo, useState } from 'react'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { EditorPane } from '@/ui/components/EditorPane/editor-pane'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import { HistoryPanel } from '@/ui/components/HistoryPanel/history-panel'
import { PreviewPane } from '@/ui/components/PreviewPane/preview-pane'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { useAutosave } from '@/ui/hooks/use-autosave'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import type { EditorStore } from '@/ui/store/editorStore'

interface AppProps {
  store: EditorStore
  /** 入口（ライブラリ）へ戻る */
  onExit?: () => void
}

/** 原稿エディタ（サイドバー＋本文／プレビュー＋履歴）。 */
export function App({ store, onExit }: AppProps) {
  const state = useEditorStore(store)
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    void store.init()
  }, [store])

  const previewHtml = useMemo(() => blocksToHtml(parseEpisodeBody(state.draft)), [state.draft])
  useAutosave(state.draft, state.dirty, () => void store.save(), 800)

  const work = state.work
  const episode = work?.episodes.find((e) => e.id === state.currentEpisodeId) ?? null

  const openExport = async () => {
    if (episode) await store.save()
    setExportOpen(true)
  }

  return (
    <AppShell
      onBrandClick={onExit}
      saveStatus={{ dirty: state.dirty, status: state.status }}
      onExport={() => void openExport()}
      sidebar={
        <SideNav
          projectTitle={work?.title ?? 'novel-studio'}
          projectSubtitle="執筆中"
          active="episodes"
          onNavigateCollection={() => onExit?.()}
          cta={{
            label: '新しいエピソードを追加',
            onClick: () => setNewEpisodeOpen(true),
            disabled: !work,
          }}
          episodes={work?.episodes.map((e) => ({ id: e.id, title: e.title })) ?? []}
          currentEpisodeId={state.currentEpisodeId}
          onSelectEpisode={(id) => store.openEpisode(id)}
        />
      }
      aside={
        episode ? (
          <HistoryPanel
            snapshots={state.snapshots}
            currentEpisodeId={state.currentEpisodeId}
            onRestore={(id) => store.restoreSnapshot(id)}
          />
        ) : undefined
      }
    >
      {episode ? (
        <>
          <div className="flex h-full w-1/2 min-w-0 border-outline-variant/20 border-r">
            <EditorPane value={state.draft} onChange={(v) => store.setDraft(v)} />
          </div>
          <div className="h-full w-1/2 min-w-0">
            <PreviewPane html={previewHtml} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-on-surface-variant text-sm">
          {work
            ? '「新しいエピソードを追加」で書き始めましょう'
            : 'ライブラリから作品を開いてください'}
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
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        work={state.work}
        getAllWorks={() => store.getAllWorks()}
      />
    </AppShell>
  )
}
