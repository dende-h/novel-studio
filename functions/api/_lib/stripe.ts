/// <reference types="@cloudflare/workers-types" />
/**
 * Stripe クライアント生成（Cloudflare Workers 用）と Customer の取得/作成。
 * Workers では Node の http を使えないため fetch ベースの HttpClient を指定する。
 */
import Stripe from 'stripe'
import { readSubscription, upsertSubscription } from './membership'

export interface StripeEnv {
  STRIPE_SECRET_KEY: string
}

export function makeStripe(env: StripeEnv): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  })
}

/**
 * userId に対応する Stripe Customer を取得（無ければ作成）。
 * D1 subscriptions に customer_id を先に永続化することで、webhook 遅延や再試行でも
 * 重複 Customer を作らない（status=incomplete＝まだ非会員）。
 */
export async function getOrCreateCustomerId(
  stripe: Stripe,
  db: D1Database,
  userId: string,
): Promise<string> {
  const existing = await readSubscription(db, userId)
  if (existing?.stripe_customer_id) return existing.stripe_customer_id

  const customer = await stripe.customers.create({ metadata: { clerk_user_id: userId } })
  await upsertSubscription(db, {
    user_id: userId,
    stripe_customer_id: customer.id,
    stripe_subscription_id: null,
    status: 'incomplete',
    price_id: null,
    current_period_end: 0,
    grace_until: 0,
    updated_at: Date.now(),
  })
  return customer.id
}
