-- scripts/cleanup-fake-execs.sql
--
-- One-shot cleanup for executives that were auto-created from WhatsApp JIDs
-- (group JIDs "*@g.us", individual JIDs "*@s.whatsapp.net", or "Unknown").
--
-- Run AFTER deploying the fix branch so the bug doesn't re-introduce them.
--
-- Usage on the droplet:
--   docker compose exec db psql -U postgres -d sales_tracker -f /scripts/cleanup-fake-execs.sql
-- or, from an interactive psql:
--   \i /scripts/cleanup-fake-execs.sql
--
-- Idempotent: safe to run repeatedly.

BEGIN;

-- 1) Collect the fake exec IDs into a temp table for cascade operations.
CREATE TEMP TABLE _fake_execs AS
SELECT id, display_name
FROM   executives
WHERE  display_name LIKE '%@g.us'
   OR  display_name LIKE '%@s.whatsapp.net'
   OR  display_name LIKE '%@broadcast'
   OR  display_name LIKE '%@newsletter'
   OR  display_name = 'Unknown';

-- Show what we're about to delete so you can sanity-check before COMMIT.
\echo 'Fake executives about to be purged:'
SELECT id, display_name FROM _fake_execs ORDER BY display_name;

-- 2) Purge dependent rows first (no FK cascade configured).
DELETE FROM alerts WHERE executive_id IN (SELECT id FROM _fake_execs);
DELETE FROM visits WHERE executive_id IN (SELECT id FROM _fake_execs);

-- 3) Purge the fake execs themselves.
DELETE FROM executives WHERE id IN (SELECT id FROM _fake_execs);

-- 4) Show what remains.
\echo 'Remaining active executives:'
SELECT id, display_name, daily_target, active
FROM   executives
WHERE  active = TRUE
ORDER  BY display_name;

-- Inspect the output above. If it looks wrong, run ROLLBACK;
-- If it looks right, run COMMIT;
-- (Script intentionally does NOT auto-commit.)
