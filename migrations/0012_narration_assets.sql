CREATE TABLE IF NOT EXISTS narration_assets (
 user_id TEXT NOT NULL,
 hash TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size > 0 AND size <= 8388608),
 ready INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, hash)
);
CREATE TRIGGER IF NOT EXISTS narration_assets_capacity
BEFORE INSERT ON narration_assets
WHEN NOT EXISTS (SELECT 1 FROM narration_assets WHERE user_id=NEW.user_id AND hash=NEW.hash)
 AND (SELECT COALESCE(SUM(size),0) FROM narration_assets WHERE user_id=NEW.user_id)+NEW.size > 5368709120
BEGIN SELECT RAISE(ABORT, 'narration_storage_full'); END;
