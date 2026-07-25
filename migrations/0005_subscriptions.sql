-- 0005_subscriptions: Stripe 直課金（JPY）のサブスク状態を D1 にミラーする。
-- Clerk Billing（USD 固定）から Stripe 直課金へ移行するにあたり、会員判定の「単一の真実」を
-- Clerk の JWT クレーム（has({plan})）から、この D1 テーブルへ移す。Stripe webhook が更新し、
-- サーバー（verifyMember / MCP）とクライアント（/api/billing/status）が参照する。
--   status      : Stripe の subscription.status（active / trialing / canceled / past_due ...）。
--                 会員＝status が active/trialing の行が存在すること（isActiveMember）。
--   grace_until : 失効時に now+30日 を入れる。>0 の行は、その時刻以降に reaper がクラウドデータを
--                 削除する（ログインは残す＝猶予期間つき削除）。0 は削除予定なし。
--   時刻はすべて epoch ms（Date.now()）。
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                TEXT    PRIMARY KEY,          -- Clerk userId
  stripe_customer_id     TEXT    NOT NULL,
  stripe_subscription_id TEXT,
  status                 TEXT    NOT NULL,
  price_id               TEXT,
  current_period_end     INTEGER NOT NULL DEFAULT 0,
  grace_until            INTEGER NOT NULL DEFAULT 0,
  updated_at             INTEGER NOT NULL
);

-- webhook は customer_id から userId を逆引きする（metadata が無いイベント用のフォールバック）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_customer ON subscriptions (stripe_customer_id);
-- reaper は grace_until で「削除予定の行」を走査する。
CREATE INDEX IF NOT EXISTS idx_sub_grace ON subscriptions (grace_until);
