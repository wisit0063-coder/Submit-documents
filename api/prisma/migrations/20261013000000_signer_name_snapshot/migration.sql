-- Snapshot the signer's name on the three evidence tables.
--
-- These tables stand in for handwritten signatures (CLAUDE.md section 5 rule 6
-- and section 12), but they stored only the account id, and pdf.service.ts
-- composed the signer's name live at print time. Renaming an account - or
-- handing a position account to the next holder, which happens about every four
-- years - therefore rewrote who signed a memo years earlier. Same principle
-- already applied to requests.faculty_id, requests.department_name and
-- budget_year_logs.actor_name.

ALTER TABLE "request_approvals" ADD COLUMN "approver_name" VARCHAR(255);
ALTER TABLE "request_approvals" ADD COLUMN "approver_position" VARCHAR(150);
ALTER TABLE "request_status_logs" ADD COLUMN "actor_name" VARCHAR(255);
ALTER TABLE "payments" ADD COLUMN "recorded_by_name" VARCHAR(255);

-- Backfill from the accounts as they stand right now. This is an approximation,
-- not a recovery: rows written before this migration have no record of the name
-- used at the time. It is safe here because the system holds only test data so
-- far. From this point on the name is written in the same transaction as the
-- signature, so it can never drift again.
--
-- The expression matches how the application builds a display name:
-- `${prefix ?? ''}${firstName} ${lastName}`.

UPDATE "request_approvals" AS a
SET "approver_name" = TRIM(COALESCE(u."prefix", '') || u."first_name" || ' ' || u."last_name"),
    "approver_position" = u."academic_position"
FROM "users" AS u
WHERE a."approver_id" = u."id"
  AND a."approver_name" IS NULL;

UPDATE "request_status_logs" AS l
SET "actor_name" = TRIM(COALESCE(u."prefix", '') || u."first_name" || ' ' || u."last_name")
FROM "users" AS u
WHERE l."actor_id" = u."id"
  AND l."actor_name" IS NULL;

UPDATE "payments" AS p
SET "recorded_by_name" = TRIM(COALESCE(u."prefix", '') || u."first_name" || ' ' || u."last_name")
FROM "users" AS u
WHERE p."recorded_by" = u."id"
  AND p."recorded_by_name" IS NULL;
