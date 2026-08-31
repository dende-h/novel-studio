import type { GameAssetRepository } from '@/core/storage/gameAssetRepository'
import type { StagingRepository } from '@/core/storage/stagingRepository'
import { PublishPage } from '@/ui/components/PublishPage/publish-page'
import { useEditorStore } from '@/ui/hooks/use-editor-store'
import type { EditorStore } from '@/ui/store/editorStore'

interface PublishRouteProps {
  store: EditorStore
  getToken: () => Promise<string | null>
  isSignedIn: boolean
  onSignIn?: () => void
  /** サウンドノベル公開（契約 v4）の材料。渡されたときだけ切り替えが出る。 */
  stagingRepo?: Pick<StagingRepository, 'listByWork'>
  gameAssetRepo?: Pick<GameAssetRepository, 'list'>
}

/**
 * 公開ページの入れ物。
 *
 * 作品の購読をこの階層に閉じ込める（Root で購読すると、本文を1文字打つたびに
 * アプリ全体が再描画される）。対象はいま開いている作品で、ライブラリ・執筆画面の
 * どちらから来ても openWork を通ってからここへ遷移する。
 */
export function PublishRoute({
  store,
  getToken,
  isSignedIn,
  onSignIn,
  stagingRepo,
  gameAssetRepo,
}: PublishRouteProps) {
  const state = useEditorStore(store)

  return (
    <PublishPage
      work={state.work}
      getToken={getToken}
      isSignedIn={isSignedIn}
      onSignIn={onSignIn}
      stagingRepo={stagingRepo}
      gameAssetRepo={gameAssetRepo}
      onPersist={(workId, values) =>
        void store.updateWorkMeta(workId, {
          description: values.description,
          platform: values.platform,
        })
      }
    />
  )
}
