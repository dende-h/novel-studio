import { useEffect, useMemo, useRef } from 'react'
import { importBundle } from '../core/bundle'
import { blocksToHtml } from '../core/exporter/toHtml'
import { parseEpisodeBody } from '../core/parser/parseNotation'
import { readFileText, triggerDownload } from './_utils/download'
import {
  episodeKakuyomuExport,
  episodeNarouExport,
  workEpubExport,
  workFolderZipExport,
  worksBundleExport,
} from './_utils/exporters'
import { EditorPane } from './components/EditorPane/editor-pane'
import { PreviewPane } from './components/PreviewPane/preview-pane'
import { StatusBar } from './components/StatusBar/status-bar'
import { WorkSidebar } from './components/WorkSidebar/work-sidebar'
import { useAutosave } from './hooks/use-autosave'
import { useEditorStore } from './hooks/use-editor-store'
import type { EditorStore } from './store/editorStore'

interface AppProps {
  store: EditorStore
  onExit?: () => void
}

export function App({ store, onExit }: AppProps) {
  const state = useEditorStore(store)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void store.init()
  }, [store])

  const previewHtml = useMemo(() => blocksToHtml(parseEpisodeBody(state.draft)), [state.draft])
  useAutosave(state.draft, state.dirty, () => void store.save(), 800)

  const work = state.work
  const episode = work?.episodes.find((e) => e.id === state.currentEpisodeId) ?? null
  const liveEpisode = episode ? { ...episode, blocks: parseEpisodeBody(state.draft) } : null

  const newWork = () => {
    const title = window.prompt('作品タイトル', '無題の作品')
    if (title != null) void store.createWork(title || '無題の作品')
  }
  const newEpisode = () => {
    const title = window.prompt('話タイトル', `第${(work?.episodes.length ?? 0) + 1}話`)
    if (title != null) void store.createEpisode(title || '無題の話')
  }

  const exportEpub = async () => {
    await store.save()
    const w = store.getSnapshot().work
    if (w) triggerDownload(workEpubExport(w))
  }
  const exportFolder = async () => {
    await store.save()
    const w = store.getSnapshot().work
    if (w) triggerDownload(workFolderZipExport(w))
  }
  const exportBundle = async () => {
    await store.save()
    triggerDownload(worksBundleExport(await store.getAllWorks()))
  }
  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    await store.importWorks(importBundle(await readFileText(file)))
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 border-neutral-200 border-b px-3 py-2">
        <h1 className="font-bold text-sm">
          <button
            type="button"
            onClick={onExit}
            disabled={!onExit}
            title="入り口に戻る"
            className="rounded transition hover:text-neutral-500 disabled:cursor-default"
          >
            novel-studio
          </button>
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() =>
              liveEpisode && work && triggerDownload(episodeNarouExport(work.title, liveEpisode))
            }
            disabled={!liveEpisode}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            なろう
          </button>
          <button
            type="button"
            onClick={() =>
              liveEpisode && work && triggerDownload(episodeKakuyomuExport(work.title, liveEpisode))
            }
            disabled={!liveEpisode}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            カクヨム
          </button>
          <button
            type="button"
            onClick={exportEpub}
            disabled={!work}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            EPUB
          </button>
          <button
            type="button"
            onClick={exportFolder}
            disabled={!work}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            フォルダ
          </button>
          <button type="button" onClick={exportBundle} className="rounded border px-2 py-1">
            バンドル出力
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border px-2 py-1"
          >
            取り込み
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="バンドル取り込み"
            onChange={(e) =>
              void onImportFile(e.target.files?.[0]).then(() => {
                if (fileInput.current) fileInput.current.value = ''
              })
            }
          />
          <StatusBar dirty={state.dirty} status={state.status} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <WorkSidebar
          workList={state.workList}
          currentWorkId={work?.id ?? null}
          episodes={work?.episodes.map((e) => ({ id: e.id, title: e.title })) ?? []}
          currentEpisodeId={state.currentEpisodeId}
          onSelectWork={(id) => void store.openWork(id)}
          onSelectEpisode={(id) => store.openEpisode(id)}
          onNewWork={newWork}
          onNewEpisode={newEpisode}
        />
        {episode ? (
          <main className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-neutral-200">
            <EditorPane value={state.draft} onChange={(v) => store.setDraft(v)} />
            <PreviewPane html={previewHtml} />
          </main>
        ) : (
          <main className="flex flex-1 items-center justify-center text-neutral-400 text-sm">
            {work ? '「新規話」で話を追加して書き始める' : '「新規作品」から始める'}
          </main>
        )}
      </div>
    </div>
  )
}
