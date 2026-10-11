-- Audit trail for the fund ceiling.
--
-- budget_years.total_amount is the only money figure a person types in, and it
-- was editable with nothing recorded: the table carried created_at alone, so
-- there was no way to say who changed a ceiling, when, or what it had been.
-- Claims have request_status_logs standing in for signatures on paper; the
-- fund they draw from had no equivalent.

-- Existing rows get the current time; Prisma writes the column from here on.
ALTER TABLE "budget_years"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TYPE "BudgetYearAction" AS ENUM ('CREATE', 'UPDATE');

CREATE TABLE "budget_year_logs" (
    "id" BIGSERIAL NOT NULL,
    "budget_year_id" BIGINT NOT NULL,
    "action" "BudgetYearAction" NOT NULL,
    "actor_id" BIGINT,
    -- The name as it stood at the time: accounts get renamed and position
    -- accounts get handed on, and neither may rewrite history.
    "actor_name" VARCHAR(255) NOT NULL,
    "previous_amount" DECIMAL(14,2),
    "new_amount" DECIMAL(14,2),
    "previous_is_active" BOOLEAN,
    "new_is_active" BOOLEAN,
    "reason" TEXT,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_year_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "budget_year_logs_budget_year_id_created_at_idx"
  ON "budget_year_logs"("budget_year_id", "created_at");

ALTER TABLE "budget_year_logs"
  ADD CONSTRAINT "budget_year_logs_budget_year_id_fkey"
  FOREIGN KEY ("budget_year_id") REFERENCES "budget_years"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "budget_year_logs"
  ADD CONSTRAINT "budget_year_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
