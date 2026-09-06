-- 0010_oauth: 自前の認可サーバー（OAuth 2.1）の置き場。
--
-- なぜ要るか（docs/requirement/10-mcp-oauth.md §4・案3）: Clerk を認可サーバーに据えていた間、
-- **ChatGPT と Clerk の間で何が起きているかが誰にも見えなかった**。認可・同意・トークン発行を
-- こちらへ寄せると、全部が Cloudflare のログに出る。Clerk は身元確認だけに退く。
--
-- 決めごと:
--   * 秘密（コード・トークン）は**平文を持たない**。SHA-256 のハッシュだけ（mcp_tokens と同じ）。
--   * 期限切れの掃除は cron を増やさず、トークン発行のたびに同じ経路でまとめて消す。
--   * 既存の `mcp_tokens`（長期トークン）と Clerk 発行トークンは**そのまま生かす**。
--     ここに足すのは 3 つ目の系統で、置き換えではない（CLAUDE.md「後方互換性」）。

-- 動的登録（RFC 7591）で受け付けたクライアント。公開クライアントのみ＝secret は持たない。
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT    PRIMARY KEY,
  client_name   TEXT,
  client_uri    TEXT,
  -- 登録された戻り先。JSON 配列。照合は**完全一致**（前方一致もワイルドカードも作らない）。
  redirect_uris TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);

-- authorize から同意画面へ渡す一時レコード。rid だけを URL に載せ、値そのものは運ばない
-- （画面へ渡した値をクライアントが書き換えられない）。
CREATE TABLE IF NOT EXISTS oauth_requests (
  rid            TEXT    PRIMARY KEY,
  client_id      TEXT    NOT NULL,
  redirect_uri   TEXT    NOT NULL,
  state          TEXT,
  scope          TEXT    NOT NULL,
  resource       TEXT,
  code_challenge TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);

-- 認可コード。1 回限り（交換時に削除）・短命。平文は保存しない。
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT    PRIMARY KEY,
  user_id        TEXT    NOT NULL,
  client_id      TEXT    NOT NULL,
  redirect_uri   TEXT    NOT NULL,
  scope          TEXT    NOT NULL,
  resource       TEXT,
  code_challenge TEXT    NOT NULL,
  expires_at     INTEGER NOT NULL
);

-- アクセス／リフレッシュトークン。kind で分ける。回転の追跡に parent_hash を持つ。
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash  TEXT    PRIMARY KEY,
  kind        TEXT    NOT NULL,          -- 'access' | 'refresh'
  user_id     TEXT    NOT NULL,
  client_id   TEXT    NOT NULL,
  scope       TEXT    NOT NULL,
  resource    TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  parent_hash TEXT
);

-- 失効（利用者が接続を切る／退会）を user_id で引けるように。
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens (user_id);
-- 期限切れの掃除を範囲で引けるように。
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_exp ON oauth_tokens (expires_at);
