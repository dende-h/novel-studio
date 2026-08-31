import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardMeResponse, BoardThread, MyBoardPost } from '@/core/board/types'
import { AuthContext, type AuthState } from '@/ui/auth/auth-context'
import { BOARD_SEEN_KEY } from '@/ui/board/board-ui'
import { BoardPage } from './board-page'

// アカウントメニューは Clerk を遅延読み込みするのでスタブに差し替える（TopAppBar のテストと同じ）。
vi.mock('@/ui/auth/clerk-user-button', () => ({
  default: () => <div data-testid="user-button" />,
}))

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0)
const HOUR = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 足場
// ---------------------------------------------------------------------------

const threadOf = (over: Partial<BoardThread> = {}): BoardThread => ({
  id: 't1',
  kind: 'request',
  title: '章ごとの文字数を出してほしい',
  author: { displayName: '青井', staff: false, retired: false },
  mine: false,
  status: '',
  statusNote: '',
  shippedVersion: '',
  pinned: false,
  locked: false,
  replyCount: 2,
  likeCount: 3,
  liked: false,
  hasPoll: false,
  excerpt: '話ごとではなく章ごとに知りたいです',
  createdAt: NOW - 3 * HOUR,
  bumpedAt: NOW - HOUR,
  deleted: false,
  ...over,
})

const myPostOf = (over: Partial<MyBoardPost> = {}): MyBoardPost => ({
  id: 'p1',
  threadId: 't1',
  threadTitle: '章ごとの文字数を出してほしい',
  threadKind: 'request',
  seq: 1,
  excerpt: '話ごとではなく章ごとに知りたいです',
  replyTo: 0,
  deleted: false,
  hidden: false,
  createdAt: NOW - 3 * HOUR,
  ...over,
})

const meOf = (over: Partial<BoardMeResponse> = {}): BoardMeResponse => ({
  profile: {
    userId: 'u1',
    displayName: '青井',
    role: 'member',
    bannedUntil: 0,
    deletedAt: 0,
    createdAt: NOW - 10 * HOUR,
    updatedAt: NOW - 10 * HOUR,
  },
  banned: false,
  posts: [],
  ...over,
})

/** `Response` の代わり。`board.ts` が触るのは `ok` / `status` / `json()` だけ。 */
const jsonRes = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>

/** URL ごとの応答を差し替える。想定外の URL は落として、取りこぼしをテストで見つける。 */
function stubFetch(handler: Handler) {
  const fn = vi.fn(async (input: string, init?: RequestInit) => await handler(input, init))
  vi.stubGlobal('fetch', fn)
  return fn
}

function authState(over: Partial<AuthState> = {}): AuthState {
  return {
    available: true,
    status: 'guest',
    isSignedIn: false,
    userId: null,
    graceUntil: null,
    canRestore: false,
    displayName: null,
    openSignIn: vi.fn(),
    openSignUp: vi.fn(),
    signOut: vi.fn(),
    getToken: async () => null,
    ...over,
  }
}

const signedInAuth = (over: Partial<AuthState> = {}): AuthState =>
  authState({
    status: 'free',
    isSignedIn: true,
    userId: 'u1',
    displayName: '青井',
    getToken: async () => 'jwt',
    ...over,
  })

function renderPage(
  auth: AuthState,
  props: { onOpenThread?: (id: string) => void; onNavigateBoard?: () => void } = {},
) {
  return render(
    <AuthContext.Provider value={auth}>
      <BoardPage
        onNavigateCollection={() => {}}
        onNavigateBoard={props.onNavigateBoard}
        onOpenThread={props.onOpenThread ?? (() => {})}
        now={NOW}
      />
    </AuthContext.Provider>,
  )
}

/** 取得の `.then` で走る setState まで流す。 */
const settle = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('BoardPage（掲示板の一覧）', () => {
  it('未ログインでも一覧が読める。トークンは付けず、/api/board/me も呼ばない', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('/api/board/threads')) {
        return jsonRes({ threads: [threadOf()], nextCursor: null })
      }
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(authState())

    expect(await screen.findByText('章ごとの文字数を出してほしい')).toBeInTheDocument()
    // 認証ヘッダを付けない（未ログインでも読める・設計 §2）。
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/board/threads',
      expect.objectContaining({ headers: {} }),
    )
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/board/me')).toBe(false)
  })

  it('未ログインでは「スレッドを立てる」を出さず、ログインの導線を出す', async () => {
    stubFetch(() => jsonRes({ threads: [threadOf()], nextCursor: null }))
    const openSignIn = vi.fn()
    renderPage(authState({ openSignIn }))

    await screen.findByText('章ごとの文字数を出してほしい')
    expect(screen.queryByRole('button', { name: 'スレッドを立てる' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(openSignIn).toHaveBeenCalledTimes(1)
  })

  it('行を押すと onOpenThread にスレッドの id を返す（ハッシュ遷移は止める）', async () => {
    stubFetch(() => jsonRes({ threads: [threadOf({ id: 't 1' })], nextCursor: null }))
    const onOpenThread = vi.fn()
    renderPage(authState(), { onOpenThread })

    const link = await screen.findByRole('link', { name: /章ごとの文字数を出してほしい/ })
    fireEvent.click(link)
    // href は encode されている（`#/board/t%201`）ので、戻すところまで確かめる。
    expect(onOpenThread).toHaveBeenCalledWith('t 1')
  })

  it('表示名が未設定のままスレを立てようとすると、先に表示名のダイアログを出す', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.startsWith('/api/board/threads')) {
        return jsonRes({ threads: [threadOf()], nextCursor: null })
      }
      if (url === '/api/board/me') return jsonRes(meOf({ profile: null }))
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(signedInAuth())

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/board/me')).toBe(true)
    })
    await settle()

    fireEvent.click(screen.getByRole('button', { name: 'スレッドを立てる' }))

    expect(await screen.findByText('表示名を決める')).toBeInTheDocument()
    // 表示名を決めるまでスレ立ての画面は出さない（見出しは同じ文言なので説明文で見る）。
    expect(screen.queryByText('掲示板では、あなたの表示名で公開されます。')).toBeNull()
  })

  it('表示名を決めたら、そのままスレ立ての画面へ進む', async () => {
    stubFetch((url, init) => {
      if (url === '/api/board/me' && init?.method === 'PUT') return jsonRes(meOf(), 201)
      if (url === '/api/board/me') return jsonRes(meOf({ profile: null }))
      if (url.startsWith('/api/board/threads')) {
        return jsonRes({ threads: [threadOf()], nextCursor: null })
      }
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(signedInAuth())

    await screen.findByText('章ごとの文字数を出してほしい')
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'スレッドを立てる' }))

    fireEvent.change(await screen.findByLabelText('表示名'), { target: { value: 'あおい' } })
    fireEvent.click(screen.getByRole('button', { name: 'この名前にする' }))

    // 押し直させない＝表示名のダイアログが閉じたら、続けてスレ立てが開く。
    expect(
      await screen.findByText('掲示板では、あなたの表示名で公開されます。'),
    ).toBeInTheDocument()
  })

  it('自分が書いたスレッドが最後に見た時刻より後に動いていたら、タブに未読バッジを出す', async () => {
    localStorage.setItem(BOARD_SEEN_KEY, String(NOW - 2 * HOUR))
    stubFetch((url) => {
      if (url.startsWith('/api/board/threads')) {
        return jsonRes({ threads: [threadOf({ mine: true })], nextCursor: null })
      }
      if (url === '/api/board/me') return jsonRes(meOf({ posts: [myPostOf()] }))
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(signedInAuth())

    const tab = await screen.findByRole('button', { name: /自分の書き込み/ })
    await waitFor(() => {
      expect(within(tab).getByText('1')).toBeInTheDocument()
    })

    // 開いたら既読にする（未読の基準は localStorage・設計 §2）。
    fireEvent.click(tab)
    expect(within(tab).queryByText('1')).toBeNull()
    expect(Number(localStorage.getItem(BOARD_SEEN_KEY))).toBeGreaterThan(NOW - 2 * HOUR)
    // 自分の書き込みが並ぶ。
    expect(screen.getByRole('link', { name: /章ごとの文字数を出してほしい/ })).toBeInTheDocument()
  })

  it('スレ立てで profile_required が返っても、書いた本文を閉じずに表示名を挟む', async () => {
    stubFetch((url, init) => {
      if (url.startsWith('/api/board/threads') && init?.method === 'POST') {
        return jsonRes({ error: 'profile_required' }, 409)
      }
      if (url.startsWith('/api/board/threads')) {
        return jsonRes({ threads: [threadOf()], nextCursor: null })
      }
      if (url === '/api/board/me') return jsonRes(meOf())
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(signedInAuth())

    fireEvent.click(await screen.findByRole('button', { name: 'スレッドを立てる' }))
    fireEvent.change(await screen.findByLabelText('タイトル'), {
      target: { value: '章ごとの文字数' },
    })
    fireEvent.change(screen.getByLabelText('本文'), { target: { value: '知りたいです' } })
    fireEvent.click(screen.getByRole('button', { name: '立てる' }))

    expect(await screen.findByText('表示名を決める')).toBeInTheDocument()
    // 本文を書いた画面は開いたまま（閉じると 4000 字が消える）。
    expect(screen.getByLabelText('本文')).toHaveValue('知りたいです')
  })

  it('取得に失敗したら理由をそのまま出し、押し直せる', async () => {
    let calls = 0
    stubFetch((url) => {
      if (!url.startsWith('/api/board/threads')) throw new Error(`想定外の取得: ${url}`)
      calls += 1
      if (calls === 1) return jsonRes({}, 500)
      return jsonRes({ threads: [threadOf()], nextCursor: null })
    })

    renderPage(authState())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('サーバー側で処理できませんでした')

    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(await screen.findByText('章ごとの文字数を出してほしい')).toBeInTheDocument()
  })

  it('nextCursor があるときだけ「もっと読む」を出し、押すと続きを足す', async () => {
    stubFetch((url) => {
      if (!url.startsWith('/api/board/threads')) throw new Error(`想定外の取得: ${url}`)
      if (url.includes('cursor=')) {
        return jsonRes({ threads: [threadOf({ id: 't2', title: '次の1本' })], nextCursor: null })
      }
      return jsonRes({ threads: [threadOf()], nextCursor: 'c1' })
    })

    renderPage(authState())

    fireEvent.click(await screen.findByRole('button', { name: 'もっと読む' }))

    expect(await screen.findByText('次の1本')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'もっと読む' })).toBeNull()
  })

  it('続きの取得中に種別を切り替えても、「もっと読む」が押せなくならない', async () => {
    // 続き（cursor 付き）の応答だけ手元で止めて、種別の切り替えに追い越させる。
    let releaseMore: () => void = () => {}
    const pendingMore = new Promise<void>((resolve) => {
      releaseMore = () => resolve()
    })

    stubFetch(async (url) => {
      if (!url.startsWith('/api/board/threads')) throw new Error(`想定外の取得: ${url}`)
      if (url.includes('cursor=')) {
        await pendingMore
        return jsonRes({ threads: [threadOf({ id: 't2', title: '次の1本' })], nextCursor: null })
      }
      if (url.includes('kind=bug')) {
        return jsonRes({
          threads: [threadOf({ id: 't3', kind: 'bug', title: '不具合の1本' })],
          nextCursor: 'c2',
        })
      }
      return jsonRes({ threads: [threadOf()], nextCursor: 'c1' })
    })

    renderPage(authState())

    fireEvent.click(await screen.findByRole('button', { name: 'もっと読む' }))
    // 追い越し。続きが返る前に一覧が別のものへ入れ替わる。
    fireEvent.click(screen.getByRole('button', { name: '不具合' }))
    expect(await screen.findByText('不具合の1本')).toBeInTheDocument()

    releaseMore()
    await settle()

    // 読み込み中のまま固まらない＝押し直せる。
    const more = await screen.findByRole('button', { name: 'もっと読む' })
    await waitFor(() => {
      expect(more).toBeEnabled()
    })
    // 追い越された続きは、切り替えたあとの一覧に混ぜない。
    expect(screen.queryByText('次の1本')).toBeNull()
  })

  it('最後に書き込んだのが自分なら、未読バッジを出さない', async () => {
    localStorage.setItem(BOARD_SEEN_KEY, String(NOW - 2 * HOUR))
    stubFetch((url) => {
      if (url.startsWith('/api/board/threads')) {
        // スレッドが動いた時刻＝自分が返信した時刻（＝最後の書き込みは自分）。
        return jsonRes({
          threads: [threadOf({ mine: true, bumpedAt: NOW - HOUR })],
          nextCursor: null,
        })
      }
      if (url === '/api/board/me') {
        return jsonRes(meOf({ posts: [myPostOf({ id: 'p2', seq: 2, createdAt: NOW - HOUR })] }))
      }
      throw new Error(`想定外の取得: ${url}`)
    })

    renderPage(signedInAuth())

    const tab = await screen.findByRole('button', { name: /自分の書き込み/ })
    await settle()

    expect(within(tab).queryByText('1')).toBeNull()
    expect(screen.queryByText('件の新しい書き込み')).toBeNull()
  })

  it('種別で絞り込んでも、未読バッジは据え置かれる（他の種別の未読を落とさない）', async () => {
    localStorage.setItem(BOARD_SEEN_KEY, String(NOW - 2 * HOUR))
    stubFetch((url) => {
      if (url === '/api/board/me') return jsonRes(meOf({ posts: [myPostOf()] }))
      if (!url.startsWith('/api/board/threads')) throw new Error(`想定外の取得: ${url}`)
      // 「不具合」で絞ると、自分が書いた要望のスレッドは一覧から外れる。
      if (url.includes('kind=bug')) {
        return jsonRes({
          threads: [threadOf({ id: 't3', kind: 'bug', title: '不具合の1本' })],
          nextCursor: null,
        })
      }
      return jsonRes({ threads: [threadOf({ mine: true })], nextCursor: null })
    })

    renderPage(signedInAuth())

    const tab = await screen.findByRole('button', { name: /自分の書き込み/ })
    await waitFor(() => {
      expect(within(tab).getByText('1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '不具合' }))
    expect(await screen.findByText('不具合の1本')).toBeInTheDocument()
    await settle()

    // 絞り込みは一覧の話。未読の数え直しに巻き込まない。
    expect(within(tab).getByText('1')).toBeInTheDocument()
  })

  it('onNavigateBoard を渡すと、サイドバーの掲示板が現在地になる', async () => {
    stubFetch(() => jsonRes({ threads: [threadOf()], nextCursor: null }))
    renderPage(authState(), { onNavigateBoard: () => {} })

    await screen.findByText('章ごとの文字数を出してほしい')
    const row = screen.getByRole('button', { name: '掲示板' })
    expect(row).toHaveAttribute('aria-current', 'page')
  })
})
