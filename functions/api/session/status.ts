/// <reference types="@cloudflare/workers-types" />
import { type ActiveSession, isSessionCurrent } from '../../../src/core/sync/session'
import { type ClerkEnv, json, verifyUserId } from '../_lib/auth'

interface Env extends ClerkEnv {
  DB: D1Database
}

/** この端末がまだ唯一の有効セッションか確認する。奪われていれば 409。 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const userId = await verifyUserId(context.request, context.env)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const presented = context.request.headers.get('X-Session-Token') ?? ''
  const row = await context.env.DB.prepare(
    'SELECT user_id, session_token, rotated_at FROM sessions WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ user_id: string; session_token: string; rotated_at: number }>()

  const active: ActiveSession | null = row
    ? { userId: row.user_id, sessionToken: row.session_token, rotatedAt: row.rotated_at }
    : null

  if (!isSessionCurrent(active, userId, presented)) {
    return json({ status: 'superseded' }, 409)
  }
  return json({ status: 'active' })
}
