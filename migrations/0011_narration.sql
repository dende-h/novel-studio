-- Private narration jobs, with atomic quota accounting on every state transition.
CREATE TABLE IF NOT EXISTS narration_budgets (
 user_id TEXT NOT NULL, period TEXT NOT NULL, quota INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0,
 reserved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,period)
);
CREATE TABLE IF NOT EXISTS narration_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, work_id TEXT NOT NULL, period TEXT NOT NULL,
 request_hash TEXT NOT NULL, dispatch_token TEXT NOT NULL, created_at INTEGER NOT NULL,
 snapshot_removed INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS narration_takes (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES narration_jobs(id), segment_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', characters INTEGER NOT NULL,
 input_bytes INTEGER NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL,
 started_at INTEGER, expires_at INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS narration_jobs_owner ON narration_jobs(user_id,work_id);
CREATE INDEX IF NOT EXISTS narration_takes_job ON narration_takes(job_id,state);
CREATE TABLE IF NOT EXISTS narration_lock (id INTEGER PRIMARY KEY CHECK(id=1), take_id TEXT, until_ms INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO narration_lock(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS narration_reserve AFTER INSERT ON narration_takes BEGIN
 UPDATE narration_budgets SET reserved=reserved+NEW.characters
 WHERE (user_id,period)=(SELECT user_id,period FROM narration_jobs WHERE id=NEW.job_id)
 AND used+reserved+NEW.characters<=quota;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'narration_quota_exceeded') END;
END;
CREATE TRIGGER IF NOT EXISTS narration_settle AFTER UPDATE OF state ON narration_takes
WHEN OLD.state IN ('queued','generating','unknown') AND NEW.state IN ('ready','failed','canceled') BEGIN
 UPDATE narration_budgets SET reserved=reserved-NEW.characters,
 used=used+CASE WHEN NEW.state='ready' THEN NEW.characters ELSE 0 END
 WHERE (user_id,period)=(SELECT user_id,period FROM narration_jobs WHERE id=NEW.job_id);
END;

-- Conservative daily provider-input budget, including failed/unknown attempts.
CREATE TABLE IF NOT EXISTS narration_daily(day INTEGER PRIMARY KEY,byte_limit INTEGER NOT NULL,bytes INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS narration_daily_reserve AFTER INSERT ON narration_takes BEGIN
 UPDATE narration_daily SET bytes=bytes+NEW.input_bytes
 WHERE day=CAST(NEW.created_at/86400000 AS INTEGER) AND bytes+NEW.input_bytes<=byte_limit;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'narration_daily_limit') END;
END;
