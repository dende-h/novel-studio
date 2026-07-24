-- 0002_sync_works: Work 同期本体（Phase 2）。
-- 各ユーザーの Work ごとに同期メタを 1 行持つ。実体（本文 doc・画像 media）は R2 に
-- gzip→AES-GCM で保存し、ここにはキー・ハッシュ・サイズだけを置く。
-- deleted=1 は purge 済みのトゥームストーン（他端末に削除を伝播するため行は残す）。
CREATE TABLE IF NOT EXISTS works (
  user_id    TEXT    NOT NULL,
  work_id    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  doc_key    TEXT    NOT NULL,
  doc_hash   TEXT    NOT NULL,
  doc_size   INTEGER NOT NULL DEFAULT 0,
  media_key  TEXT,
  media_hash TEXT    NOT NULL DEFAULT '',
  media_size INTEGER NOT NULL DEFAULT 0,
  synced_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_id)
);

CREATE INDEX IF NOT EXISTS idx_works_user ON works (user_id);

-- 簡易レート制限（60 req/min/user）。autosave coalesce があるので素朴な分カウンタで足りる。
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id      TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
