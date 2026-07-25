/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/checkout — Stripe Checkout（ホスト型・サブスク）セッションを作り URL を返す。
 * body: { plan: 'monthly' | 'yearly' }。クライアントは返ってきた url へリダイレクトする。
 * client_reference_id と subscription_data.metadata.clerk_user_id に userId を埋め、webhook が
 * D1 subscriptions を userId で更新できるようにする。成功後は `?billing=return` 付きでアプリへ戻す。
 */
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { getOrCreateCustomerId, makeStripe } from '../_lib/stripe'

interface Env extends ClerkEnv {
  DB: D1Database
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_MONTHLY: string
  STRIPE_PRICE_YEARLY: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  const userId = await verifyUserId(request, env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let plan: unknown
  try {
    plan = (await request.json<{ plan?: unknown }>()).plan
  } catch {
    plan = 'monthly'
  }
  const price = plan === 'yearly' ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY
  if (!price) return json({ error: 'price_not_configured' }, 500)

  const stripe = makeStripe(env)
  const customerId = await getOrCreateCustomerId(stripe, env.DB, userId)
  const origin = new URL(request.url).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { clerk_user_id: userId } },
    success_url: `${origin}/?billing=return`,
    cancel_url: `${origin}/?billing=cancel`,
    locale: 'ja',
    allow_promotion_codes: true,
  })

  return json({ url: session.url })
}
