// @vitest-environment node
/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { GRACE_PERIOD_MS } from '../../../src/core/billing/stripe-event'
import type { SubscriptionRow } from '../_lib/membership'
import { makeSubsDb } from '../_lib/subs-test-util'
import { onRequestPost } from './stripe'

// Stripe SDK は署名検証だけに使う。テストでは constructEventAsync が body をそのまま JSON.parse する。
vi.mock('stripe', () => {
  class Stripe {
    webhooks = { constructEventAsync: async (body: string) => JSON.parse(body) }
    static createFetchHttpClient = () => ({})
    static createSubtleCryptoProvider = () => ({})
  }
  return { default: Stripe }
})

type Ctx = Parameters<typeof onRequestPost>[0]
const env = (db: D1Database, over: Record<string, unknown> = {}) =>
  ({ DB: db, STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test', ...over }) as never
const req = (event: unknown) =>
  new Request('https://x/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=abc' },
    body: JSON.stringify(event),
  })
const call = (event: unknown, e: unknown) => onRequestPost({ request: req(event), env: e } as Ctx)

const subEvent = (type: string, obj: Record<string, unknown>) => ({ type, data: { object: obj } })
const seedRow = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
  user_id: 'u1',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  status: 'active',
  price_id: 'price_m',
  current_period_end: 0,
  grace_until: 0,
  updated_at: 1,
  ...over,
})

describe('stripe webhook', () => {
  it('subscription.created → active を upsert（period 秒→ms・grace=0）', async () => {
    const { db, rows } = makeSubsDb()
    const res = await call(
      subEvent('customer.subscription.created', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        current_period_end: 1_700_000_000,
        metadata: { clerk_user_id: 'u1' },
        items: { data: [{ price: { id: 'price_m' } }] },
      }),
      env(db),
    )
    expect(res.status).toBe(200)
    expect(rows.get('u1')?.status).toBe('active')
    expect(rows.get('u1')?.grace_until).toBe(0)
    expect(rows.get('u1')?.current_period_end).toBe(1_700_000_000_000)
  })

  it('subscription.deleted → canceled ＋ grace_until を now+30日に', async () => {
    const { db, rows } = makeSubsDb([seedRow({})])
    const before = Date.now()
    await call(
      subEvent('customer.subscription.deleted', {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'canceled',
        metadata: { clerk_user_id: 'u1' },
      }),
      env(db),
    )
    expect(rows.get('u1')?.status).toBe('canceled')
    expect(rows.get('u1')?.grace_until ?? 0).toBeGreaterThanOrEqual(before + GRACE_PERIOD_MS)
  })

  it('metadata 無しでも customer_id で逆引きして更新', async () => {
    const { db, rows } = makeSubsDb([
      seedRow({ user_id: 'u2', stripe_customer_id: 'cus_2', status: 'incomplete' }),
    ])
    await call(
      subEvent('customer.subscription.updated', {
        id: 'sub_2',
        customer: 'cus_2',
        status: 'active',
        current_period_end: 1_700_000_000,
        metadata: {},
        items: { data: [{ price: { id: 'price_y' } }] },
      }),
      env(db),
    )
    expect(rows.get('u2')?.status).toBe('active')
  })

  it('secret 未設定は 500・対象外イベントは 200 ignored', async () => {
    const { db } = makeSubsDb()
    const noSecret = await call(subEvent('x', {}), env(db, { STRIPE_WEBHOOK_SECRET: undefined }))
    expect(noSecret.status).toBe(500)
    const ignored = await call(subEvent('invoice.created', {}), env(db))
    expect(ignored.status).toBe(200)
  })
})
