import { Prisma } from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';

/**
 * Row-level ownership filter for contacts.
 * - MANAGER: no restriction (may view/manage all contacts).
 * - EMPLOYEE: only contacts whose `responsibleUserId` is the authenticated user.
 *
 * Default deny: a contact with no responsible user (company record) is not visible
 * to employees through this filter.
 */
export function contactOwnershipWhere(
  viewer: AuthUser,
): Prisma.ContactWhereInput {
  return viewer.role === Role.MANAGER ? {} : { responsibleUserId: viewer.id };
}
