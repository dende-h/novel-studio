/// <reference types="@cloudflare/workers-types" />
/**
 * 運営（staff）の判定。掲示板の `board_profiles.role = 'staff'`（09-board.md §8.1 の SQL 1 行で
 * 付ける）をそのまま運営の印にする＝管理ページのために別の権限の仕組みを持たない。
 *
 * 呼び出し側は staff でないとき **403 ではなく 404** を返す（管理の口の存在を教えない）。
 */

import { type ClerkEnv, verifyUserId } from './auth'
import { readProfile } from './board-store'

/** Clerk セッションを検証し、staff なら userId、それ以外（未認証・member・退会済み）は null。 */
export async function verifyStaff(
  request: Request,
  env: ClerkEnv & { DB: D1Database },
): Promise<string | null> {
  const userId = await verifyUserId(request, env)
  if (!userId) return null
  const profile = await readProfile(env.DB, userId)
  return profile?.role === 'staff' && profile.deleted_at === 0 ? userId : null
}
