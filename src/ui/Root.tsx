import { useEffect, useMemo, useRef, useState } from 'react'
import { App } from './App'
import { useAuth } from './auth/auth-context'
import { createDefaultBackupService } from './backup/backup-service'
import { CloudBackupDialog } from './components/CloudBackupDialog/cloud-backup-dialog'
import { Library } from './components/Library/library'
import { SmallScreenNotice } from './components/SmallScreenNotice/small-screen-notice'
import { SyncOnboarding } from './components/SyncOnboarding/sync-onboarding'
import { useToast } from './components/Toast/toast'
import { useHashRoute } from './hooks/use-hash-route'
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

  // 会員のみクラウド全体バックアップ・復元を提供（IndexedDB＋/api/backup を結線）。
  // 単一アクティブセッションは撤去したので、複数端末に常時ログインでき、押し出しは起きない。
  const backupService = useMemo(
    () => (status === 'member' ? createDefaultBackupService(() => getTokenRef.current()) : null),
    [status],
  )
  const [backupOpen, setBackupOpen] = useState(false)

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
      {route === '/write' ? (
        <App store={store} onExit={() => navigate('/')} />
      ) : (
        <Library
          store={store}
          onEnterEditor={() => navigate('/write')}
          onOpenCloudBackup={backupService ? () => setBackupOpen(true) : undefined}
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
      {/* スマホ等の狭い画面（lg 未満）では本体を覆って非対応を案内する。 */}
      <SmallScreenNotice />
    </>
  )
}
