-- Property Trash + permanent deep-delete tombstone.
-- Forward migration (applies cleanly on top of 20261030112154_priority_notification_type).

-- AlterTable: soft-delete markers (NULL deletedAt = active property).
ALTER TABLE "Property"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" UUID,
  ADD COLUMN "deletionReason" TEXT;

-- CreateTable: minimal tombstone that permanently reserves the property code
-- and records the permanent deletion without retaining house/owner details.
CREATE TABLE "PropertyTombstone" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "deletedByUserId" UUID,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" JSONB,

    CONSTRAINT "PropertyTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyTombstone_reference_key" ON "PropertyTombstone"("reference");
CREATE INDEX "PropertyTombstone_deletedAt_idx" ON "PropertyTombstone"("deletedAt");
CREATE INDEX "Property_deletedAt_idx" ON "Property"("deletedAt");

-- AddForeignKey
ALTER TABLE "Property"
  ADD CONSTRAINT "Property_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PropertyTombstone"
  ADD CONSTRAINT "PropertyTombstone_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Manual rollback (reversible):
-- ALTER TABLE "PropertyTombstone" DROP CONSTRAINT "PropertyTombstone_deletedByUserId_fkey";
-- ALTER TABLE "Property" DROP CONSTRAINT "Property_deletedByUserId_fkey";
-- DROP INDEX "Property_deletedAt_idx";
-- DROP TABLE "PropertyTombstone";
-- ALTER TABLE "Property" DROP COLUMN "deletionReason", DROP COLUMN "deletedByUserId", DROP COLUMN "deletedAt";
-- ---------------------------------------------------------------------------
