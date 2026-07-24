-- 0004_mcp_tokens: AI・MCP アクセス（read-only リモート MCP）用のユーザートークン。
-- ユーザーごとに 1 つ。トークン平文は保存せず SHA-256 ハッシュのみ持つ（表示は発行時一度きり）。
-- MCP エンドポイントは受け取ったトークンをハッシュ化して token_hash から user_id を解決する。
CREATE TABLE IF NOT EXISTS mcp_tokens (
  user_id    TEXT    PRIMARY KEY,
  token_hash TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_token_hash ON mcp_tokens (token_hash);
