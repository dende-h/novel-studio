import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMcpTokenStatus } from './_api/mcp'
import { triggerDownload } from './_utils/download'
import { App } from './App'
import { useAuth } from './auth/auth-context'
import { createDefaultBackupService, createLocalBackupService } from './backup/backup-service'
import { ActivityPage } from './components/ActivityPage/activity-page'
import { AiPullDialog } from './components/AiPullDialog/ai-pull-dialog'
import { CloudBackupDialog } from './components/CloudBackupDialog/cloud-backup-dialog'
import { FirstRunDialog } from './components/FirstRunDialog/first-run-dialog'
import { HelpPage } from './components/HelpPage/help-page'
import { IdeaboxPage } from './components/IdeaboxPage/idea-box-page'
import { Library } from './components/Library/library'
import { McpConnectDialog } from './components/McpConnectDialog/mcp-connect-dialog'
import { PublishRoute } from './components/PublishPage/publish-route'
import { RestoreGrace } from './components/RestoreGrace/restore-grace'
import { SettingsPage } from './components/SettingsPage/settings-page'
import { SyncOnboarding } from './components/SyncOnboarding/sync-onboarding'
import { useToast } from './components/Toast/toast'
import { useAutoBackup } from './hooks/use-auto-backup'
import { useAutoSync } from './hooks/use-auto-sync'
import { useHashRoute } from './hooks/use-hash-route'
import { useLiveSnapshot } from './hooks/use-live-snapshot'
import { useLocalFlag } from './hooks/use-local-flag'
import {
  createDefaultActivityRepository,
  createDefaultIdeaRepository,
  createDefaultStructureRepository,
} from './store/createDefaultStore'
import type { EditorStore } from './store/editorStore'
import { createDefaultSyncService } from './sync/sync-service'
import { announceSyncApplied, withSyncTouch } from './sync/sync-touch'

interface RootProps {
  store: EditorStore
}

/** 入口（ライブラリ）とエディタをハッシュで切り替えるトップレベル Container。 */
export function Root({ store }: RootProps) {
  const { route, navigate } = useHashRoute()
  const {
    status,
    canRestore,
    graceUntil,
    signOut,
    getToken,
    openSignIn,
    openSignUp,
    available,
    isSignedIn,
  } = useAuth()
  const { show } = useToast()
  // 初回のみ保存の仕組みを一度だけ説明する（思想の共有）。立てたら再表示しない。
  const [onboarded, markOnboarded] = useLocalFlag('ns-onboarded')
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  // 子（ダイアログ・effect）へ渡す安定した参照。毎レンダーで新関数を渡すと子の useEffect が
  // 再実行され、発行直後のトークン表示が消える等の不具合を招くため固定する。
  const getTokenStable = useCallback(() => getTokenRef.current(), [])

  // 会員のみクラウド全体バックアップ・復元を提供（IndexedDB＋/api/backup を結線）。
  // 単一アクティブセッションは撤去したので、複数端末に常時ログインでき、押し出しは起きない。
  // 会員に加え、解約後の復元猶予期間（canRestore）でも生成する（復元のみ許可・作成はサーバが 402）。
  const backupService = useMemo(
    () =>
      status === 'member' || canRestore
        ? createDefaultBackupService(() => getTokenRef.current())
        : null,
    [status, canRestore],
  )
  // 執筆活動（草・ストリーク）は純ローカル・誰でも使える（同じ IndexedDB を読む）。
  const activityRepo = useMemo(() => createDefaultActivityRepository(), [])
  // ローカル（ファイル）バックアップも純ローカル・誰でも使える（全状態の書き出し／全置換復元）。
  const localBackup = useMemo(() => createLocalBackupService(), [])
  // ネタ帳（アイデアの受け皿）も純ローカル・誰でも使える。
  // 構造・ネタ帳の編集は editorStore を通らないため、変更系メソッドに同期通知（sync-touch）を
  // 差し込む＝編集の ~5 秒後に push される（これが無いと構造・ネタ帳の編集が push されない）。
  const ideaRepo = useMemo(
    () => withSyncTouch(createDefaultIdeaRepository(), ['add', 'update', 'remove']),
    [],
  )
  // 構造レイヤー（アウトライン／相関図／マインドマップ）は cloud 会員のみ利用。
  const structureRepo = useMemo(
    () =>
      withSyncTouch(createDefaultStructureRepository(), [
        'create',
        'save',
        'remove',
        'removeByWork',
      ]),
    [],
  )
  const [backupOpen, setBackupOpen] = useState(false)
  const [aiPullOpen, setAiPullOpen] = useState(false)
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

  // 会員の Work 単位自動同期（CAS＋三方向差分・2026-08 改訂）。スマホ⇔PC の使い分けを
  // バックアップ→復元なしで成立させる。pull 等でローカルが変わったら一覧を読み直し、
  // 競合（LWW で解決・敗者は履歴へ退避済み）はトーストで知らせる。
  // 執筆画面で開いている作品も、下書きが未保存（dirty）の間以外は pull を受け付け、
  // refreshOpenWork でエディタ状態を追随させる（図鑑・本文もページ遷移なしで届く）。
  const routeRef = useRef(route)
  routeRef.current = route
  const syncService = useMemo(
    () =>
      status === 'member'
        ? createDefaultSyncService(
            () => getTokenRef.current(),
            () => {
              if (routeRef.current !== '/write') return null
              const snap = store.getSnapshot()
              return snap.work ? { id: snap.work.id, dirty: snap.dirty } : null
            },
          )
        : null,
    [status, store],
  )
  useAutoSync(store, syncService, status === 'member', {
    onLocalChanged: () => {
      void store.init()
      // 開いている作品（本文・図鑑）のメモリ状態を pull へ追随させる。
      // 追随しないと次の save() が古い状態で上書きし、pull を黙って巻き戻してしまう。
      void store.refreshOpenWork()
      // 開いている構造ビュー・ネタ帳にも pull を反映させる（マウント時読み切りのため）。
      announceSyncApplied()
    },
    onConflicts: (conflicts) =>
      show(
        `別端末の変更と競合したため新しい方を採用しました（${conflicts.length}件・負けた版は端末内に退避済み）`,
      ),
  })

  // 会員の自動クラウドバックアップ（編集静止 5 分・最小間隔 60 分・世代 20）。
  // 同期が運ばない structures/ideas/profile/activity を含む全体スナップショットの安全網。
  useAutoBackup(store, backupService, status === 'member')

  // 法務ページ（利用規約・プライバシーポリシー・特商法表記）は SPA から切り出し、public/ 配下の
  // 静的HTML（/terms・/privacy・/tokushoho）として配信する。JS 無効でもクローラ・決済審査から
  // 参照でき、ハッシュ以降が無視される問題も解消する。アプリ内・LP からは実URLの anchor で飛ぶ。

  // 設定・ヘルプはサイドバー付き本体とは独立した一枚ものページ。認証・オンボーディングに関わらず
  // （狭い画面でも）到達できるよう、法務ページと同じくガードの手前に置く。
  if (route === '/settings') return <SettingsPage />
  if (route === '/help') return <HelpPage />

  // クラウド同期（有料）の案内。かつては未課金のサインイン済みに強制表示していたが、
  // novel platform とアカウントを共有する以上そこへ閉じ込められないため、
  // ヘッダーの導線から任意で開く一枚ものページにした。
  if (route === '/plan') return <SyncOnboarding onDismiss={() => navigate('/')} />

  // 解約後の復元猶予期間：クラウドから復元 → ローカル → 無料のファイル書き出し でデータを持ち出せる
  // 安全網。onboarding より先に判定する（猶予中も status は guest のため）。期限後はクラウド削除。
  if (canRestore && graceUntil != null) {
    return (
      <>
        <RestoreGrace
          graceUntil={graceUntil}
          onRestore={() => setBackupOpen(true)}
          onExport={async () => {
            const json = await localBackup.exportPlaintext()
            triggerDownload({
              filename: `kotonoha-backup-${new Date().toISOString().slice(0, 10)}.json`,
              mime: 'application/json;charset=utf-8',
              data: json,
            })
            show('ファイルに書き出しました')
          }}
          onSignOut={signOut}
        />
        {backupService ? (
          <CloudBackupDialog
            open={backupOpen}
            onOpenChange={setBackupOpen}
            service={backupService}
            restoreOnly
            onNotify={show}
            onRestored={() => {
              void store.init()
              show('手元に戻りました。「ファイルに書き出す」で保存できます')
            }}
          />
        ) : null}
      </>
    )
  }

  if (route === '/activity') {
    return (
      <ActivityPage
        repo={activityRepo}
        onNavigateCollection={() => navigate('/')}
        onNavigateIdeas={() => navigate('/ideas')}
        onNavigateSettings={() => navigate('/settings')}
        onNavigateHelp={() => navigate('/help')}
      />
    )
  }

  // 公開の管理（作品ひとつぶん）。いま開いている作品を対象にする＝ライブラリ・執筆画面の
  // どちらから来ても、先に openWork を通ってからここへ遷移する。
  if (route === '/publish') {
    return (
      <PublishRoute
        store={store}
        getToken={getTokenStable}
        isSignedIn={isSignedIn}
        onSignIn={available ? openSignIn : undefined}
      />
    )
  }

  if (route === '/ideas') {
    return (
      <IdeaboxPage
        repo={ideaRepo}
        onNavigateCollection={() => navigate('/')}
        onNavigateActivity={() => navigate('/activity')}
        onNavigateSettings={() => navigate('/settings')}
        onNavigateHelp={() => navigate('/help')}
      />
    )
  }

  return (
    <>
      {route === '/write' ? (
        <App
          store={store}
          onExit={() => navigate('/')}
          onNavigatePublish={() => navigate('/publish')}
          onNavigateActivity={() => navigate('/activity')}
          onNavigateSettings={() => navigate('/settings')}
          onNavigateHelp={() => navigate('/help')}
          activityRepo={activityRepo}
          structureRepo={structureRepo}
          canUseStructure={status === 'member'}
          ideaRepo={ideaRepo}
        />
      ) : (
        <Library
          store={store}
          onEnterEditor={() => navigate('/write')}
          onEnterPublish={() => navigate('/publish')}
          onOpenCloudBackup={backupService ? () => setBackupOpen(true) : undefined}
          onOpenAiPull={backupService ? () => setAiPullOpen(true) : undefined}
          onOpenMcp={backupService ? () => setMcpOpen(true) : undefined}
          onOpenActivity={() => navigate('/activity')}
          onOpenIdeas={() => navigate('/ideas')}
          onOpenSettings={() => navigate('/settings')}
          onOpenHelp={() => navigate('/help')}
          localBackup={localBackup}
          isMember={status === 'member'}
          onboarded={onboarded}
          activityRepo={activityRepo}
          // 無料の人向けクラウド導線＝サインアップ（→購読）。Clerk 未構成時はリンクを出さない。
          onOpenCloudPlan={available ? openSignUp : undefined}
        />
      )}
      {/* 初回のみの保存説明。執筆画面（/write）には出さない＝執筆中の割り込みを避ける。 */}
      {route !== '/write' && <FirstRunDialog open={!onboarded} onClose={markOnboarded} />}
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
        <AiPullDialog
          open={aiPullOpen}
          onOpenChange={setAiPullOpen}
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
    </>
  )
}
