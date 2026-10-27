/**
 * reaper（/api/billing/reap）の「この人のクラウドのデータを消してよいか」の判定（純関数・破壊的処理の単一点）。
 *
 * 消すのは **解約して猶予（grace_until）が切れた人の、クラウド版のデータだけ**。
 *   - 会員（active/trialing）：絶対に消さない
 *   - 解約者：猶予が切れたら、クラウドのデータ（同期・バックアップ・ライブスナップショット等）を消す。
 *     **ログインは残す**＝無料アカウントとして使い続けられる
 *   - **一度も課金していないアカウント：対象外**（猶予を持たない）
 *
 * かつては「アカウント＝有料課金者」を保つため、解約者は猶予切れでログインごと、未課金は作成から
 * 30 日でアカウントごと削除していた。これは Stripe 移行前の方針の名残で、**すでに捨てた前提に
 * 基づいていた**：`src/ui/auth/derive-status.ts` は未課金のサインイン済み（`free`）を正当な状態として
 * 扱い、`src/ui/Root.tsx` の `canUseCreativeTools` は無料アカウントに構想の道具を開いている。
 * 掲示板（docs/requirement/09-board.md）も無料アカウントで書ける前提で、アカウントは
 * コトノハ-grove- とも共有している。
 *
 * 未課金の削除は先に落とした（2026-08）。解約者のログイン削除も同じ理由で落とした（2026-10）：
 * 一度も課金していない人は残るのに、課金したことのある人だけがアカウントを失う逆転になっていた。
 */

export interface ReapInput {
  /** 有効な会員（active/trialing のサブスク）か。true なら絶対に消さない。 */
  isMember: boolean
  /** サブスク行の grace_until（epoch ms）。0 は猶予なし＝削除の予定なし。 */
  graceUntil: number
  /** 現在時刻（epoch ms）。 */
  now: number
}

/**
 * クラウドのデータを消してよい時刻（epoch ms）。0 は「削除の予定なし」。
 * 解約者だけが締切を持つ（未課金アカウントは締切を持たない＝期限なし）。
 */
export function reapDeadline(input: Pick<ReapInput, 'graceUntil'>): number {
  return input.graceUntil > 0 ? input.graceUntil : 0
}

/** クラウドのデータを消すべきか。会員は常に false。未課金（猶予なし）も常に false。 */
export function shouldReap(input: ReapInput): boolean {
  if (input.isMember) return false
  const deadline = reapDeadline(input)
  if (deadline === 0) return false
  return input.now >= deadline
}
