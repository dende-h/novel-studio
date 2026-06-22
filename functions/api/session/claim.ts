/// <reference types="@cloudflare/workers-types" />
import { claimSession } from '../../../src/core/sync/session'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'

interface Env extends ClerkEnv {
  DB: D1Database
}

/** この端末を唯一の有効セッションとして登録する（session_token を回転し旧端末を無効化）。 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const token = crypto.randomUUID()
  const next = claimSession(userId, token, Date.now())
  await context.env.DB.prepare(
    `INSERT INTO sessions (user_id, session_token, rotated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       session_token = excluded.session_token,
       rotated_at = excluded.rotated_at`,
  )
    .bind(next.userId, next.sessionToken, next.rotatedAt)
    .run()

  return json({ sessionToken: token })
}
