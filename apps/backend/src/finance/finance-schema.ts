import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type FinanceDb = PrismaService | Prisma.TransactionClient;

/**
 * True only when the reviewed Finance migration is applied to the connected
 * database. This lets the same code run safely before real-database activation:
 * deal creation keeps working without writing rounded 3-decimal ledger rows,
 * and Finance requests fail with an explicit "migration required" response
 * instead of a Prisma column error.
 */
export async function financeSchemaReady(db: FinanceDb): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'FinanceMovement'
          AND column_name = 'amount'
          AND numeric_scale = 3
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'Commission'
          AND column_name = 'paidById'
      )
    ) AS ready
  `);
  return rows[0]?.ready === true;
}

/**
 * True only when the reviewed automatic-FX migration is applied. Kept separate
 * from `financeSchemaReady` so deal creation can keep writing the existing
 * ledger on a database that has not activated FX reporting yet.
 */
export async function financeFxSchemaReady(db: FinanceDb): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
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
