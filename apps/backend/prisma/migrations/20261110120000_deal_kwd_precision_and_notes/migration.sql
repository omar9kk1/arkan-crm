-- Deal KWD precision (fils, scale 3) + first-class Deal.notes.
--
-- The ALTER TYPE casts are exact numeric widenings: every existing
-- DECIMAL(14,2) value becomes the same value with a trailing zero
-- (e.g. 300000.50 -> 300000.500). No row is recreated or deleted.
ALTER TABLE "Deal" ALTER COLUMN "price" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "Deal" ALTER COLUMN "companyCommission" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "Deal" ADD COLUMN "notes" TEXT;
ALTER TABLE "Commission" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15, 3);

-- Preserve deal notes that the interim integration stored in the DEAL_CREATE
-- audit entry. The audit row itself is kept intact (it is the audit trail).
UPDATE "Deal" AS d
SET "notes" = src.notes
FROM (
  SELECT DISTINCT ON (a."entityId")
         a."entityId" AS deal_id,
         btrim(a."after"->>'notes') AS notes
  FROM "AuditLog" AS a
  WHERE a."entityType" = 'Deal'
    AND a."action" = 'DEAL_CREATE'
    AND a."after"->>'notes' IS NOT NULL
    AND btrim(a."after"->>'notes') <> ''
  ORDER BY a."entityId", a."createdAt" ASC
) AS src
WHERE d."id" = src.deal_id
  AND d."notes" IS NULL;
