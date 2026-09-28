-- Required creator IDs and commission roles have no invented defaults.
-- Existing rows in the three tables below require a reviewed, staged backfill
-- migration instead of this empty-table migration. Do not delete data to proceed.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Commission")
     OR EXISTS (SELECT 1 FROM "PayrollEntry")
     OR EXISTS (SELECT 1 FROM "FinanceMovement") THEN
    RAISE EXCEPTION 'MVP schema migration requires empty Commission, PayrollEntry and FinanceMovement tables. Prepare a staged backfill for createdById and commissionRole before deployment.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "CommissionRole" AS ENUM ('PROPERTY_EMPLOYEE', 'CLIENT_EMPLOYEE', 'MANUAL');

-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'LATE' BEFORE 'ABSENT';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "Owner" ADD COLUMN     "source" TEXT,
ADD COLUMN     "status" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "bathrooms" INTEGER,
ADD COLUMN     "bedrooms" INTEGER,
ADD COLUMN     "block" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "sizeSqm" DECIMAL(14,2),
ADD COLUMN     "street" TEXT;

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "commissionRole" "CommissionRole" NOT NULL,
ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "PayrollEntry" ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "FinanceMovement" ADD COLUMN     "createdById" UUID NOT NULL,
ADD COLUMN     "manualExpenseId" UUID;

-- CreateTable
CREATE TABLE "ManualExpense" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "propertyId" UUID,
    "createdById" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualExpense_reference_key" ON "ManualExpense"("reference");

-- CreateIndex
CREATE INDEX "ManualExpense_propertyId_idx" ON "ManualExpense"("propertyId");

-- CreateIndex
CREATE INDEX "ManualExpense_createdById_occurredAt_idx" ON "ManualExpense"("createdById", "occurredAt");

-- CreateIndex
CREATE INDEX "FinanceMovement_manualExpenseId_idx" ON "FinanceMovement"("manualExpenseId");

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualExpense" ADD CONSTRAINT "ManualExpense_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualExpense" ADD CONSTRAINT "ManualExpense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_manualExpenseId_fkey" FOREIGN KEY ("manualExpenseId") REFERENCES "ManualExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceMovement" ADD CONSTRAINT "FinanceMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve sourceType/sourceId and the optional manual-expense relationship.
-- A linked manual expense must match sourceId; other sources cannot carry it.
-- The existing FollowUp_exactly_one_target constraint remains unchanged.
ALTER TABLE "FinanceMovement"
DROP CONSTRAINT "FinanceMovement_source_matches_relation";

ALTER TABLE "FinanceMovement"
ADD CONSTRAINT "FinanceMovement_source_matches_relation"
CHECK (
  ("sourceType" = 'DEAL'
    AND "dealId" IS NOT NULL AND "sourceId" = "dealId"
    AND num_nonnulls("commissionId", "payrollEntryId", "manualExpenseId") = 0)
  OR ("sourceType" = 'COMMISSION'
    AND "commissionId" IS NOT NULL AND "sourceId" = "commissionId"
    AND num_nonnulls("dealId", "payrollEntryId", "manualExpenseId") = 0)
  OR ("sourceType" = 'PAYROLL'
    AND "payrollEntryId" IS NOT NULL AND "sourceId" = "payrollEntryId"
    AND num_nonnulls("dealId", "commissionId", "manualExpenseId") = 0)
  OR ("sourceType" = 'MANUAL_EXPENSE' AND "direction" = 'EXPENSE'
    AND num_nonnulls("dealId", "commissionId", "payrollEntryId") = 0
    AND ("manualExpenseId" IS NULL OR "sourceId" = "manualExpenseId"))
);

COMMIT;
