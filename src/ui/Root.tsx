import { useCallback, useEffect, useRef } from 'react'
import { App } from './App'
import { useAuth } from './auth/auth-context'
import { useSessionGuard } from './auth/use-session-guard'
import { Library } from './components/Library/library'
import { SmallScreenNotice } from './components/SmallScreenNotice/small-screen-notice'
import { SyncOnboarding } from './components/SyncOnboarding/sync-onboarding'
import { SyncStatusBanner } from './components/SyncStatusBanner/sync-status-banner'
import { useToast } from './components/Toast/toast'
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
  const { status, isSignedIn, signOut } = useAuth()
  const { show } = useToast()

  // 別端末ログインでこの端末が無効化されたとき：強制サインアウト（→ゲスト化）＋トースト1回。
  // 旧 superseded バナーは廃止し、ヘッダーの「同期オフ」表示に一本化する。
  // セッション監視（checkSession）と push の 409 の両方から呼ばれるためワンショットにする。
  const supersededFiredRef = useRef(false)
  const handleSuperseded = useCallback(() => {
    if (supersededFiredRef.current) return
    supersededFiredRef.current = true
    show('別の端末でログインされたためサインアウトしました')
    signOut()
  }, [show, signOut])

  // member へ（再）突入したらワンショットガードを解除する（次に奪われたら再びトースト）。
  // 別ユーザーへの切替も必ず一度 guest を経由するため status の遷移だけで十分。
  useEffect(() => {
    if (status === 'member') supersededFiredRef.current = false
  }, [status])

  // 単一アクティブセッションの監視。claimed=セッション claim 完了。
  // これが立つまで sync は起動しない（claim 前の 409 を防ぐ）。
  const { claimed } = useSessionGuard(handleSuperseded)
  // クラウド同期の結線（ログイン時の全同期・autosave push・状態フェーズ）。
  const { phase, syncNow } = useSync(store, syncBridge, claimed, handleSuperseded)

  // ライブラリで保存済み作品一覧を表示するため、入口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  // 未課金でサインイン済み：中途半端な状態を残さず、専用オンボーディングで「購読する or ローカルの
  // まま使う（＝サインアウトしてゲスト）」の二択に収束させる（§1.1「アカウント＝有料会員だけが持つ」）。
  if (status === 'guest' && isSignedIn) {
    return (
      <>
        <SyncOnboarding onUseLocal={signOut} />
        <SmallScreenNotice />
      </>
    )
  }

  return (
    <>
      <SyncStatusBanner phase={phase} onSyncNow={syncNow} />
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
