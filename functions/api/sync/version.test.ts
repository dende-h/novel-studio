// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Clerk 認証は可変の userId を返すようにモック（null なら未認証）。work.test.ts と同じ流儀。
const authState = vi.hoisted(() => ({ userId: 'user_1' as string | null }))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async () =>
      authState.userId
        ? { isAuthenticated: true, toAuth: () => ({ userId: authState.userId }) }
        : { isAuthenticated: false },
  }),
}))

import { fakeWorkRow, makeSyncDb } from './sync-test-util'
import { onRequestGet } from './version'

function makeEnv(opts: { members?: string[] } = { members: ['user_1'] }) {
  const { db, works, activity } = makeSyncDb(opts)
  const env = { DB: db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' }
  return { env, works, activity }
}

const req = () =>
  new Request('https://x/api/sync/version', { headers: { authorization: 'Bearer x' } })

const call = (env: unknown) =>
  (onRequestGet as unknown as (c: { request: Request; env: unknown }) => Promise<Response>)({
    request: req(),
    env,
  })

beforeEach(() => {
  authState.userId = 'user_1'
})

describe('GET /api/sync/version', () => {
  it('未認証 401・非会員 402', async () => {
    const { env } = makeEnv()
    authState.userId = null
    expect((await call(env)).status).toBe(401)
    authState.userId = 'user_9' // members に居ない
    expect((await call(env)).status).toBe(402)
  })

  it('works の MAX(synced_at) と activity の MAX(updated_at) を返す（行なしは 0）', async () => {
    const { env, works, activity } = makeEnv()
    expect(await (await call(env)).json()).toEqual({ works: 0, activity: 0 })

    works.set('user_1:w1', fakeWorkRow({ synced_at: 500 }))
    works.set('user_1:w2', fakeWorkRow({ work_id: 'w2', synced_at: 900 }))
    works.set('user_2:w9', fakeWorkRow({ user_id: 'user_2', work_id: 'w9', synced_at: 9999 })) // 他ユーザーは無関係
    activity.set('user_1:2026-08-01', {
      user_id: 'user_1',
      date: '2026-08-01',
      added: 1,
      removed: 0,
      saves: 1,
      updated_at: 777,
    })
    expect(await (await call(env)).json()).toEqual({ works: 900, activity: 777 })
  })
})
