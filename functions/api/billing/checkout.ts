/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/checkout — Stripe Checkout（ホスト型・サブスク）セッションを作り URL を返す。
 * body: { plan }。クライアントは返ってきた url へリダイレクトする。
 * client_reference_id と subscription_data.metadata.clerk_user_id に userId を埋め、webhook が
 * D1 subscriptions を userId で更新できるようにする。成功後は `?billing=return` 付きでアプリへ戻す。
 *
 * 基本プランの初回契約には 30 日間の無料トライアルを付ける（カード登録あり・終了時に自動で課金開始）。
 * trialing は会員判定（MEMBER_STATUSES）に最初から含まれているため、サーバ側のゲートは無改修。
 */
import { NARRATION_BILLING_PLANS } from '../../../src/core/narration/types'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { hasBillingHistory, readSubscription } from '../_lib/membership'
import { getOrCreateCustomerId, makeStripe } from '../_lib/stripe'

/** 無料トライアルの日数（初回契約のみ）。 */
const TRIAL_DAYS = 30

interface Env extends ClerkEnv {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_MONTHLY: string
  STRIPE_PRICE_YEARLY: string
  NARRATION_BILLING_ENABLED?: string
  NARRATION_PRICE_STANDARD?: string
  NARRATION_PRICE_PLUS?: string
  NARRATION_PRICE_PREMIUM?: string
}

function higherPrices(env: Env) {
  return {
    standard: env.NARRATION_PRICE_STANDARD,
    plus: env.NARRATION_PRICE_PLUS,
    premium: env.NARRATION_PRICE_PREMIUM,
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const prices = higherPrices(env)
  return new Response(
    JSON.stringify({
      narrationPlans:
        env.NARRATION_BILLING_ENABLED === '1'
          ? NARRATION_BILLING_PLANS.filter((plan) => !!prices[plan])
          : [],
    }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  )
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  const userId = await verifyUserId(request, env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let plan: unknown
  try {
    plan = (await request.json<{ plan?: unknown }>()).plan
  } catch {
    return json({ error: 'invalid_plan' }, 400)
  }
  const higher = NARRATION_BILLING_PLANS.find((value) => value === plan)
  if (!higher && plan !== 'monthly' && plan !== 'yearly')
    return json({ error: 'invalid_plan' }, 400)
  if (higher && env.NARRATION_BILLING_ENABLED !== '1')
    return json({ error: 'price_not_configured' }, 404)
  const price = higher
    ? higherPrices(env)[higher]
    : plan === 'yearly'
      ? env.STRIPE_PRICE_YEARLY
      : env.STRIPE_PRICE_MONTHLY
  if (!price) return json({ error: 'price_not_configured' }, 500)

  const stripe = makeStripe(env)
  // 無料トライアルは初回契約のみ。D1 の履歴（解約済み・猶予中を含む）を先に見て、
  // 念のため Stripe 側のサブスク履歴も確認する（webhook 遅延・行の作り直しでも二重付与しない）。
  // Stripe 側で既存契約を確認できないときは新しい契約の作成を止める。
  const existing = await readSubscription(env.DB, userId)
  if (
    existing?.stripe_subscription_id &&
    ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(existing.status)
  )
    return json({ error: 'subscription_exists' }, 409)
  const customerId = await getOrCreateCustomerId(stripe, env.DB, userId)
  let offerTrial = !higher && !hasBillingHistory(existing)
  try {
    const past = stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    for await (const { status } of past) {
      if (status !== 'canceled' && status !== 'incomplete_expired')
        return json({ error: 'subscription_exists' }, 409)
      offerTrial = false
    }
  } catch {
    return json({ error: 'billing_unavailable' }, 503)
  }
  const origin = new URL(request.url).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: {
      metadata: { clerk_user_id: userId },
      ...(offerTrial ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    success_url: `${origin}/?billing=return`,
    cancel_url: `${origin}/?billing=cancel`,
    locale: 'ja',
    allow_promotion_codes: true,
  })

  return json({ url: session.url })
}
