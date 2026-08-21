/**
 * 破壊的な全置換（クラウド復元・AI の変更の取り込み・ファイル取り込み）と自動同期の排他。
 *
 * 全置換は「ローカル全体を差し替え、同期 base（`syncbase:*`）を全消しする」操作で、
 * 実行中に別で走っている reconcile が**取り込み前の前提**で書き戻すと事故になる：
 * - base 全消しの**後**に in-flight の reconcile が base を書き戻す
 *   → 次の reconcile が「base はあるのにローカルに無い」＝ケース6 と誤認して
 *     **purgeRemote（サーバから削除）**を出し、全端末から作品が消える。
 * - 取り込み前に読んだ本文で push し、AI が書いた内容を上書きする。
 *
 * 同期は 5〜10 秒おきに走るので、この重なりは普通に起こりうる。そこで
 * 「世代（epoch）」と「保留中（suspended）」の 2 つの合図を置き、
 * - 全置換の**開始**で epoch を進める＝実行中の reconcile はすべて stale になり、以後の書き込みを止める
 * - 全置換の**最中**は suspended＝新しい reconcile は走り出さない
 * ようにする。純関数の core には持ち込まず、UI 層（同期サービス・バックアップ I/O）だけで完結させる。
 */

let epoch = 0
let depth = 0

/** 現在の世代。全置換の開始・終了で進む（reconcile は開始時の値を握って比較する）。 */
export function syncEpoch(): number {
  return epoch
}

/** 全置換の実行中か（新しい reconcile を走らせない）。 */
export function isSyncSuspended(): boolean {
  return depth > 0
}

/**
 * 全置換を排他区間として実行する。区間の開始と終了で世代を進め、区間中は suspended にする。
 * 例外時も必ず解除する（解除漏れで同期が永久停止しないこと）。
 */
export async function withSyncSuspended<T>(fn: () => Promise<T>): Promise<T> {
  depth++
  epoch++
  try {
    return await fn()
  } finally {
    depth--
    if (depth === 0) epoch++
  }
}
