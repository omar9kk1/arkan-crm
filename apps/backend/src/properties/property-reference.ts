import type { PrismaService } from '../prisma/prisma.service';

/**
 * The permanent property code: `A-000001`, `A-000002`, …
 *
 * The old `AK-<date>-<random>` codes are retired: there is no alias and no
 * fallback — the current code is always resolved from the property row.
 */
export function formatPropertyCode(value: bigint | number): string {
  return `A-${String(value).padStart(6, '0')}`;
}

/**
 * Allocates the next property code from the DATABASE counter.
 *
 * The counter is a single row incremented with `UPDATE ... RETURNING`: the
 * row lock serialises the allocation, so hundreds of concurrent employees each
 * receive a DIFFERENT code. The counter only grows — a failed creation leaves
 * a gap, never a reused number — and a code is never changed afterwards.
 */
export async function nextPropertyCode(prisma: PrismaService): Promise<string> {
  // The row is seeded by the migration; this keeps the allocator safe even on
  // a database that was never seeded.
  await prisma.$executeRaw`
    INSERT INTO "PropertyCodeSequence" ("id", "value") VALUES (1, 0)
    ON CONFLICT ("id") DO NOTHING
  `;
  const rows = await prisma.$queryRaw<{ value: bigint }[]>`
    UPDATE "PropertyCodeSequence" SET "value" = "value" + 1
    WHERE "id" = 1
    RETURNING "value"
  `;
  const value = rows[0]?.value;
  if (value === undefined)
    throw new Error('Could not allocate a property code');
  return formatPropertyCode(value);
}
