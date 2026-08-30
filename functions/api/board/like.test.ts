// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/like のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み系は 401
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタ（素の user_id）と混ざらない
 *  （§7-4）投稿禁止中とロック中は押せない — 返信が 403 なのに 👍 は 200、を作らない
 *
 * 👍 が付く相手は**スレッドではなく投稿 1 件**（migrations/0009_board_post_likes.sql）。
 * 種別では絞らない＝雑談の書き込みにも押せる。ここで固定したいのは 3 つ。
 *   1. **連打で数がずれない。** `like_count` を差分加算にすると、二重送信や失敗した
 *      書き込みでずれ、ずれたまま誰も直せなくなる（store が毎回数え直す）。
 *   2. **投稿をまたいで混ざらない。** 返信への 👍 でスレの賛同数が動かない。
 *   3. **古い呼び方（`?thread=`）がスレ本文への 👍 に落ちる。** 端末に残った古い JS から
 *      当分飛んでくるので、弾かずに同じ意味へ写す。
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_2' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { BOARD_ACTIONS_PER_MINUTE } from './board-endpoint'
import {
  type BoardDbFake,
  fakePost,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestPost } from './like'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

/** `?post=` が本筋。`?thread=` は古い呼び方（本文への 👍 に写る）。 */
const url = (query: { post?: string; thread?: string }) => {
  const params = new URLSearchParams()
  if (query.post !== undefined) params.set('post', query.post)
  if (query.thread !== undefined) params.set('thread', query.thread)
  const qs = params.toString()
  return qs === '' ? 'https://x/api/board/like' : `https://x/api/board/like?${qs}`
}

const like = (env: unknown, query: { post?: string; thread?: string } = { post: 'p1' }) =>
  (onRequestPost as unknown as Handler)({
    request: new Request(url(query), { method: 'POST', headers: { authorization: 'Bearer x' } }),
    env,
  })

/** レスポンス本文（成功時）。 */
type LikeBody = { liked: boolean; likeCount: number; postId: string }

const likeBody = async (
  env: unknown,
  query: { post?: string; thread?: string } = { post: 'p1' },
): Promise<LikeBody> => (await (await like(env, query)).json()) as LikeBody

/**
 * user_1（スレ主）・user_2（押す人）・user_3 が居る。
 *   t1（要望）  … p1 = 本文（user_1）／ p2 = 返信（user_3）
 *   chat1（雑談）… c1 = 本文（user_1）
 * 種別で押せる・押せないを分けないので、雑談のスレも同じ形で置く。
 */
function setup(): { store: BoardDbFake; env: unknown } {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({ user_id: 'user_1', display_name: 'スレ主', name_key: 'すれぬし' }),
      fakeProfile({ user_id: 'user_2', display_name: '通りすがり', name_key: 'とおりすがり' }),
      fakeProfile({ user_id: 'user_3', display_name: 'もう一人', name_key: 'もうひとり' }),
    ],
    threads: [
      fakeThread({ id: 't1', kind: 'request', user_id: 'user_1' }),
      fakeThread({ id: 'chat1', kind: 'chat', user_id: 'user_1' }),
    ],
    posts: [
      fakePost({ id: 'p1', thread_id: 't1', seq: 1, user_id: 'user_1' }),
      fakePost({ id: 'p2', thread_id: 't1', seq: 2, user_id: 'user_3' }),
      fakePost({ id: 'c1', thread_id: 'chat1', seq: 1, user_id: 'user_1' }),
    ],
  })
  return { store, env: makeBoardEnv({ store }) }
}

beforeEach(() => {
  authState.userId = 'user_2'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// 認証と入力
// ---------------------------------------------------------------------------

describe('POST /api/board/like — 入口', () => {
  it('未ログインは 401（§7-1）。行も作らない', async () => {
    const { store, env } = setup()
    authState.userId = null

    const res = await like(env)
    expect(res.status).toBe(401)
    expect(store.postLikes.size).toBe(0)
    expect(store.posts.get('p1')?.like_count).toBe(0)
  })

  it('対象の指定が無ければ 400・存在しない投稿は 404', async () => {
    const { env } = setup()
    expect((await like(env, {})).status).toBe(400)
    expect((await like(env, { post: 'nope' })).status).toBe(404)
    expect((await like(env, { thread: 'nope' })).status).toBe(404)
  })

  it('表示名（board_profiles）が無くても押せる — 👍 は記名で表に出ない', async () => {
    const { store, env } = setup()
    authState.userId = 'user_9' // プロフィール未登録

    const res = await like(env)
    expect(res.status).toBe(200)
    expect((await res.json()) as LikeBody).toEqual({ liked: true, likeCount: 1, postId: 'p1' })
    expect(store.postLikes.size).toBe(1)
  })

  it('古い `?thread=` はスレ本文（seq=1）への 👍 に写る（端末に残る古い JS のため）', async () => {
    const { store, env } = setup()

    expect(await likeBody(env, { thread: 't1' })).toEqual({
      liked: true,
      likeCount: 1,
      postId: 'p1',
    })
    expect(store.postLikes.has('p1:user_2')).toBe(true)
    // 同じ相手を指しているので、`?post=` で押し直すと外れる（二重に積まれない）。
    expect(await likeBody(env, { post: 'p1' })).toEqual({
      liked: false,
      likeCount: 0,
      postId: 'p1',
    })
  })
})

// ---------------------------------------------------------------------------
// どの投稿に押せるか
// ---------------------------------------------------------------------------

describe('POST /api/board/like — 押せる相手', () => {
  // 0009 以前は request / bug のスレだけだった。押したいのは「このスレッド」ではなく
  // 中の 1 つの書き込みで、それは雑談でも作品紹介でも変わらない。
  it.each([
    'notice',
    'chat',
    'intro',
    'promo',
    'bug',
  ])('%s のスレの書き込みにも押せる（種別では絞らない）', async (kind) => {
    const { store, env } = setup()
    store.threads.set('k1', fakeThread({ id: 'k1', kind, user_id: 'user_1' }))
    store.posts.set('kp1', fakePost({ id: 'kp1', thread_id: 'k1', seq: 1, user_id: 'user_1' }))

    expect(await likeBody(env, { post: 'kp1' })).toEqual({
      liked: true,
      likeCount: 1,
      postId: 'kp1',
    })
  })

  it('返信（seq>=2）にも押せる。スレの賛同数は動かない（一覧に出るのは本文の数）', async () => {
    const { store, env } = setup()

    expect(await likeBody(env, { post: 'p2' })).toEqual({
      liked: true,
      likeCount: 1,
      postId: 'p2',
    })
    expect(store.posts.get('p2')?.like_count).toBe(1)
    expect(store.threads.get('t1')?.like_count).toBe(0)
  })

  it('本文（seq=1）への 👍 はスレ行の like_count にも写る（一覧の賛同数）', async () => {
    const { store, env } = setup()

    await like(env, { post: 'p1' })
    expect(store.threads.get('t1')?.like_count).toBe(1)
  })

  it('削除済み・運営が非表示にした投稿には押せない（gone・404）', async () => {
    const { store, env } = setup()

    store.posts.set('p1', fakePost({ id: 'p1', user_id: 'user_1', deleted_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    store.posts.set('p1', fakePost({ id: 'p1', user_id: 'user_1', hidden_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    expect(store.postLikes.size).toBe(0)
  })

  it('削除済み・運営が非表示にしたスレには押せない（gone・404）', async () => {
    const { store, env } = setup()

    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', deleted_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', hidden_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    expect(store.postLikes.size).toBe(0)
  })

  it('自分の書き込みにも押せる（自演を止めるのはここの仕事ではない）', async () => {
    const { env } = setup()
    authState.userId = 'user_1'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1, postId: 'p1' })
  })
})

// ---------------------------------------------------------------------------
// トグル — 連打で数がずれない
// ---------------------------------------------------------------------------

describe('POST /api/board/like — トグル', () => {
  it('同じ userId で 2 回叩くと元に戻る（連打で数がずれない）', async () => {
    const { store, env } = setup()

    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1, postId: 'p1' })
    expect(store.postLikes.size).toBe(1)

    expect(await likeBody(env)).toEqual({ liked: false, likeCount: 0, postId: 'p1' })
    expect(store.postLikes.size).toBe(0)
    expect(store.posts.get('p1')?.like_count).toBe(0)
    expect(store.threads.get('t1')?.like_count).toBe(0)
  })

  it('4 回叩いても on/off が交互で、行と like_count が食い違わない', async () => {
    const { store, env } = setup()

    for (const expected of [true, false, true, false]) {
      const body = await likeBody(env)
      expect(body.liked).toBe(expected)
      // 行の数と like_count は常に一致する（差分加算ではなく毎回数え直すため）。
      expect(body.likeCount).toBe(store.postLikes.size)
      expect(store.posts.get('p1')?.like_count).toBe(store.postLikes.size)
      expect(store.threads.get('t1')?.like_count).toBe(store.postLikes.size)
    }
  })

  it('別の userId の 👍 は独立して数える（自分が外しても相手のは残る）', async () => {
    const { store, env } = setup()

    authState.userId = 'user_2'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1, postId: 'p1' })

    authState.userId = 'user_3'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 2, postId: 'p1' })

    // user_2 が外しても user_3 のぶんは残る。
    authState.userId = 'user_2'
    expect(await likeBody(env)).toEqual({ liked: false, likeCount: 1, postId: 'p1' })
    expect(store.postLikes.has('p1:user_3')).toBe(true)
  })

  it('投稿をまたいでも混ざらない', async () => {
    const { store, env } = setup()

    await like(env, { post: 'p1' })
    expect(await likeBody(env, { post: 'p2' })).toEqual({
      liked: true,
      likeCount: 1,
      postId: 'p2',
    })
    expect(store.posts.get('p1')?.like_count).toBe(1)
  })

  it('👍 ではスレを持ち上げない（一覧の並びは最終書き込み順・§2）', async () => {
    const { store, env } = setup()
    const before = store.threads.get('t1')?.bumped_at

    await like(env)
    expect(store.threads.get('t1')?.bumped_at).toBe(before)
    expect(store.threads.get('t1')?.reply_count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// レート制限（D-BOARD-RATE・§7-11）
// ---------------------------------------------------------------------------

describe('POST /api/board/like — レート制限', () => {
  it('`board:` 接頭辞のキーで数える（同期の枠と混ざらない・§7-11）', async () => {
    const { store, env } = setup()

    await like(env)
    expect(store.rates.has('board:user_2')).toBe(true)
    expect(store.rates.has('user_2')).toBe(false)
  })

  it('分窓の上限を超えたら 429（超過ぶんは書き込まない）', async () => {
    const { store, env } = setup()
    store.rates.set('board:user_2', {
      user_id: 'board:user_2',
      window_start: Math.floor(NOW / 60_000) * 60_000,
      count: BOARD_ACTIONS_PER_MINUTE,
    })

    const res = await like(env)
    expect(res.status).toBe(429)
    expect(store.postLikes.size).toBe(0)
  })

  it('👍 は投稿の時間枠（10 件/時）を食わない — 押しただけで書けなくなることはない', async () => {
    const { store, env } = setup()
    // 押した回数はカウンタを 1 つずつ進めるだけで、上限は分あたりの安全弁のほうにある。
    for (let i = 0; i < 12; i++) expect((await like(env)).status).toBe(200)
    expect(store.rates.get('board:user_2')?.count).toBe(12)
  })

  it('弾かれるリクエスト（伏せた投稿）ではカウンタを進めない', async () => {
    const { store, env } = setup()
    store.posts.set('p1', fakePost({ id: 'p1', user_id: 'user_1', hidden_at: NOW - 1 }))

    expect((await like(env)).status).toBe(404)
    expect(store.rates.has('board:user_2')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 立場（投稿禁止・ロック）— 判定は canPost と同じ順で効く
// ---------------------------------------------------------------------------

describe('POST /api/board/like — 押せない立場', () => {
  it('投稿禁止中は押せない（403 banned・期限を添える）', async () => {
    const { store, env } = setup()
    store.profiles.set(
      'user_2',
      fakeProfile({ user_id: 'user_2', name_key: 'とおりすがり', banned_until: NOW + 1000 }),
    )

    const res = await like(env)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned', bannedUntil: NOW + 1000 })
    // 👍 は「次に何を作るか」を決める票そのもの。書き込みを止めた相手に数だけ動かされない。
    expect(store.postLikes.size).toBe(0)
    expect(store.posts.get('p1')?.like_count).toBe(0)

    // 期限が切れていれば押せる（bannedUntil === now は明けたものとして扱う）。
    store.profiles.set(
      'user_2',
      fakeProfile({ user_id: 'user_2', name_key: 'とおりすがり', banned_until: NOW }),
    )
    expect((await like(env)).status).toBe(200)
  })

  it('ロック中のスレには押せない（409 locked）。staff でも票は足せない', async () => {
    const { store, env } = setup()
    store.threads.set('t1', fakeThread({ id: 't1', kind: 'request', user_id: 'user_1', locked: 1 }))

    const res = await like(env)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'locked' })

    // ロックは「この話は終わり」という運営の意思表示。締めた時点の数字を根拠にできるよう、
    // staff にも票は足させない（書き込みだけは staff に許す canPost とここが違う）。
    store.profiles.set(
      'user_2',
      fakeProfile({ user_id: 'user_2', name_key: 'とおりすがり', role: 'staff' }),
    )
    expect((await like(env)).status).toBe(409)
    expect(store.postLikes.size).toBe(0)
  })

  it('レスポンスに private, no-store が付く（liked は閲覧者ごとに違う）', async () => {
    const { env } = setup()
    const res = await like(env)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })
})
