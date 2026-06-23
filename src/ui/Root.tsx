import { useEffect } from 'react'
import { App } from './App'
import { useSessionGuard } from './auth/use-session-guard'
import { Library } from './components/Library/library'
import { SmallScreenNotice } from './components/SmallScreenNotice/small-screen-notice'
import { SyncStatusBanner } from './components/SyncStatusBanner/sync-status-banner'
import { useHashRoute } from './hooks/use-hash-route'
import type { EditorStore } from './store/editorStore'
import type { SyncBridge } from './sync/sync-bridge'
import { useSync } from './sync/use-sync'

interface RootProps {
  store: EditorStore
  syncBridge: SyncBridge
}

/** 入口（ライブラリ）とエディタをハッシュで切り替えるトップレベル Container。 */
export function Root({ store, syncBridge }: RootProps) {
  const { route, navigate } = useHashRoute()
  // 単一アクティブセッションの監視（別端末に奪われたら同期停止バナーを出す）。
  const { superseded } = useSessionGuard()
  // クラウド同期の結線（ログイン時の全同期・autosave push・状態フェーズ）。
  const { phase, syncNow } = useSync(store, syncBridge)

  // ライブラリで保存済み作品一覧を表示するため、入口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  return (
    <>
      <SyncStatusBanner superseded={superseded} phase={phase} onSyncNow={syncNow} />
      {route === '/write' ? (
        <App store={store} onExit={() => navigate('/')} />
      ) : (
        <Library store={store} onEnterEditor={() => navigate('/write')} />
      )}
      {/* スマホ等の狭い画面（lg 未満）では本体を覆って非対応を案内する。 */}
      <SmallScreenNotice />
    </>
  )
}
