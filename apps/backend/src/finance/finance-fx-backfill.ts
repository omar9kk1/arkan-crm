import { FinanceFxStatus, Prisma, type PrismaClient } from '@prisma/client';
import { convertToReportingAmount } from './finance-fx';
import type { FxRateService } from './fx-rate.service';

/** Only this isolated database may receive an FX backfill in this phase. */
export const FX_BACKFILL_TEST_DATABASE = 'arkan_crm_api_test';

export interface FxBackfillPreviewRow {
  id: string;
  reference: string;
  amount: string;
  currency: string;
  occurredAt: string;
  fxStatus: string;
}

export interface FxBackfillPreview {
  database: string;
  schemaReady: boolean;
  applyAllowed: boolean;
  total: number;
  byCurrency: Array<{ currency: string; count: number; amount: string }>;
  rows: FxBackfillPreviewRow[];
}

export interface FxBackfillApplyResult {
  database: string;
  scanned: number;
  converted: number;
  repairedKwd: number;
  skippedUnsupported: number;
  skippedAlreadyResolved: number;
  failed: Array<{ reference: string; currency: string; message: string }>;
  remaining: number;
}

export interface FxBackfillOptions {
  limit?: number;
}

export async function previewFxBackfill(
  prisma: PrismaClient,
  options: FxBackfillOptions = {},
): Promise<FxBackfillPreview> {
  const limit = normalizeLimit(options.limit);
  const database = await currentDatabase(prisma);
  const schemaReady = await hasFxColumns(prisma);

  if (schemaReady) {
    const where: Prisma.FinanceMovementWhereInput = {
      OR: [
        { fxStatus: FinanceFxStatus.UNRESOLVED },
        { reportingAmount: null },
      ],
    };
    const [groups, rows] = await Promise.all([
      prisma.financeMovement.groupBy({
        by: ['currency'],
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      prisma.financeMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: {
          id: true,
          reference: true,
          amount: true,
          currency: true,
          occurredAt: true,
          fxStatus: true,
        },
      }),
    ]);
    return {
      database,
      schemaReady,
      applyAllowed: database === FX_BACKFILL_TEST_DATABASE,
      total: groups.reduce((sum, group) => sum + group._count._all, 0),
      byCurrency: groups.map((group) => ({
        currency: group.currency,
        count: group._count._all,
        amount: (group._sum.amount ?? new Prisma.Decimal(0)).toFixed(3),
      })),
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        amount: row.amount.toFixed(3),
        currency: row.currency,
        occurredAt: row.occurredAt.toISOString().slice(0, 10),
        fxStatus: row.fxStatus,
      })),
    };
  }

  // Pre-migration preview: read-only, legacy columns only. This is what lets
  // the real database be inspected safely before any schema change is approved.
  const [groups, rows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ currency: string; count: number; amount: string }>
    >(Prisma.sql`
      SELECT currency, count(*)::int AS count, sum(amount)::text AS amount
      FROM "FinanceMovement"
      WHERE currency <> 'KWD'
      GROUP BY currency
      ORDER BY currency
    `),
    prisma.$queryRaw<
      Array<{
        id: string;
        reference: string;
        amount: string;
        currency: string;
        occurredAt: string;
      }>
    >(Prisma.sql`
      SELECT id::text, reference, amount::text AS amount, currency,
             "occurredAt"::date::text AS "occurredAt"
      FROM "FinanceMovement"
      WHERE currency <> 'KWD'
      ORDER BY "occurredAt" ASC, id ASC
      LIMIT ${limit}
    `),
  ]);

  return {
    database,
    schemaReady,
    applyAllowed: false,
    total: groups.reduce((sum, group) => sum + group.count, 0),
    byCurrency: groups,
    rows: rows.map((row) => ({
      ...row,
      fxStatus: FinanceFxStatus.UNRESOLVED,
    })),
  };
}

/**
 * Idempotent, resumable legacy FX backfill. Every row is resolved with the rate
 * for its own transaction date; already-converted rows are never touched.
 * Apply is hard-guarded to the isolated test database in this phase.
 */
export async function applyFxBackfill(
  prisma: PrismaClient,
  fx: FxRateService,
  options: FxBackfillOptions = {},
): Promise<FxBackfillApplyResult> {
  const limit = normalizeLimit(options.limit);
  const database = await currentDatabase(prisma);
  if (database !== FX_BACKFILL_TEST_DATABASE) {
    throw new Error(
      `Refusing FX backfill on database "${database}"; only ${FX_BACKFILL_TEST_DATABASE} is allowed in this phase.`,
    );
  }
  if (!(await hasFxColumns(prisma))) {
    throw new Error(
      'Refusing FX backfill: the finance FX migration is not applied to this database.',
    );
  }

  const rows = await prisma.financeMovement.findMany({
    where: {
      OR: [
        { fxStatus: FinanceFxStatus.UNRESOLVED },
        { reportingAmount: null },
      ],
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: {
      id: true,
      reference: true,
      amount: true,
      currency: true,
      occurredAt: true,
    },
  });

  const result: FxBackfillApplyResult = {
    database,
    scanned: rows.length,
    converted: 0,
    repairedKwd: 0,
    skippedUnsupported: 0,
    skippedAlreadyResolved: 0,
    failed: [],
    remaining: 0,
  };

  for (const row of rows) {
    if (row.currency === 'KWD') {
      const updated = await prisma.financeMovement.updateMany({
        where: {
          id: row.id,
          reportingAmount: null,
        },
        data: {
          reportingAmount: row.amount,
          fxStatus: FinanceFxStatus.NOT_REQUIRED,
        },
      });
      if (updated.count === 1) result.repairedKwd += 1;
      else result.skippedAlreadyResolved += 1;
      continue;
    }

    if (row.currency !== 'EGP') {
      result.skippedUnsupported += 1;
      continue;
    }

    try {
      const date = row.occurredAt.toISOString().slice(0, 10);
      const quote = await fx.egpToKwd(date);
      const reportingAmount = convertToReportingAmount(row.amount, quote.rate);
      if (reportingAmount.lte(0)) {
        throw new Error(
          'The converted KWD amount rounds to zero; resolve this row manually.',
        );
      }
      const updated = await prisma.financeMovement.updateMany({
        where: {
          id: row.id,
          reportingAmount: null,
        },
        data: {
          reportingAmount,
          fxStatus: FinanceFxStatus.CONVERTED,
          fxRate: new Prisma.Decimal(quote.rate),
          fxRateDate: new Date(`${quote.rateDate}T00:00:00.000Z`),
          fxProvider: quote.provider,
        },
      });
      if (updated.count === 1) result.converted += 1;
      else result.skippedAlreadyResolved += 1;
    } catch (error) {
      result.failed.push({
        reference: row.reference,
        currency: row.currency,
        message:
          error instanceof Error
            ? error.message.slice(0, 200)
            : 'FX conversion failed',
      });
    }
  }

  result.remaining = await prisma.financeMovement.count({
    where: {
      OR: [
        { fxStatus: FinanceFxStatus.UNRESOLVED },
        { reportingAmount: null },
      ],
    },
  });
  return result;
}

async function currentDatabase(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`SELECT current_database() AS name`,
  );
  return rows[0]?.name ?? '';
}

async function hasFxColumns(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'reportingAmount'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'fxStatus'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'fxRate'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'fxRateDate'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'fxProvider'
      )
    ) AS ready
  `);
  return rows[0]?.ready === true;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return 50;
  return Math.min(Math.floor(value), 500);
}
