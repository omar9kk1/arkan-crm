import { randomBytes } from 'node:crypto';

/**
 * Generates a unique, collision-safe property reference server-side. The client can
 * never supply or override it. `AK-<YYMMDD>-<40 random bits>` keeps the value opaque
 * and non-sequential; the DB unique constraint is the final guarantee.
 */
export function generatePropertyReference(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear()).slice(2);
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const random = randomBytes(5).toString('hex').toUpperCase();
  return `AK-${year}${month}${day}-${random}`;
}
