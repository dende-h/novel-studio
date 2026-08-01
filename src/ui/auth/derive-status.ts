import type { AuthStatus } from './auth-context'

/**
 * Clerk の状態から認証ステータスを導く純関数（単一の真実・ユニットテスト対象）。
 *
 * - `guest`  ＝未サインイン。ローカル執筆のみ（同期オフ）。
 * - `free`   ＝サインイン済みだが未課金。ローカル執筆に加え、公開先（novel platform）への
 *   投稿ができる。クラウド同期は付かない。
 * - `member` ＝サインイン済み **かつ** 有効なサブスク保持（`hasPlan`）。同期が有効。
 *   会員判定の真実は D1 subscriptions（Stripe webhook が更新・/api/billing/status で取得）。
 * - 判定前（Clerk 未ロード）は `loading`（ちらつき防止）。
 *
 * かつては「アカウント＝有料会員だけが持つ」とし、未課金のサインイン済みを guest に丸めて
 * 全画面オンボーディング（購読 or サインアウト）へ収束させていた。
 * しかし novel platform とアカウントを共有する（執筆アカウント＝公開アカウント）以上、
 * 「platform に無料登録した人がコトノハを開くと課金画面に閉じ込められる」ことになるため、
 * 未課金のサインイン済みを正当な状態として扱うことにした。
 * 課金の線は「配布」ではなく「保全」に引く（完成品を出す＝無料 / 制作中の資産を守る＝有料）。
 */
export function deriveStatus(input: {
  isLoaded: boolean
  isSignedIn: boolean
  hasPlan: boolean
}): AuthStatus {
  if (!input.isLoaded) return 'loading'
  if (!input.isSignedIn) return 'guest'
  return input.hasPlan ? 'member' : 'free'
}
