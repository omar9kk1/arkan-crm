-- CreateEnum
CREATE TYPE "FollowUpSubjectKind" AS ENUM ('PROPERTY_OWNER', 'CLIENT_REQUEST', 'INQUIRY', 'CLIENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FOLLOWUP_EMPLOYEE_LATE';
ALTER TYPE "NotificationType" ADD VALUE 'FOLLOWUP_MANAGER_ESCALATION';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "followUpSubjectId" UUID;

-- CreateTable
CREATE TABLE "FollowUpSubject" (
    "id" UUID NOT NULL,
    "targetKey" TEXT NOT NULL,
    "kind" "FollowUpSubjectKind" NOT NULL,
    "responsibleId" UUID NOT NULL,
    "propertyId" UUID,
    "clientId" UUID,
    "interestId" UUID,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "lastSavedAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "employeeWarnedCycle" INTEGER NOT NULL DEFAULT 0,
    "managerEscalatedCycle" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEntry" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "batchId" UUID,
    "prevDueAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSubject_targetKey_key" ON "FollowUpSubject"("targetKey");

-- CreateIndex
CREATE INDEX "FollowUpSubject_responsibleId_active_nextDueAt_idx" ON "FollowUpSubject"("responsibleId", "active", "nextDueAt");

-- CreateIndex
CREATE INDEX "FollowUpSubject_active_kind_idx" ON "FollowUpSubject"("active", "kind");

-- CreateIndex
CREATE INDEX "FollowUpEntry_subjectId_createdAt_idx" ON "FollowUpEntry"("subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpEntry_authorId_batchId_subjectId_key" ON "FollowUpEntry"("authorId", "batchId", "subjectId");

-- AddForeignKey
ALTER TABLE "FollowUpSubject" ADD CONSTRAINT "FollowUpSubject_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSubject" ADD CONSTRAINT "FollowUpSubject_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSubject" ADD CONSTRAINT "FollowUpSubject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEntry" ADD CONSTRAINT "FollowUpEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "FollowUpSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEntry" ADD CONSTRAINT "FollowUpEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "EmployeeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_followUpSubjectId_fkey" FOREIGN KEY ("followUpSubjectId") REFERENCES "FollowUpSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
