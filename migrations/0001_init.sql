-- 0001_init: 単一アクティブセッション（同期 Phase 1）。
-- 各ユーザーにつき有効なセッションは最大 1 つ。
-- 新しい端末がログインすると session_token を回転し、旧端末のトークンを無効化する。
-- 同期本体の works / blobs テーブルは Phase 2 の 0002_*.sql で追加する。
CREATE TABLE IF NOT EXISTS sessions (
  user_id       TEXT    PRIMARY KEY,
  session_token TEXT    NOT NULL,
  rotated_at    INTEGER NOT NULL
);
