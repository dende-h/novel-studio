/**
 * reaper（/api/billing/reap）の「アカウントを完全削除してよいか」の判定（純関数・破壊的処理の単一点）。
 *
 * 「アカウント＝有料課金者（＋猶予中）」を保つための掃除ルール。会員でないアカウントを、
 *   - 解約したユーザー：猶予（grace_until）が切れたら
 *   - 一度も課金していないアカウント（サインアップだけ／Checkout 中断）：作成から NEVER_PAID_MS 経過したら
 * 削除対象（データ＋Clerk ログイン）とする。会員（active/trialing）は絶対に削除しない。
 */

/** 未課金アカウントを保持する期間（サインアップから 30 日）。過ぎたら掃除対象。 */
export const NEVER_PAID_MS = 30 * 24 * 60 * 60 * 1000

export interface ReapInput {
  /** 有効な会員（active/trialing のサブスク）か。true なら絶対に削除しない。 */
  isMember: boolean
  /** サブスク行の grace_until（epoch ms・0 は猶予なし＝未課金）。 */
  graceUntil: number
  /** Clerk アカウント作成時刻（epoch ms）。 */
  accountCreatedAt: number
  /** 現在時刻（epoch ms）。 */
  now: number
}

/** このアカウントを削除してよい時刻（epoch ms）。解約者は猶予期限、未課金者は作成+保持期間。 */
export function reapDeadline(input: Pick<ReapInput, 'graceUntil' | 'accountCreatedAt'>): number {
  return input.graceUntil > 0 ? input.graceUntil : input.accountCreatedAt + NEVER_PAID_MS
}

/** アカウントを完全削除すべきか。会員は常に false。それ以外は締切を過ぎたら true。 */
export function shouldReap(input: ReapInput): boolean {
  if (input.isMember) return false
  return input.now >= reapDeadline(input)
}
