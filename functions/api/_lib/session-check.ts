/// <reference types="@cloudflare/workers-types" />
/**
 * 単一アクティブセッションの照合（Phase 2・サーバ側共通）。
 * session/status.ts と同じ判定を sync ハンドラからも使えるよう切り出したもの。
 * 純判定は src/core/sync/session.ts、ここは D1 読み出しだけ担う。
 */

import { type ActiveSession, isSessionCurrent } from '../../../src/core/sync/session'

/** 提示トークンが現在の有効セッションか D1 で確認する。 */
export async function isCurrentSession(
  db: D1Database,
  userId: string,
  presentedToken: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT user_id, session_token, rotated_at FROM sessions WHERE user_id = ?')
    .bind(userId)
    .first<{ user_id: string; session_token: string; rotated_at: number }>()

  const active: ActiveSession | null = row
    ? { userId: row.user_id, sessionToken: row.session_token, rotatedAt: row.rotated_at }
    : null

  return isSessionCurrent(active, userId, presentedToken)
}
