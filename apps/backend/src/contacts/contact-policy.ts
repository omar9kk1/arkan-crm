import { Prisma } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { contactOwnershipWhere as scopedContactWhere } from '../common/access/access-policy';

/**
 * Row-level ownership filter for contacts.
 * - OWNER: every contact.
 * - MANAGER: company records plus contacts responsible to the Manager or a
 *   currently assigned team employee.
 * - EMPLOYEE: only contacts whose `responsibleUserId` is the caller.
 *
 * Default deny: a contact with no responsible user (company record) is not
 * visible to employees through this filter.
 */
export function contactOwnershipWhere(
  viewer: AuthUser,
): Prisma.ContactWhereInput {
  return scopedContactWhere(viewer);
}
