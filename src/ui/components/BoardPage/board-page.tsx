import { Plus } from 'lucide-react'
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type {
  BoardKind,
  BoardMeResponse,
  BoardThread,
  CreateThreadInput,
  MyBoardPost,
} from '@/core/board/types'
import { cn } from '@/lib/utils'
import {
  type BoardResult,
  createThread,
  fetchMe,
  fetchThreads,
  setDisplayName,
} from '@/ui/_api/board'
import { formatCount } from '@/ui/_utils/format'
import { useAuth } from '@/ui/auth/auth-context'
import {
  excerptOf,
  formatBoardTime,
  KIND_UI,
  markSeen,
  readLastSeen,
  unreadCount,
} from '@/ui/board/board-ui'
import { AppShell } from '@/ui/components/AppShell/app-shell'
import { type NavKey, SideNav } from '@/ui/components/SideNav/side-nav'
import { useToast } from '@/ui/components/Toast/toast'
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { NameDialog } from './name-dialog'
import { NewThreadDialog } from './new-thread-dialog'
import { KindFilter, ThreadList, threadHref } from './thread-list'

/**
 * 掲示板の一覧画面（`#/board`・設計 docs/requirement/09-board.md §2）。
 *
 * この画面が持つのは**取得と導線だけ**で、見た目は `thread-list.tsx`、
 * 色と抜粋と未読は `@/ui/board/board-ui`、通信は `@/ui/_api/board` にある。
 *
 * 守っていること。
 *
 * 1. **未ログインでも読める**（§2）。`fetchThreads` はトークン無しで叩ける。
 *    `fetchMe` だけは自分にしか意味がないので、ログインしていなければ呼ばない。
 * 2. **書けないときは「書けない」ではなく次の一手を出す。** 未ログインならログインの導線、
 *    表示名が未設定なら `NameDialog` を先に挟む（§2「初回投稿の直前に表示名の設定」）。
 * 3. **書きかけを消さない。** スレ立ての途中で `profile_required` が返ったときは、
 *    `NewThreadDialog` を開いたまま `NameDialog` を重ねる。閉じてしまうと本文が消える。
 * 4. スレを開くのは `onOpenThread(threadId)` で親に返す（画面の出し分けは `Root`）。
 */

/** スレ詳細のハッシュ。`threadHref` の逆写像をこの 1 か所に置く。 */
const THREAD_HREF_PREFIX = '#/board/'

/**
 * `#/board/<id>` から id を取り出す。掲示板の行以外のリンク（外部リンク等）は null。
 * `decodeURIComponent` は壊れた `%` で投げるので、そのときは素の文字列に落とす。
 */
function threadIdFromHref(href: string | null): string | null {
  if (href === null || !href.startsWith(THREAD_HREF_PREFIX)) return null
  const raw = href.slice(THREAD_HREF_PREFIX.length)
  if (raw === '') return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * サイドバーの現在地。`NavKey` に `board` が入ったので、掲示板の行を現在地にする。
 * ホームを現在地にすると、掲示板にいるのに「マイライブラリ」が選択済みに見える。
 */
const SIDE_NAV_ACTIVE: NavKey = 'board'

type BoardTab = 'threads' | 'mine'

export interface BoardPageProps {
  /** ライブラリ（コレクション）へ戻る。左サイドバー／ブランドから使う。 */
  onNavigateCollection: () => void
  /** 執筆の記録へ（サイドバー）。 */
  onNavigateActivity?: () => void
  /** ネタ帳へ（サイドバー）。 */
  onNavigateIdeas?: () => void
  /** 掲示板へ（サイドバー）。渡したときだけ掲示板の行が出る＝ここでは現在地の行になる。 */
  onNavigateBoard?: () => void
  /** 設定ページへ（サイドバーフッター）。 */
  onNavigateSettings?: () => void
  /** ヘルプページへ（サイドバーフッター）。 */
  onNavigateHelp?: () => void
  /** スレッドを開く。ルートの切り替えは親（Root）がする。 */
  onOpenThread: (threadId: string) => void
  /**
   * 表示名の初期候補。親が grove の作者ペンネーム →ローカルの `Profile.penName` の順で詰める
   *（D-BOARD-NAME は「提案するだけ」）。
   */
  initialName?: string
  /** 相対時刻の基準。テストから固定できるように受け取る。 */
  now?: number
}

export function BoardPage({
  onNavigateCollection,
  onNavigateActivity,
  onNavigateIdeas,
  onNavigateBoard,
  onNavigateSettings,
  onNavigateHelp,
  onOpenThread,
  initialName = '',
  now,
}: BoardPageProps) {
  const auth = useAuth()
  const toast = useToast()

  // Clerk 配線（clerk-gate.tsx）は毎レンダーで新しい関数を作るので、effect の依存に置くと
  // 取得が止まらなくなる。認証は ref 越しに読み、`getToken` だけ安定した関数にして渡す。
  const authRef = useRef(auth)
  authRef.current = auth
  const getToken = useCallback(() => authRef.current.getToken(), [])

  const [tab, setTab] = useState<BoardTab>('threads')
  const [kind, setKind] = useState<BoardKind | null>(null)
  const [threads, setThreads] = useState<readonly BoardThread[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  // 未読バッジを数える材料。**絞り込みの影響を受けない**ように、種別を指定せずに取れた
  // 一覧だけをここに写す。種別で絞っている間は更新されない＝バッジは絞り込み前の値のまま
  // 据え置かれる（絞り込みで他の種別の未読が落ちない）。
  const [badgeThreads, setBadgeThreads] = useState<readonly BoardThread[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [me, setMe] = useState<BoardMeResponse | null>(null)
  const [lastSeen, setLastSeen] = useState<number>(() => readLastSeen())
  const [nameOpen, setNameOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)

  // 表示名を決めたら、そのままスレ立てへ進むための印（押し直させない）。
  const continueToCreateRef = useRef(false)
  // 表示名が今この場で決まったか。**state（me）では判定できない**＝ NameDialog は
  // `onSubmit` の直後に `onOpenChange(false)` を呼ぶので、閉じる時点の handler が見ている
  // `me` はまだ 1 つ前（profile が null のまま）になる。
  const nameJustSetRef = useRef(false)
  // 一覧の取得は種別の切り替えで追い越しが起きる。最後に投げた取得だけを画面に反映する。
  const listSeqRef = useRef(0)

  const nowMs = now ?? Date.now()
  const signedIn = auth.isSignedIn

  const loadThreads = useCallback(
    async (target: BoardKind | null, withToken: boolean) => {
      const seq = ++listSeqRef.current
      setThreads(null)
      setListError(null)
      setNextCursor(null)
      // 未ログインならトークンを取りに行かない（`mine` / `liked` は false で返る）。
      const result = await fetchThreads({
        kind: target,
        getToken: withToken ? getToken : undefined,
      })
      if (seq !== listSeqRef.current) return
      if (!result.ok) {
        setListError(result.message)
        return
      }
      setThreads(result.data.threads)
      setNextCursor(result.data.nextCursor)
      // 絞り込み無しで取れたときだけ、未読の材料を更新する（絞り込み中は据え置き）。
      if (target === null) setBadgeThreads(result.data.threads)
    },
    [getToken],
  )

  // 種別を変えたとき・ログイン状態が変わったときに読み直す
  //（`mine` と `liked` は閲覧者ごとに違うので、ログインの前後で同じ配列を使い回せない）。
  useEffect(() => {
    void loadThreads(kind, signedIn)
  }, [kind, signedIn, loadThreads])

  // 自分の表示名と書き込み。**未ログインでは呼ばない**（401 が返るだけで得るものがない）。
  useEffect(() => {
    if (!signedIn) {
      setMe(null)
      return
    }
    let cancelled = false
    void fetchMe(getToken).then((result) => {
      if (cancelled || !result.ok) return
      setMe(result.data)
    })
    return () => {
      cancelled = true
    }
  }, [signedIn, getToken])

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return
    const seq = listSeqRef.current
    setLoadingMore(true)
    try {
      const result = await fetchThreads({
        kind,
        cursor: nextCursor,
        getToken: signedIn ? getToken : undefined,
      })
      // 種別の切り替えに追い越されていたら、この続きはもう別の一覧のもの。捨てる。
      if (seq !== listSeqRef.current) return
      if (!result.ok) {
        toast.show(result.message)
        return
      }
      // 続きは末尾に足す（ピン留めの先頭寄せは ThreadList がやり直してくれる）。
      setThreads((prev) => [...(prev ?? []), ...result.data.threads])
      setNextCursor(result.data.nextCursor)
    } finally {
      // **どの経路で抜けても必ず解除する。** 追い越しの早期 return でここを飛ばすと、
      // ボタンが「読み込み中…」のまま disabled で固まり、二度と続きを読めなくなる。
      setLoadingMore(false)
    }
  }

  /** スレ立ての入口。書けない理由ごとに、次の一手へ落とす。 */
  const startCreate = () => {
    if (!signedIn) {
      auth.openSignIn()
      return
    }
    // 表示名が未設定（profile === null）なら先に決めてもらう（§2）。
    // `me` 自体が null（まだ読めていない・取得に失敗した）ときは開いてしまい、
    // サーバが `profile_required` を返したらそこで拾う。
    if (me !== null && me.profile === null) {
      continueToCreateRef.current = true
      setNameOpen(true)
      return
    }
    setNewOpen(true)
  }

  const handleSetName = async (name: string): Promise<BoardResult<unknown>> => {
    const result = await setDisplayName(name, getToken)
    if (result.ok) {
      setMe(result.data.me)
      nameJustSetRef.current = result.data.me.profile !== null
      toast.show(result.data.created ? '表示名を登録しました' : '表示名を変更しました')
    }
    return result
  }

  const handleNameOpenChange = (open: boolean) => {
    setNameOpen(open)
    if (open) return
    // 表示名を決めた直後だけ、続けてスレ立てのダイアログへ渡す。
    // （キャンセルで閉じたときは印が立っていないので、勝手には開かない）
    const goOn = continueToCreateRef.current && nameJustSetRef.current
    continueToCreateRef.current = false
    nameJustSetRef.current = false
    if (goOn) setNewOpen(true)
  }

  const handleCreateThread = async (input: CreateThreadInput): Promise<BoardResult<unknown>> => {
    const result = await createThread(input, getToken)
    if (result.ok) {
      toast.show('スレッドを立てました')
      // 立てたスレを先頭で見せたいので、一覧を先頭から読み直す。
      void loadThreads(kind, signedIn)
      void fetchMe(getToken).then((r) => {
        if (r.ok) setMe(r.data)
      })
      return result
    }
    // **ダイアログは閉じない。** 書いた本文を消さないまま、足りないものだけ足してもらう。
    if (result.code === 'profile_required') setNameOpen(true)
    if (result.code === 'unauthorized') auth.openSignIn()
    return result
  }

  const openThread = (event: MouseEvent<HTMLDivElement>) => {
    // 別タブ・別ウィンドウで開く操作（修飾キー・中クリック）は素通しする。
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href]')
    const id = threadIdFromHref(anchor?.getAttribute('href') ?? null)
    if (id === null) return
    event.preventDefault()
    onOpenThread(id)
  }

  const myPosts: readonly MyBoardPost[] = me?.posts ?? []
  // 自分が最後に書いた時刻（スレッドごと）。`me.posts` は自分の投稿しか返らないので、
  // これがそのまま「自分の最終書き込み」になる。
  const myLastPostAt = new Map<string, number>()
  for (const post of myPosts) {
    myLastPostAt.set(post.threadId, Math.max(myLastPostAt.get(post.threadId) ?? 0, post.createdAt))
  }
  // 未読は「自分が書き込んだスレッドが、最後に見て以降に**他人の手で**動いたか」で数える。
  // 一覧は最終書き込みの主を返さないので、`bumpedAt` が自分の最終書き込み以降に
  // 進んでいなければ「最後に書いたのは自分」とみなして数えない（自分の返信でバッジが
  // 立つのを防ぐ）。
  //
  // 限界（サーバに口ができるまで直せない）:
  // - 自分の書き込みと他人の書き込みが同じ ms に並ぶと、他人のぶんを取りこぼす。
  // - `bumpedAt` は「そのスレが動いた」しか表さないので、数えられるのは**スレッド単位**
  //   （1 スレに 3 件返信が付いても 1 と出る）。件数まで正しく出すには、サーバが
  //   「自分の関わったスレの、自分以外の新着数」を返す必要がある。
  // - 材料は種別なしの一覧の 1 ページ目だけ。並びは `bumpedAt` の降順なので、動いた
  //   スレは先頭側に集まる＝取りこぼすのは「1 ページぶんより多くのスレが自分より後に
  //   動いた」ときに限られる。
  // - `me.posts` はサーバ側で直近 50 件まで。それより古い書き込みしかないスレは、
  //   返信が付いてもバッジに出ない。
  const unread = unreadCount(
    badgeThreads
      .filter((thread) => myLastPostAt.has(thread.id))
      .map((thread) => ({
        createdAt: thread.bumpedAt,
        mine: thread.bumpedAt <= (myLastPostAt.get(thread.id) ?? 0),
        deleted: thread.deleted,
      })),
    lastSeen,
  )

  const showMine = () => {
    setTab('mine')
    // ここを開いた時点までを既読にする（未読の基準は localStorage・§2）。
    const seenAt = Date.now()
    markSeen(seenAt)
    setLastSeen(seenAt)
  }

  return (
    <AppShell
      onBrandClick={onNavigateCollection}
      sidebar={
        <SideNav
          active={SIDE_NAV_ACTIVE}
          onNavigateCollection={onNavigateCollection}
          onNavigateActivity={onNavigateActivity}
          onNavigateIdeas={onNavigateIdeas}
          onNavigateBoard={onNavigateBoard}
          onNavigateSettings={onNavigateSettings}
          onNavigateHelp={onNavigateHelp}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-9 md:px-10">
        <div className="mx-auto max-w-3xl pb-16">
          <header className="mb-5">
            <h1 className="font-semibold font-serif text-[26px] text-on-surface">掲示板</h1>
            <p className="mt-1 text-[13px] text-on-surface-variant">
              気づいたこと、困っていること、いま書いている作品の話。読むだけならログインは要りません
            </p>
          </header>

          {/* 書き込みの導線。Clerk が構成されていないビルドではログインできないので出さない。 */}
          {!signedIn && auth.available && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-lowest p-4">
              <p className="text-[13px] text-on-surface-variant">
                書き込むには、無料のアカウントでログインしてください
              </p>
              <Button type="button" size="sm" onClick={() => auth.openSignIn()}>
                ログイン
              </Button>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* 同じ一覧の出し分けなので role="tablist" にはしない（KindFilter と同じ流儀）。 */}
            <div className="flex min-w-0 items-center gap-1.5">
              <TabButton
                label="スレッド一覧"
                active={tab === 'threads'}
                onClick={() => setTab('threads')}
              />
              <TabButton label="自分の書き込み" active={tab === 'mine'} onClick={showMine}>
                {unread > 0 && (
                  <Badge className="bg-primary text-primary-foreground">
                    {formatCount(unread)}
                    <span className="sr-only">件の新しい書き込み</span>
                  </Badge>
                )}
              </TabButton>
            </div>
            {signedIn && (
              <Button type="button" size="sm" onClick={startCreate}>
                <Plus className="size-4" />
                スレッドを立てる
              </Button>
            )}
          </div>

          {/* 行は `<a>`（キーボードでも中クリックでも開ける）。押した先の切り替えは親に返すので、
              捕捉フェーズで受けて既定のハッシュ遷移を止める。Enter で押したときも click は
              飛ぶので、キーボードだけでも同じ経路を通る。 */}
          <div onClickCapture={openThread}>
            {tab === 'threads' ? (
              <>
                <KindFilter kind={kind} onChange={setKind} className="mb-4" />
                {listError !== null ? (
                  <ListError message={listError} onRetry={() => void loadThreads(kind, signedIn)} />
                ) : threads === null ? (
                  <p className="py-8 text-center text-on-surface-variant text-sm">読み込み中…</p>
                ) : (
                  <>
                    <ThreadList
                      threads={threads}
                      now={nowMs}
                      kind={kind}
                      onCreate={signedIn ? startCreate : undefined}
                      onClearKind={() => setKind(null)}
                    />
                    {nextCursor !== null && (
                      <div className="mt-4 flex justify-center">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void loadMore()}
                          disabled={loadingMore}
                        >
                          {loadingMore ? '読み込み中…' : 'もっと読む'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <MyPosts posts={myPosts} now={nowMs} signedIn={signedIn} />
            )}
          </div>
        </div>
      </div>

      <NameDialog
        open={nameOpen}
        onOpenChange={handleNameOpenChange}
        initialName={me?.profile?.displayName ?? initialName}
        onSubmit={handleSetName}
      />
      <NewThreadDialog open={newOpen} onOpenChange={setNewOpen} onSubmit={handleCreateThread} />
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// タブ
// ---------------------------------------------------------------------------

function TabButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        active
          ? 'border-transparent bg-surface-container-high text-on-surface'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low',
      )}
    >
      {label}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 取得に失敗したとき
// ---------------------------------------------------------------------------

/**
 * 失敗の表示。文言は `BoardResult` の `message` をそのまま出す
 *（対応表は `src/ui/_api/board.ts` の 1 か所だけ・ここで書き直さない）。
 */
function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p role="alert" className="text-on-surface-variant text-sm">
        {message}
      </p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        もう一度読み込む
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 自分の書き込み
// ---------------------------------------------------------------------------

/**
 * 「自分の書き込み」タブ。返信が付いたかを見に来る場所なので、
 * **スレッドの見出しを主役**にして、自分が書いた中身は抜粋に留める。
 */
function MyPosts({
  posts,
  now,
  signedIn,
}: {
  posts: readonly MyBoardPost[]
  now: number
  signedIn: boolean
}) {
  if (!signedIn) {
    return (
      <p className="py-16 text-center text-on-surface-variant text-sm">
        ログインすると、自分の書き込みと返信をここでたどれます
      </p>
    )
  }
  if (posts.length === 0) {
    return (
      <p className="py-16 text-center text-on-surface-variant text-sm">
        まだ書き込みがありません。気になるスレッドに、ひとことから返信できます
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {posts.map((post) => (
        <li key={post.id}>
          <MyPostRow post={post} now={now} />
        </li>
      ))}
    </ul>
  )
}

function MyPostRow({ post, now }: { post: MyBoardPost; now: number }) {
  const kindUi = post.threadKind === '' ? null : KIND_UI[post.threadKind]
  const excerpt = excerptOf(post.excerpt)
  const at = formatBoardTime(post.createdAt, now)

  return (
    <a
      href={threadHref(post.threadId)}
      className={cn(
        'block rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-3.5',
        'no-underline transition-colors hover:bg-surface-container-low',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {kindUi && <Badge className={kindUi.className}>{kindUi.label}</Badge>}
        {/* seq=1 はスレッド本文（設計 §4）。返信と見分けが付かないと、削除の意味も変わる */}
        {post.seq === 1 && (
          <Badge className="bg-surface-container-high text-on-surface-variant">
            立てたスレッド
          </Badge>
        )}
        {post.deleted && (
          <Badge className="bg-surface-container-highest text-on-surface-variant">削除済み</Badge>
        )}
        {post.hidden && (
          <Badge className="bg-surface-container-highest text-on-surface-variant">
            運営が非表示にしました
          </Badge>
        )}
      </div>

      <h3 className="mt-1.5 font-semibold text-[15px] text-on-surface leading-6 [overflow-wrap:anywhere]">
        {post.threadTitle === '' ? 'スレッドが見つかりません' : post.threadTitle}
      </h3>

      {excerpt !== '' && (
        <p className="mt-1 line-clamp-2 text-on-surface-variant text-sm leading-6 [overflow-wrap:anywhere]">
          {excerpt}
        </p>
      )}

      {at !== '' && <p className="mt-2 text-on-surface-variant text-xs">{at}</p>}
    </a>
  )
}
