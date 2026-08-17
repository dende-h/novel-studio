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

/**
 * 過去に課金・トライアルの履歴があるか（無料トライアルを初回のみ付ける判定に使う）。
 * customer 作成直後のプレースホルダ行（status=incomplete・subscription 未紐付け）は
 * 「まだ一度も契約していない」＝履歴なし。それ以外の行（active/trialing/canceled 等、
 * または subscription id が付いた行）は履歴ありとみなす。
 */
export function hasBillingHistory(row: SubscriptionRow | null): boolean {
  return row !== null && (row.stripe_subscription_id !== null || row.status !== 'incomplete')
}

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

/**
 * サブスク行を upsert（webhook / checkout から。user_id 主キー）。
 * 並行して届く webhook（例：checkout.session.completed と customer.subscription.created）の
 * 「読んで→書く」競合を避けるため、**アトミックな単文**で反映する。price_id / subscription_id /
 * current_period_end は、届いた値が null / 0 のときは既存値を保持（COALESCE / CASE）＝情報を持たない
 * イベントが持つイベントの値を消さない。status / grace_until / updated_at は届いた値で更新。
 */
export async function upsertSubscription(db: D1Database, row: SubscriptionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions
         (user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
          current_period_end, grace_until, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id     = excluded.stripe_customer_id,
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
         status                 = excluded.status,
         price_id               = COALESCE(excluded.price_id, subscriptions.price_id),
         current_period_end     = CASE WHEN excluded.current_period_end > 0
                                       THEN excluded.current_period_end
                                       ELSE subscriptions.current_period_end END,
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
