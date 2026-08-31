import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOARD_ERROR_MESSAGES,
  boardErrorMessage,
  createPost,
  createThread,
  deletePost,
  deleteThread,
  fetchMe,
  fetchThread,
  fetchThreads,
  moderate,
  patchThread,
  report,
  setDisplayName,
  toggleLike,
  vote,
} from './board'

/**
 * 掲示板 API クライアントの契約。ここで固定するのは 4 つ。
 *   1. **未ログインでも一覧・詳細が読める**（Authorization を付けずに叩く・設計 §2）
 *   2. クエリの組み立てが実装のパスと一致する（`?kind=` `?cursor=` `?thread=` `?id=`）
 *   3. サーバの `error` が、そのまま画面に出せる日本語になる
 *   4. 通信不能・JSON でない応答も `ok: false` に畳む（例外を投げない）
 */

const jwt = async () => 'jwt-token'
const noToken = async () => null

const author = { displayName: '名無し', staff: false, retired: false }

const thread = {
  id: 't1',
  kind: 'request',
  title: '要望です',
  author,
  createdAt: 1000,
  bumpedAt: 2000,
}

const post = {
  id: 'p1',
  threadId: 't1',
  seq: 1,
  author,
  body: '本文',
  createdAt: 1000,
}

const poll = {
  question: '次に作るなら？',
  options: ['A', 'B'],
  multiple: false,
  closesAt: 9000,
  closed: false,
  voted: true,
  myChoices: [0],
  revealed: true,
  counts: [3, 1],
  total: 4,
}

/** JSON を返す fetch。差し替えたモックをそのまま返す（呼ばれ方を検査するため）。 */
function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 直近の fetch の [url, init]。 */
function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
}

const headersOf = (init: RequestInit): Record<string, string> =>
  (init.headers ?? {}) as Record<string, string>

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// 未ログインで読める（設計 §2・§7-1）
// ---------------------------------------------------------------------------

describe('未ログインの読み取り', () => {
  it('getToken を渡さなくても一覧を叩け、Authorization は付かない', async () => {
    const fetchMock = mockFetch({ threads: [thread], nextCursor: null })

    const result = await fetchThreads()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('/api/board/threads')
    expect(headersOf(init).Authorization).toBeUndefined()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.threads).toHaveLength(1)
      expect(result.data.nextCursor).toBeNull()
    }
  })

  it('トークンが null なら Authorization を付けずに詳細を読む', async () => {
    const fetchMock = mockFetch({ thread, posts: [post], poll: null, canPost: false })

    const result = await fetchThread('t1', noToken)

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('/api/board/thread?id=t1')
    expect(headersOf(init).Authorization).toBeUndefined()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.canPost).toBe(false)
  })

  it('トークンがあれば読み取りにも Bearer を載せる（mine / liked が埋まる）', async () => {
    const fetchMock = mockFetch({ threads: [], nextCursor: null })

    await fetchThreads({ getToken: jwt })

    expect(headersOf(lastCall(fetchMock)[1]).Authorization).toBe('Bearer jwt-token')
  })

  it('getToken が投げても読み取りは落ちない（期限切れセッションで白画面にしない）', async () => {
    const fetchMock = mockFetch({ threads: [], nextCursor: null })

    const result = await fetchThreads({
      getToken: async () => {
        throw new Error('clerk down')
      },
    })

    expect(headersOf(lastCall(fetchMock)[1]).Authorization).toBeUndefined()
    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// クエリの組み立て
// ---------------------------------------------------------------------------

describe('クエリの組み立て', () => {
  it('一覧は ?kind= と ?cursor= を載せる', async () => {
    const fetchMock = mockFetch({ threads: [], nextCursor: null })

    await fetchThreads({ kind: 'bug', cursor: '2000_t9' })

    expect(lastCall(fetchMock)[0]).toBe('/api/board/threads?kind=bug&cursor=2000_t9')
  })

  it('空のカーソルは載せない（?cursor= だけの URL を作らない）', async () => {
    const fetchMock = mockFetch({ threads: [], nextCursor: null })

    await fetchThreads({ kind: null, cursor: null })

    expect(lastCall(fetchMock)[0]).toBe('/api/board/threads')
  })

  it('返信は ?thread=、投稿の削除は ?id=（対象は id、親スレは thread）', async () => {
    const created = mockFetch({ id: 'p9', threadId: 't1', seq: 3 }, 201)
    await createPost('t1', { body: 'よろしく', replyTo: 0 }, jwt)
    expect(lastCall(created)[0]).toBe('/api/board/posts?thread=t1')

    const deleted = mockFetch({ ok: true })
    await deletePost('p9', jwt)
    const [url, init] = lastCall(deleted)
    expect(url).toBe('/api/board/posts?id=p9')
    expect(init.method).toBe('DELETE')
  })

  it('👍 は ?post=、投票は ?thread=、スレの PATCH / DELETE は ?id=', async () => {
    // 👍 が付く相手は投稿 1 件（0009）。スレッドを指す ?thread= には戻さない。
    const liked = mockFetch({ liked: true, likeCount: 5 })
    await toggleLike('p1', jwt)
    expect(lastCall(liked)[0]).toBe('/api/board/like?post=p1')

    const voted = mockFetch({ poll })
    await vote('t1', [0], jwt)
    expect(lastCall(voted)[0]).toBe('/api/board/vote?thread=t1')

    const patched = mockFetch({ thread })
    await patchThread('t1', { pinned: true }, jwt)
    expect(lastCall(patched)[0]).toBe('/api/board/thread?id=t1')

    const removed = mockFetch({ ok: true, mode: 'whole' })
    await deleteThread('t1', jwt)
    expect(lastCall(removed)[0]).toBe('/api/board/thread?id=t1')
  })

  it('id は URL エンコードする', async () => {
    const fetchMock = mockFetch({ thread, posts: [], poll: null, canPost: false })

    await fetchThread('a b&c')

    expect(lastCall(fetchMock)[0]).toBe('/api/board/thread?id=a+b%26c')
  })
})

// ---------------------------------------------------------------------------
// 書き込み系
// ---------------------------------------------------------------------------

describe('書き込み', () => {
  it('スレ立ては本文を JSON で送り、id を threadId に写して返す', async () => {
    const fetchMock = mockFetch({ id: 't9', postId: 'p9', seq: 1 }, 201)

    const result = await createThread({ kind: 'chat', title: '進捗', body: '書いています' }, jwt)

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('/api/board/threads')
    expect(init.method).toBe('POST')
    expect(headersOf(init)['content-type']).toBe('application/json')
    expect(headersOf(init).Authorization).toBe('Bearer jwt-token')
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'chat',
      title: '進捗',
      body: '書いています',
    })
    expect(result).toEqual({ ok: true, data: { threadId: 't9', postId: 'p9', seq: 1 } })
  })

  it('返信は id を postId に写して返す（スレの id と取り違えない）', async () => {
    mockFetch({ id: 'p9', threadId: 't1', seq: 4 }, 201)

    const result = await createPost('t1', { body: 'なるほど', replyTo: 1 }, jwt)

    expect(result).toEqual({ ok: true, data: { postId: 'p9', threadId: 't1', seq: 4 } })
  })

  it('未ログインの書き込みは fetch せずに unauthorized を返す', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await createThread({ kind: 'chat', title: 'あ', body: 'い' }, noToken)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      code: 'unauthorized',
      status: 401,
      message: BOARD_ERROR_MESSAGES.unauthorized,
    })
  })

  it('スレ削除は消えた範囲（whole / head-only）を返す', async () => {
    mockFetch({ ok: true, mode: 'head-only' })

    const result = await deleteThread('t1', jwt)

    expect(result).toEqual({ ok: true, data: { mode: 'head-only' } })
  })

  it('👍 はトグルの結果をそのまま返す（付ける／外すは送らない）', async () => {
    const fetchMock = mockFetch({ liked: false, likeCount: 4 })

    const result = await toggleLike('t1', jwt)

    expect(lastCall(fetchMock)[1].body).toBeUndefined()
    expect(result).toEqual({ ok: true, data: { liked: false, likeCount: 4 } })
  })

  it('投票は choices を配列で送り、票数入りの結果を受け取る', async () => {
    const fetchMock = mockFetch({ poll })

    const result = await vote('t1', [0], jwt)

    expect(JSON.parse(lastCall(fetchMock)[1].body as string)).toEqual({ choices: [0] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.poll.counts).toEqual([3, 1])
      expect(result.data.poll.total).toBe(4)
    }
  })

  it('通報は postId と理由を送り、件数を返さない', async () => {
    const fetchMock = mockFetch({ ok: true })

    const result = await report({ postId: 'p1', reason: '宣伝が続いています' }, jwt)

    expect(lastCall(fetchMock)[0]).toBe('/api/board/reports')
    expect(JSON.parse(lastCall(fetchMock)[1].body as string)).toEqual({
      postId: 'p1',
      reason: '宣伝が続いています',
    })
    expect(result).toEqual({ ok: true, data: null })
  })

  it('PATCH は更新後のスレを封筒のまま返す', async () => {
    mockFetch({ thread: { ...thread, pinned: true, status: 'planned' } })

    const result = await patchThread('t1', { status: 'planned', pinned: true }, jwt)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.thread.pinned).toBe(true)
      expect(result.data.thread.status).toBe('planned')
    }
  })

  it('moderate は打った action をそのまま返し、postId 経由では userId を持たない', async () => {
    mockFetch({ ok: true, action: 'ban_user', postId: 'p1', bannedUntil: 5000 })

    const result = await moderate({ action: 'ban_user', postId: 'p1', bannedUntil: 5000 }, jwt)

    expect(result).toEqual({
      ok: true,
      data: { action: 'ban_user', postId: 'p1', bannedUntil: 5000 },
    })
  })
})

// ---------------------------------------------------------------------------
// 自分（表示名）
// ---------------------------------------------------------------------------

describe('/api/board/me', () => {
  it('プロフィール未登録なら profile は null（設定ダイアログの合図）', async () => {
    mockFetch({ profile: null, banned: false, posts: [] })

    const result = await fetchMe(jwt)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.profile).toBeNull()
  })

  it('表示名の登録は 201 のとき created が true になる', async () => {
    const body = {
      profile: {
        userId: 'u1',
        displayName: 'そら',
        role: 'member',
        bannedUntil: 0,
        deletedAt: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      banned: false,
      posts: [],
    }
    const fetchMock = mockFetch(body, 201)

    const result = await setDisplayName('そら', jwt)

    const [url, init] = lastCall(fetchMock)
    expect(url).toBe('/api/board/me')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'そら' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.created).toBe(true)
      expect(result.data.me.profile?.displayName).toBe('そら')
    }
  })

  it('改名は 200 なので created は false', async () => {
    mockFetch({ profile: null, banned: false, posts: [] }, 200)

    const result = await setDisplayName('そら', jwt)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.created).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// エラーコード → 画面に出せる日本語
// ---------------------------------------------------------------------------

describe('エラーの文言', () => {
  it('profile_required は次の一手が分かる文になる', async () => {
    mockFetch({ error: 'profile_required' }, 409)

    const result = await createThread({ kind: 'chat', title: 'あ', body: 'い' }, jwt)

    expect(result).toEqual({
      ok: false,
      code: 'profile_required',
      status: 409,
      message: '表示名を決めると書き込めます',
    })
  })

  it('banned は期限（bannedUntil）を添えて返す', async () => {
    mockFetch({ error: 'banned', bannedUntil: 7000 }, 403)

    const result = await createPost('t1', { body: 'あ', replyTo: 0 }, jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('banned')
      expect(result.bannedUntil).toBe(7000)
      expect(result.message).toContain('書き込みを止めています')
    }
  })

  it.each([
    ['unauthorized', 401],
    ['forbidden', 403],
    ['locked', 409],
    ['gone', 404],
    ['not_found', 404],
    ['unsupported-kind', 400],
    ['too_many_posts', 429],
    ['too_many_threads', 429],
    ['rate_limited', 429],
    ['conflict', 409],
    ['bad_request', 400],
    ['missing_id', 400],
    ['missing_thread', 400],
    ['use_thread_delete', 409],
    ['closed', 409],
    ['already_voted', 409],
    ['no_poll', 404],
    ['bad_choices', 400],
    ['bad_poll', 400],
    ['empty', 400],
    ['too_long', 400],
    ['invalid', 400],
    ['reserved', 409],
    ['duplicate', 409],
    ['cannot_ban_self', 400],
    ['bad_banned_until', 400],
    ['bad_url', 400],
    ['missing_post', 400],
    ['missing_user', 400],
    ['missing_url', 400],
  ])('%s は画面にそのまま出せる日本語になる', async (code, status) => {
    mockFetch({ error: code }, status)

    const result = await createPost('t1', { body: 'あ', replyTo: 0 }, jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(code)
      expect(result.message).toBe(BOARD_ERROR_MESSAGES[code])
      // 「エラーが発生しました」で済ませない＝事実と次の一手が入る長さがある。
      expect(result.message.length).toBeGreaterThan(6)
      expect(result.message).not.toContain('エラーが発生')
    }
  })

  it('数える上限の文言は board-guidelines.html の数字と揃っている', () => {
    expect(BOARD_ERROR_MESSAGES.too_many_threads).toContain('1日に10本')
    expect(BOARD_ERROR_MESSAGES.too_many_posts).toContain('1時間に10件')
  })

  it('conflict は本文が残っている事実を先に伝える', () => {
    expect(BOARD_ERROR_MESSAGES.conflict).toContain('本文はそのまま')
  })

  it('知らないコードでも文言が出る（サーバがコードを増やしても壊れない）', async () => {
    mockFetch({ error: 'brand_new_code' }, 400)

    const result = await deletePost('p1', jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('brand_new_code')
      expect(result.message).toBe(boardErrorMessage('brand_new_code'))
      expect(result.message).not.toBe('')
    }
  })
})

// ---------------------------------------------------------------------------
// 失敗の畳み方（例外を投げない）
// ---------------------------------------------------------------------------

describe('通信と応答の失敗', () => {
  it('通信できないときは network に畳む（throw しない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await fetchThreads()

    expect(result).toEqual({
      ok: false,
      code: 'network',
      status: 0,
      message: BOARD_ERROR_MESSAGES.network,
    })
  })

  it('書き込みの通信断も network に畳む', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const result = await createPost('t1', { body: 'あ', replyTo: 0 }, jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('network')
  })

  it('JSON でない応答（HTML のエラーページ）は status からコードを引く', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>500</html>', { status: 500 })),
    )

    const result = await fetchThreads()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('server_error')
      expect(result.status).toBe(500)
    }
  })

  it('error の無い 429 も rate_limited として扱える', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))

    const result = await toggleLike('t1', jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('rate_limited')
  })

  it('形の合わない 200 は成功として通さない（bad_response）', async () => {
    mockFetch({ threads: [{ id: 't1' }], nextCursor: null })

    const result = await fetchThreads()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_response')
  })

  it('本文が JSON でない 200 も bad_response に畳む', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))

    const result = await fetchMe(jwt)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_response')
  })
})
