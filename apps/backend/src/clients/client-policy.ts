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

/**
 * Resolves the stable `EmployeeProfile` of an EMPLOYEE, provisioning a minimal
 * one ({ userId } only — every other column is optional) when the account was
 * never provisioned (e.g. seeded directly or created before the manager
 * registered the employee).
 *
 * WHY: client ownership (`clientOwnershipWhere`) resolves ONLY through this
 * profile relation. An employee without one would save clients that are owned
 * by NOBODY — silently invisible to their very creator on the next open (404),
 * which is exactly the "wizard works for some accounts but not others" bug.
 * Managers never need this (they see every client row).
 */
export async function ensureEmployeeProfile(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string> {
  const profile = await tx.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (profile) return profile.id;
  const provisioned = await tx.employeeProfile.create({
    data: { userId },
    select: { id: true },
  });
  return provisioned.id;
}
