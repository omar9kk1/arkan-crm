import { FinanceFxStatus, Prisma } from '@prisma/client';

export const REPORTING_CURRENCY = 'KWD';

/**
 * Reporting fields for a movement that is created directly in KWD. Non-KWD
 * movements created outside the FX flow are marked UNRESOLVED rather than
 * guessed; the reviewed backfill resolves them with a persisted historical
 * rate.
 */
export function financeReportingFields(
  amount: Prisma.Decimal,
  currency: string,
): {
  reportingAmount: Prisma.Decimal | null;
  fxStatus: FinanceFxStatus;
  fxRate: Prisma.Decimal | null;
  fxRateDate: Date | null;
  fxProvider: string | null;
} {
  if (currency === REPORTING_CURRENCY) {
    return {
      reportingAmount: amount,
      fxStatus: FinanceFxStatus.NOT_REQUIRED,
      fxRate: null,
      fxRateDate: null,
      fxProvider: null,
    };
  }
  return {
    reportingAmount: null,
    fxStatus: FinanceFxStatus.UNRESOLVED,
    fxRate: null,
    fxRateDate: null,
    fxProvider: null,
  };
}

/** Exact EGP amount * persisted rate, rounded HALF_UP to three KWD decimals. */
export function convertToReportingAmount(
  amount: Prisma.Decimal,
  rate: string,
): Prisma.Decimal {
  return amount
    .mul(new Prisma.Decimal(rate))
    .toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}
