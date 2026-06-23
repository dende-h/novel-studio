/// <reference types="@cloudflare/workers-types" />
/**
 * 簡易レート制限（Phase 2）。ユーザーごとに 1 分窓で req 数を数え、上限超で false。
 * autosave は ~30s coalesce で間引かれるので、D1 の素朴な分カウンタで足りる
 * （厳密な原子性は要らない。多少の競合は許容）。
 */

export const RATE_LIMIT = 60
const WINDOW_MS = 60_000

/** true=許可 / false=超過（429 を返すべき）。 */
export async function checkRateLimit(
  db: D1Database,
  userId: string,
  now: number,
): Promise<boolean> {
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS
  const row = await db
    .prepare('SELECT window_start, count FROM rate_limits WHERE user_id = ?')
    .bind(userId)
    .first<{ window_start: number; count: number }>()

  if (!row || row.window_start !== windowStart) {
    // 窓が変わった（または初回）→ カウンタをリセットして 1。
    await db
      .prepare(
        `INSERT INTO rate_limits (user_id, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(user_id) DO UPDATE SET window_start = excluded.window_start, count = 1`,
      )
      .bind(userId, windowStart)
      .run()
    return true
  }

  if (row.count >= RATE_LIMIT) {
    return false
  }
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE user_id = ?').bind(userId).run()
  return true
}
