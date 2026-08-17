/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/billing/checkout — Stripe Checkout（ホスト型・サブスク）セッションを作り URL を返す。
 * body: { plan: 'monthly' | 'yearly' }。クライアントは返ってきた url へリダイレクトする。
 * client_reference_id と subscription_data.metadata.clerk_user_id に userId を埋め、webhook が
 * D1 subscriptions を userId で更新できるようにする。成功後は `?billing=return` 付きでアプリへ戻す。
 *
 * 初回契約には 30 日間の無料トライアルを付ける（カード登録あり・終了時に自動で課金開始）。
 * trialing は会員判定（MEMBER_STATUSES）に最初から含まれているため、サーバ側のゲートは無改修。
 */
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
  // 無料トライアルは初回契約のみ。D1 の履歴（解約済み・猶予中を含む）を先に見て、
  // 念のため Stripe 側のサブスク履歴も確認する（webhook 遅延・行の作り直しでも二重付与しない）。
  // 判定に失敗したときはトライアル無しに倒す（fail-closed・課金自体は通常どおり可能）。
  const existing = await readSubscription(env.DB, userId)
  const customerId = await getOrCreateCustomerId(stripe, env.DB, userId)
  let offerTrial = !hasBillingHistory(existing)
  if (offerTrial) {
    try {
      const past = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1,
      })
      offerTrial = past.data.length === 0
    } catch {
      offerTrial = false
    }
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
