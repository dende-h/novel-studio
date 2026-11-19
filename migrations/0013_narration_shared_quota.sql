-- Keep the character totals for older clients and track the second unit of each
-- Drama 3 character separately. Trial and preview keep their own original units.
ALTER TABLE narration_budgets ADD COLUMN unit_quota INTEGER;
ALTER TABLE narration_budgets ADD COLUMN extra_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE narration_budgets ADD COLUMN extra_reserved INTEGER NOT NULL DEFAULT 0;

WITH previous_drama AS (
 SELECT j.user_id, j.period,
        SUM(CASE WHEN t.state = 'ready' THEN t.characters ELSE 0 END) AS used,
        SUM(CASE WHEN t.state IN ('queued','generating','unknown') THEN t.characters ELSE 0 END) AS reserved
 FROM narration_takes t JOIN narration_jobs j ON j.id = t.job_id
 WHERE t.model = 'drama-3'
   AND j.period <> 'trial' AND j.period NOT LIKE 'staff:%:trial' AND j.period NOT LIKE 'preview:%'
 GROUP BY j.user_id, j.period
)
UPDATE narration_budgets AS budget
 SET extra_used = previous_drama.used, extra_reserved = previous_drama.reserved
 FROM previous_drama
 WHERE budget.user_id = previous_drama.user_id AND budget.period = previous_drama.period;

DROP TRIGGER narration_reserve;
CREATE TRIGGER narration_reserve AFTER INSERT ON narration_takes BEGIN
 UPDATE narration_budgets SET reserved = reserved + NEW.characters,
 extra_reserved = extra_reserved + CASE
   WHEN NEW.model = 'drama-3' AND period <> 'trial'
        AND period NOT LIKE 'staff:%:trial' AND period NOT LIKE 'preview:%'
   THEN NEW.characters ELSE 0 END
 WHERE (user_id,period) = (SELECT user_id,period FROM narration_jobs WHERE id = NEW.job_id)
 AND CASE WHEN unit_quota IS NULL THEN used + reserved + NEW.characters <= quota
     ELSE used + reserved + extra_used + extra_reserved + NEW.characters + CASE
       WHEN NEW.model = 'drama-3' AND period <> 'trial'
            AND period NOT LIKE 'staff:%:trial' AND period NOT LIKE 'preview:%'
       THEN NEW.characters ELSE 0 END <= unit_quota END;
 SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT,'narration_quota_exceeded') END;
END;

DROP TRIGGER narration_settle;
CREATE TRIGGER narration_settle AFTER UPDATE OF state ON narration_takes
WHEN OLD.state IN ('queued','generating','unknown') AND NEW.state IN ('ready','failed','canceled') BEGIN
 UPDATE narration_budgets SET reserved = reserved - NEW.characters,
 used = used + CASE WHEN NEW.state = 'ready' THEN NEW.characters ELSE 0 END,
 extra_reserved = extra_reserved - CASE
   WHEN NEW.model = 'drama-3' AND period <> 'trial'
        AND period NOT LIKE 'staff:%:trial' AND period NOT LIKE 'preview:%'
   THEN NEW.characters ELSE 0 END,
 extra_used = extra_used + CASE
   WHEN NEW.state = 'ready' AND NEW.model = 'drama-3' AND period <> 'trial'
        AND period NOT LIKE 'staff:%:trial' AND period NOT LIKE 'preview:%'
   THEN NEW.characters ELSE 0 END
 WHERE (user_id,period) = (SELECT user_id,period FROM narration_jobs WHERE id = NEW.job_id);
END;
