-- EMERGENCY ROLLBACK ONLY — reviewed separately, never applied automatically.
--
-- WARNING: reverting DECIMAL(15,3) to DECIMAL(14,2) ROUNDS any amount whose
-- third decimal (fils) is non-zero. Export and audit those rows first:
--
--   SELECT id, amount FROM "FinanceMovement" WHERE amount <> round(amount, 2);
--   SELECT id, amount FROM "ManualExpense" WHERE amount <> round(amount, 2);
--   SELECT id, "baseSalary", deductions, bonus, "netAmount"
--   FROM "PayrollEntry"
--   WHERE "baseSalary" <> round("baseSalary", 2)
--      OR deductions <> round(deductions, 2)
--      OR bonus <> round(bonus, 2)
--      OR "netAmount" <> round("netAmount", 2);
--
-- The finance rows created by the backfill are intentionally NOT deleted by
-- this rollback: deleting ledger history is destructive. Remove them manually
-- only after an explicit audit and approval.
--
-- Prefer a forward fix (keep scale 3) over this rollback.

DROP INDEX "FinanceMovement_sourceType_sourceId_key";
CREATE INDEX "FinanceMovement_sourceType_sourceId_idx"
  ON "FinanceMovement"("sourceType", "sourceId");

DROP INDEX "Commission_paidById_idx";
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_paidById_fkey";
ALTER TABLE "Commission" DROP COLUMN "paidById";

ALTER TABLE "PayrollEntry" ALTER COLUMN "baseSalary" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "PayrollEntry" ALTER COLUMN "deductions" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "PayrollEntry" ALTER COLUMN "bonus" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "PayrollEntry" ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "ManualExpense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "FinanceMovement" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14, 2);
