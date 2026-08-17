/// <reference types="@cloudflare/workers-types" />
/**
 * /api/sync/activity — 執筆の記録（日別活動集計）の同期（POST）。
 *
 * 原稿の内容を含まない（日付と文字数カウンタのみ）ため、R2 の暗号化 blob ではなく
 * D1 に平文の行で持ち、サーバ側で日付ごとに max マージする。カウンタは各端末で
 * 単調増加なので max を取れば全端末の進捗の合流になる＝衝突が原理的に起きず、
 * CAS / LWW / base は不要。net（added - removed）は導出値なので保存せず、
 * クライアントが再計算する。days は空でもよい（読み取り専用の同期＝マージ結果だけ返す）。
 */

import { type ClerkEnv, json, verifyMember } from '../_lib/auth'
import { checkRateLimit } from '../_lib/rate-limit'

interface Env extends ClerkEnv {
  DB: D1Database
}

/** 1 回の同期で受け付ける日数の上限（約 10 年分）。 */
const MAX_DAYS = 4000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** クライアントと往復する 1 日分の形（net は導出値なので含めない）。 */
interface ActivityDay {
  date: string
  added: number
  removed: number
  saves: number
  updatedAt: number
}

/** D1 `activity` の 1 行（このエンドポイントで使う列のみ）。 */
interface ActivityRow {
  date: string
  added: number
  removed: number
  saves: number
  updated_at: number
}

/** 非負の有限数か。 */
function nonNeg(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** body の 1 要素が ActivityDay の形か（date 形式・数値の非負を検証）。 */
function isValidDay(d: unknown): d is ActivityDay {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  return (
    typeof o.date === 'string' &&
    DATE_RE.test(o.date) &&
    nonNeg(o.added) &&
    nonNeg(o.removed) &&
    nonNeg(o.saves) &&
    nonNeg(o.updatedAt)
  )
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const m = await verifyMember(context.request, context.env)
  if (!m) return json({ error: 'unauthorized' }, 401)
  if (!m.isMember) return json({ error: 'subscription_required' }, 402)

  if (!(await checkRateLimit(context.env.DB, m.userId, Date.now()))) {
    return json({ error: 'rate_limited' }, 429)
  }

  let body: { days?: unknown }
  try {
    body = await context.request.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const days = body?.days
  if (!Array.isArray(days) || days.length > MAX_DAYS || !days.every(isValidDay)) {
    return json({ error: 'bad_request' }, 400)
  }

  // 日付ごとの max マージで upsert（D1 は SQLite なので max() が使える）。
  // どの順で届いても・どの端末が先でも、小さい値で大きい値を巻き戻さない。
  if (days.length > 0) {
    await context.env.DB.batch(
      days.map((d) =>
        context.env.DB.prepare(
          `INSERT INTO activity (user_id, date, added, removed, saves, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, date) DO UPDATE SET
             added      = max(added, excluded.added),
             removed    = max(removed, excluded.removed),
             saves      = max(saves, excluded.saves),
             updated_at = max(updated_at, excluded.updated_at)`,
        ).bind(m.userId, d.date, d.added, d.removed, d.saves, d.updatedAt),
      ),
    )
  }

  // マージ後の全量を返す（クライアントはこれで置き換え、net を再計算する）。
  const { results } = await context.env.DB.prepare(
    `SELECT date, added, removed, saves, updated_at
     FROM activity WHERE user_id = ? ORDER BY date`,
  )
    .bind(m.userId)
    .all<ActivityRow>()

  return json({
    days: (results ?? []).map((r) => ({
      date: r.date,
      added: r.added,
      removed: r.removed,
      saves: r.saves,
      updatedAt: r.updated_at,
    })),
  })
}
