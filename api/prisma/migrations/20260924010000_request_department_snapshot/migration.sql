-- The request form no longer asks for สาขาวิชา (the sign-up already collects it).
-- Keep what the requester wrote next to the request, so the CPRU-RDI-F011 memo
-- prints the real subject area rather than the placeholder department row.
ALTER TABLE "requests" ADD COLUMN "department_name" VARCHAR(255);

-- Existing requests: fall back to the department row they were filed against.
UPDATE "requests" r
   SET "department_name" = d."name_th"
  FROM "departments" d
 WHERE d."id" = r."department_id" AND r."department_name" IS NULL;
