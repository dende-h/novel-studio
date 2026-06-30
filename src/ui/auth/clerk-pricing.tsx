import { PricingTable } from '@clerk/clerk-react'

/**
 * Clerk Billing の料金表（月額 ¥500／年額 ¥4,800・プラン定義はダッシュボード＝Slice F）。
 *
 * `@clerk/clerk-react` を含むため main バンドルから切り離し、`UpgradeDialog` から lazy import する
 * （ゲストに Clerk SDK をダウンロードさせない＝`auth-provider` の ClerkGate と同じ方針）。
 * 描画されるのは ClerkProvider 配下（＝サインイン済みユーザー）に限られる。
 *
 * 課金成立 → `newSubscriptionRedirectUrl` で現在 URL へ再遷移（＝フルリロード）させ、新しい plan
 * クレーム入りの Clerk セッショントークンを取り直す。これをしないと発行済み JWT がクレーム更新まで
 * （最大トークン寿命ぶん）古いままで `has({ plan })` が偽に留まり、課金直後に member へ遷移せず同期も
 * 402 のままになる。リロード後に `deriveStatus` が member へ遷移し同期が起動する。
 */
export default function ClerkPricing() {
  return <PricingTable newSubscriptionRedirectUrl={window.location.href} />
}
