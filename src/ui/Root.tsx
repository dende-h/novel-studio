import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMcpTokenStatus } from './_api/mcp'
import { App } from './App'
import { useAuth } from './auth/auth-context'
import { createDefaultBackupService } from './backup/backup-service'
import { ActivityPage } from './components/ActivityPage/activity-page'
import { CloudBackupDialog } from './components/CloudBackupDialog/cloud-backup-dialog'
import { Library } from './components/Library/library'
import { McpConnectDialog } from './components/McpConnectDialog/mcp-connect-dialog'
import { SmallScreenNotice } from './components/SmallScreenNotice/small-screen-notice'
import { SyncOnboarding } from './components/SyncOnboarding/sync-onboarding'
import { useToast } from './components/Toast/toast'
import { useHashRoute } from './hooks/use-hash-route'
import { useLiveSnapshot } from './hooks/use-live-snapshot'
import { createDefaultActivityRepository } from './store/createDefaultStore'
import type { EditorStore } from './store/editorStore'

interface RootProps {
  store: EditorStore
}

/** 入口（ライブラリ）とエディタをハッシュで切り替えるトップレベル Container。 */
export function Root({ store }: RootProps) {
  const { route, navigate } = useHashRoute()
  const { status, isSignedIn, signOut, getToken } = useAuth()
  const { show } = useToast()
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  // 子（ダイアログ・effect）へ渡す安定した参照。毎レンダーで新関数を渡すと子の useEffect が
  // 再実行され、発行直後のトークン表示が消える等の不具合を招くため固定する。
  const getTokenStable = useCallback(() => getTokenRef.current(), [])

  // 会員のみクラウド全体バックアップ・復元を提供（IndexedDB＋/api/backup を結線）。
  // 単一アクティブセッションは撤去したので、複数端末に常時ログインでき、押し出しは起きない。
  const backupService = useMemo(
    () => (status === 'member' ? createDefaultBackupService(() => getTokenRef.current()) : null),
    [status],
  )
  // 執筆活動（草・ストリーク）は純ローカル・誰でも使える（同じ IndexedDB を読む）。
  const activityRepo = useMemo(() => createDefaultActivityRepository(), [])
  const [backupOpen, setBackupOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  // AI・MCP 接続済みか（トークン発行済み）。接続時のみ編集をライブスナップショットへ送る。
  const [mcpConnected, setMcpConnected] = useState(false)

  // ライブラリで保存済み作品一覧を表示するため、入口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  // 会員なら現在の MCP 接続状態を取得し、接続済みならライブ push を有効化する。
  useEffect(() => {
    if (status !== 'member') {
      setMcpConnected(false)
      return
    }
    void getMcpTokenStatus(getTokenStable).then((s) => setMcpConnected(s.hasToken))
  }, [status, getTokenStable])

  // 接続済み会員の編集をデバウンスでライブスナップショットへ反映（AI が最新を読める）。
  useLiveSnapshot(store, backupService, mcpConnected)

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

  if (route === '/activity') {
    return (
      <>
        <ActivityPage repo={activityRepo} onNavigateCollection={() => navigate('/')} />
        <SmallScreenNotice />
      </>
    )
  }

  return (
    <>
      {route === '/write' ? (
        <App
          store={store}
          onExit={() => navigate('/')}
          onNavigateActivity={() => navigate('/activity')}
        />
      ) : (
        <Library
          store={store}
          onEnterEditor={() => navigate('/write')}
          onOpenCloudBackup={backupService ? () => setBackupOpen(true) : undefined}
          onOpenMcp={backupService ? () => setMcpOpen(true) : undefined}
          onOpenActivity={() => navigate('/activity')}
        />
      )}
      {backupService && (
        <CloudBackupDialog
          open={backupOpen}
          onOpenChange={setBackupOpen}
          service={backupService}
          onNotify={show}
          onRestored={() => store.init()}
        />
      )}
      {backupService && (
        <McpConnectDialog
          open={mcpOpen}
          onOpenChange={setMcpOpen}
          getToken={getTokenStable}
          pushLive={backupService.pushLive}
          onConnectedChange={setMcpConnected}
          onNotify={show}
        />
      )}
      {/* スマホ等の狭い画面（lg 未満）では本体を覆って非対応を案内する。 */}
      <SmallScreenNotice />
    </>
  )
}
