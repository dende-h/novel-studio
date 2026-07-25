import { describe, expect, it } from 'vitest'
import { interpretStripeEvent } from './stripe-event'

// 実 Stripe ペイロードの最小形（余剰フィールドは省略）。
const subObject = (over: Record<string, unknown> = {}) => ({
  id: 'sub_123',
  customer: 'cus_123',
  status: 'active',
  current_period_end: 1_700_000_000, // unix 秒
  metadata: { clerk_user_id: 'user_abc' },
  items: { data: [{ price: { id: 'price_month' } }] },
  ...over,
})

const evt = (type: string, object: unknown) => ({ id: 'evt_1', type, data: { object } })

describe('interpretStripeEvent', () => {
  it('subscription.created → upsert（userId/price/period を秒→msで抽出）', () => {
    const a = interpretStripeEvent(evt('customer.subscription.created', subObject()))
    expect(a).toEqual({
      kind: 'upsert',
      sub: {
        userId: 'user_abc',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
        status: 'active',
        priceId: 'price_month',
        currentPeriodEnd: 1_700_000_000_000,
      },
    })
  })

  it('subscription.updated（past_due）→ upsert で status を反映', () => {
    const a = interpretStripeEvent(
      evt('customer.subscription.updated', subObject({ status: 'past_due' })),
    )
    expect(a.kind).toBe('upsert')
    if (a.kind === 'upsert') expect(a.sub.status).toBe('past_due')
  })

  it('subscription.deleted → cancel（status=canceled）', () => {
    const a = interpretStripeEvent(
      evt('customer.subscription.deleted', subObject({ status: 'canceled' })),
    )
    expect(a.kind).toBe('cancel')
    if (a.kind === 'cancel') {
      expect(a.sub.userId).toBe('user_abc')
      expect(a.sub.status).toBe('canceled')
    }
  })

  it('checkout.session.completed（subscription）→ upsert・client_reference_id を userId に', () => {
    const session = {
      mode: 'subscription',
      customer: 'cus_9',
      subscription: 'sub_9',
      client_reference_id: 'user_ref',
    }
    const a = interpretStripeEvent(evt('checkout.session.completed', session))
    expect(a).toEqual({
      kind: 'upsert',
      sub: {
        userId: 'user_ref',
        customerId: 'cus_9',
        subscriptionId: 'sub_9',
        status: 'active',
        priceId: null,
        currentPeriodEnd: 0,
      },
    })
  })

  it('checkout の mode が payment（都度課金）は ignore', () => {
    const a = interpretStripeEvent(
      evt('checkout.session.completed', { mode: 'payment', customer: 'cus_1' }),
    )
    expect(a.kind).toBe('ignore')
  })

  it('metadata が無い subscription は userId=null（webhook が customer で逆引きする）', () => {
    const a = interpretStripeEvent(
      evt('customer.subscription.updated', subObject({ metadata: {} })),
    )
    expect(a.kind).toBe('upsert')
    if (a.kind === 'upsert') expect(a.sub.userId).toBeNull()
  })

  it('customer が無ければ ignore', () => {
    const a = interpretStripeEvent(
      evt('customer.subscription.updated', subObject({ customer: undefined })),
    )
    expect(a.kind).toBe('ignore')
  })

  it('対象外イベント・非オブジェクトは ignore', () => {
    expect(interpretStripeEvent(evt('invoice.created', {})).kind).toBe('ignore')
    expect(interpretStripeEvent(null).kind).toBe('ignore')
    expect(interpretStripeEvent(evt('customer.subscription.updated', null)).kind).toBe('ignore')
  })
})
