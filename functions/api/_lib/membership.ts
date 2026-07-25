/// <reference types="@cloudflare/workers-types" />
/**
 * Stripe 直課金の会員判定（D1 `subscriptions` を単一の真実にする）。
 *
 * Clerk Billing（USD 固定）から Stripe 直課金へ移行したため、会員判定は Clerk の JWT クレームでなく
 * この D1 テーブルで行う。Stripe webhook（functions/api/webhooks/stripe.ts）が更新し、
 * サーバーの 402/403 ゲート（verifyMember / MCP）とクライアント（/api/billing/status）が参照する。
 */

/** サブスク 1 行。会員か否か・猶予削除の予定・表示に使う。 */
export interface SubscriptionRow {
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string | null
  status: string
  price_id: string | null
  current_period_end: number
  grace_until: number
  updated_at: number
}

/** 会員とみなす Stripe subscription.status。past_due（支払い遅延）は非会員扱い（fail-closed）。 */
const MEMBER_STATUSES = new Set(['active', 'trialing'])

/** userId のサブスク行を取得（無ければ null）。 */
export async function readSubscription(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  return await db
    .prepare('SELECT * FROM subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<SubscriptionRow>()
}

/** Stripe customer_id から逆引き（webhook で metadata が無いとき用）。 */
export async function readSubscriptionByCustomer(
  db: D1Database,
  customerId: string,
): Promise<SubscriptionRow | null> {
  return await db
    .prepare('SELECT * FROM subscriptions WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first<SubscriptionRow>()
}

/**
 * userId が有効な会員か（active/trialing のサブスク行があるか）。fail-closed：
 * 行が無い・status が対象外・DB エラーはすべて非会員（false）に倒す。
 */
export async function isActiveMember(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT status FROM subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<{ status: string }>()
  return !!row && MEMBER_STATUSES.has(row.status)
}

/** サブスク行を upsert（webhook / checkout から。user_id 主キーで置き換え）。 */
export async function upsertSubscription(db: D1Database, row: SubscriptionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions
         (user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
          current_period_end, grace_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id     = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status                 = excluded.status,
         price_id               = excluded.price_id,
         current_period_end     = excluded.current_period_end,
         grace_until            = excluded.grace_until,
         updated_at             = excluded.updated_at`,
    )
    .bind(
      row.user_id,
      row.stripe_customer_id,
      row.stripe_subscription_id,
      row.status,
      row.price_id,
      row.current_period_end,
      row.grace_until,
      row.updated_at,
    )
    .run()
}
