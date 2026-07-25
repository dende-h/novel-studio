// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import {
  isActiveMember,
  readSubscription,
  readSubscriptionByCustomer,
  type SubscriptionRow,
  upsertSubscription,
} from './membership'
import { makeSubsDb } from './subs-test-util'

const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  user_id: 'user_1',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  status: 'active',
  price_id: 'price_m',
  current_period_end: 0,
  grace_until: 0,
  updated_at: 1,
  ...over,
})

describe('membership', () => {
  it('isActiveMember: active/trialing は true、それ以外・行なしは false', async () => {
    const { db } = makeSubsDb([
      row({ user_id: 'u_active', status: 'active' }),
      row({ user_id: 'u_trial', status: 'trialing' }),
      row({ user_id: 'u_canceled', status: 'canceled' }),
      row({ user_id: 'u_pastdue', status: 'past_due' }),
    ])
    expect(await isActiveMember(db, 'u_active')).toBe(true)
    expect(await isActiveMember(db, 'u_trial')).toBe(true)
    expect(await isActiveMember(db, 'u_canceled')).toBe(false)
    expect(await isActiveMember(db, 'u_pastdue')).toBe(false)
    expect(await isActiveMember(db, 'u_none')).toBe(false)
  })

  it('upsert → read / readByCustomer で往復できる', async () => {
    const { db } = makeSubsDb()
    await upsertSubscription(db, row({ user_id: 'u9', stripe_customer_id: 'cus_9' }))
    expect((await readSubscription(db, 'u9'))?.stripe_customer_id).toBe('cus_9')
    expect((await readSubscriptionByCustomer(db, 'cus_9'))?.user_id).toBe('u9')
    // 同 user_id を upsert で置き換え
    await upsertSubscription(
      db,
      row({ user_id: 'u9', stripe_customer_id: 'cus_9', status: 'canceled' }),
    )
    expect(await isActiveMember(db, 'u9')).toBe(false)
  })
})
