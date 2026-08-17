// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 認証は可変の userId を返すようにモック（null なら未認証）。
// 会員（402）の判定は D1 フェイク側（members セット）で決まる。
const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async () =>
      authState.userId
        ? { isAuthenticated: true, toAuth: () => ({ userId: authState.userId }) }
        : { isAuthenticated: false },
  }),
}))

import { onRequestPost } from './activity'
import { fakeActivityRow, makeSyncDb } from './sync-test-util'

/** テスト用のコンテキスト一式（D1 フェイクのみ。R2/暗号鍵は不要）。 */
function makeEnv(opts: { members?: string[] } = { members: ['user_1'] }) {
  const { db, activity, rates } = makeSyncDb(opts)
  const env = { DB: db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' }
  return { env, activity, rates }
}

type Handler = PagesFunction<never>

function call(handler: Handler, env: unknown, request: Request): Promise<Response> {
  return handler({ request, env } as never) as Promise<Response>
}

const postReq = (body: unknown) =>
  new Request('https://x/api/sync/activity', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { authorization: 'Bearer x' },
  })

const day = (over: Record<string, unknown> = {}) => ({
  date: '2026-01-01',
  added: 100,
  removed: 10,
  saves: 3,
  updatedAt: 1000,
  ...over,
})

beforeEach(() => {
  authState.userId = 'user_1'
})

describe('認証ゲート', () => {
  it('未認証は 401', async () => {
    authState.userId = null
    const { env } = makeEnv()
    const res = await call(onRequestPost, env, postReq({ days: [] }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('非会員は 402', async () => {
    const { env } = makeEnv({ members: [] })
    const res = await call(onRequestPost, env, postReq({ days: [] }))
    expect(res.status).toBe(402)
    expect(await res.json()).toEqual({ error: 'subscription_required' })
  })
})

describe('レート制限（変更系 60 req/min）', () => {
  it('窓内 60 件で 429', async () => {
    const { env, rates } = makeEnv()
    const windowStart = Math.floor(Date.now() / 60_000) * 60_000
    rates.set('user_1', { user_id: 'user_1', window_start: windowStart, count: 60 })
    const res = await call(onRequestPost, env, postReq({ days: [] }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})

describe('入力検証（400）', () => {
  it('JSON 不正・days が配列でない', async () => {
    const { env } = makeEnv()
    expect((await call(onRequestPost, env, postReq('not json'))).status).toBe(400)
    expect((await call(onRequestPost, env, postReq({}))).status).toBe(400)
    expect((await call(onRequestPost, env, postReq({ days: 'x' }))).status).toBe(400)
    expect((await call(onRequestPost, env, postReq({ days: {} }))).status).toBe(400)
    const res = await call(onRequestPost, env, postReq({ days: null }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
  })

  it('date 形式・数値の非負・有限を要素ごとに検証（1 件でも不正なら 400）', async () => {
    const { env, activity } = makeEnv()
    const bads = [
      day({ date: '2026/01/01' }),
      day({ date: '2026-1-1' }),
      day({ date: 20260101 }),
      day({ added: -1 }),
      day({ removed: -1 }),
      day({ saves: Number.NaN }),
      day({ updatedAt: Number.POSITIVE_INFINITY }),
      day({ updatedAt: '1000' }),
      null,
      'x',
    ]
    for (const bad of bads) {
      // 正常な要素が混ざっていても、不正な要素が 1 件あれば全体を棄却する。
      const res = await call(onRequestPost, env, postReq({ days: [day(), bad] }))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_request' })
    }
    // 棄却時は一切書き込まない。
    expect(activity.size).toBe(0)
  })

  it('4000 件超は 400（ちょうど 4000 件は許可）', async () => {
    const { env } = makeEnv()
    // date は同一でよい（重複は upsert の max マージで潰れる）。件数だけを見る。
    const ok = await call(onRequestPost, env, postReq({ days: Array(4000).fill(day()) }))
    expect(ok.status).toBe(200)
    const over = await call(onRequestPost, env, postReq({ days: Array(4001).fill(day()) }))
    expect(over.status).toBe(400)
    expect(await over.json()).toEqual({ error: 'bad_request' })
  })
})

describe('マージと読み出し', () => {
  it('新規 insert → camelCase の形で date 昇順に返る', async () => {
    const { env, activity } = makeEnv()
    const res = await call(
      onRequestPost,
      env,
      postReq({
        days: [
          day({ date: '2026-01-02', added: 5, removed: 0, saves: 1, updatedAt: 2000 }),
          day({ date: '2026-01-01' }),
        ],
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      days: [
        { date: '2026-01-01', added: 100, removed: 10, saves: 3, updatedAt: 1000 },
        { date: '2026-01-02', added: 5, removed: 0, saves: 1, updatedAt: 2000 },
      ],
    })
    // D1 側は snake_case・net 列なし。
    expect(activity.get('user_1:2026-01-01')).toEqual({
      user_id: 'user_1',
      date: '2026-01-01',
      added: 100,
      removed: 10,
      saves: 3,
      updated_at: 1000,
    })
  })

  it('空 days は書き込まず既存行だけ返す（読み取り専用の同期）', async () => {
    const { env, activity } = makeEnv()
    activity.set('user_1:2026-01-01', fakeActivityRow())
    // 他ユーザーの行は混ざらない。
    activity.set('user_2:2026-01-01', fakeActivityRow({ user_id: 'user_2', added: 999 }))
    const res = await call(onRequestPost, env, postReq({ days: [] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      days: [{ date: '2026-01-01', added: 100, removed: 10, saves: 3, updatedAt: 100 }],
    })
    expect(activity.size).toBe(2)
  })

  it('max マージ: 小さい値では上書きされない（列ごとに独立して max）', async () => {
    const { env, activity } = makeEnv()
    activity.set(
      'user_1:2026-01-01',
      fakeActivityRow({ added: 100, removed: 50, saves: 10, updated_at: 5000 }),
    )
    const res = await call(
      onRequestPost,
      env,
      postReq({ days: [day({ added: 30, removed: 80, saves: 2, updatedAt: 1000 })] }),
    )
    expect(res.status).toBe(200)
    // added/saves/updatedAt は既存が勝ち、removed だけ届いた値が勝つ。
    expect(await res.json()).toEqual({
      days: [{ date: '2026-01-01', added: 100, removed: 80, saves: 10, updatedAt: 5000 }],
    })
  })

  it('複数端末の相互マージ: どちらの端末も同じ合流結果に収束する', async () => {
    // 端末 A と B が同じ日をそれぞれ進めた状態から、双方が push しても
    // max マージなので順序に依らず同じ行に収束する（衝突なし）。
    const a = [day({ date: '2026-01-01', added: 200, removed: 5, saves: 4, updatedAt: 3000 })]
    const b = [day({ date: '2026-01-01', added: 150, removed: 20, saves: 6, updatedAt: 2000 })]
    const merged = [{ date: '2026-01-01', added: 200, removed: 20, saves: 6, updatedAt: 3000 }]

    const ab = makeEnv()
    await call(onRequestPost, ab.env, postReq({ days: a }))
    const resAb = await call(onRequestPost, ab.env, postReq({ days: b }))
    expect(await resAb.json()).toEqual({ days: merged })

    const ba = makeEnv()
    await call(onRequestPost, ba.env, postReq({ days: b }))
    const resBa = await call(onRequestPost, ba.env, postReq({ days: a }))
    expect(await resBa.json()).toEqual({ days: merged })
  })
})
