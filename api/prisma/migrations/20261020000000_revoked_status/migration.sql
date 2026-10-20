-- A claim revoked after approval (CLAUDE.md ข้อ 26).
--
-- The research office's answer to a claim approved but never drawn, or found
-- ineligible afterwards (ประกาศ ข้อ ๕(๖)): the money returns to the fund and
-- the claimant's slot with it, the article stays barred. Adding an enum value
-- touches no existing row.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'REVOKED';
