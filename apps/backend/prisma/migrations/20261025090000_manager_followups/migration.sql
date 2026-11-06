-- Manager follow-ups extension (prepared, awaiting EXPLICIT owner approval).
-- Additive only: nullable columns, one appended enum value, one new audit
-- table. No existing row is rewritten, no schedule/history/due date changes.

-- FollowUpSubject: the responsible user may now be a MANAGER (resolved from
-- the real `Property.createdByUserId` / manager-registered `Client` facts).
-- Employee rows keep `responsibleId` and leave `responsibleUserId` null, so
-- every employee-scope query keeps the exact same results.
ALTER TABLE "FollowUpSubject" ADD COLUMN "responsibleUserId" UUID;
ALTER TABLE "FollowUpSubject" ALTER COLUMN "responsibleId" DROP NOT NULL;

-- Exactly ONE responsible side is ever set (app invariant mirrored in SQL).
-- (Plain CHECK — validation happens per statement, and the app transfers
-- responsibility with ONE statement that both columns at once.)
ALTER TABLE "FollowUpSubject" ADD CONSTRAINT "FollowUpSubject_responsible_exactly_one"
  CHECK ((("responsibleId" IS NOT NULL)::int + ("responsibleUserId" IS NOT NULL)::int) = 1);

-- ForeignKey: responsibleUserId → User
ALTER TABLE "FollowUpSubject" ADD CONSTRAINT "FollowUpSubject_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes (Prisma default index names, so schema and database stay in step).
CREATE INDEX "FollowUpSubject_responsibleUserId_active_nextDueAt_idx"
  ON "FollowUpSubject"("responsibleUserId", "active", "nextDueAt");

-- FollowUpEntry: a MANAGER author is recorded at the USER level (managers
-- have no EmployeeProfile). Employee rows remain authorId-scoped, so the
-- existing `(authorId, batchId, subjectId)` idempotency does not change.
ALTER TABLE "FollowUpEntry" ADD COLUMN "authorUserId" UUID;
ALTER TABLE "FollowUpEntry" ALTER COLUMN "authorId" DROP NOT NULL;

ALTER TABLE "FollowUpEntry" ADD CONSTRAINT "FollowUpEntry_author_exactly_one"
  CHECK ((("authorId" IS NOT NULL)::int + ("authorUserId" IS NOT NULL)::int) = 1);

ALTER TABLE "FollowUpEntry" ADD CONSTRAINT "FollowUpEntry_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Manager-batch replay idempotency: PostgreSQL treats NULLs as distinct in
-- unique indexes by default, and employee rows carry `authorUserId = NULL`,
-- so this index only bites manager rows (always both parts non-null).
CREATE UNIQUE INDEX "FollowUpEntry_authorUserId_batchId_subjectId_key"
  ON "FollowUpEntry"("authorUserId", "batchId", "subjectId");

-- Client attribution at the USER level for manager-registered clients with
-- no responsible employee (same dual-link precedent as Property).
ALTER TABLE "Client" ADD COLUMN "createdByUserId" UUID;
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Client_createdByUserId_idx" ON "Client"("createdByUserId");

-- The manual-reminder notification event, appended at the enum's tail (the
-- project convention; PostgreSQL ≥ 12 allows ADD VALUE inside a transaction
-- as long as the value is not used in that same transaction).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLLOWUP_EMPLOYEE_REMINDER';

-- Reminder audit table: the persistent, database-guaranteed cooldown record.
CREATE TABLE "FollowUpReminder" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpReminder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "FollowUpSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpReminder" ADD CONSTRAINT "FollowUpReminder_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FollowUpReminder_eventKey_key" ON "FollowUpReminder"("eventKey");
CREATE INDEX "FollowUpReminder_subjectId_sentAt_idx" ON "FollowUpReminder"("subjectId", "sentAt");
