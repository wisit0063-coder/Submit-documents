-- Handing a position account to its next holder.
--
-- Accounts for the signing steps belong to the post, not to the person: when a
-- director's term ends the account is passed on rather than replaced, because
-- the claims waiting at that step are found by role and unit, so a fresh
-- account would leave them stranded (CLAUDE.md ข้อ 19).
--
-- Two things were missing for that to work.
--
-- 1. No way for an administrator to set another account's password. The three
--    existing paths are account creation, the emailed reset link, and changing
--    your own - and the address on a position account is one the office makes
--    up, with no mailbox behind it, so the reset link goes nowhere. Handover
--    could only be done by asking the departing holder to set the new password,
--    which assumes they are still around and still trusted.
--
-- 2. Changing a password did not end sessions already open. authenticate()
--    reloads the account on every request but only refuses inactive ones, so
--    the previous holder's browser kept working for up to JWT_EXPIRES_IN.
--    password_changed_at closes that window.

-- Null means "never tracked": existing sessions keep working, and the column
-- starts being written the first time each account's password changes.
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);

CREATE TYPE "PositionAccountAction" AS ENUM ('HANDOVER', 'PASSWORD_RESET');

-- Evidence, on the same footing as request_status_logs and budget_year_logs:
-- written in the same transaction as the change, and with no way to delete a
-- row. A password is a signature here, so who was given the ability to sign for
-- a post, by whom and why, has to be answerable years later.
CREATE TABLE "position_handover_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "action" "PositionAccountAction" NOT NULL,
    "actor_id" BIGINT,
    -- Names as they stood at the time, never joined live: the whole point of
    -- this table is that the account's own name is about to be overwritten.
    "actor_name" VARCHAR(255) NOT NULL,
    "previous_holder" VARCHAR(255) NOT NULL,
    "new_holder" VARCHAR(255) NOT NULL,
    "previous_position" VARCHAR(150),
    "new_position" VARCHAR(150),
    -- Which steps the account could sign for at the time, as plain text, so the
    -- row still reads correctly after its roles are changed.
    "roles_snapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_handover_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "position_handover_logs_user_id_created_at_idx"
  ON "position_handover_logs"("user_id", "created_at");

ALTER TABLE "position_handover_logs"
  ADD CONSTRAINT "position_handover_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "position_handover_logs"
  ADD CONSTRAINT "position_handover_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
