import type { AuthStatus } from './auth-context'

/**
 * Clerk の状態から認証ステータスを導く純関数（単一の真実・ユニットテスト対象）。
 *
 * - `member`＝サインイン済み **かつ** 課金プラン保持（`has({ plan: PLAN_KEY })`）。同期が有効。
 * - サインイン済みだが未課金（登録直後・解約後グレース外など）は **guest 扱い**（同期オフ）。
 *   通常フローは guest / member の 2 つに収束する（失効＝アカウント削除→ゲスト化のため）。
 *   「サインイン済みだが未課金」を `isSignedIn` で見分け、Root が全画面オンボーディング
 *   （購読 or サインアウト）を出す。持続する未課金ヘッダー状態は持たない。
 * - 判定前（Clerk 未ロード）は `loading`（ちらつき防止）。
 */
export function deriveStatus(input: {
  isLoaded: boolean
  isSignedIn: boolean
  hasPlan: boolean
}): AuthStatus {
  if (!input.isLoaded) return 'loading'
  if (input.isSignedIn && input.hasPlan) return 'member'
  return 'guest'
}
