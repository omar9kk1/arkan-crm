import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ManagerCapabilityType,
  Prisma,
  PropertyStatus,
  Role,
} from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../../prisma/prisma.service';

export type DbClient = PrismaService | Prisma.TransactionClient;

export const isOwner = (viewer: AuthUser): boolean =>
  viewer.role === Role.OWNER;

export const isManager = (viewer: AuthUser): boolean =>
  viewer.role === Role.MANAGER;

export const isEmployee = (viewer: AuthUser): boolean =>
  viewer.role === Role.EMPLOYEE;

/** OWNER and MANAGER share the management surfaces. */
export const isManagement = (viewer: AuthUser): boolean =>
  isOwner(viewer) || isManager(viewer);

export function assertOwner(viewer: AuthUser): void {
  if (!isOwner(viewer))
    throw new ForbiddenException('This action is reserved for the OWNER');
}

/**
 * Property visibility.
 *
 * - OWNER: every non-deleted property.
 * - MANAGER: every published company listing (AVAILABLE or SOLD), the Manager's own
 *   rows, and PENDING/REJECTED rows created by currently assigned team
 *   employees. Another team's private review rows are invisible.
 * - EMPLOYEE: unchanged (all AVAILABLE + own PENDING/REJECTED).
 *
 * Soft-deleted rows stay invisible to every normal read path.
 */
export function propertyVisibilityWhere(
  viewer: AuthUser,
): Prisma.PropertyWhereInput {
  if (isOwner(viewer)) return { deletedAt: null };
  if (isManager(viewer)) {
    // Published inventory is company-wide: AVAILABLE stays available, and a
    // SOLD row remains in the catalog (read-only) as sold history. Private
    // review work remains scoped to the Manager's own rows/current team.
    return {
      deletedAt: null,
      OR: [
        { status: { in: [PropertyStatus.AVAILABLE, PropertyStatus.SOLD] } },
        { createdByUserId: viewer.id },
        { createdByUser: { employee: { managerUserId: viewer.id } } },
      ],
    };
  }
  return {
    deletedAt: null,
    OR: [
      { status: { in: [PropertyStatus.AVAILABLE, PropertyStatus.SOLD] } },
      {
        createdByUserId: viewer.id,
        status: {
          in: [PropertyStatus.PENDING, PropertyStatus.REJECTED],
        },
      },
    ],
  };
}

/**
 * Client visibility.
 *
 * - OWNER: all.
 * - MANAGER: clients owned/responsible by the Manager or by a currently
 *   assigned team employee.
 * - EMPLOYEE: unchanged (created by or responsible for the caller).
 */
export function clientOwnershipWhere(
  viewer: AuthUser,
): Prisma.ClientWhereInput {
  if (isOwner(viewer)) return {};
  if (isManager(viewer)) {
    return {
      OR: [
        { createdByUserId: viewer.id },
        { createdBy: { managerUserId: viewer.id } },
        { responsibleEmployee: { managerUserId: viewer.id } },
      ],
    };
  }
  return {
    OR: [
      { createdBy: { userId: viewer.id } },
      { responsibleEmployee: { userId: viewer.id } },
    ],
  };
}

/**
 * Contact visibility.
 *
 * - OWNER: all.
 * - MANAGER: company records (no responsible user) + contacts responsible to
 *   the Manager or a currently assigned team employee.
 * - EMPLOYEE: unchanged (own contacts only).
 */
export function contactOwnershipWhere(
  viewer: AuthUser,
): Prisma.ContactWhereInput {
  if (isOwner(viewer)) return {};
  if (isManager(viewer)) {
    return {
      OR: [
        { responsibleUserId: null },
        { responsibleUserId: viewer.id },
        {
          responsibleUser: {
            employee: { managerUserId: viewer.id },
          },
        },
      ],
    };
  }
  return { responsibleUserId: viewer.id };
}

/** Currently assigned employee USER ids for a Manager; OWNER gets everyone. */
export async function teamEmployeeUserIds(
  db: DbClient,
  viewer: AuthUser,
): Promise<string[]> {
  if (isOwner(viewer)) {
    const users = await db.user.findMany({
      where: { role: { in: [Role.MANAGER, Role.EMPLOYEE] } },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }
  if (isManager(viewer)) {
    const profiles = await db.employeeProfile.findMany({
      where: { managerUserId: viewer.id },
      select: { userId: true },
    });
    return profiles.map((profile) => profile.userId);
  }
  return [viewer.id];
}

/** Currently assigned employee PROFILE ids for a Manager; OWNER gets everyone. */
export async function teamEmployeeProfileIds(
  db: DbClient,
  viewer: AuthUser,
): Promise<string[]> {
  if (isOwner(viewer)) {
    const profiles = await db.employeeProfile.findMany({
      select: { id: true },
    });
    return profiles.map((profile) => profile.id);
  }
  if (isManager(viewer)) {
    const profiles = await db.employeeProfile.findMany({
      where: { managerUserId: viewer.id },
      select: { id: true },
    });
    return profiles.map((profile) => profile.id);
  }
  const profile = await db.employeeProfile.findUnique({
    where: { userId: viewer.id },
    select: { id: true },
  });
  return profile ? [profile.id] : [];
}

export interface ManagerCapabilities {
  approveProperties: boolean;
  rejectProperties: boolean;
}

/** Live capability read. OWNER is always full; EMPLOYEE is always false. */
export async function managerCapabilities(
  db: DbClient,
  viewer: AuthUser,
): Promise<ManagerCapabilities> {
  if (isOwner(viewer))
    return { approveProperties: true, rejectProperties: true };
  if (!isManager(viewer))
    return { approveProperties: false, rejectProperties: false };
  const rows = await db.managerCapability.findMany({
    where: { managerUserId: viewer.id, granted: true },
    select: { capability: true },
  });
  const granted = new Set(rows.map((row) => row.capability));
  return {
    approveProperties: granted.has(ManagerCapabilityType.PROPERTY_APPROVE),
    rejectProperties: granted.has(ManagerCapabilityType.PROPERTY_REJECT),
  };
}

export type PropertyReviewAction = 'APPROVE' | 'REJECT' | 'CHANGES';

/**
 * Authorizes a review decision on one property.
 *
 * - OWNER: allowed for every row.
 * - MANAGER: only a currently assigned team employee's submission, never the
 *   Manager's own row, and only with the matching granted capability. A
 *   cross-team row is answered 404 (never 403) so its existence never leaks.
 */
export async function assertPropertyReviewPermission(
  db: DbClient,
  viewer: AuthUser,
  property: { createdByUserId: string | null },
  action: PropertyReviewAction,
): Promise<void> {
  const creatorId = property.createdByUserId;

  if (isOwner(viewer)) {
    // OWNER reviews direct reports and manager/owner-submitted rows only. An
    // employee with a live manager assignment belongs to that Manager's review
    // authority; OWNER cannot bypass it through the normal decision API.
    if (!creatorId) return;
    const creator = await db.user.findUnique({
      where: { id: creatorId },
      select: {
        role: true,
        employee: { select: { managerUserId: true } },
      },
    });
    if (
      creator?.role === Role.EMPLOYEE &&
      creator.employee?.managerUserId
    )
      throw new ForbiddenException(
        'This property review is assigned to the employee direct manager',
      );
    return;
  }
  if (!isManager(viewer))
    throw new ForbiddenException('Property review is not allowed');

  if (!creatorId || creatorId === viewer.id)
    throw new ForbiddenException(
      'A Manager cannot review their own submission',
    );

  const teamMember = await db.employeeProfile.findFirst({
    where: { userId: creatorId, managerUserId: viewer.id },
    select: { id: true },
  });
  if (!teamMember)
    throw new NotFoundException('Property not found');

  const capabilities = await managerCapabilities(db, viewer);
  const allowed =
    action === 'APPROVE'
      ? capabilities.approveProperties
      : action === 'REJECT'
        ? capabilities.rejectProperties
        : capabilities.approveProperties || capabilities.rejectProperties;
  if (!allowed)
    throw new ForbiddenException(
      'This Manager has not been granted this review capability',
    );
}

/**
 * Recipients of a review/submission event: the DIRECT supervisor only.
 *
 * - Employee assigned to an active Manager -> that Manager only.
 * - Employee assigned directly to the OWNER (`managerUserId = null`) ->
 *   active OWNERs only.
 * - Employee assigned to an INACTIVE/missing Manager -> NOBODY. The review is
 *   intentionally left pending for the OWNER to resolve through the existing
 *   staff workflows; it is never silently redirected to an OWNER or another
 *   Manager.
 * - Manager/OWNER actor -> active OWNERs (management events are never sent to
 *   an unrelated Manager).
 *
 * The groups are deliberately exclusive: an employee's review request can never
 * reach the Manager and an OWNER at the same time.
 */
export async function reviewNotificationRecipientIds(
  db: DbClient,
  actor: { id: string; role: Role },
  excludeUserId?: string,
): Promise<string[]> {
  const withoutExcluded = (ids: string[]): string[] =>
    excludeUserId ? ids.filter((id) => id !== excludeUserId) : ids;

  if (actor.role === Role.EMPLOYEE) {
    const profile = await db.employeeProfile.findUnique({
      where: { userId: actor.id },
      select: { managerUserId: true },
    });
    // A Manager assignment exists: this employee's review authority is that
    // Manager and nobody else. If the assigned Manager is inactive/missing,
    // returning [] preserves the request pending without rerouting it.
    if (profile?.managerUserId) {
      const manager = await db.user.findFirst({
        where: {
          id: profile.managerUserId,
          role: Role.MANAGER,
          isActive: true,
        },
        select: { id: true },
      });
      return manager ? withoutExcluded([manager.id]) : [];
    }
    // No Manager assignment: the employee reports directly to the OWNER.
  }

  const owners = await db.user.findMany({
    where: { role: Role.OWNER, isActive: true },
    select: { id: true },
  });
  return withoutExcluded(owners.map((owner) => owner.id));
}

/** Same as above when only the actor id is known (notification contexts). */
export async function reviewNotificationRecipientIdsForUser(
  db: DbClient,
  actorUserId: string,
  excludeUserId?: string,
): Promise<string[]> {
  const actor = await db.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true },
  });
  if (!actor) return [];
  return reviewNotificationRecipientIds(
    db,
    { id: actor.id, role: actor.role },
    excludeUserId,
  );
}
