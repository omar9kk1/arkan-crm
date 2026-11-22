-- EMERGENCY ROLLBACK ONLY - reviewed separately, never applied automatically.
--
-- WARNING: dropping these columns destroys the persisted historical FX
-- rate/date/provider and the KWD reporting amounts. Export them first:
--
--   SELECT id, reference, amount, currency, "reportingAmount", "fxStatus",
--          "fxRate", "fxRateDate", "fxProvider"
--   FROM "FinanceMovement"
--   WHERE "fxStatus" <> 'NOT_REQUIRED';
--
-- Prefer a forward fix over this rollback.

DROP INDEX "FinanceMovement_fxStatus_idx";

ALTER TABLE "FinanceMovement"
  DROP COLUMN "fxProvider",
  DROP COLUMN "fxRateDate",
  DROP COLUMN "fxRate",
  DROP COLUMN "fxStatus",
  DROP COLUMN "reportingAmount";

DROP TYPE "FinanceFxStatus";
