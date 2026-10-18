-- Arkan CRM — In-app notification events (ADDITIVE / NON-DESTRUCTIVE).
--
-- Reviewed before applying. This migration only ATTACHES the notification event
-- metadata to the pre-existing "Notification" table:
--   * adds the "NotificationType" enum;
--   * adds "type" (defaulted to 'SYSTEM' so an existing row is never left
--     without a value) and the nullable deduplication key "eventKey";
--   * adds a per-recipient unique index on ("userId", "eventKey").
--
-- No existing column is dropped or renamed, no row is deleted and no data is
-- backfilled or invented. Verified before writing: all three earlier migrations
-- are applied to both the development and the isolated test database, and
-- "Notification" held 0 rows in both, so no historical notification is created
-- and no legacy row needs a synthesized "eventKey".
--
-- `eventKey` is NULLABLE on purpose: the unique index is a per-recipient
-- guarantee for the rows this feature writes (every writer always sets it),
-- while remaining a purely additive column that can never fail on a table that
-- already contains rows. In PostgreSQL NULLs are distinct, so any future row
-- that legitimately carries no deduplication key is unaffected.
--
-- Generated with `prisma migrate diff` from the project's own migration history
-- and schema so the on-disk schema cannot drift from `schema.prisma`.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PROPERTY_SUBMITTED', 'PROPERTY_CHANGES_REQUESTED', 'PROPERTY_REJECTED', 'PROPERTY_RESUBMITTED', 'PROPERTY_APPROVED', 'PROPERTY_AVAILABLE', 'SYSTEM');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "eventKey" TEXT,
ADD COLUMN     "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM';

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");
