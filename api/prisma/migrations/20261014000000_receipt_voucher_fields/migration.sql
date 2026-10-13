-- The receipt voucher (ใบสำคัญรับเงิน) that the claimant signs quotes two
-- things the system never stored: the electronic ISSN alongside the printed
-- one, and the coverage a journal prints on its cover ("พฤษภาคม-สิงหาคม 2569"),
-- which most TCI journals issue per half-year.
--
-- Both are nullable and display-only. In particular issue_period must not be
-- used to decide the December grace period - that stays on published_at
-- (CLAUDE.md section 6), because moving it would change who gets paid.

ALTER TABLE "requests" ADD COLUMN "issn_electronic" VARCHAR(20);
ALTER TABLE "requests" ADD COLUMN "issue_period" VARCHAR(120);
