/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/billing/status — サインイン中ユーザーの会員状態を返す（クライアントの会員判定の源）。
 * Clerk のプランクレームを廃し、D1 subscriptions を単一の真実にしたため、クライアントはこれを叩く。
 */
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'
import { isActiveMember, readSubscription } from '../_lib/membership'

interface Env extends ClerkEnv {
  DB: D1Database
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const sub = await readSubscription(context.env.DB, userId)
  return json({
    isMember: await isActiveMember(context.env.DB, userId),
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.current_period_end ?? null,
    graceUntil: sub?.grace_until ?? null,
  })
}
