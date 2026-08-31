import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { IdbStore } from '@/core/storage/idbStore'
import { SyncLostRepository } from '@/core/sync/syncLostRepository'
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
import { ProfileDialog } from './components/ProfileDialog/profile-dialog'
import { PublishRoute } from './components/PublishPage/publish-route'
import { RestoreGrace } from './components/RestoreGrace/restore-grace'
import { SettingsPage } from './components/SettingsPage/settings-page'
import { SyncLostDialog } from './components/SyncLostDialog/sync-lost-dialog'
import { SyncOnboarding } from './components/SyncOnboarding/sync-onboarding'
import { useToast } from './components/Toast/toast'
import { useAutoBackup } from './hooks/use-auto-backup'
import { useAutoSync } from './hooks/use-auto-sync'
import { useHashRoute } from './hooks/use-hash-route'
import { useLiveSnapshot } from './hooks/use-live-snapshot'
import { useLocalFlag } from './hooks/use-local-flag'
import {
  PenNameContext,
  ProfileEditContext,
  useAccountPenNameSync,
  usePenName,
  useSaveProfile,
} from './hooks/use-pen-name'
import {
  createDefaultActivityRepository,
  createDefaultIdeaRepository,
  createDefaultPlotRepository,
  createDefaultStagingRepository,
  createDefaultStructureRepository,
} from './store/createDefaultStore'
import type { EditorStore } from './store/editorStore'
import { createDefaultSyncService } from './sync/sync-service'
import { announceSyncApplied, withSyncTouch } from './sync/sync-touch'

/**
 * 掲示板（一覧・スレッド詳細）は入口から遠く、初回描画には要らない画面なので、
 * 構想の道具（App.tsx のマインドマップ等）と同じく遅延ロードして初期バンドルから外す。
 * どちらも名前付き export なので、`default` に畳んでから `lazy` へ渡す。
 */
const BoardPage = lazy(() =>
  import('./components/BoardPage/board-page').then((m) => ({ default: m.BoardPage })),
)
const ThreadView = lazy(() =>
  import('./components/BoardPage/thread-view').then((m) => ({ default: m.ThreadView })),
)

/** 掲示板スレッド詳細のハッシュ接頭辞（`#/board/<id>`）。 */
const BOARD_THREAD_PREFIX = '/board/'

/**
 * `/board/<id>` からスレッド id を取り出す。一覧（`/board`）と id が空の `/board/` は null。
 * `decodeURIComponent` は壊れた `%` で例外を投げるので、そのときは素の文字列を id として扱う
 *（サーバが知らない id なら「見つかりません」で済み、白画面にはしない）。
 */
function boardThreadId(route: string): string | null {
  if (!route.startsWith(BOARD_THREAD_PREFIX)) return null
  const raw = route.slice(BOARD_THREAD_PREFIX.length)
  if (raw === '') return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * 遅延ロード中のつなぎ。掲示板はサイドバーごと遅延させるため、画面いっぱいの受け皿を出す。
 * 部分的に置くと、読み込みの一瞬だけ左端に文字が貼りついて見える。
 */
function PageLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-on-surface-variant text-sm">
      読み込み中…
    </div>
  )
}

interface RootProps {
  store: EditorStore
}

/** 入口（ライブラリ）とエディタをハッシュで切り替えるトップレベル Container。 */
function RootRoutes({ store }: RootProps) {
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
  // 掲示板の表示名の初期候補に使うペンネーム（D-BOARD-NAME は「提案するだけ」）。
  // 購読は外側の `Root` が 1 回だけ行い、ここは配られた値を読む。
  const penName = usePenName()
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
  // 差し込む＝編集の ~1.5 秒後に push される（これが無いと構造・ネタ帳の編集が push されない）。
  const ideaRepo = useMemo(
    () => withSyncTouch(createDefaultIdeaRepository(), ['add', 'update', 'remove']),
    [],
  )
  // 構造レイヤー（アウトライン／相関図／マインドマップ）。純ローカルなので器は誰にも作るが、
  // 画面へ出すかは canUseCreativeTools（無料アカウント登録で可）で決める。
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
  // プロット（幕×ビートの物語設計・世界観設定）も同じ。編集は Repository 直書きなので
  // 構造レイヤーと同じく sync-touch を差し込んで push の契機を作る。
  const plotRepo = useMemo(
    () =>
      withSyncTouch(createDefaultPlotRepository(), ['create', 'save', 'remove', 'removeByWork']),
    [],
  )
  // 演出譜（サウンドノベルの Staging）も同じ。編集は Repository 直書きなので sync-touch で push の契機を作る。
  const stagingRepo = useMemo(
    () => withSyncTouch(createDefaultStagingRepository(), ['save', 'remove', 'removeByWork']),
    [],
  )
  /**
   * 構想の道具（プロット・世界観設定・アウトライン・相関図・マインドマップ）を出すか。
   *
   * **無料アカウント登録で使える**（`free` も `member` も可）。これらは純ローカルで動き、
   * サーバ資源を使わない＝課金の線を引く理由がない。課金の線は「保全」に引いてある
   *（端末間の自動同期・クラウドバックアップ／復元・MCP）。
   * 未サインイン（guest）で出さないのは、作品が端末にしか無い状態で構想まで積み上げると
   * 失ったときの損害が大きいため。登録しておけば、あとからクラウドへ引き上げられる。
   */
  const canUseCreativeTools = status === 'free' || status === 'member'

  const [backupOpen, setBackupOpen] = useState(false)
  const [aiPullOpen, setAiPullOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  // 同期で退避した版（＝採用しなかった方の置き場所）の一覧と件数。
  const [syncLostOpen, setSyncLostOpen] = useState(false)
  const [syncLostCount, setSyncLostCount] = useState(0)
  // AI・MCP 接続済みか（トークン発行済み）。接続時のみ編集をライブスナップショットへ送る。
  const [mcpConnected, setMcpConnected] = useState(false)
  // AI が書いた未取り込みの変更があるか（サーバが自動 push を 409 で弾いた＝AI の成果を保護中）。
  // 立っている間はライブラリのデータ管理に印を出し、取り込みのタイミングを自分で選べるようにする。
  const [aiEditPending, setAiEditPending] = useState(false)

  // ライブラリで保存済み作品一覧を表示するため、入口で一覧を読み込む。
  useEffect(() => {
    void store.init()
  }, [store])

  // 退避の置き場所（synclost）。件数はデータ管理メニューに小さく出すだけで、通知はしない。
  const syncLostRepo = useMemo(() => new SyncLostRepository(new IdbStore('novel-studio')), [])
  const refreshSyncLost = useCallback(() => {
    void syncLostRepo.list().then((list) => setSyncLostCount(list.length))
  }, [syncLostRepo])
  useEffect(() => {
    refreshSyncLost()
  }, [refreshSyncLost])

  // 会員なら現在の MCP 接続状態を取得し、接続済みならライブ push を有効化する。
  useEffect(() => {
    if (status !== 'member') {
      setMcpConnected(false)
      return
    }
    void getMcpTokenStatus(getTokenStable).then((s) => setMcpConnected(s.hasToken))
  }, [status, getTokenStable])

  // 接続済み会員の編集をデバウンスでライブスナップショットへ反映（AI が最新を読める）。
  // 未取り込みの AI 編集があるとサーバが push を弾く＝AI の成果が守られている状態なので、
  // 上書きを諦めた事実ではなく「取り込める変更がある」ことを知らせる。
  useLiveSnapshot(store, backupService, mcpConnected, () => {
    setAiEditPending((was) => {
      if (!was) show('AIの変更が届いています。「AIの変更を取り込む」で反映できます')
      return true
    })
  })

  // 会員の Work 単位自動同期（CAS＋三方向差分・2026-08 改訂）。スマホ⇔PC の使い分けを
  // バックアップ→復元なしで成立させる。pull 等でローカルが変わったら一覧を読み直し、
  // 競合（LWW で解決・敗者は履歴／退避一覧へ保存済み）は通知せず、退避一覧の件数だけ更新する。
  // 執筆画面で開いている作品も、下書きが未保存（dirty）の間以外は pull を受け付け、
  // refreshOpenWork でエディタ状態を追随させる（用語集・本文もページ遷移なしで届く）。
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
  useAutoSync(
    store,
    syncService,
    status === 'member',
    {
      onLocalChanged: () => {
        void store.init()
        // 開いている作品（本文・用語集）のメモリ状態を pull へ追随させる。
        // 追随しないと次の save() が古い状態で上書きし、pull を黙って巻き戻してしまう。
        void store.refreshOpenWork()
        // 開いている構造ビュー・ネタ帳にも pull を反映させる（マウント時読み切りのため）。
        announceSyncApplied()
      },
      // 競合の決着はトーストで知らせない：同期は数秒おきに走るので通知が鳴り続け、
      // 「勝ち負け」「バックアップしました」と言われても退避先が分からず不安だけが残る
      // （実際、勝った側では退避が起きないのに退避済みと出ていた）。代わりに
      // ①ヘッダーの「同期中…」で進行を淡々と見せ ②置き換わった版は端末内に残し
      // ③データ管理の「同期で退避した版」からいつでも辿れるようにする。
      onConflicts: () => refreshSyncLost(),
      // 画面遷移＝端末を持ち替えた/戻ってきた合図としてポーリングをバーストさせる（5 秒間隔・30 秒）。
    },
    route,
  )

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
        onNavigateBoard={() => navigate('/board')}
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
        onNavigateBoard={() => navigate('/board')}
        onNavigateSettings={() => navigate('/settings')}
        onNavigateHelp={() => navigate('/help')}
      />
    )
  }

  // 掲示板（`#/board` 一覧・`#/board/<threadId>` 詳細）。**ログインなしでも読める**ので
  // 認証のガードは置かない（書き込みの手前で画面側がログイン・表示名を要求する）。
  if (route === '/board' || route.startsWith(BOARD_THREAD_PREFIX)) {
    const threadId = boardThreadId(route)
    return (
      <Suspense fallback={<PageLoading />}>
        {threadId === null ? (
          <BoardPage
            onNavigateCollection={() => navigate('/')}
            onNavigateActivity={() => navigate('/activity')}
            onNavigateIdeas={() => navigate('/ideas')}
            onNavigateBoard={() => navigate('/board')}
            onNavigateSettings={() => navigate('/settings')}
            onNavigateHelp={() => navigate('/help')}
            onOpenThread={(id) => navigate(`${BOARD_THREAD_PREFIX}${encodeURIComponent(id)}`)}
            initialName={penName}
          />
        ) : (
          <ThreadView
            threadId={threadId}
            onBack={() => navigate('/board')}
            onNavigateCollection={() => navigate('/')}
            onNavigateActivity={() => navigate('/activity')}
            onNavigateIdeas={() => navigate('/ideas')}
            onNavigateBoard={() => navigate('/board')}
            onNavigateSettings={() => navigate('/settings')}
            onNavigateHelp={() => navigate('/help')}
            navActive="board"
          />
        )}
      </Suspense>
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
          onNavigateBoard={() => navigate('/board')}
          onNavigateSettings={() => navigate('/settings')}
          onNavigateHelp={() => navigate('/help')}
          activityRepo={activityRepo}
          structureRepo={structureRepo}
          plotRepo={plotRepo}
          stagingRepo={stagingRepo}
          canUseStructure={canUseCreativeTools}
          ideaRepo={ideaRepo}
        />
      ) : (
        <Library
          store={store}
          onEnterEditor={() => navigate('/write')}
          onEnterPublish={() => navigate('/publish')}
          onOpenCloudBackup={backupService ? () => setBackupOpen(true) : undefined}
          onOpenAiPull={backupService ? () => setAiPullOpen(true) : undefined}
          aiEditPending={aiEditPending}
          onOpenMcp={backupService ? () => setMcpOpen(true) : undefined}
          onOpenSyncLost={syncService ? () => setSyncLostOpen(true) : undefined}
          syncLostCount={syncLostCount}
          onOpenActivity={() => navigate('/activity')}
          onOpenIdeas={() => navigate('/ideas')}
          onNavigateBoard={() => navigate('/board')}
          onOpenSettings={() => navigate('/settings')}
          onOpenHelp={() => navigate('/help')}
          localBackup={localBackup}
          isMember={status === 'member'}
          onboarded={onboarded}
          activityRepo={activityRepo}
          stagingRepo={stagingRepo}
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
          onRestored={() => {
            setAiEditPending(false) // 取り込んだので印を下ろす（自動 push も通常運転へ戻る）
            return store.init()
          }}
        />
      )}
      <SyncLostDialog
        open={syncLostOpen}
        onOpenChange={setSyncLostOpen}
        repo={syncLostRepo}
        onChanged={refreshSyncLost}
      />
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

/**
 * アプリの入口。**ペンネームを配る器**をルーティングの外側に置く。
 *
 * ヘッダのように store を持たない部品にも名前が要る一方、ルーティング（`RootRoutes`）は
 * 画面ごとに早期 return するので、その中で Provider を張ると設定・ヘルプ・料金の画面だけ
 * 名前が届かない。**外側に 1 枚かぶせて、全部の画面に同じ値が流れる形**にする。
 *
 * アカウントとの突き合わせ（`useAccountPenNameSync`）も**ここ 1 か所だけ**で走らせる。
 * 画面ごとに呼ぶと、行き来のたびに同じ問い合わせが飛ぶ。
 */
export function Root({ store }: RootProps) {
  // **文字列 1 つずつ購読する**＝ペンネーム／アバターが変わったときにしか描き直さない
  // （スナップショット全体を購読すると、執筆中の 1 文字ごとにアプリ全体が再描画される。
  //  オブジェクトを返す getSnapshot は毎回別参照になって無限ループにもなる）。
  const penName = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().profile.penName ?? '',
  )
  const avatar = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().profile.avatar ?? '',
  )
  useAccountPenNameSync(store)

  const [profileOpen, setProfileOpen] = useState(false)
  const openProfile = useCallback(() => setProfileOpen(true), [])
  const saveProfile = useSaveProfile(store)
  const { isSignedIn } = useAuth()

  return (
    <PenNameContext.Provider value={penName}>
      <ProfileEditContext.Provider value={openProfile}>
        <RootRoutes store={store} />
        {/* プロフィールはアプリに 1 つだけ。どの画面からでも同じ口で開く。 */}
        <ProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          initial={{ penName, avatar }}
          signedIn={isSignedIn}
          onSubmit={saveProfile}
        />
      </ProfileEditContext.Provider>
    </PenNameContext.Provider>
  )
}
