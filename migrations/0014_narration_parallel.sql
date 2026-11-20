ALTER TABLE narration_takes ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE narration_takes ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX narration_takes_in_flight ON narration_takes(started_at) WHERE state='generating';
