import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * True only when the additive client-review ownership migration is applied.
 * Until then the running real backend refuses review mutations/reads rather
 * than issuing Prisma queries for a missing column.
 */
export async function clientReviewOwnershipReady(db: Db): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ ready: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ClientReviewRequest'
        AND column_name = 'assignedReviewerId'
    ) AS ready
  `);
  return rows[0]?.ready === true;
}
