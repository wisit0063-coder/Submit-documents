-- Display order for units, chosen by the owner (CLAUDE.md 13.2).
-- Alphabetical order by code put the offices first in an arbitrary order.
ALTER TABLE "faculties" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 100;

UPDATE "faculties" SET "sort_order" = 1 WHERE "code" = 'ACAD';
UPDATE "faculties" SET "sort_order" = 2 WHERE "code" = 'PRES';
UPDATE "faculties" SET "sort_order" = 3 WHERE "code" = 'INTERNAL';
UPDATE "faculties" SET "sort_order" = 4 WHERE "code" = 'LAS';
UPDATE "faculties" SET "sort_order" = 5 WHERE "code" = 'EDU';
UPDATE "faculties" SET "sort_order" = 6 WHERE "code" = 'NUR';

-- Renamed by the owner 24 Sep 2026: the unit is the internal audit office, not
-- a catch-all for internal units.
UPDATE "faculties" SET "name_th" = 'หน่วยตรวจสอบภายใน', "name_en" = 'Internal Audit Unit'
  WHERE "code" = 'INTERNAL';
