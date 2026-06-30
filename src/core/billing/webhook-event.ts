import { PLAN_KEY } from './plan'

/**
 * Clerk Billing webhook の解釈結果。`delete-account` のときだけ破壊的処理を行い、それ以外は ACK して無視。
 */
export type BillingAction =
  | { kind: 'delete-account'; userId: string }
  | { kind: 'ignore'; reason: string }

/**
 * 失効＝アカウント削除に相当する終端イベント。
 * `subscriptionItem.ended`＝当該プランが完全終了しアクセス喪失（グレース期間後）。
 * `subscriptionItem.canceled`（期末解約予約・member 継続）や `subscriptionItem.pastDue`
 * （支払い遅延・グレース中）は対象外。
 */
const TERMINAL_TYPES = new Set(['subscriptionItem.ended'])

/**
 * Clerk Billing の webhook イベントを解釈し取るべき行動を返す（純関数・破壊的処理の単一判断点・TDD）。
 *
 * 安全側に倒す設計：次を**すべて**確証できたときだけ `delete-account` を返し、少しでも曖昧なら `ignore`。
 *   1. type が終端イベント（`subscriptionItem.ended`）であること。
 *   2. 終了したプランが我々の有料プラン（`PLAN_KEY`）であること。
 *      ── 無料プランの ended は**アップグレード時にも発火**するため、これが無いと昇格で誤削除する。
 *   3. payer が user で `user_id` を持つこと（organization は対象外）。
 *
 * フィールドパス（`data.plan.slug` / `data.payer.user_id` 等）は Clerk Dashboard の Event Catalog で
 * Slice F に最終確認する。形が違っても「削除しない（ignore）」側に倒れるので破壊は起きない。
 */
export function interpretBillingEvent(event: unknown): BillingAction {
  if (!isRecord(event)) return { kind: 'ignore', reason: 'not_an_object' }

  const type = typeof event.type === 'string' ? event.type : ''
  if (!TERMINAL_TYPES.has(type)) {
    return { kind: 'ignore', reason: `non_terminal:${type || 'unknown'}` }
  }

  const data = isRecord(event.data) ? event.data : null
  if (!data) return { kind: 'ignore', reason: 'no_data' }

  // 必須ガード：終了したのが有料プランでなければ（無料プランの ended＝昇格など）絶対に削除しない。
  const planSlug = readPlanSlug(data)
  if (planSlug !== PLAN_KEY) return { kind: 'ignore', reason: `other_plan:${planSlug ?? 'none'}` }

  const payer = isRecord(data.payer) ? data.payer : null
  if (!payer) return { kind: 'ignore', reason: 'no_payer' }
  if (payer.type !== 'user')
    return { kind: 'ignore', reason: `payer_not_user:${String(payer.type)}` }

  // 空文字だけでなく空白のみ（truthy だが無意味な値）も弾く＝安全側。
  const userId = typeof payer.user_id === 'string' && payer.user_id.trim() ? payer.user_id : null
  if (!userId) return { kind: 'ignore', reason: 'no_user_id' }

  return { kind: 'delete-account', userId }
}

/** 終了したプランの slug を取り出す。`data.plan.slug` を第一候補、`data.plan_slug` をフォールバック。 */
function readPlanSlug(data: Record<string, unknown>): string | null {
  const plan = isRecord(data.plan) ? data.plan : null
  if (plan && typeof plan.slug === 'string') return plan.slug
  if (typeof data.plan_slug === 'string') return data.plan_slug
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
