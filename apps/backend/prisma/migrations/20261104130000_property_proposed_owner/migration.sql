-- Provisional owner staging for employee property submissions.
-- The value is a small JSON document { type, name, phone, notes } and is
-- promoted into an official Contact only when a Manager approves the property.
--
-- Forward migration. Reversible:
--   ALTER TABLE "Property" DROP COLUMN "proposedOwner";
ALTER TABLE "Property" ADD COLUMN "proposedOwner" JSONB;
