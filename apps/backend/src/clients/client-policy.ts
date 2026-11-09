import { Prisma } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { clientOwnershipWhere as scopedClientWhere } from '../common/access/access-policy';

/**
 * Row-level visibility filter for CRM clients.
 * - OWNER: every company client.
 * - MANAGER: only the Manager's own clients and currently assigned team
 *   employees' clients.
 * - EMPLOYEE: only clients they created or are responsible for, resolved
 *   through the stable `EmployeeProfile.userId` relationship — never by
 *   matching a display name.
 *
 * Default deny: a client created by someone else and assigned to someone else
 * is invisible (answered with 404, so existence never leaks).
 */
export function clientOwnershipWhere(
  viewer: AuthUser,
): Prisma.ClientWhereInput {
  return scopedClientWhere(viewer);
}

/**
 * Resolves the stable `EmployeeProfile` of an EMPLOYEE, provisioning a minimal
 * one ({ userId } only — every other column is optional) when the account was
 * never provisioned.
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
