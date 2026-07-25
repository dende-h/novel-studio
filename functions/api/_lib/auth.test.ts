// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'

// Clerk 認証は userId を固定で返すようにモック（会員/猶予の判定は D1 側で決まる）。
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    authenticateRequest: async () => ({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_1', has: () => false }),
    }),
  }),
}))

import { verifyBackupAccess } from './auth'
import type { SubscriptionRow } from './membership'
import { makeSubsDb } from './subs-test-util'

const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  user_id: 'user_1',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  status: 'active',
  price_id: 'price_1',
  current_period_end: 0,
  grace_until: 0,
  updated_at: 1,
  ...over,
})
const env = (db: D1Database) =>
  ({ DB: db, CLERK_SECRET_KEY: 'sk', CLERK_PUBLISHABLE_KEY: 'pk' }) as never
const req = () => new Request('https://x/api/backup', { headers: { authorization: 'Bearer x' } })
const DAY = 86_400_000

describe('verifyBackupAccess', () => {
  it('会員は isMember=true・canRestore=true', async () => {
    const { db } = makeSubsDb([row({ status: 'active' })])
    expect(await verifyBackupAccess(req(), env(db))).toMatchObject({
      isMember: true,
      canRestore: true,
    })
  })

  it('解約・猶予期間内は復元のみ（isMember=false・canRestore=true）', async () => {
    const { db } = makeSubsDb([row({ status: 'canceled', grace_until: Date.now() + DAY })])
    expect(await verifyBackupAccess(req(), env(db))).toMatchObject({
      isMember: false,
      canRestore: true,
    })
  })

  it('解約・猶予切れは復元不可', async () => {
    const { db } = makeSubsDb([row({ status: 'canceled', grace_until: Date.now() - DAY })])
    expect(await verifyBackupAccess(req(), env(db))).toMatchObject({
      isMember: false,
      canRestore: false,
    })
  })

  it('サブスク行なしは復元不可', async () => {
    const { db } = makeSubsDb([])
    expect(await verifyBackupAccess(req(), env(db))).toMatchObject({
      isMember: false,
      canRestore: false,
    })
  })
})
