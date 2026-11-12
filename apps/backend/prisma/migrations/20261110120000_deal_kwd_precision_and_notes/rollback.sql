-- EMERGENCY ROLLBACK ONLY — reviewed separately, never applied automatically.
--
-- WARNING: reverting DECIMAL(15,3) to DECIMAL(14,2) ROUNDS any amount whose
-- third decimal (fils) is non-zero. Export and audit those rows first:
--
--   SELECT id, price, "companyCommission", "notes"
--   FROM "Deal"
--   WHERE price <> round(price, 2)
--      OR "companyCommission" <> round("companyCommission", 2);
--
--   SELECT id, amount FROM "Commission" WHERE amount <> round(amount, 2);
--
-- Prefer a forward fix (keep scale 3) over this rollback.

ALTER TABLE "Deal" DROP COLUMN "notes";
ALTER TABLE "Deal" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "Deal" ALTER COLUMN "companyCommission" SET DATA TYPE DECIMAL(14, 2);
ALTER TABLE "Commission" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14, 2);
