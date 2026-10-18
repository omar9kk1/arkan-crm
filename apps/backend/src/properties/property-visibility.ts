import { Prisma, PropertyStatus } from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';

/**
 * Row-level visibility filter for properties, applied inside Prisma queries (never
 * after fetching unfiltered rows).
 *
 * - MANAGER: every property.
 * - EMPLOYEE:
 *     * every AVAILABLE property (any creator);
 *     * their own PENDING / REJECTED properties.
 *
 * SOLD / RENTED / ARCHIVED fail closed for employees: employees cannot read them
 * until those access rules are explicitly defined. Non-authorized ids resolve to a
 * non-disclosing 404 at the call site.
 */
export function propertyVisibilityWhere(
  viewer: AuthUser,
): Prisma.PropertyWhereInput {
  if (viewer.role === Role.MANAGER) return {};
  return {
    OR: [
      { status: PropertyStatus.AVAILABLE },
      {
        createdByUserId: viewer.id,
        status: { in: [PropertyStatus.PENDING, PropertyStatus.REJECTED] },
      },
    ],
  };
}
