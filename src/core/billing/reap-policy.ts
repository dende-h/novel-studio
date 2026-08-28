/**
 * reaper（/api/billing/reap）の「アカウントを完全削除してよいか」の判定（純関数・破壊的処理の単一点）。
 *
 * 削除するのは **解約して猶予（grace_until）が切れたアカウントだけ**。
 *   - 会員（active/trialing）：絶対に削除しない
 *   - 解約者：猶予が切れたら削除（データ＋Clerk ログイン）
 *   - **一度も課金していないアカウント：削除しない**（下記）
 *
 * かつては「アカウント＝有料課金者」を保つため、未課金アカウントを作成から 30 日で
 * 削除していた。これは Stripe 移行前の方針の名残で、**すでに捨てた前提に基づいていた**：
 * `src/ui/auth/derive-status.ts` は未課金のサインイン済み（`free`）を正当な状態として扱い、
 * `src/ui/Root.tsx` の `canUseCreativeTools` は無料アカウントにプロット・世界観設定・
 * アウトライン・相関図・マインドマップを開いている。ヘルプも「無料のアカウント登録で使えます」と
 * 案内していて、期限は書いていない。掲示板（docs/requirement/09-board.md）も
 * 無料アカウントで書ける前提で、書いた人が 30 日後に消えると会話が成立しない。
 *
 * つまり「登録から 30 日で消す」は、利用者への案内とも他のコードとも食い違っていた。
 * 無料アカウントに期限は無い、が正しい前提なので、その経路を落とす。
 * （未課金アカウントはクラウドに実体をほぼ持たない。R2 も D1 の works も空で、
 *   残しても費用は Clerk の MAU ぶんだけ。使っている人を消す損害のほうが大きい。）
 */

export interface ReapInput {
  /** 有効な会員（active/trialing のサブスク）か。true なら絶対に削除しない。 */
  isMember: boolean
  /** サブスク行の grace_until（epoch ms）。0 は猶予なし＝削除の予定なし。 */
  graceUntil: number
  /** 現在時刻（epoch ms）。 */
  now: number
}

/**
 * このアカウントを削除してよい時刻（epoch ms）。0 は「削除の予定なし」。
 * 解約者だけが締切を持つ（未課金アカウントは締切を持たない＝期限なし）。
 */
export function reapDeadline(input: Pick<ReapInput, 'graceUntil'>): number {
  return input.graceUntil > 0 ? input.graceUntil : 0
}

/** アカウントを完全削除すべきか。会員は常に false。未課金（猶予なし）も常に false。 */
export function shouldReap(input: ReapInput): boolean {
  if (input.isMember) return false
  const deadline = reapDeadline(input)
  if (deadline === 0) return false
  return input.now >= deadline
}
