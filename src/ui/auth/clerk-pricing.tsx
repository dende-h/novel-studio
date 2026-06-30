import { PricingTable } from '@clerk/clerk-react'

/**
 * Clerk Billing の料金表（月額 ¥500／年額 ¥4,800・プラン定義はダッシュボード＝Slice F）。
 *
 * `@clerk/clerk-react` を含むため main バンドルから切り離し、`UpgradeDialog` から lazy import する
 * （ゲストに Clerk SDK をダウンロードさせない＝`auth-provider` の ClerkGate と同じ方針）。
 * 描画されるのは ClerkProvider 配下（＝サインイン済みユーザー）に限られる。
 * 課金成立で Clerk セッションに plan クレームが入り、`deriveStatus` が member へ遷移する。
 */
export default function ClerkPricing() {
  return <PricingTable />
}
