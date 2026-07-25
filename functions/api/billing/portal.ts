/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/portal — Stripe Customer Portal セッションを作り URL を返す。
 * ユーザーはここで解約・支払い方法変更・請求履歴確認を行う（自前 UI は持たない）。
 * クライアントは返ってきた url へリダイレクトする。customer が無ければ 404。
 */
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { readSubscription } from '../_lib/membership'
import { makeStripe } from '../_lib/stripe'

interface Env extends ClerkEnv {
  DB: D1Database
  STRIPE_SECRET_KEY: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context
  const userId = await verifyUserId(request, env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const sub = await readSubscription(env.DB, userId)
  if (!sub?.stripe_customer_id) return json({ error: 'no_subscription' }, 404)

  const stripe = makeStripe(env)
  const origin = new URL(request.url).origin
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}/`,
  })

  return json({ url: session.url })
}
