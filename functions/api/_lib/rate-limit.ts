/// <reference types="@cloudflare/workers-types" />
/**
 * 簡易レート制限（rate_limits テーブル・分カウンタ）。
 *
 * 同期 API の変更系（PUT/PATCH/DELETE）を 60 req/min/user に抑える安全弁。
 * クライアント側に autosave coalesce があるため、user_id 1 行の素朴な
 * 「分窓の先頭 + カウント」で足りる（厳密なスライディングウィンドウは不要）。
 * 読み→書きの間に競合すると数リクエスト分甘くなるが、安全弁としては許容する。
 */

/** 分窓の幅（ms）。 */
const WINDOW_MS = 60_000

/**
 * userId の変更系リクエストを 1 件カウントし、limit 以内なら true を返す。
 * window_start が現在の分窓とずれていたらカウントをリセットして数え直す。
 * 超過（false）のときはカウントを進めない（窓が明ければ即回復する）。
 */
export async function checkRateLimit(
  db: D1Database,
  userId: string,
  now: number,
  limit = 60,
): Promise<boolean> {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS
  const row = await db
    .prepare('SELECT window_start, count FROM rate_limits WHERE user_id = ?')
    .bind(userId)
    .first<{ window_start: number; count: number }>()

  const sameWindow = !!row && row.window_start === windowStart
  if (sameWindow && row.count >= limit) return false

  const count = sameWindow ? row.count + 1 : 1
  await db
    .prepare(
      `INSERT INTO rate_limits (user_id, window_start, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         window_start = excluded.window_start,
         count        = excluded.count`,
    )
    .bind(userId, windowStart, count)
    .run()
  return true
}
