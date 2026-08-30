import { UserButton } from '@clerk/clerk-react'

/**
 * 会員のアカウント操作（Clerk 公式の `<UserButton />`）。アバター → メニューに「アカウント管理」を
 * 内包し、Clerk Billing 有効時はそこにサブスクリプション面が出る＝**解約（`cancel_at_period_end`）と
 * グレース中の再開**、加えてサインアウトを提供する。解約ロジックは我々が持たず Clerk/Stripe に委ねる
 * 設計（D-SYNC-PRICE）にそのまま一致する。
 *
 * `@clerk/clerk-react` を含むため main バンドルから切り離し、会員のときだけ lazy import する
 * （ゲストに Clerk SDK をダウンロードさせない＝`clerk-pricing` と同じ方針）。サインアウト時の端末
 * ローカルトークン破棄は `clerk-gate` の Clerk リスナーが担う（UserButton 内蔵サインアウトも捕捉）。
 */
export default function ClerkUserButton() {
  // `showName` は付けない。Clerk が出すのはサインアップに入れた名前（多くはメールアドレス）で、
  // 名乗るつもりのないものが画面に出てしまう。表示する名前はペンネームに一本化してあり
  // （`src/ui/hooks/use-pen-name.ts`）、ヘッダの `AccountName` が隣に出す。
  return <UserButton />
}
