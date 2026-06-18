import { useCallback, useEffect, useMemo, useState } from 'react'
import { blocksToHtml } from '@/core/exporter/toHtml'
import { categoriesOf, findAppearances, resolvedNameSet, resolveRef } from '@/core/glossary'
import { parseEpisodeBody } from '@/core/parser/parseNotation'
import type { GlossaryEntry } from '@/core/schema'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog/confirm-dialog'
import { EditorPane } from '@/ui/components/EditorPane/editor-pane'
import { ExportDialog } from '@/ui/components/ExportDialog/export-dialog'
import {
  GlossaryEntryForm,
  type GlossaryFormValues,
} from '@/ui/components/GlossaryEntryForm/glossary-entry-form'
import { GlossaryPeek } from '@/ui/components/GlossaryPeek/glossary-peek'
import { GlossaryView } from '@/ui/components/GlossaryView/glossary-view'
import { HistoryPanel } from '@/ui/components/HistoryPanel/history-panel'
import { PreviewPane } from '@/ui/components/PreviewPane/preview-pane'
import { SideNav } from '@/ui/components/SideNav/side-nav'
import { TitlePromptDialog } from '@/ui/components/TitlePromptDialog/title-prompt-dialog'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { useAutosave } from '@/ui/hooks/use-autosave'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
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
})

interface AppProps {
  store: EditorStore
  /** 入口（ライブラリ）へ戻る */
  onExit?: () => void
}

/** 自動保存：本文の入力が止まってから保存するまでの待ち時間(ms)。 */
const AUTOSAVE_DELAY_MS = 1500

/** 原稿エディタ（サイドバー＋本文／プレビュー＋履歴）。 */
export function App({ store, onExit }: AppProps) {
  const state = useEditorStore(store)
  const [newEpisodeOpen, setNewEpisodeOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeScreen, setActiveScreen] = useState<'episodes' | 'glossary'>('episodes')
  // プレビューの @参照クリックで開く右 aside ピーク（entry は id で引いて常に最新を見る）。
  const [peekId, setPeekId] = useState<string | null>(null)
  // 未解決 @参照クリックで起動するクイック作成（プリフィルする名前）。
  const [quickCreateName, setQuickCreateName] = useState<string | null>(null)
  const [deleteEpisodeTarget, setDeleteEpisodeTarget] = useState<{
    id: string
    title: string
  } | null>(null)

  useEffect(() => {
    void store.init()
  }, [store])

  const work = state.work
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

  // ピークは id 参照で常に最新の entry を引く（改名/削除に追従し、削除されれば自動で閉じる）。
  const peekEntry = useMemo(
    () => (peekId ? ((work?.glossary ?? []).find((e) => e.id === peekId) ?? null) : null),
    [peekId, work?.glossary],
  )

  // プレビューの @参照クリック：解決済み→ピーク表示、未解決→当該名でクイック作成。
  const onRefClick = useCallback(
    (name: string) => {
      const entry = resolveRef(name, work?.glossary ?? [])
      if (entry) {
        setHistoryOpen(false)
        setPeekId(entry.id)
      } else {
        setQuickCreateName(name)
      }
    },
    [work?.glossary],
  )

  return (
    <AppShell
      onBrandClick={onExit}
      saveStatus={{ dirty: state.dirty, status: state.status }}
      onExport={() => void openExport()}
      onToggleHistory={episode && onEpisodes ? () => setHistoryOpen((v) => !v) : undefined}
      historyOpen={historyOpen}
      onCloseAside={() => {
        setHistoryOpen(false)
        setPeekId(null)
      }}
      sidebar={
        <SideNav
          projectTitle={work?.title ?? 'novel-studio'}
          projectSubtitle={onEpisodes ? '執筆中' : '辞書'}
          active={activeScreen}
          onNavigateCollection={() => onExit?.()}
          onNavigateEpisodes={work ? () => setActiveScreen('episodes') : undefined}
          onNavigateGlossary={work ? () => setActiveScreen('glossary') : undefined}
          cta={{
            label: '新しいエピソードを追加',
            onClick: () => setNewEpisodeOpen(true),
            disabled: !work,
          }}
          episodes={work?.episodes.map((e) => ({ id: e.id, title: e.title })) ?? []}
          currentEpisodeId={state.currentEpisodeId}
          onSelectEpisode={(id) => {
            store.openEpisode(id)
            setActiveScreen('episodes')
          }}
          onDeleteEpisode={(id) => {
            const ep = work?.episodes.find((e) => e.id === id)
            if (ep) setDeleteEpisodeTarget({ id, title: ep.title })
          }}
        />
      }
      aside={
        onEpisodes && peekEntry ? (
          <GlossaryPeek
            entry={peekEntry}
            appearances={getAppearances(peekEntry)}
            onClose={() => setPeekId(null)}
            onEdit={() => {
              setPeekId(null)
              setActiveScreen('glossary')
            }}
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
      {activeScreen === 'glossary' && work ? (
        <GlossaryView
          entries={work.glossary ?? []}
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
        <>
          <div className="h-full min-w-0 basis-3/5 border-outline-variant/20 border-r">
            <EditorPane
              value={state.draft}
              onChange={(v) => store.setDraft(v)}
              glossary={work?.glossary ?? []}
              onCreateEntry={(name) => store.addGlossaryEntry({ name })}
            />
          </div>
          <div className="h-full min-w-0 basis-2/5">
            <PreviewPane html={previewHtml} onRefClick={onRefClick} />
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
      {/* 未解決 @参照クリックからのクイック作成（名前プリフィル）。 */}
      <GlossaryEntryForm
        open={quickCreateName !== null}
        onOpenChange={(o) => {
          if (!o) setQuickCreateName(null)
        }}
        mode="create"
        initial={quickCreateName !== null ? { name: quickCreateName } : undefined}
        categories={categoriesOf(work?.glossary ?? [])}
        onSubmit={async (values) => {
          await store.addGlossaryEntry({ name: values.name, ...toFieldPatch(values) })
        }}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        work={state.work}
        getAllWorks={() => store.getAllWorks()}
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
          initial={{ title: work.title, author: work.author, description: work.description }}
          onSubmit={(values) => void store.updateWorkMeta(work.id, values)}
        />
      ) : null}
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
