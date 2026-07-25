/**
 * Stripe webhook イベントの解釈（純関数・破壊/更新の単一判断点・TDD）。
 *
 * Clerk Billing（USD 固定）→ Stripe 直課金（JPY）移行で新設。webhook（functions/api/webhooks/stripe.ts）
 * は署名検証だけ行い、「このイベントで D1 subscriptions をどう更新するか」はこの純関数に集約する。
 * 時刻（grace_until = now + 猶予）は副作用側（webhook）で付与するため、ここは now を受け取らない。
 *
 * 会員判定の真実は D1 subscriptions。userId は Checkout 時に埋めた
 * `subscription.metadata.clerk_user_id`（または checkout.session の client_reference_id）から取る。
 * ペイロードから取れないときは userId=null を返し、webhook 側が customer_id→D1 で逆引きする。
 */

/** 猶予期間：失効（subscription.deleted）後、クラウドデータを保持する期間（30日）。 */
export const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

/** Stripe イベントから抜き出したサブスク断面。userId は取れないことがある（null）。 */
export interface ParsedSubscription {
  userId: string | null
  customerId: string
  subscriptionId: string | null
  status: string
  priceId: string | null
  /** epoch ms（不明なら 0）。 */
  currentPeriodEnd: number
}

/**
 * webhook が取るべき行動。
 *   upsert : active/trialing/past_due 等の状態を D1 に反映（grace はクリア）。
 *   cancel : 失効。status=canceled にし、now+GRACE_PERIOD_MS を grace_until に入れる（webhook 側）。
 *   ignore : 対象外イベント。ACK のみ。
 */
export type StripeAction =
  | { kind: 'upsert'; sub: ParsedSubscription }
  | { kind: 'cancel'; sub: ParsedSubscription }
  | { kind: 'ignore'; reason: string }

export function interpretStripeEvent(event: unknown): StripeAction {
  if (!isRecord(event)) return { kind: 'ignore', reason: 'not_an_object' }
  const type = typeof event.type === 'string' ? event.type : ''
  const data = isRecord(event.data) ? event.data : null
  const obj = data && isRecord(data.object) ? data.object : null
  if (!obj) return { kind: 'ignore', reason: `no_object:${type || 'unknown'}` }

  if (type === 'checkout.session.completed') {
    // サブスク購入のみ対象（都度課金 mode:'payment' は無視）。customer↔userId の紐付けを確定する。
    if (obj.mode !== 'subscription')
      return { kind: 'ignore', reason: `checkout_mode:${str(obj.mode)}` }
    const customerId = str(obj.customer)
    if (!customerId) return { kind: 'ignore', reason: 'no_customer' }
    return {
      kind: 'upsert',
      sub: {
        userId: str(obj.client_reference_id) || metaUserId(obj) || null,
        customerId,
        subscriptionId: str(obj.subscription) || null,
        status: 'active', // Checkout 完了＝有効。詳細（period/price）は subscription.* イベントで埋まる。
        priceId: null,
        currentPeriodEnd: 0,
      },
    }
  }

  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
    const customerId = str(obj.customer)
    if (!customerId) return { kind: 'ignore', reason: 'no_customer' }
    const sub: ParsedSubscription = {
      userId: metaUserId(obj),
      customerId,
      subscriptionId: str(obj.id) || null,
      status:
        str(obj.status) || (type === 'customer.subscription.deleted' ? 'canceled' : 'unknown'),
      priceId: readPriceId(obj),
      currentPeriodEnd: readPeriodEndMs(obj),
    }
    return type === 'customer.subscription.deleted'
      ? { kind: 'cancel', sub }
      : { kind: 'upsert', sub }
  }

  return { kind: 'ignore', reason: `unhandled:${type || 'unknown'}` }
}

/** subscription/session の metadata.clerk_user_id を取り出す。 */
function metaUserId(obj: Record<string, unknown>): string | null {
  const meta = isRecord(obj.metadata) ? obj.metadata : null
  const v = meta && typeof meta.clerk_user_id === 'string' ? meta.clerk_user_id.trim() : ''
  return v || null
}

/** items.data[0].price.id を取り出す。 */
function readPriceId(obj: Record<string, unknown>): string | null {
  const items = isRecord(obj.items) ? obj.items : null
  const arr = items && Array.isArray(items.data) ? items.data : null
  const first = arr && isRecord(arr[0]) ? arr[0] : null
  const price = first && isRecord(first.price) ? first.price : null
  return price && typeof price.id === 'string' ? price.id : null
}

/** current_period_end（Stripe は unix 秒）を epoch ms に変換。無ければ 0。 */
function readPeriodEndMs(obj: Record<string, unknown>): number {
  const sec = typeof obj.current_period_end === 'number' ? obj.current_period_end : 0
  return sec > 0 ? sec * 1000 : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
