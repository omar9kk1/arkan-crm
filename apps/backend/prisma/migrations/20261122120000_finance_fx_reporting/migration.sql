-- Persist an immutable KWD reporting amount for every FinanceMovement.
--
-- The original `amount`/`currency` stay untouched. KWD rows get
-- reportingAmount = amount. Foreign-currency rows that predate this migration
-- are explicitly marked UNRESOLVED: they are visible and flagged, but never
-- counted as zero in totals until the reviewed FX backfill runs.
--
-- No rate is guessed here. The backfill is a separate, idempotent operation.

CREATE TYPE "FinanceFxStatus" AS ENUM ('NOT_REQUIRED', 'CONVERTED', 'UNRESOLVED');

ALTER TABLE "FinanceMovement"
  ADD COLUMN "reportingAmount" DECIMAL(15, 3),
  ADD COLUMN "fxStatus" "FinanceFxStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "fxRate" DECIMAL(24, 12),
  ADD COLUMN "fxRateDate" DATE,
  ADD COLUMN "fxProvider" TEXT;

-- KWD movements are already the reporting currency.
UPDATE "FinanceMovement"
SET "reportingAmount" = "amount"
WHERE "currency" = 'KWD'
  AND "reportingAmount" IS NULL;

-- Foreign-currency history is deliberately left unresolved instead of being
-- converted with today's rate. The backfill resolves each row using its own
-- transaction date and persists the rate/date/provider it actually used.
UPDATE "FinanceMovement"
SET "fxStatus" = 'UNRESOLVED'
WHERE "currency" <> 'KWD';

CREATE INDEX "FinanceMovement_fxStatus_idx" ON "FinanceMovement"("fxStatus");
