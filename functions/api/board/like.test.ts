// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/like のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み系は 401
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタ（素の user_id）と混ざらない
 *  （D-BOARD-KIND）👍 が付くのは request / bug のスレだけ
 *
 * いちばん効かせたいのは**連打で数がずれない**こと。`like_count` を差分加算にすると、
 * 二重送信や失敗した書き込みでずれ、ずれたまま誰も直せなくなる（store が毎回数え直す）。
 * 同じ userId で 2 回叩けば元に戻り、別の userId は独立して数えられることを固定する。
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（レート制限の分窓が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_2' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import { BOARD_LIMITS } from '../../../src/core/board/types'
import {
  type BoardDbFake,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestPost } from './like'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const url = (threadId: string | null) =>
  threadId === null
    ? 'https://x/api/board/like'
    : `https://x/api/board/like?thread=${encodeURIComponent(threadId)}`

const like = (env: unknown, threadId: string | null = 't1') =>
  (onRequestPost as unknown as Handler)({
    request: new Request(url(threadId), {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
    }),
    env,
  })

/** レスポンス本文（成功時）。 */
type LikeBody = { liked: boolean; likeCount: number }

const likeBody = async (env: unknown, threadId: string | null = 't1'): Promise<LikeBody> =>
  (await (await like(env, threadId)).json()) as LikeBody

/**
 * user_1（スレ主）・user_2（押す人）・user_3 が居て、`t1` は種別 `request`（👍 が付く）。
 * 種別が違うスレの比較用に `chat1`（雑談）も置く。
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
    expect(store.likes.size).toBe(0)
    expect(store.threads.get('t1')?.like_count).toBe(0)
  })

  it('thread が無ければ 400・存在しないスレは 404', async () => {
    const { env } = setup()
    expect((await like(env, null)).status).toBe(400)
    expect((await like(env, 'nope')).status).toBe(404)
  })

  it('表示名（board_profiles）が無くても押せる — 👍 は記名で表に出ない', async () => {
    const { store, env } = setup()
    authState.userId = 'user_9' // プロフィール未登録

    const res = await like(env)
    expect(res.status).toBe(200)
    expect((await res.json()) as LikeBody).toEqual({ liked: true, likeCount: 1 })
    expect(store.likes.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 種別（D-BOARD-KIND）と、触れないスレ
// ---------------------------------------------------------------------------

describe('POST /api/board/like — 押せるスレの種別', () => {
  it('request と bug には押せる', async () => {
    const { store, env } = setup()
    store.threads.set('bug1', fakeThread({ id: 'bug1', kind: 'bug', user_id: 'user_1' }))

    expect(await likeBody(env, 't1')).toEqual({ liked: true, likeCount: 1 })
    expect(await likeBody(env, 'bug1')).toEqual({ liked: true, likeCount: 1 })
  })

  it.each([
    'suggestion',
    'chat',
    'intro',
    'promo',
  ])('%s のスレには押せない（unsupported-kind・行も作らない）', async (kind) => {
    const { store, env } = setup()
    store.threads.set('k1', fakeThread({ id: 'k1', kind, user_id: 'user_1' }))

    const res = await like(env, 'k1')
    // ステータスは permission.ts の STATUS_OF_REASON をそのまま写す
    //（対応表をエンドポイント側で書き直さない）。
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toEqual({ error: 'unsupported-kind' })
    expect(store.likes.size).toBe(0)
    expect(store.threads.get('k1')?.like_count).toBe(0)
  })

  it('削除済み・運営が非表示にしたスレには押せない（gone・404）', async () => {
    const { store, env } = setup()

    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', deleted_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    store.threads.set('t1', fakeThread({ id: 't1', user_id: 'user_1', hidden_at: NOW - 1 }))
    expect((await like(env)).status).toBe(404)

    expect(store.likes.size).toBe(0)
  })

  it('自分のスレにも押せる（自演を止めるのはここの仕事ではない）', async () => {
    const { env } = setup()
    authState.userId = 'user_1'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1 })
  })
})

// ---------------------------------------------------------------------------
// トグル — 連打で数がずれない
// ---------------------------------------------------------------------------

describe('POST /api/board/like — トグル', () => {
  it('同じ userId で 2 回叩くと元に戻る（連打で数がずれない）', async () => {
    const { store, env } = setup()

    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1 })
    expect(store.likes.size).toBe(1)

    expect(await likeBody(env)).toEqual({ liked: false, likeCount: 0 })
    expect(store.likes.size).toBe(0)
    expect(store.threads.get('t1')?.like_count).toBe(0)
  })

  it('4 回叩いても on/off が交互で、行と like_count が食い違わない', async () => {
    const { store, env } = setup()

    for (const expected of [true, false, true, false]) {
      const body = await likeBody(env)
      expect(body.liked).toBe(expected)
      // 行の数と like_count は常に一致する（差分加算ではなく毎回数え直すため）。
      expect(body.likeCount).toBe(store.likes.size)
      expect(store.threads.get('t1')?.like_count).toBe(store.likes.size)
    }
  })

  it('別の userId の 👍 は独立して数える（自分が外しても相手のは残る）', async () => {
    const { store, env } = setup()

    authState.userId = 'user_2'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 1 })

    authState.userId = 'user_3'
    expect(await likeBody(env)).toEqual({ liked: true, likeCount: 2 })

    // user_2 が外しても user_3 のぶんは残る。
    authState.userId = 'user_2'
    expect(await likeBody(env)).toEqual({ liked: false, likeCount: 1 })
    expect(store.likes.has('t1:user_3')).toBe(true)
  })

  it('スレをまたいでも混ざらない', async () => {
    const { store, env } = setup()
    store.threads.set('bug1', fakeThread({ id: 'bug1', kind: 'bug', user_id: 'user_1' }))

    await like(env, 't1')
    expect(await likeBody(env, 'bug1')).toEqual({ liked: true, likeCount: 1 })
    expect(store.threads.get('t1')?.like_count).toBe(1)
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
      count: BOARD_LIMITS.postsPerHour,
    })

    const res = await like(env)
    expect(res.status).toBe(429)
    expect(store.likes.size).toBe(0)
  })

  it('弾かれるリクエスト（種別違い）ではカウンタを進めない', async () => {
    const { store, env } = setup()

    expect((await like(env, 'chat1')).status).toBe(400)
    expect(store.rates.has('board:user_2')).toBe(false)
  })
})
