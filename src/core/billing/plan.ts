/**
 * 課金プランの slug（単一の真実）。Clerk Dashboard で作成するプランの slug と完全一致させる。
 * クライアント（`has({ plan: PLAN_KEY })` ＝ UX 出し分け）とサーバ（`toAuth().has({ plan: PLAN_KEY })`
 * ＝同期 API の強制力）の両方がこれを参照する。Stripe ↔ 自前 D1 のサブスク状態ミラーは持たず、
 * 会員判定は Clerk JWT クレームのみで行う（D-SYNC-PRICE）。
 *
 * Slice F でダッシュボードに実プランを作るまでの仮置き。実 slug に変えるのはここ 1 箇所だけ。
 */
export const PLAN_KEY = 'cloud'
