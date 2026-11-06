-- P/A property numbering.
--
-- `Property.reference` becomes the SUBMISSION code (P-000001, ...). The official
-- A-code is stored in `approvedReference` and assigned only when a Manager
-- approves the property. Existing rows keep their `reference` untouched; legacy
-- approved A rows are displayed through `approvedReference ?? reference` and are
-- never rewritten by this migration.
--
-- The A sequence keeps using id = 1 (existing counter); the new independent P
-- sequence uses id = 2. The A allocator skips codes already present in either
-- `reference` or `approvedReference`, so legacy rows never collide.
ALTER TABLE "Property" ADD COLUMN "approvedReference" TEXT;

CREATE UNIQUE INDEX "Property_approvedReference_key" ON "Property"("approvedReference");

-- Seed the independent submission sequence. Existing value is preserved.
INSERT INTO "PropertyCodeSequence" ("id", "value") VALUES (2, 0)
ON CONFLICT ("id") DO NOTHING;

-- Manual rollback:
-- DROP INDEX "Property_approvedReference_key";
-- ALTER TABLE "Property" DROP COLUMN "approvedReference";
-- DELETE FROM "PropertyCodeSequence" WHERE "id" = 2;
