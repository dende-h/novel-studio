// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
/**
 * /api/board/vote のテスト。設計 docs/requirement/09-board.md §7 の不変条件のうち、
 * このエンドポイントが担うぶんを固定する。
 *   §7-1  未ログインの書き込み（投票）は 401
 *   §7-2  表示名が未設定のまま投票すると 409
 *   §7-7  **アンケートは投票前に票数を返さない／締切後の投票は 409／1 アカウント 1 票**
 *   §7-11 レート制限のキーが `board:` 接頭辞で、同期のカウンタと混ざらない
 *
 * D1 は `board-test-util.ts` の in-memory フェイク。時刻は fake timers で固定する
 *（締切の判定と分窓のレート制限が実行時刻に依存して揺れないように）。
 */

const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', async () => {
  const { clerkAuthMock } = await import('./board-test-util')
  return clerkAuthMock(authState)
})

import type { PollResult } from '../../../src/core/board/types'
import {
  type BoardDbFake,
  fakeProfile,
  fakeThread,
  makeBoardDb,
  makeBoardEnv,
} from './board-test-util'
import { onRequestPost } from './vote'

/** 固定時刻。分窓（60_000ms）の途中に置き、境界で揺れないようにする。 */
const NOW = 1_800_000_030_000
const WINDOW = Math.floor(NOW / 60_000) * 60_000
/** 締切は未来（開いているアンケート）。 */
const OPEN_UNTIL = NOW + 60 * 60 * 1000

type Handler = (c: { request: Request; env: unknown }) => Promise<Response>

const post = (env: unknown, body: unknown, query = '?thread=t1') =>
  (onRequestPost as unknown as Handler)({
    request: new Request(`https://x/api/board/vote${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  })

/**
 * 表示名のある user_1 と、スレ t1（締切前の 3 択アンケート付き）。
 * `closesAt` を渡せば締切済みのアンケートにできる。
 */
function setup(opts: { closesAt?: number; multiple?: boolean } = {}): {
  store: BoardDbFake
  env: unknown
} {
  const store = makeBoardDb({
    profiles: [
      fakeProfile({ user_id: 'user_1', display_name: 'あかり', name_key: 'あかり' }),
      fakeProfile({ user_id: 'user_2', display_name: 'ひかる', name_key: 'ひかる' }),
    ],
    threads: [fakeThread({ id: 't1', kind: 'request' })],
  })
  store.polls.set('t1', {
    thread_id: 't1',
    question: '次に作るなら？',
    options: JSON.stringify(['全文検索', '縦書き', 'ダークモード']),
    multiple: opts.multiple ? 1 : 0,
    closes_at: opts.closesAt ?? OPEN_UNTIL,
    created_at: 1000,
  })
  return { store, env: makeBoardEnv({ store }) }
}

/** 他人の票を 1 つ置く（票数が動いたことを確かめるため）。 */
function seedVote(store: BoardDbFake, userId: string, choices: number[]): void {
  store.votes.set(`t1:${userId}`, {
    thread_id: 't1',
    user_id: userId,
    choices: JSON.stringify(choices),
    created_at: 1000,
  })
}

beforeEach(() => {
  authState.userId = 'user_1'
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/board/vote', () => {
  it('未ログインは 401（§7-1）。票は増えない', async () => {
    const { store, env } = setup()
    authState.userId = null

    const res = await post(env, { choices: [0] })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(store.votes.size).toBe(0)
  })

  it('表示名が未設定なら 409 profile_required（§7-2）', async () => {
    const { store, env } = setup()
    store.profiles.delete('user_1')

    const res = await post(env, { choices: [0] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'profile_required' })
    expect(store.votes.size).toBe(0)
  })

  it('thread の指定なしは 400、壊れた JSON と choices 不正も 400', async () => {
    const { env } = setup()
    expect((await post(env, { choices: [0] }, '')).status).toBe(400)
    expect((await post(env, 'not json')).status).toBe(400)
    expect((await post(env, { choices: [] })).status).toBe(400)
    expect((await post(env, {})).status).toBe(400)
  })

  it('存在しないスレは 404、アンケートの無いスレは 404 no_poll', async () => {
    const { store, env } = setup()
    expect((await post(env, { choices: [0] }, '?thread=nope')).status).toBe(404)

    store.polls.delete('t1')
    const res = await post(env, { choices: [0] })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no_poll' })
  })

  it('削除済みのスレは 404、投稿禁止中は 403（期限つき）', async () => {
    const { store, env } = setup()
    store.threads.set('t1', fakeThread({ id: 't1', kind: 'request', deleted_at: 500 }))
    expect((await post(env, { choices: [0] })).status).toBe(404)

    store.threads.set('t1', fakeThread({ id: 't1', kind: 'request' }))
    store.profiles.set(
      'user_1',
      fakeProfile({ user_id: 'user_1', name_key: 'あかり', banned_until: NOW + 1000 }),
    )
    const res = await post(env, { choices: [0] })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'banned', bannedUntil: NOW + 1000 })
    expect(store.votes.size).toBe(0)
  })

  it('投票すると 200 で、その瞬間から票数が見える（§7-7 開示）', async () => {
    const { store, env } = setup()
    seedVote(store, 'user_2', [2])

    const res = await post(env, { choices: [1] })
    expect(res.status).toBe(200)

    const body = (await res.json()) as { poll: PollResult }
    expect(body.poll.voted).toBe(true)
    expect(body.poll.revealed).toBe(true)
    expect(body.poll.closed).toBe(false)
    expect(body.poll.myChoices).toEqual([1])
    // 自分の 1 票を含めて数え直す（読み直さずに結果を出せる）。
    expect(body.poll.counts).toEqual([0, 1, 1])
    expect(body.poll.total).toBe(2)
    expect(body.poll.options).toEqual(['全文検索', '縦書き', 'ダークモード'])

    // 保存された票は正規化済みの JSON 配列。
    expect(store.votes.get('t1:user_1')).toMatchObject({
      thread_id: 't1',
      user_id: 'user_1',
      choices: '[1]',
      created_at: NOW,
    })
  })

  it('2 回目は 409 already_voted で、最初の票を上書きしない（§7-7 1 アカウント 1 票）', async () => {
    const { store, env } = setup()
    expect((await post(env, { choices: [0] })).status).toBe(200)

    const res = await post(env, { choices: [2] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_voted' })
    // 上書きされていない＝開示後に票を動かせない。
    expect(store.votes.get('t1:user_1')?.choices).toBe('[0]')
    expect(store.votes.size).toBe(1)
  })

  it('締切後は 409 closed。締切ちょうども締切後（§7-7）', async () => {
    for (const closesAt of [NOW - 1, NOW]) {
      const { store, env } = setup({ closesAt })
      const res = await post(env, { choices: [0] })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'closed' })
      expect(store.votes.size).toBe(0)
    }
  })

  it('選択肢の範囲外・重複・単一選択への複数投票は 400（票は入らない）', async () => {
    const { store, env } = setup()

    const outOfRange = await post(env, { choices: [3] })
    expect(outOfRange.status).toBe(400)
    expect(await outOfRange.json()).toMatchObject({ error: 'bad_choices', reason: 'out_of_range' })

    expect((await post(env, { choices: [1, 1] })).status).toBe(400)
    expect((await post(env, { choices: [0, 1] })).status).toBe(400) // multiple=false
    expect(store.votes.size).toBe(0)
  })

  it('複数選択のアンケートは複数の index を受け、昇順に正規化して保存する', async () => {
    const { store, env } = setup({ multiple: true })

    const res = await post(env, { choices: [2, 0] })
    expect(res.status).toBe(200)
    expect(store.votes.get('t1:user_1')?.choices).toBe('[0,2]')

    const body = (await res.json()) as { poll: PollResult }
    expect(body.poll.myChoices).toEqual([0, 2])
    expect(body.poll.counts).toEqual([1, 0, 1])
    // total は「1 票以上を投じた人数」で、counts の合計ではない。
    expect(body.poll.total).toBe(1)
  })

  it('レート制限のキーは board: 接頭辞で、同期のカウンタと混ざらない（§7-11）', async () => {
    const { store, env } = setup()
    await post(env, { choices: [0] })

    expect(store.rates.get('board:user_1')).toEqual({
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: 1,
    })
    expect(store.rates.has('user_1')).toBe(false)
  })

  it('レート制限を超えたら 429。空振り（締切後・2 回目）では枠を食わない', async () => {
    const { store, env } = setup()
    // 同じ分窓の枠を使い切っておく。
    store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: 10, // BOARD_LIMITS.postsPerHour
    })

    const res = await post(env, { choices: [0] })
    expect(res.status).toBe(429)
    expect(store.votes.size).toBe(0)

    // 締切後の投票は、レート制限に触れる前に 409 で止まる。
    const closed = setup({ closesAt: NOW - 1 })
    closed.store.rates.set('board:user_1', {
      user_id: 'board:user_1',
      window_start: WINDOW,
      count: 0,
    })
    expect((await post(closed.env, { choices: [0] })).status).toBe(409)
    expect(closed.store.rates.get('board:user_1')?.count).toBe(0)
  })
})
