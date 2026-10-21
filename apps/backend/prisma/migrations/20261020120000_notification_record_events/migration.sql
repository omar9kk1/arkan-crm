-- Arkan CRM — Employee record-activity notifications (ADDITIVE / NON-DESTRUCTIVE).
--
-- This is the smallest change the manager-activity-notification feature needs:
--   * six new values appended to the "NotificationType" enum;
--   * one nullable "contactId" reference on "Notification" for modern Owner/
--     Broker contact cards (the legacy "ownerId" column is left untouched and
--     keeps pointing at the retired "Owner" model — it is never written again).
--
-- No column is dropped or renamed, no row is read, moved or deleted, and no
-- existing notification changes shape: every row already carries `eventKey`
-- NULL-able and the new reference is NULL-able, so legacy rows are exactly as
-- they were before this migration.
--
-- `ALTER TYPE ... ADD VALUE` appends the values in the order written below,
-- matching the schema declaration order so no future diff drifts.

ALTER TABLE "Notification" ADD COLUMN "contactId" UUID;

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_INTEREST_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTACT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTACT_UPDATED';

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
