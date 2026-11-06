import { Prisma } from '@prisma/client';

/**
 * The permanent OFFICIAL property code: `A-000001`, `A-000002`, ...
 * The submission code is `P-000001`, ... and is assigned separately.
 */
export function formatPropertyCode(value: bigint | number): string {
  return `A-${String(value).padStart(6, '0')}`;
}

/** The submission code shown while a property is pending/rejected. */
export function formatSubmissionCode(value: bigint | number): string {
  return `P-${String(value).padStart(6, '0')}`;
}

/**
 * The two independent counters share the existing table:
 *   id = 1 -> official A sequence (legacy + approved codes)
 *   id = 2 -> submission P sequence
 */
const OFFICIAL_SEQUENCE_ID = 1;
const SUBMISSION_SEQUENCE_ID = 2;

type CodeSequenceClient = Pick<
  Prisma.TransactionClient,
  '$executeRaw' | '$queryRaw'
>;

async function bumpSequence(
  client: CodeSequenceClient,
  id: number,
): Promise<bigint> {
  // The row is seeded lazily; the migration also seeds both rows. The UPDATE
  // row lock makes the allocation atomic and transaction-scoped, so a rolled
  // back creation/approval never leaves a consumed number.
  await client.$executeRaw`
    INSERT INTO "PropertyCodeSequence" ("id", "value") VALUES (${id}, 0)
    ON CONFLICT ("id") DO NOTHING
  `;
  const rows = await client.$queryRaw<{ value: bigint }[]>`
    UPDATE "PropertyCodeSequence" SET "value" = "value" + 1
    WHERE "id" = ${id}
    RETURNING "value"
  `;
  const value = rows[0]?.value;
  if (value === undefined)
    throw new Error('Could not allocate a property code');
  return value;
}

/** Allocate the next official A code (used only at approval / manager create). */
export async function nextPropertyCode(
  client: CodeSequenceClient,
): Promise<string> {
  return formatPropertyCode(await bumpSequence(client, OFFICIAL_SEQUENCE_ID));
}

/** Allocate the next submission P code (employee create). */
export async function nextSubmissionCode(
  client: CodeSequenceClient,
): Promise<string> {
  return formatSubmissionCode(
    await bumpSequence(client, SUBMISSION_SEQUENCE_ID),
  );
}

/**
 * Allocate the next A code that is not already used by a legacy row in either
 * `reference` (old A-only submissions) or `approvedReference`. Must run inside
 * the approval transaction; the sequence increment rolls back with it.
 */
export async function allocateOfficialCode(
  tx: Prisma.TransactionClient,
): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const code = await nextPropertyCode(tx);
    const used = await tx.property.findFirst({
      where: { OR: [{ reference: code }, { approvedReference: code }] },
      select: { id: true },
    });
    if (!used) return code;
  }
  throw new Error('Could not allocate an unused official property code');
}
