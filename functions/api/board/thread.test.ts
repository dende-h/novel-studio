// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/thread のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1 未ログインの書き込み系は 401・読み取りは 200
 *   §7-4 自分以外のスレは削除できない（403）。staff でも削除はしない
 *   §7-5 返信のあるスレを削除すると、本文だけ消えて返信は残る
 *   §7-6 削除・非表示の投稿は詳細でも本文を返さない（伏字）
 *   §7-7 アンケートは投票前に票数を返さない（締切後は未投票でも開示）
 *  （§5）ステータス／ピン／ロックは staff だけ
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { DELETED_BODY_TEXT, HIDDEN_BODY_TEXT } from '../../../src/core/board/permission'
import { BOARD_ACTIONS_PER_MINUTE } from './board-endpoint'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestDelete, onRequestGet, onRequestPatch } from './thread'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const url = (id: string | null) =>
  id === null ? 'https://x/api/board/thread' : `https://x/api/board/thread?id=${id}`

const get = (env: unknown, id: string | null = 't1') =>
  (onRequestGet as unknown as Handler)({
    request: new Request(url(id), { headers: { authorization: 'Bearer x' } }),
    env,
  })

const patch = (env: unknown, body: unknown, id: string | null = 't1') =>
  (onRequestPatch as unknown as Handler)({
    request: new Request(url(id), {
      method: 'PATCH',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

/** GET のレスポンス（`BoardThreadDetail` のうちテストで見るぶん）。 */
type DetailBody = {
  thread: {
    id: string
    mine: boolean
    status: string
    statusNote: string
    shippedVersion: string
    pinned: boolean
    locked: boolean
    author: { displayName: string }
  }
  posts: { body: string; deleted: boolean; hidden: boolean }[]
  poll: {
    question: string
    voted: boolean
    closed: boolean
    revealed: boolean
    myChoices: number[] | null
    counts: number[] | null
    total: number | null
  } | null
  canPost: boolean
}

/** GET して本文を読む（型を 1 か所で当てる）。 */
const detailOf = async (env: unknown, id: string | null = 't1'): Promise<DetailBody> =>
  (await (await get(env, id)).json()) as DetailBody

const del = (env: unknown, id: string | null = 't1') =>
  (onRequestDelete as unknown as Handler)({
    request: new Request(url(id), {
      method: 'DELETE',
      headers: { authorization: 'Bearer x' },
    }),
    env,
  })

/**
 * user_1（スレ主・member）と user_2（別人）と staff_1（運営）が居て、
 * `t1` に本文（seq=1）だけがあるスレを 1 本。
 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({ user_id: 'user_1', display_name: 'スレ主', name_key: 'すれぬし' }),
      fakeProfile({ user_id: 'user_2', display_name: '通りすがり', name_key: 'とおりすがり' }),
      fakeProfile({
        user_id: 'staff_1',
        display_name: '運営',
        name_key: 'うんえい',
        role: 'staff',
      }),
    ],
    threads: [fakeThread({ id: 't1', kind: 'request', user_id: 'user_1' })],
    posts: [fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1', body: '本文です' })],
  })
  return { store, env: makeBoardEnv({ store }) }
}

/** `t1` に user_2 の返信を 1 件足す。 */
function addReply(store: BoardDbFake): void {
  store.posts.set(
    'p2',
    fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2', body: '返信です' }),
  )
  const t = store.threads.get('t1')
  if (t) store.threads.set('t1', { ...t, reply_count: 1 })
}

beforeEach(() => {
  authState.userId = 'user_1'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/board/thread', () => {
  it('未ログインでも 200 で読める（§7-1）', async () => {
    const { env } = setup()
    authState.userId = null

    const res = await get(env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as DetailBody
    expect(body.thread.id).toBe('t1')
    expect(body.thread.author.displayName).toBe('スレ主')
    expect(body.posts).toHaveLength(1)
    expect(body.posts[0]?.body).toBe('本文です')
    // 未ログインは書き込めない（画面はここでログインを促す）。
    expect(body.canPost).toBe(false)
    expect(body.thread.mine).toBe(false)
  })

  it('id が無ければ 400・無いスレは 404', async () => {
    const { env } = setup()
    expect((await get(env, null)).status).toBe(400)
    expect((await get(env, 'nope')).status).toBe(404)
  })

  it('削除済み・運営が非表示にしたスレは 404（見出しも出さない）', async () => {
    const { store, env } = setup()
    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', deleted_at: NOW - 1 }))
    expect((await get(env)).status).toBe(404)

    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', hidden_at: NOW - 1 }))
    expect((await get(env)).status).toBe(404)
  })

  it('削除・非表示の投稿は本文を返さず伏字になる（§7-6）', async () => {
    const { store, env } = setup()
    store.posts.set(
      'p2',
      fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_2', body: '消した本音' }),
    )
    store.posts.set(
      'p3',
      fakePost({
        id: 'p3',
        thread_id: 't1',
        seq: 3,
        user_id: 'user_2',
        body: '運営が伏せた暴言',
        hidden_at: NOW - 1,
      }),
    )
    const p2 = store.posts.get('p2')
    if (p2) store.posts.set('p2', { ...p2, deleted_at: NOW - 1 })

    const body = await detailOf(env)
    const bodies = body.posts.map((p) => p.body)
    expect(bodies).toEqual(['本文です', DELETED_BODY_TEXT, HIDDEN_BODY_TEXT])
    // 生の本文がレスポンスのどこにも残っていない。
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('消した本音')
    expect(raw).not.toContain('運営が伏せた暴言')
    expect(body.posts[1]?.deleted).toBe(true)
    expect(body.posts[2]?.hidden).toBe(true)
  })

  it('canPost はロック中なら member に false・staff に true', async () => {
    const { store, env } = setup()
    expect((await detailOf(env)).canPost).toBe(true)

    const t = store.threads.get('t1')
    if (t) store.threads.set('t1', { ...t, locked: 1 })
    expect((await detailOf(env)).canPost).toBe(false)

    authState.userId = 'staff_1'
    expect((await detailOf(env)).canPost).toBe(true)
  })

  it('投稿禁止中は canPost が false', async () => {
    const { store, env } = setup()
    store.profiles.set(
      'user_1',
      fakeProfile({ user_id: 'user_1', name_key: 'すれぬし', banned_until: NOW + 1000 }),
    )
    expect((await detailOf(env)).canPost).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GET のアンケート（§7-7）
// ---------------------------------------------------------------------------

describe('GET のアンケート開示', () => {
  /** 締切が未来のアンケートと、user_2 の 1 票を仕込む。 */
  function seedPoll(store: BoardDbFake, closesAt: number): void {
    store.polls.set('t1', {
      thread_id: 't1',
      question: '次に作るのは？',
      options: JSON.stringify(['検索', '通知']),
      multiple: 0,
      closes_at: closesAt,
      created_at: NOW - 1000,
    })
    store.votes.set('t1:user_2', {
      thread_id: 't1',
      user_id: 'user_2',
      choices: JSON.stringify([0]),
      created_at: NOW - 500,
    })
  }

  it('未投票かつ締切前は票数を返さない（counts / total は null）', async () => {
    const { store, env } = setup()
    seedPoll(store, NOW + 60_000)

    const { poll } = await detailOf(env)
    if (!poll) throw new Error('poll が無い')
    expect(poll.question).toBe('次に作るのは？')
    expect(poll.voted).toBe(false)
    expect(poll.revealed).toBe(false)
    expect(poll.counts).toBeNull()
    expect(poll.total).toBeNull()
    expect(poll.myChoices).toBeNull()
    // 0 埋めで「0 票」に見せることもしない。
    expect(JSON.stringify(poll)).not.toContain('[0,0]')
  })

  it('投票済みなら締切前でも票数が見える', async () => {
    const { store, env } = setup()
    seedPoll(store, NOW + 60_000)
    store.votes.set('t1:user_1', {
      thread_id: 't1',
      user_id: 'user_1',
      choices: JSON.stringify([1]),
      created_at: NOW - 100,
    })

    const { poll } = await detailOf(env)
    if (!poll) throw new Error('poll が無い')
    expect(poll.voted).toBe(true)
    expect(poll.revealed).toBe(true)
    expect(poll.counts).toEqual([1, 1])
    expect(poll.total).toBe(2)
    expect(poll.myChoices).toEqual([1])
  })

  it('締切後は未投票でも票数が見える', async () => {
    const { store, env } = setup()
    seedPoll(store, NOW - 1)

    const { poll } = await detailOf(env)
    if (!poll) throw new Error('poll が無い')
    expect(poll.closed).toBe(true)
    expect(poll.voted).toBe(false)
    expect(poll.counts).toEqual([1, 0])
    expect(poll.total).toBe(1)
  })

  it('アンケートが無ければ poll は null', async () => {
    const { env } = setup()
    expect((await detailOf(env)).poll).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PATCH（staff のみ）
// ---------------------------------------------------------------------------

describe('PATCH /api/board/thread', () => {
  it('未ログインは 401・id なしは 400・壊れた JSON は 400', async () => {
    const { env } = setup()
    authState.userId = null
    expect((await patch(env, { pinned: true })).status).toBe(401)

    authState.userId = 'staff_1'
    expect((await patch(env, { pinned: true }, null)).status).toBe(400)
    expect((await patch(env, '{')).status).toBe(400)
    expect((await patch(env, { status: 'unknown' })).status).toBe(400)
  })

  it('member はステータスもピンも変えられない（403）', async () => {
    const { store, env } = setup()
    // スレ主でも運営操作はできない。
    expect((await patch(env, { status: 'planned' })).status).toBe(403)
    expect((await patch(env, { pinned: true })).status).toBe(403)
    expect(store.threads.get('t1')?.status).toBe('')
    expect(store.threads.get('t1')?.pinned).toBe(0)
  })

  it('staff はステータス・ピン・ロックを付けられる', async () => {
    const { store, env } = setup()
    authState.userId = 'staff_1'

    const res = await patch(env, {
      status: 'planned',
      statusNote: '次の版で入れます',
      pinned: true,
      locked: true,
    })
    expect(res.status).toBe(200)
    const { thread } = (await res.json()) as { thread: DetailBody['thread'] }
    expect(thread.status).toBe('planned')
    expect(thread.statusNote).toBe('次の版で入れます')
    expect(thread.pinned).toBe(true)
    expect(thread.locked).toBe(true)

    const row = store.threads.get('t1')
    expect(row?.status).toBe('planned')
    expect(row?.pinned).toBe(1)
    expect(row?.locked).toBe(1)
  })

  it('省略した項目は据え置かれる（1 欄の更新で他の欄を落とさない）', async () => {
    const { store, env } = setup()
    authState.userId = 'staff_1'

    await patch(env, { status: 'shipped', shippedVersion: 'v1.4.0', pinned: true })
    await patch(env, { locked: true })

    const row = store.threads.get('t1')
    expect(row?.status).toBe('shipped')
    expect(row?.shipped_version).toBe('v1.4.0')
    expect(row?.pinned).toBe(1)
    expect(row?.locked).toBe(1)
  })

  it('ステータスが付くのは request / bug だけ（雑談スレは 400）', async () => {
    const { store, env } = setup()
    store.threads.set('t1', fakeThread({ id: 't1', kind: 'chat', user_id: 'user_1' }))
    authState.userId = 'staff_1'

    expect((await patch(env, { status: 'planned' })).status).toBe(400)
    // ピン・ロックは種別を問わない（目安箱以外も先頭に固定できる）。
    expect((await patch(env, { pinned: true })).status).toBe(200)
    expect(store.threads.get('t1')?.pinned).toBe(1)
  })

  it('無いスレ・削除済みのスレは 404', async () => {
    const { store, env } = setup()
    authState.userId = 'staff_1'
    expect((await patch(env, { pinned: true }, 'nope')).status).toBe(404)

    store.threads.set(
      't1',
      fakeThread({ id: 't1', kind: 'request', user_id: 'user_1', deleted_at: NOW - 1 }),
    )
    expect((await patch(env, { pinned: true })).status).toBe(404)
  })

  it('レート制限のキーは `board:` 接頭辞（同期のカウンタと混ざらない・§7-11）', async () => {
    const { store, env } = setup()
    authState.userId = 'staff_1'
    await patch(env, { pinned: true })

    expect(store.rates.has('board:staff_1')).toBe(true)
    expect(store.rates.has('staff_1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DELETE（自分のスレだけ）
// ---------------------------------------------------------------------------

describe('DELETE /api/board/thread', () => {
  it('未ログインは 401・id なしは 400・無いスレは 404', async () => {
    const { env } = setup()
    authState.userId = null
    expect((await del(env)).status).toBe(401)

    authState.userId = 'user_1'
    expect((await del(env, null)).status).toBe(400)
    expect((await del(env, 'nope')).status).toBe(404)
  })

  it('他人のスレは削除できない。staff でも削除はしない（§7-4）', async () => {
    const { store, env } = setup()
    authState.userId = 'user_2'
    expect((await del(env)).status).toBe(403)

    authState.userId = 'staff_1'
    expect((await del(env)).status).toBe(403)

    expect(store.threads.get('t1')?.deleted_at).toBe(0)
    expect(store.posts.get('p1')?.deleted_at).toBe(0)
  })

  it('返信 0 のスレは丸ごと消える（whole）', async () => {
    const { store, env } = setup()

    const res = await del(env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, mode: 'whole' })
    expect(store.threads.get('t1')?.deleted_at).toBe(NOW)
    expect(store.posts.get('p1')?.deleted_at).toBe(NOW)

    // 一覧からも詳細からも消える。
    expect((await get(env)).status).toBe(404)
  })

  it('返信があるスレは本文だけ消えて返信は残る（§7-5）', async () => {
    const { store, env } = setup()
    addReply(store)

    const res = await del(env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, mode: 'head-only' })

    // スレ自体は生きたまま、本文（seq=1）だけが伏せられる。
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
    expect(store.posts.get('p1')?.deleted_at).toBe(NOW)
    expect(store.posts.get('p2')?.deleted_at).toBe(0)

    const body = await detailOf(env)
    expect(body.thread.id).toBe('t1')
    expect(body.posts.map((p) => p.body)).toEqual([DELETED_BODY_TEXT, '返信です'])
    expect(JSON.stringify(body)).not.toContain('本文です')
  })

  it('削除済みのスレをもう一度消しても、返信の削除時刻を書き換えない', async () => {
    const { store, env } = setup()
    await del(env)
    // 2 回目は canDeleteThread が gone を返す＝404。
    expect((await del(env)).status).toBe(404)
    expect(store.threads.get('t1')?.deleted_at).toBe(NOW)
  })

  it('運営が伏せた返信しか無くても head-only（他人の hidden を「本人が削除」に塗り替えない）', async () => {
    const { store, env } = setup()
    addReply(store)
    // staff が調査中に返信を伏せる。生きている返信は 0 になり reply_count も 0 に戻る。
    const p2 = store.posts.get('p2')
    if (p2) store.posts.set('p2', { ...p2, hidden_at: NOW - 1000 })
    const t = store.threads.get('t1')
    if (t) store.threads.set('t1', { ...t, reply_count: 0 })

    const res = await del(env)
    expect(await res.json()).toEqual({ ok: true, mode: 'head-only' })

    // 他人の投稿に deleted_at を刻まない＝`unhide_post` すれば元どおり読める（措置は可逆）。
    expect(store.posts.get('p2')).toMatchObject({ hidden_at: NOW - 1000, deleted_at: 0 })
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
    expect(store.posts.get('p1')?.deleted_at).toBe(NOW)
  })

  it('本人が消した返信しか無くても head-only（行が在れば巻き添えにしない）', async () => {
    const { store, env } = setup()
    addReply(store)
    const p2 = store.posts.get('p2')
    if (p2) store.posts.set('p2', { ...p2, deleted_at: NOW - 1000 })
    const t = store.threads.get('t1')
    if (t) store.threads.set('t1', { ...t, reply_count: 0 })

    expect(await (await del(env)).json()).toEqual({ ok: true, mode: 'head-only' })
    // 1 度目の削除時刻を上書きしない。
    expect(store.posts.get('p2')?.deleted_at).toBe(NOW - 1000)
  })

  it('レート制限のキーは `board:` 接頭辞（§7-11）', async () => {
    const { store, env } = setup()
    await del(env)
    expect(store.rates.has('board:user_1')).toBe(true)
    expect(store.rates.has('user_1')).toBe(false)
  })

  it('分窓の上限を超えたら 429（スレは消さない）', async () => {
    const { store, env } = setup()
    store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: BOARD_ACTIONS_PER_MINUTE,
    })

    const res = await del(env)
    expect(res.status).toBe(429)
    expect(store.threads.get('t1')?.deleted_at).toBe(0)
  })

  it('レスポンスに private, no-store が付く', async () => {
    const { env } = setup()
    expect((await get(env)).headers.get('cache-control')).toBe('private, no-store')
    expect((await del(env)).headers.get('cache-control')).toBe('private, no-store')
  })
})
