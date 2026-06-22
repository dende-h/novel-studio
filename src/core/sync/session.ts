/**
 * 単一アクティブセッションの純ロジック（同期 Phase 1）。
 *
 * 各ユーザーにつき有効なセッションは最大 1 つ（D1 `sessions` テーブルの 1 行）。
 * 新しい端末がログインするとトークンが回転し、旧端末のトークンは無効化される。
 * I/O・乱数・時刻取得は持たず、判定と行の生成だけを担う（テスト容易・core 境界準拠）。
 */

/** D1 `sessions` テーブルの 1 行に対応。 */
export interface ActiveSession {
  userId: string
  sessionToken: string
  /** 直近にトークンを回転した時刻（epoch ms）。 */
  rotatedAt: number
}

/**
 * 端末が提示したトークンが、現在有効なセッションと一致するか。
 * 未 claim（active なし）／ユーザー不一致／空トークン／トークン不一致なら false。
 */
export function isSessionCurrent(
  active: ActiveSession | null,
  userId: string,
  presentedToken: string,
): boolean {
  if (active === null) return false
  if (active.userId !== userId) return false
  // 空文字同士の偶発一致を弾く（未登録端末が "" を送っても通さない）。
  if (presentedToken === '') return false
  return active.sessionToken === presentedToken
}

/**
 * 端末がセッションを奪取するとき、永続化すべき新しい行を作る。
 * 旧トークンはこの行で上書きされ、以後 isSessionCurrent で弾かれる。
 */
export function claimSession(userId: string, newToken: string, at: number): ActiveSession {
  return { userId, sessionToken: newToken, rotatedAt: at }
}
