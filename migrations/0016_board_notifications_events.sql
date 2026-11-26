-- Apply after the existing board schema and post likes. Existing posts are
-- deliberately not backfilled: notification history starts at opt-in.
CREATE TABLE board_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  post_id TEXT UNIQUE,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('thread', 'reply', 'event_rescheduled', 'event_cancelled')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_board_activity_recent ON board_activity (created_at, id);
CREATE INDEX idx_board_activity_thread ON board_activity (thread_id, post_id, id DESC);

CREATE TABLE board_notification_state (
  user_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'related', 'off')),
  enabled_after INTEGER NOT NULL DEFAULT 0,
  read_through INTEGER NOT NULL DEFAULT 0,
  silent_until INTEGER
);
CREATE TABLE board_thread_reads (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  post_through INTEGER NOT NULL DEFAULT 0,
  event_through INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE board_events (
  thread_id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL CHECK (starts_at < ends_at),
  cancelled_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE (host_id, request_id)
);
CREATE INDEX idx_board_events_start ON board_events (starts_at, thread_id);
CREATE INDEX idx_board_events_end ON board_events (ends_at, thread_id);

CREATE TABLE board_event_participants (
  id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  joined_after INTEGER NOT NULL,
  work_url TEXT,
  withdrawn_at INTEGER,
  hidden_at INTEGER NOT NULL DEFAULT 0,
  link_hidden_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX idx_board_event_participants_active
  ON board_event_participants (thread_id, withdrawn_at, hidden_at, joined_at, id);
CREATE INDEX idx_board_event_participants_user ON board_event_participants (user_id, withdrawn_at);
CREATE INDEX idx_board_posts_relation ON board_posts (thread_id, user_id, seq);

-- Existing post writers and retries share this transaction automatically.
CREATE TRIGGER board_record_post_activity AFTER INSERT ON board_posts
BEGIN
  INSERT INTO board_activity (thread_id, post_id, actor_id, kind, created_at)
  VALUES (NEW.thread_id, NEW.id, NEW.user_id, CASE NEW.seq WHEN 1 THEN 'thread' ELSE 'reply' END, NEW.created_at);
END;

CREATE TRIGGER board_record_event_activity AFTER UPDATE OF starts_at, ends_at, cancelled_at ON board_events
WHEN OLD.cancelled_at IS NULL AND (
  NEW.cancelled_at IS NOT NULL OR OLD.starts_at <> NEW.starts_at OR OLD.ends_at <> NEW.ends_at
)
BEGIN
  INSERT INTO board_activity (thread_id, actor_id, kind, created_at)
  VALUES (NEW.thread_id, NEW.updated_by,
    CASE WHEN NEW.cancelled_at IS NULL THEN 'event_rescheduled' ELSE 'event_cancelled' END, NEW.updated_at);
END;

ALTER TABLE board_reports ADD COLUMN participant_id TEXT;
ALTER TABLE board_reports ADD COLUMN reported_work_url TEXT;
CREATE INDEX idx_board_reports_participant ON board_reports (participant_id);



-- Physical thread purges are operational. Delete the accompanying feature data
-- when that path is used, without changing normal soft-deletion/moderation.
CREATE TRIGGER board_purge_participants AFTER DELETE ON board_threads
BEGIN
  DELETE FROM board_event_participants WHERE thread_id = OLD.id;
END;
CREATE TRIGGER board_purge_event AFTER DELETE ON board_threads
BEGIN
  DELETE FROM board_events WHERE thread_id = OLD.id;
END;
CREATE TRIGGER board_purge_thread_reads AFTER DELETE ON board_threads
BEGIN
  DELETE FROM board_thread_reads WHERE thread_id = OLD.id;
END;
CREATE TRIGGER board_purge_activity AFTER DELETE ON board_threads
BEGIN
  DELETE FROM board_activity WHERE thread_id = OLD.id;
END;
