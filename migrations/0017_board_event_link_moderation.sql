-- Keep link moderation keyed by the canonical URL so removing, rejoining or
-- resending the same URL cannot clear a staff decision.
CREATE TABLE board_event_hidden_links (
  participant_id TEXT NOT NULL REFERENCES board_event_participants(id) ON DELETE CASCADE,
  work_url TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (participant_id, work_url)
);

INSERT INTO board_event_hidden_links (participant_id, work_url, hidden_at)
SELECT id, work_url, link_hidden_at FROM board_event_participants
WHERE work_url IS NOT NULL AND link_hidden_at > 0;



-- Pages may still be running the previous release while this migration is applied.
CREATE TRIGGER board_preserve_legacy_link_moderation
AFTER UPDATE OF link_hidden_at ON board_event_participants
WHEN NEW.work_url IS NOT NULL AND NEW.link_hidden_at <> OLD.link_hidden_at
BEGIN
  INSERT INTO board_event_hidden_links (participant_id, work_url, hidden_at)
  VALUES (NEW.id, NEW.work_url, NEW.link_hidden_at)
  ON CONFLICT (participant_id, work_url) DO UPDATE SET hidden_at = excluded.hidden_at;
END;
