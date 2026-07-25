/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/webhooks/stripe — Stripe webhook（会員状態を D1 subscriptions にミラーする）。
 *   1. STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY が無ければ設定不備 500（破壊せず）。
 *   2. Stripe-Signature を SDK の constructEventAsync（Web Crypto）で検証。不正は 401。
 *   3. interpretStripeEvent（純関数）で upsert / cancel / ignore を決める。
 *   4. userId は metadata（Checkout で埋込）優先、無ければ customer_id → D1 で逆引き。
 *   5. cancel（subscription.deleted）は status=canceled ＋ grace_until=now+30日（即削除しない）。
 * 冪等：同じイベント再送でも user_id 主キーの upsert なので結果は変わらない。
 */
import Stripe from 'stripe'
import { GRACE_PERIOD_MS, interpretStripeEvent } from '../../../src/core/billing/stripe-event'
import { json } from '../_lib/auth'
import {
  readSubscription,
  readSubscriptionByCustomer,
  type SubscriptionRow,
  upsertSubscription,
} from '../_lib/membership'

interface Env {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    return json({ error: 'webhook_not_configured' }, 500)
  }
  const sig = request.headers.get('stripe-signature')
  if (!sig) return json({ error: 'no_signature' }, 400)

  const body = await request.text()
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() })
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    )
  } catch (err) {
    console.error('stripe webhook: signature verification failed', err)
    return json({ error: 'invalid_signature' }, 401)
  }

  const action = interpretStripeEvent(event)
  if (action.kind === 'ignore') return json({ ok: true, ignored: action.reason })

  const { sub } = action
  // userId 解決：Checkout で埋めた metadata を優先。無ければ customer_id → D1 逆引き。
  let userId = sub.userId
  if (!userId) {
    const byCustomer = await readSubscriptionByCustomer(env.DB, sub.customerId)
    userId = byCustomer?.user_id ?? null
  }
  if (!userId) return json({ ok: true, ignored: 'no_user_mapping' })

  const now = Date.now()
  const existing = await readSubscription(env.DB, userId)
  // 既存値とマージ（checkout.session.completed は price/period が null/0 なので上書きしない）。
  const row: SubscriptionRow = {
    user_id: userId,
    stripe_customer_id: sub.customerId || existing?.stripe_customer_id || '',
    stripe_subscription_id: sub.subscriptionId ?? existing?.stripe_subscription_id ?? null,
    status: action.kind === 'cancel' ? 'canceled' : sub.status,
    price_id: sub.priceId ?? existing?.price_id ?? null,
    current_period_end: sub.currentPeriodEnd || existing?.current_period_end || 0,
    grace_until: action.kind === 'cancel' ? now + GRACE_PERIOD_MS : 0,
    updated_at: now,
  }
  await upsertSubscription(env.DB, row)
  return json({ ok: true })
}
