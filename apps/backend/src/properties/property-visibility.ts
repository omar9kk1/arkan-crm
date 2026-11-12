import { Prisma } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { propertyVisibilityWhere as scopedPropertyWhere } from '../common/access/access-policy';

/**
 * Row-level visibility filter for properties, applied inside Prisma queries
 * (never after fetching unfiltered rows).
 *
 * - OWNER: every non-deleted property.
 * - MANAGER: every published company listing (AVAILABLE or SOLD) + their own
 *   rows + PENDING/REJECTED rows created by currently assigned team employees.
 *   Other teams' private review rows stay invisible; soft-deleted rows are
 *   invisible.
 * - EMPLOYEE: every published property (AVAILABLE or SOLD, any creator) + their
 *   own PENDING / REJECTED properties; RENTED / ARCHIVED fail closed.
 */
export function propertyVisibilityWhere(
  viewer: AuthUser,
): Prisma.PropertyWhereInput {
  return scopedPropertyWhere(viewer);
}
