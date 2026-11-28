import { useEffect, useState } from 'react'
import type { Work } from '@/core/schema'
import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { useAuth } from '@/ui/auth/auth-context'
import { useToast } from '@/ui/components/Toast/toast'
import { WorkMetaDialog } from '@/ui/components/WorkMetaDialog/work-meta-dialog'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import { useIsNarrow } from '@/ui/hooks/use-narrow'
import type { EditorStore } from '@/ui/store/editorStore'
import { ExportPage } from './export-page'

interface ExportRouteProps {
  store: EditorStore
  requestedWorkId?: string
  workId: string
  onSelectWork: (id: string) => void
  requestedEpisodeId?: string
  fromEditor: boolean
  onBackToLibrary: () => void
  onOpenEditor: (workId: string, episodeId?: string, screen?: 'staging') => Promise<void>
  stagingRepo: Pick<StagingRepository, 'get'>
  gameAssetRepo: Pick<GameAssetRepository, 'list'>
}

export function ExportRoute({
  store,
  requestedWorkId,
  workId,
  onSelectWork,
  requestedEpisodeId,
  fromEditor,
  onBackToLibrary,
  onOpenEditor,
  stagingRepo,
  gameAssetRepo,
}: ExportRouteProps) {
  const { workList } = useEditorStore(store)
  const [loaded, setLoaded] = useState<{
    id: string
    updatedAt?: number
    work?: Work
    failed?: true
  } | null>(null)
  const [metaOpen, setMetaOpen] = useState(false)
  const { status } = useAuth()
  const narrow = useIsNarrow()
  const { show } = useToast()
  const updatedAt = workList.find(({ id }) => id === workId)?.updatedAt

  useEffect(() => {
    if (!workId) return
    let active = true
    void store.readWork(workId).then(
      (work) => {
        if (active) setLoaded({ id: workId, updatedAt, work })
      },
      () => {
        if (active) setLoaded({ id: workId, updatedAt, failed: true })
      },
    )
    return () => {
      active = false
    }
  }, [store, workId, updatedAt])

  const selection = loaded?.id === workId && loaded.updatedAt === updatedAt ? loaded : null
  const work = selection?.work ?? null
  const backToEditor = fromEditor && requestedWorkId !== undefined
  const edit = (id: string, episodeId?: string, screen?: 'staging') => {
    void onOpenEditor(id, episodeId, screen).catch(() => {
      show('作品を開けませんでした。マイライブラリから開き直してください。')
    })
  }

  return (
    <>
      <ExportPage
        key={workId}
        work={work}
        workId={workId}
        workList={workList}
        onSelectWork={onSelectWork}
        workStatus={
          !workId
            ? '書き出す作品を選んでください。'
            : !selection
              ? '作品を読み込み中…'
              : selection.failed
                ? '作品を読み込めませんでした。'
                : '作品が見つかりませんでした。'
        }
        onBack={backToEditor ? () => edit(requestedWorkId, requestedEpisodeId) : onBackToLibrary}
        backLabel={backToEditor ? '執筆画面に戻る' : 'マイライブラリに戻る'}
        initialEpisode={workId === requestedWorkId ? requestedEpisodeId : undefined}
        onEditEpisode={work ? (episodeId) => edit(work.id, episodeId) : undefined}
        onEditMeta={work ? () => setMetaOpen(true) : undefined}
        onEditStaging={
          work && !narrow && (status === 'free' || status === 'member')
            ? (episodeId) => edit(work.id, episodeId, 'staging')
            : undefined
        }
        stagingRepo={stagingRepo}
        gameAssetRepo={gameAssetRepo}
      />
      {work && metaOpen && (
        <WorkMetaDialog
          open
          onOpenChange={setMetaOpen}
          initial={{
            title: work.title,
            author: work.author,
            description: work.description,
            synopsis: work.synopsis,
            coverImage: work.coverImage,
            format: work.format,
          }}
          onSubmit={(values) => {
            void store.updateWorkMeta(work.id, values).catch(() => {
              show('作品情報を保存できませんでした。')
            })
          }}
        />
      )}
    </>
  )
}
