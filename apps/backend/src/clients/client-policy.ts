import { Prisma } from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';

/**
 * Row-level visibility filter for CRM clients.
 * - MANAGER: no restriction (may view every company client record).
 * - EMPLOYEE: only clients they created or are responsible for, resolved
 *   through the stable `EmployeeProfile.userId` relationship — never by
 *   matching a display name.
 *
 * Default deny: a client created by someone else and assigned to someone else
 * is invisible to an employee (answered with 404, so existence never leaks).
 */
export function clientOwnershipWhere(
  viewer: AuthUser,
): Prisma.ClientWhereInput {
  if (viewer.role === Role.MANAGER) return {};
  return {
    OR: [
      { createdBy: { userId: viewer.id } },
      { responsibleEmployee: { userId: viewer.id } },
    ],
  };
}
