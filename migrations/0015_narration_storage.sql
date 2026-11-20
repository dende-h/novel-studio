-- Current sync and restore points share the encrypted audio bytes, but only current
-- sync contributes to the normal storage quota.
ALTER TABLE works ADD COLUMN narration_indexed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE narration_assets ADD COLUMN storage_version TEXT;
ALTER TABLE narration_assets ADD COLUMN touched_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX narration_assets_cleanup ON narration_assets(ready,touched_at);

CREATE TABLE narration_asset_refs (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('current','archive','live')),
  ref_id TEXT NOT NULL,
  hashes TEXT NOT NULL CHECK(json_valid(hashes)),
  object_key TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,scope,ref_id)
);
CREATE INDEX narration_asset_refs_audit ON narration_asset_refs(checked_at) WHERE scope!='current';
CREATE INDEX narration_asset_refs_object ON narration_asset_refs(user_id,object_key) WHERE scope!='current';

CREATE TABLE narration_storage_indexed (user_id TEXT PRIMARY KEY);

DROP TRIGGER IF EXISTS narration_assets_capacity;
CREATE TRIGGER narration_assets_pending_capacity
BEFORE INSERT ON narration_assets
WHEN NOT EXISTS (SELECT 1 FROM narration_assets WHERE user_id=NEW.user_id AND hash=NEW.hash)
 AND NEW.size + COALESCE((
  SELECT SUM(a.size) FROM narration_assets a WHERE a.user_id=NEW.user_id AND a.storage_version IS NOT NULL
    AND a.hash NOT IN (
      SELECT h.value FROM narration_asset_refs r, json_each(r.hashes) h WHERE r.user_id=NEW.user_id
    )
 ),0) > 5368709120
BEGIN SELECT RAISE(ABORT, 'narration_upload_capacity'); END;

CREATE TRIGGER narration_asset_refs_valid
BEFORE INSERT ON narration_asset_refs
WHEN EXISTS (
 SELECT 1 FROM json_each(NEW.hashes) h
 WHERE NOT EXISTS (
  SELECT 1 FROM narration_assets a WHERE a.user_id=NEW.user_id AND a.hash=h.value AND a.ready=1
 )
)
BEGIN SELECT RAISE(ABORT, 'narration_audio_missing'); END;

CREATE TRIGGER narration_current_capacity
BEFORE INSERT ON narration_asset_refs
WHEN NEW.scope='current' AND (
 SELECT COALESCE(SUM(a.size),0) FROM narration_assets a WHERE a.user_id=NEW.user_id AND a.hash IN (
  SELECT h.value FROM json_each(NEW.hashes) h
  UNION
  SELECT h.value FROM narration_asset_refs r, json_each(r.hashes) h
  WHERE r.user_id=NEW.user_id AND r.scope='current'
 )
) > 5368709120
BEGIN SELECT RAISE(ABORT, 'narration_storage_full'); END;

CREATE TRIGGER narration_current_remove_on_trash
AFTER UPDATE OF deleted ON works
WHEN NEW.deleted=1 AND NEW.work_id LIKE 'narration:%'
BEGIN
 DELETE FROM narration_asset_refs
 WHERE user_id=NEW.user_id AND scope='current' AND ref_id=NEW.work_id;
END;

-- Leave enough time for a restore or a concurrent upload that already read a prior manifest.
CREATE TRIGGER narration_audio_grace
AFTER DELETE ON narration_asset_refs
BEGIN
 UPDATE narration_assets SET touched_at=MAX(touched_at,unixepoch()*1000)
 WHERE user_id=OLD.user_id AND hash IN (SELECT value FROM json_each(OLD.hashes));
END;
