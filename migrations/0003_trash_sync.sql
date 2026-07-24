-- 0003_trash_sync: ゴミ箱状態を同期（共有ゴミ箱）。
-- works に trashed_at を追加し、状態を active / trashed / purged の3つで表す:
--   active : trashed_at = 0, deleted = 0（blob あり）
--   trashed: trashed_at > 0, deleted = 0（blob 保持＝どの端末からでも復元可・30日 grace）
--   purged : deleted = 1（blob 削除・トゥームストーン）
-- 削除（ゴミ箱）を端末間で伝播させ、「別端末で削除→pull で復活」「各端末でゴミ箱が増殖」を解消する
-- （D-SYNC-TOMBSTONE 改）。updated_at が LWW の時計（編集・trash・restore で更新）。
ALTER TABLE works ADD COLUMN trashed_at INTEGER NOT NULL DEFAULT 0;

-- ゴミ箱の一覧・TTL 判定用（user 単位で trashed を引く）。
CREATE INDEX IF NOT EXISTS idx_works_trashed ON works (user_id, trashed_at);
