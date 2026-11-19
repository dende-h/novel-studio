// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { onRequestGet, onRequestPost } from './checkout'

const { createSession, readSubscription, listSubscriptions } = vi.hoisted(() => ({
  createSession: vi.fn(async (_options: unknown) => ({
    url: 'https://checkout.stripe.test/session',
  })),
  readSubscription: vi.fn(),
  listSubscriptions: vi.fn(),
}))
vi.mock('../_lib/auth', () => ({
  verifyUserId: async () => 'author',
  json: (data: unknown, status = 200) => Response.json(data, { status }),
}))
vi.mock('../_lib/membership', () => ({
  hasBillingHistory: (existing: unknown) => existing !== null,
  readSubscription,
}))
vi.mock('../_lib/stripe', () => ({
  makeStripe: () => ({
    subscriptions: { list: listSubscriptions },
    checkout: { sessions: { create: createSession } },
  }),
  getOrCreateCustomerId: async () => 'cus_test',
}))

function context(plan: string, enabled = true) {
  return {
    env: {
      STRIPE_PRICE_MONTHLY: 'price_monthly',
      STRIPE_PRICE_YEARLY: 'price_yearly',
      NARRATION_PRICE_STANDARD: 'price_standard',
      NARRATION_PRICE_PREMIUM: 'price_premium',
      NARRATION_BILLING_ENABLED: enabled ? '1' : '0',
    },
    request: new Request('https://leaf.example/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),
  } as Parameters<typeof onRequestPost>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  readSubscription.mockResolvedValue(null)
  listSubscriptions.mockReturnValue([])
})

it('有効にした追加プランだけを価格IDなしで公開する', async () => {
  expect(await (await onRequestGet(context('monthly'))).json()).toEqual({
    narrationPlans: ['standard', 'premium'],
  })
  expect(await (await onRequestGet(context('monthly', false))).json()).toEqual({
    narrationPlans: [],
  })
})

it('追加プランは固定の価格IDを使い、基本プランだけに契約トライアルを付ける', async () => {
  expect((await onRequestPost(context('standard'))).status).toBe(200)
  expect(createSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      line_items: [{ price: 'price_standard', quantity: 1 }],
      subscription_data: { metadata: { clerk_user_id: 'author' } },
    }),
  )
  expect((await onRequestPost(context('yearly'))).status).toBe(200)
  expect(createSession).toHaveBeenLastCalledWith(
    expect.objectContaining({
      line_items: [{ price: 'price_yearly', quantity: 1 }],
      subscription_data: expect.objectContaining({ trial_period_days: 30 }),
    }),
  )
})

it('Stripeに更新可能な既存契約があれば、新しいCheckoutを作らない', async () => {
  listSubscriptions.mockReturnValue([{ status: 'past_due' }])
  expect((await onRequestPost(context('premium'))).status).toBe(409)
  expect(createSession).not.toHaveBeenCalled()
})

it('未公開の追加プランや任意の価格IDではCheckoutを作らない', async () => {
  expect((await onRequestPost(context('standard', false))).status).toBe(404)
  expect((await onRequestPost(context('price_from_browser'))).status).toBe(400)
  expect(createSession).not.toHaveBeenCalled()
})
