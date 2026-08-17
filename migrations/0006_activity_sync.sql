-- 0006_activity_sync: 執筆の記録（日別活動集計）の同期。
-- ユーザー×日付ごとに「書いた文字数（追加・削除）と保存回数」を 1 行持つ。
-- 原稿の内容を含まないカウンタのみなので R2 の暗号化 blob ではなく D1 に平文で置き、
-- サーバ側で日付ごとに max マージする（カウンタは単調増加＝衝突が原理的に起きない）。
-- net（added - removed）は導出値のため保存しない（クライアントが再計算する）。
CREATE TABLE IF NOT EXISTS activity (
  user_id    TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  added      INTEGER NOT NULL DEFAULT 0,
  removed    INTEGER NOT NULL DEFAULT 0,
  saves      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
