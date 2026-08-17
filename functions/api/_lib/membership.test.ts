// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it } from 'vitest'
import {
  hasBillingHistory,
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

  it('hasBillingHistory: 行なし・customer 作成直後のプレースホルダは履歴なし', () => {
    expect(hasBillingHistory(null)).toBe(false)
    // checkout 前に customer id だけ確保した行（status=incomplete・subscription 未紐付け）
    expect(hasBillingHistory(row({ stripe_subscription_id: null, status: 'incomplete' }))).toBe(
      false,
    )
  })

  it('hasBillingHistory: 契約中・トライアル中・解約済みはすべて履歴あり（トライアルは初回のみ）', () => {
    expect(hasBillingHistory(row({ status: 'active' }))).toBe(true)
    expect(hasBillingHistory(row({ status: 'trialing' }))).toBe(true)
    expect(hasBillingHistory(row({ status: 'canceled' }))).toBe(true)
    // status が incomplete でも subscription id が付いていれば契約は始まっている
    expect(hasBillingHistory(row({ stripe_subscription_id: 'sub_x', status: 'incomplete' }))).toBe(
      true,
    )
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
