import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ManagerCapabilityType,
  Prisma,
  PropertyStatus,
  Role,
} from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { kuwaitDayKey } from '../followups/followup-schedule';
import { hashPassword } from '../auth/password';
import {
  assertOwner,
  isManager,
  isOwner,
} from '../common/access/access-policy';
import type {
  EmployeeDto,
  EmployeeListItemDto,
  EmployeeListDto,
  EmployeePropertyDto,
  EmployeePropertyPageDto,
  EmployeeSummaryDto,
  ManagerDto,
  ManagerListDto,
  ManagerTeamMemberDto,
} from './employee.dto';
import type {
  EmployeeSortKey,
  ListEmployeesQueryDto,
} from './dto/list-employees.query';
import type { ListEmployeePropertiesQueryDto } from './dto/list-employee-properties.query';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { AssignEmployeeManagerDto } from './dto/assign-employee-manager.dto';
import { ManagerPermissionsDto } from './dto/manager-permissions.dto';

const PROPERTY_LIMIT = 50;
const DEFAULT_EMPLOYEE_PAGE_SIZE = 50;
const MAX_EMPLOYEE_PAGE_SIZE = 100;
const DEFAULT_PROPERTY_PAGE_SIZE = 50;
const MAX_PROPERTY_PAGE_SIZE = 100;
const HOUR_MS = 3_600_000;

const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  employee: {
    select: {
      id: true,
      phone: true,
      hiredAt: true,
      baseSalary: true,
      managerUserId: true,
      manager: { select: { id: true, name: true } },
    },
  },
  managerCapabilities: {
    select: { capability: true, granted: true },
  },
  _count: { select: { createdProperties: true } },
} satisfies Prisma.UserSelect;

type EmployeeRow = Prisma.UserGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

/**
 * OWNER account directory + Manager team management.
 *
 * - OWNER: every MANAGER/EMPLOYEE account, creation, rename, activation,
 *   assignment/transfer and capability grants.
 * - MANAGER: read-only list of the employees currently assigned to them.
 * - EMPLOYEE: no access (controller denies).
 *
 * Every relationship is resolved through stable ids; authorization never
 * trusts a client-supplied role or manager id.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /employees` — OWNER sees all accounts; MANAGER sees their team. */
  async list(
    viewer: AuthUser,
    query: ListEmployeesQueryDto = {},
  ): Promise<EmployeeListDto> {
    const baseWhere = this.directoryScope(viewer);
    const limit = Math.min(
      query.limit ?? DEFAULT_EMPLOYEE_PAGE_SIZE,
      MAX_EMPLOYEE_PAGE_SIZE,
    );
    const pageResult = await this.pageEmployeeIds(viewer, query, limit);
    const pageIds = pageResult.rows.map((row) => row.id);
    const users = pageIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: pageIds } },
          select: EMPLOYEE_SELECT,
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    const page = pageIds
      .map((id) => byId.get(id))
      .filter((user): user is EmployeeRow => Boolean(user));
    const userIds = page.map((user) => user.id);
    const profileIds = page
      .map((user) => user.employee?.id)
      .filter((id): id is string => Boolean(id));

    const [propertiesByStatus, clientsByUser, assignedByProfile, lateByProfile] =
      await Promise.all([
        this.propertyStatusByUser(userIds),
        this.clientsCountsByUser(userIds),
        this.assignedCountsByProfile(profileIds),
        this.lateCountsByProfile(profileIds),
      ]);

    const summary = query.cursor
      ? undefined
      : await this.directorySummary(baseWhere);
    return {
      items: page.map((user) =>
        this.serializeListItem(
          user,
          propertiesByStatus.get(user.id) ?? this.emptyStatusCounts(),
          clientsByUser.get(user.id) ?? 0,
          assignedByProfile.get(user.employee?.id ?? '') ?? 0,
          lateByProfile.get(user.employee?.id ?? '') ?? 0,
        ),
      ),
      nextCursor: pageResult.nextCursor,
      ...(summary ? { summary } : {}),
    };
  }

  /** OWNER: all employees; MANAGER: the current team (NULL never matches). */
  private directoryScope(viewer: AuthUser): Prisma.UserWhereInput {
    if (isOwner(viewer)) return { role: Role.EMPLOYEE };
    if (isManager(viewer)) {
      return {
        role: Role.EMPLOYEE,
        employee: { managerUserId: viewer.id },
      };
    }
    return { id: viewer.id };
  }

  private employeeMetricSql(sort: EmployeeSortKey): Prisma.Sql {
    if (sort === 'propertiesCount') {
      return Prisma.sql`(
        SELECT COUNT(*)::int
        FROM "Property" p
        WHERE p."createdByUserId" = u.id
      )`;
    }
    if (sort === 'dealsCount') {
      return Prisma.sql`(
        SELECT COUNT(DISTINCT d.id)::int
        FROM "Deal" d
        WHERE d."propertyEmployeeId" = e.id
           OR d."clientEmployeeId" = e.id
      )`;
    }
    return Prisma.sql`(
      SELECT COUNT(DISTINCT c.id)::int
      FROM "Client" c
      WHERE c."createdById" = e.id
         OR c."responsibleEmployeeId" = e.id
    )`;
  }

  /**
   * Global sort across the full authorized dataset, then one page.
   * Cursor = `<metric>:<uuid>`; ordering is metric DESC, id ASC (unique tie).
   */
  private async pageEmployeeIds(
    viewer: AuthUser,
    query: ListEmployeesQueryDto,
    limit: number,
  ): Promise<{ rows: Array<{ id: string; metric: number }>; nextCursor: string | null }> {
    const managerId = isManager(viewer) ? viewer.id : null;
    const active =
      query.status === 'active'
        ? true
        : query.status === 'inactive'
          ? false
          : null;
    const search = query.search?.trim() || null;
    const escaped = search
      ? search.replace(/[\\%_]/g, (char) => `\\${char}`)
      : null;
    let cursorMetric: number | null = null;
    let cursorId: string | null = null;
    if (query.cursor) {
      const [metric, id] = query.cursor.split(':');
      cursorMetric = Number(metric);
      cursorId = id ?? null;
    }
    const metric = this.employeeMetricSql(query.sort ?? 'clientsCount');
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; metric: number }>
    >`
      WITH counted AS (
        SELECT u.id,
               ${metric} AS metric
        FROM "User" u
        LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
        WHERE u.role = 'EMPLOYEE'
          AND (${managerId}::uuid IS NULL OR e."managerUserId" = ${managerId}::uuid)
          AND (${active}::boolean IS NULL OR u."isActive" = ${active}::boolean)
          AND (
            ${escaped}::text IS NULL
            OR u.name ILIKE '%' || ${escaped} || '%' ESCAPE '\\'
            OR COALESCE(e.phone, '') ILIKE '%' || ${escaped} || '%' ESCAPE '\\'
          )
      )
      SELECT id, metric
      FROM counted
      WHERE (
        ${cursorMetric}::int IS NULL
        OR metric < ${cursorMetric}::int
        OR (metric = ${cursorMetric}::int AND id > ${cursorId}::uuid)
      )
      ORDER BY metric DESC, id ASC
      LIMIT ${limit + 1}
    `;
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map((row) => ({ id: row.id, metric: Number(row.metric) })),
      nextCursor: truncated && last ? `${last.metric}:${last.id}` : null,
    };
  }

  private emptyStatusCounts(): Record<PropertyStatus, number> {
    return Object.values(PropertyStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<PropertyStatus, number>,
    );
  }

  private async propertyStatusByUser(
    userIds: string[],
  ): Promise<Map<string, Record<PropertyStatus, number>>> {
    const out = new Map<string, Record<PropertyStatus, number>>();
    if (!userIds.length) return out;
    const rows = await this.prisma.property.groupBy({
      by: ['createdByUserId', 'status'],
      where: { createdByUserId: { in: userIds } },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (!row.createdByUserId) continue;
      const counts = out.get(row.createdByUserId) ?? this.emptyStatusCounts();
      counts[row.status] = row._count._all;
      out.set(row.createdByUserId, counts);
    }
    return out;
  }

  private async clientsCountsByUser(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!userIds.length) return out;
    const list = Prisma.join(
      userIds.map((id) => Prisma.sql`${id}::uuid`),
    );
    const rows = await this.prisma.$queryRaw<
      Array<{ userId: string; count: bigint }>
    >`
      SELECT p."userId" AS "userId", COUNT(DISTINCT c.id)::bigint AS "count"
      FROM "EmployeeProfile" p
      JOIN "Client" c
        ON c."createdById" = p.id OR c."responsibleEmployeeId" = p.id
      WHERE p."userId" IN (${list})
      GROUP BY p."userId"
    `;
    for (const row of rows) out.set(row.userId, Number(row.count));
    return out;
  }

  private async assignedCountsByProfile(
    profileIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!profileIds.length) return out;
    const list = Prisma.join(
      profileIds.map((id) => Prisma.sql`${id}::uuid`),
    );
    const rows = await this.prisma.$queryRaw<
      Array<{ employeeId: string; count: bigint }>
    >`
      SELECT a."employeeId" AS "employeeId",
             COUNT(DISTINCT a."propertyId")::bigint AS "count"
      FROM "PropertyAssignment" a
      WHERE a."employeeId" IN (${list})
      GROUP BY a."employeeId"
    `;
    for (const row of rows) out.set(row.employeeId, Number(row.count));
    return out;
  }

  private async lateCountsByProfile(
    profileIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!profileIds.length) return out;
    const key = kuwaitDayKey(new Date());
    const start = new Date(
      Date.parse(`${key}T00:00:00.000Z`) - 3 * HOUR_MS,
    );
    const rows = await this.prisma.followUpSubject.groupBy({
      by: ['responsibleId'],
      where: {
        responsibleId: { in: profileIds },
        active: true,
        nextDueAt: { lt: start },
      },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (row.responsibleId) out.set(row.responsibleId, row._count._all);
    }
    return out;
  }

  private async directorySummary(
    baseWhere: Prisma.UserWhereInput,
  ): Promise<EmployeeSummaryDto> {
    const users = await this.prisma.user.findMany({
      where: baseWhere,
      select: { id: true, isActive: true },
    });
    const userIds = users.map((user) => user.id);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const [clientsByUser, lateByProfile] = await Promise.all([
      this.clientsCountsByUser(userIds),
      this.lateCountsByProfile(profiles.map((profile) => profile.id)),
    ]);
    return {
      total: users.length,
      active: users.filter((user) => user.isActive).length,
      clientsTotal: [...clientsByUser.values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
      lateTotal: [...lateByProfile.values()].reduce(
        (sum, value) => sum + value,
        0,
      ),
    };
  }

  /** GET /employees/:id — full detail, scoped for MANAGER. */
  async findOne(viewer: AuthUser, id: string): Promise<EmployeeDto> {
    await this.assertEmployeeVisible(viewer, id);
    return this.readOne(id);
  }

  /** Paginated properties of one authorized employee (drawer Load More). */
  async listProperties(
    viewer: AuthUser,
    id: string,
    query: ListEmployeePropertiesQueryDto = {},
  ): Promise<EmployeePropertyPageDto> {
    await this.assertEmployeeVisible(viewer, id);
    const limit = Math.min(
      query.limit ?? DEFAULT_PROPERTY_PAGE_SIZE,
      MAX_PROPERTY_PAGE_SIZE,
    );
    const [total, rows] = await Promise.all([
      this.prisma.property.count({ where: { createdByUserId: id } }),
      this.prisma.property.findMany({
        where: { createdByUserId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          reference: true,
          title: true,
          status: true,
        },
      }),
    ]);
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    return {
      items: page.map(
        (property): EmployeePropertyDto => ({
          id: property.id,
          reference: property.reference,
          title: property.title,
          status: property.status,
        }),
      ),
      nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
      total,
    };
  }

  private async assertEmployeeVisible(
    viewer: AuthUser,
    id: string,
  ): Promise<void> {
    const where: Prisma.UserWhereInput = {
      id,
      role: Role.EMPLOYEE,
      ...(isManager(viewer)
        ? { employee: { managerUserId: viewer.id } }
        : {}),
    };
    const user = await this.prisma.user.findFirst({
      where,
      select: { id: true },
    });
    if (!user) throw new NotFoundException('employee not found');
  }

  /** `GET /managers` — OWNER-only manager directory with live capabilities. */
  async listManagers(viewer: AuthUser): Promise<ManagerListDto> {
    assertOwner(viewer);
    const managers = await this.prisma.user.findMany({
      where: { role: Role.MANAGER },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        managerCapabilities: {
          select: { capability: true, granted: true },
        },
        managedEmployees: {
          orderBy: { createdAt: 'asc' },
          select: {
            userId: true,
            user: { select: { name: true, isActive: true } },
          },
        },
        _count: { select: { managedEmployees: true } },
      },
    });
    return {
      items: managers.map(
        (manager): ManagerDto => ({
          id: manager.id,
          name: manager.name,
          email: manager.email,
          isActive: manager.isActive,
          capabilities: this.capabilitiesFromRows(
            manager.managerCapabilities,
          ),
          teamCount: manager._count.managedEmployees,
          team: manager.managedEmployees.map(
            (member): ManagerTeamMemberDto => ({
              id: member.userId,
              name: member.user.name,
              isActive: member.user.isActive,
            }),
          ),
        }),
      ),
    };
  }

  /** `POST /employees` — OWNER creates a MANAGER or EMPLOYEE account. */
  async create(viewer: AuthUser, dto: CreateEmployeeDto): Promise<EmployeeDto> {
    assertOwner(viewer);
    if (dto.role !== Role.MANAGER && dto.role !== Role.EMPLOYEE)
      throw new BadRequestException('role must be MANAGER or EMPLOYEE');
    if (dto.role === Role.MANAGER && dto.managerUserId)
      throw new BadRequestException(
        'managerUserId is only valid for an EMPLOYEE account',
      );

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('this email is already registered');

    if (dto.role === Role.EMPLOYEE && dto.managerUserId)
      await this.assertAssignableManager(dto.managerUserId);

    const passwordHash = await hashPassword(dto.password);
    const created = await this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            name: dto.name.trim(),
            role: dto.role,
            isActive: dto.isActive ?? true,
            passwordHash,
            ...(dto.role === Role.EMPLOYEE
              ? {
                  employee: {
                    create: {
                      phone: dto.phone?.trim() || null,
                      hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : null,
                      baseSalary: dto.baseSalary ?? null,
                      managerUserId: dto.managerUserId ?? null,
                    },
                  },
                }
              : {}),
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: viewer.id,
            action:
              user.role === Role.MANAGER
                ? 'MANAGER_CREATE'
                : 'EMPLOYEE_CREATE',
            entityType: 'User',
            entityId: user.id,
            after: {
              name: user.name,
              email: user.email,
              role: user.role,
              isActive: user.isActive,
              managerUserId:
                user.role === Role.EMPLOYEE
                  ? (dto.managerUserId ?? null)
                  : null,
            },
          },
        });
        return user;
      })
      .catch((cause: unknown) => {
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === 'P2002'
        )
          throw new ConflictException('this email is already registered');
        throw cause;
      });
    return this.readOne(created.id);
  }

  /** `PATCH /employees/:id` — OWNER renames a MANAGER/EMPLOYEE account. */
  async update(
    viewer: AuthUser,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeDto> {
    assertOwner(viewer);
    const name = dto.name.trim();
    const target = await this.prisma.user.findFirst({
      where: { id, role: { in: [Role.MANAGER, Role.EMPLOYEE] } },
      select: { id: true, name: true, role: true },
    });
    if (!target) throw new NotFoundException('account not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { name } });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action:
            target.role === Role.MANAGER
              ? 'MANAGER_RENAME'
              : 'EMPLOYEE_RENAME',
          entityType: 'User',
          entityId: id,
          before: { name: target.name },
          after: { name },
        },
      });
    });
    return this.readOne(id);
  }

  /**
   * `PATCH /employees/:id/activation` — OWNER activates/deactivates a MANAGER
   * or EMPLOYEE. Deactivation bumps authVersion and revokes every session;
   * reactivation never revives them, so a fresh login is required.
   */
  async setActivation(
    viewer: AuthUser,
    id: string,
    isActive: boolean,
  ): Promise<EmployeeDto> {
    assertOwner(viewer);
    const target = await this.prisma.user.findFirst({
      where: { id, role: { in: [Role.MANAGER, Role.EMPLOYEE] } },
      select: { id: true, isActive: true, role: true },
    });
    if (!target) throw new NotFoundException('account not found');
    if (target.isActive === isActive) return this.readOne(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          isActive,
          ...(isActive ? {} : { authVersion: { increment: 1 } }),
        },
      });
      if (!isActive)
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: isActive
            ? target.role === Role.MANAGER
              ? 'MANAGER_ACTIVATE'
              : 'EMPLOYEE_ACTIVATE'
            : target.role === Role.MANAGER
              ? 'MANAGER_DEACTIVATE'
              : 'EMPLOYEE_DEACTIVATE',
          entityType: 'User',
          entityId: id,
          after: { isActive },
        },
      });
    });
    return this.readOne(id);
  }

  /**
   * `PATCH /employees/:id/manager` — OWNER assigns or transfers an EMPLOYEE.
   * Only the current manager link changes; the account, creator ids and every
   * historical row stay untouched. `null` leaves the employee unassigned
   * (visible to OWNER only).
   */
  async assignManager(
    viewer: AuthUser,
    id: string,
    dto: AssignEmployeeManagerDto,
  ): Promise<EmployeeDto> {
    assertOwner(viewer);
    const target = await this.prisma.user.findFirst({
      where: { id, role: Role.EMPLOYEE },
      select: {
        id: true,
        employee: { select: { managerUserId: true } },
      },
    });
    if (!target) throw new NotFoundException('employee not found');

    if (dto.managerUserId)
      await this.assertAssignableManager(dto.managerUserId);

    await this.prisma.$transaction(async (tx) => {
      await tx.employeeProfile.upsert({
        where: { userId: id },
        create: { userId: id, managerUserId: dto.managerUserId ?? null },
        update: { managerUserId: dto.managerUserId ?? null },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'EMPLOYEE_ASSIGN_MANAGER',
          entityType: 'User',
          entityId: id,
          before: {
            managerUserId: target.employee?.managerUserId ?? null,
          },
          after: { managerUserId: dto.managerUserId ?? null },
        },
      });
    });
    return this.readOne(id);
  }

  /**
   * `PATCH /managers/:id/permissions` — OWNER grants/revokes approve and
   * reject independently. Absence of a row is the default false state.
   */
  async setManagerPermissions(
    viewer: AuthUser,
    id: string,
    dto: ManagerPermissionsDto,
  ): Promise<ManagerDto> {
    assertOwner(viewer);
    const manager = await this.prisma.user.findFirst({
      where: { id, role: Role.MANAGER },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        managerCapabilities: {
          select: { capability: true, granted: true },
        },
      },
    });
    if (!manager) throw new NotFoundException('manager not found');

    const before = this.capabilitiesFromRows(manager.managerCapabilities);
    await this.prisma.$transaction(async (tx) => {
      for (const [capability, granted] of [
        [ManagerCapabilityType.PROPERTY_APPROVE, dto.canApprove],
        [ManagerCapabilityType.PROPERTY_REJECT, dto.canReject],
      ] as const) {
        await tx.managerCapability.upsert({
          where: {
            managerUserId_capability: {
              managerUserId: id,
              capability,
            },
          },
          create: { managerUserId: id, capability, granted },
          update: { granted },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'MANAGER_PERMISSIONS_UPDATE',
          entityType: 'User',
          entityId: id,
          before,
          after: {
            approveProperties: dto.canApprove,
            rejectProperties: dto.canReject,
          },
        },
      });
    });

    const refreshed = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        managerCapabilities: {
          select: { capability: true, granted: true },
        },
        managedEmployees: {
          orderBy: { createdAt: 'asc' },
          select: {
            userId: true,
            user: { select: { name: true, isActive: true } },
          },
        },
        _count: { select: { managedEmployees: true } },
      },
    });
    return {
      id: refreshed.id,
      name: refreshed.name,
      email: refreshed.email,
      isActive: refreshed.isActive,
      capabilities: this.capabilitiesFromRows(
        refreshed.managerCapabilities,
      ),
      teamCount: refreshed._count.managedEmployees,
      team: refreshed.managedEmployees.map(
        (member): ManagerTeamMemberDto => ({
          id: member.userId,
          name: member.user.name,
          isActive: member.user.isActive,
        }),
      ),
    };
  }

  private async assertAssignableManager(managerUserId: string): Promise<void> {
    const manager = await this.prisma.user.findFirst({
      where: {
        id: managerUserId,
        role: Role.MANAGER,
        isActive: true,
      },
      select: { id: true },
    });
    if (!manager)
      throw new BadRequestException(
        'managerUserId must reference an active MANAGER account',
      );
  }

  private async readOne(id: string): Promise<EmployeeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: EMPLOYEE_SELECT,
    });
    const profileId = user.employee?.id ?? null;
    const [statusByUser, properties, clientsByUser, assignedByProfile, lateByProfile] =
      await Promise.all([
        this.propertyStatusByUser([id]),
        this.prisma.property.findMany({
          where: { createdByUserId: id },
          orderBy: { createdAt: 'desc' },
          take: PROPERTY_LIMIT,
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
          },
        }),
        this.clientsCountsByUser([id]),
        profileId
          ? this.assignedCountsByProfile([profileId])
          : Promise.resolve(new Map<string, number>()),
        profileId
          ? this.lateCountsByProfile([profileId])
          : Promise.resolve(new Map<string, number>()),
      ]);
    const base = this.serializeListItem(
      user,
      statusByUser.get(id) ?? this.emptyStatusCounts(),
      clientsByUser.get(id) ?? 0,
      profileId ? (assignedByProfile.get(profileId) ?? 0) : 0,
      profileId ? (lateByProfile.get(profileId) ?? 0) : 0,
    );
    return {
      ...base,
      properties: properties.map(
        (property): EmployeePropertyDto => ({
          id: property.id,
          reference: property.reference,
          title: property.title,
          status: property.status,
        }),
      ),
    };
  }

  private capabilitiesFromRows(
    rows: Array<{ capability: ManagerCapabilityType; granted: boolean }>,
  ): { approveProperties: boolean; rejectProperties: boolean } {
    const granted = new Set(
      rows.filter((row) => row.granted).map((row) => row.capability),
    );
    return {
      approveProperties: granted.has(
        ManagerCapabilityType.PROPERTY_APPROVE,
      ),
      rejectProperties: granted.has(ManagerCapabilityType.PROPERTY_REJECT),
    };
  }

  private serializeListItem(
    user: EmployeeRow,
    propertiesByStatus: Record<PropertyStatus, number>,
    clientsCount: number,
    assignedCount: number,
    lateCount: number,
  ): EmployeeListItemDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      phone: user.employee?.phone ?? null,
      hiredAt: user.employee?.hiredAt
        ? user.employee.hiredAt.toISOString()
        : null,
      baseSalary: user.employee?.baseSalary
        ? user.employee.baseSalary.toString()
        : null,
      managerUserId: user.employee?.managerUserId ?? null,
      managerName: user.employee?.manager?.name ?? null,
      capabilities:
        user.role === Role.MANAGER
          ? this.capabilitiesFromRows(user.managerCapabilities)
          : null,
      propertyCount: user._count.createdProperties,
      propertiesByStatus,
      clientsCount,
      assignedCount,
      lateCount,
    };
  }
}
