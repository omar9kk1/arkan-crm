import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  ManagerCapabilityType,
  NotificationType,
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
import { clientReviewOwnershipReady } from '../clients/client-review-schema';

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
} satisfies Prisma.UserSelect;

type EmployeeRow = Prisma.UserGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

/** Per-row metrics for one page of the directory. */
interface EmployeePageMetric {
  propertyCount: number;
  propertiesByStatus: Record<PropertyStatus, number>;
  clientsCount: number;
  assignedCount: number;
  lateCount: number;
}

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
    const limit = Math.min(
      query.limit ?? DEFAULT_EMPLOYEE_PAGE_SIZE,
      MAX_EMPLOYEE_PAGE_SIZE,
    );
    // Summary is full-scope and independent of the page; start it alongside
    // the page query instead of serialising two full aggregations.
    const summaryPromise = query.cursor
      ? Promise.resolve(undefined)
      : this.directorySummary(viewer);
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
    const metrics = await this.pageMetrics(userIds);

    const summary = await summaryPromise;
    return {
      items: page.map((user) =>
        this.serializeListItem(
          user,
          metrics.get(user.id) ?? this.emptyPageMetric(),
        ),
      ),
      nextCursor: pageResult.nextCursor,
      ...(summary ? { summary } : {}),
    };
  }

  /**
   * Set-based metric CTE. Each canonical table is aggregated once and joined
   * to the already-scoped employees; no correlated subquery runs per employee.
   * `UNION` keeps the same distinct-client / distinct-deal semantics.
   */
  private employeeMetricCte(sort: EmployeeSortKey): {
    cte: Prisma.Sql;
    metric: Prisma.Sql;
    join: Prisma.Sql;
  } {
    if (sort === 'propertiesCount') {
      return {
        cte: Prisma.sql`property_counts AS (
          SELECT p."createdByUserId" AS user_id, COUNT(*)::int AS metric
          FROM "Property" p
          WHERE p."createdByUserId" IS NOT NULL
          GROUP BY p."createdByUserId"
        )`,
        metric: Prisma.sql`COALESCE(pc.metric, 0)::int`,
        join: Prisma.sql`LEFT JOIN property_counts pc ON pc.user_id = s.id`,
      };
    }
    if (sort === 'dealsCount') {
      return {
        cte: Prisma.sql`
          deal_pairs AS (
            SELECT d."propertyEmployeeId" AS profile_id, d.id
            FROM "Deal" d WHERE d."propertyEmployeeId" IS NOT NULL
            UNION
            SELECT d."clientEmployeeId", d.id
            FROM "Deal" d WHERE d."clientEmployeeId" IS NOT NULL
          ),
          deal_counts AS (
            SELECT s.profile_id, COUNT(*)::int AS metric
            FROM deal_pairs dp
            JOIN scoped s ON s.profile_id = dp.profile_id
            GROUP BY s.profile_id
          )`,
        metric: Prisma.sql`COALESCE(dc.metric, 0)::int`,
        join: Prisma.sql`LEFT JOIN deal_counts dc ON dc.profile_id = s.profile_id`,
      };
    }
    return {
      cte: Prisma.sql`
        client_pairs AS (
          SELECT c."createdById" AS profile_id, c.id
          FROM "Client" c WHERE c."createdById" IS NOT NULL
          UNION
          SELECT c."responsibleEmployeeId", c.id
          FROM "Client" c WHERE c."responsibleEmployeeId" IS NOT NULL
        ),
        client_counts AS (
          SELECT s.profile_id, COUNT(*)::int AS metric
          FROM client_pairs cp
          JOIN scoped s ON s.profile_id = cp.profile_id
          GROUP BY s.profile_id
        )`,
      metric: Prisma.sql`COALESCE(cc.metric, 0)::int`,
      join: Prisma.sql`LEFT JOIN client_counts cc ON cc.profile_id = s.profile_id`,
    };
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
    const metric = this.employeeMetricCte(
      query.sort ?? 'clientsCount',
    );
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; metric: number }>
    >`
      WITH scoped AS (
        SELECT u.id,
               u."isActive",
               e.id AS profile_id
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
      ),
      ${metric.cte},
      counted AS (
        SELECT s.id, ${metric.metric} AS metric
        FROM scoped s
        ${metric.join}
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

  private emptyPageMetric(): EmployeePageMetric {
    return {
      propertyCount: 0,
      propertiesByStatus: this.emptyStatusCounts(),
      clientsCount: 0,
      assignedCount: 0,
      lateCount: 0,
    };
  }

  /**
   * One set-based query for every per-row metric of the page: property counts
   * by status, clients, assignments and late follow-ups. The four previous
   * queries (and the `_count.createdProperties` relation count) are merged so
   * a request acquires one connection instead of five.
   */
  private async pageMetrics(
    userIds: string[],
  ): Promise<Map<string, EmployeePageMetric>> {
    const out = new Map<string, EmployeePageMetric>();
    if (!userIds.length) return out;
    const list = Prisma.join(
      userIds.map((id) => Prisma.sql`${id}::uuid`),
    );
    const key = kuwaitDayKey(new Date());
    const start = new Date(
      Date.parse(`${key}T00:00:00.000Z`) - 3 * HOUR_MS,
    );
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        propertyCount: number;
        available: number;
        pending: number;
        sold: number;
        rented: number;
        rejected: number;
        archived: number;
        clientsCount: number;
        assignedCount: number;
        lateCount: number;
      }>
    >`
      WITH ids AS (
        SELECT unnest(ARRAY[${list}]::uuid[]) AS id
      ),
      props AS (
        SELECT p."createdByUserId" AS uid,
               COUNT(*)::int AS property_count,
               COUNT(*) FILTER (WHERE p.status = 'AVAILABLE')::int AS available,
               COUNT(*) FILTER (WHERE p.status = 'PENDING')::int AS pending,
               COUNT(*) FILTER (WHERE p.status = 'SOLD')::int AS sold,
               COUNT(*) FILTER (WHERE p.status = 'RENTED')::int AS rented,
               COUNT(*) FILTER (WHERE p.status = 'REJECTED')::int AS rejected,
               COUNT(*) FILTER (WHERE p.status = 'ARCHIVED')::int AS archived
        FROM "Property" p
        JOIN ids ON ids.id = p."createdByUserId"
        GROUP BY 1
      ),
      client_counts AS (
        SELECT pr."userId" AS uid, COUNT(DISTINCT c.id)::int AS cnt
        FROM "EmployeeProfile" pr
        JOIN ids ON ids.id = pr."userId"
        JOIN "Client" c
          ON c."createdById" = pr.id OR c."responsibleEmployeeId" = pr.id
        GROUP BY 1
      ),
      assigned_counts AS (
        SELECT pr."userId" AS uid, COUNT(DISTINCT a."propertyId")::int AS cnt
        FROM "EmployeeProfile" pr
        JOIN ids ON ids.id = pr."userId"
        JOIN "PropertyAssignment" a ON a."employeeId" = pr.id
        GROUP BY 1
      ),
      late_counts AS (
        SELECT pr."userId" AS uid, COUNT(f.id)::int AS cnt
        FROM "EmployeeProfile" pr
        JOIN ids ON ids.id = pr."userId"
        JOIN "FollowUpSubject" f ON f."responsibleId" = pr.id
        WHERE f.active AND f."nextDueAt" < ${start}::timestamptz
        GROUP BY 1
      )
      SELECT ids.id AS "userId",
             COALESCE(pr.property_count, 0)::int AS "propertyCount",
             COALESCE(pr.available, 0)::int AS available,
             COALESCE(pr.pending, 0)::int AS pending,
             COALESCE(pr.sold, 0)::int AS sold,
             COALESCE(pr.rented, 0)::int AS rented,
             COALESCE(pr.rejected, 0)::int AS rejected,
             COALESCE(pr.archived, 0)::int AS archived,
             COALESCE(cc.cnt, 0)::int AS "clientsCount",
             COALESCE(ac.cnt, 0)::int AS "assignedCount",
             COALESCE(lc.cnt, 0)::int AS "lateCount"
      FROM ids
      LEFT JOIN props pr ON pr.uid = ids.id
      LEFT JOIN client_counts cc ON cc.uid = ids.id
      LEFT JOIN assigned_counts ac ON ac.uid = ids.id
      LEFT JOIN late_counts lc ON lc.uid = ids.id
    `;
    for (const row of rows) {
      out.set(row.userId, {
        propertyCount: row.propertyCount,
        propertiesByStatus: {
          [PropertyStatus.AVAILABLE]: row.available,
          [PropertyStatus.PENDING]: row.pending,
          [PropertyStatus.SOLD]: row.sold,
          [PropertyStatus.RENTED]: row.rented,
          [PropertyStatus.REJECTED]: row.rejected,
          [PropertyStatus.ARCHIVED]: row.archived,
        },
        clientsCount: row.clientsCount,
        assignedCount: row.assignedCount,
        lateCount: row.lateCount,
      });
    }
    return out;
  }

  private async directorySummary(
    viewer: AuthUser,
  ): Promise<EmployeeSummaryDto> {
    const managerId = isManager(viewer) ? viewer.id : null;
    const key = kuwaitDayKey(new Date());
    const start = new Date(
      Date.parse(`${key}T00:00:00.000Z`) - 3 * HOUR_MS,
    );
    const rows = await this.prisma.$queryRaw<
      Array<{
        total: number;
        active: number;
        clients_total: number;
        late_total: number;
      }>
    >`
      WITH scoped AS (
        SELECT u.id,
               u."isActive",
               e.id AS profile_id
        FROM "User" u
        LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
        WHERE u.role = 'EMPLOYEE'
          AND (${managerId}::uuid IS NULL OR e."managerUserId" = ${managerId}::uuid)
      ),
      client_pairs AS (
        SELECT c."createdById" AS profile_id, c.id
        FROM "Client" c WHERE c."createdById" IS NOT NULL
        UNION
        SELECT c."responsibleEmployeeId", c.id
        FROM "Client" c WHERE c."responsibleEmployeeId" IS NOT NULL
      ),
      client_counts AS (
        SELECT s.profile_id, COUNT(*)::int AS cnt
        FROM client_pairs cp
        JOIN scoped s ON s.profile_id = cp.profile_id
        GROUP BY s.profile_id
      ),
      late_counts AS (
        SELECT s.profile_id, COUNT(f.id)::int AS cnt
        FROM "FollowUpSubject" f
        JOIN scoped s ON s.profile_id = f."responsibleId"
        WHERE f.active AND f."nextDueAt" < ${start}::timestamptz
        GROUP BY s.profile_id
      )
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE s."isActive")::int AS active,
             COALESCE(SUM(cc.cnt), 0)::int AS clients_total,
             COALESCE(SUM(lc.cnt), 0)::int AS late_total
      FROM scoped s
      LEFT JOIN client_counts cc ON cc.profile_id = s.profile_id
      LEFT JOIN late_counts lc ON lc.profile_id = s.profile_id
    `;
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      clientsTotal: Number(row?.clients_total ?? 0),
      lateTotal: Number(row?.late_total ?? 0),
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
   * `PATCH /employees/:id/manager` — OWNER transfers an EMPLOYEE.
   *
   * Atomic and idempotent:
   * - the direct supervisor changes;
   * - every genuinely PENDING client review moves to the new supervisor;
   * - pending property approval rounds are counted in the transfer audit (their
   *   live reviewer scope moves with the employee automatically);
   * - one audit event records previous/new supervisor + affected ids/count;
   * - the new reviewer gets one deduplicated notification when work moved.
   *
   * APPROVED/REJECTED/CHANGES_REQUESTED rows keep their historical reviewer.
   * `null` means direct OWNER supervision.
   */
  async assignManager(
    viewer: AuthUser,
    id: string,
    dto: AssignEmployeeManagerDto,
  ): Promise<EmployeeDto> {
    assertOwner(viewer);
    if (!(await clientReviewOwnershipReady(this.prisma)))
      throw new ServiceUnavailableException(
        'ترحيل ملكية مراجعات العملاء غير مطبّق على قاعدة البيانات هذه بعد. لم يتم تفعيل نقل طلبات المراجعة؛ يلزم تطبيق الترحيل المعتمد أولًا.',
      );

    if (dto.managerUserId)
      await this.assertAssignableManager(dto.managerUserId);

    await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent transfers of the same employee. The second
      // transaction waits, then observes the committed destination and
      // becomes a no-op instead of splitting pending rows or double-auditing.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${id})::bigint)`,
      );

      const target = await tx.user.findFirst({
        where: { id, role: Role.EMPLOYEE },
        select: {
          id: true,
          name: true,
          employee: { select: { managerUserId: true } },
        },
      });
      if (!target) throw new NotFoundException('employee not found');

      if (dto.managerUserId)
        await this.assertAssignableManager(dto.managerUserId, tx);

      const previousManagerUserId =
        target.employee?.managerUserId ?? null;
      const nextManagerUserId = dto.managerUserId ?? null;
      if (previousManagerUserId === nextManagerUserId) return;

      const pendingClientReviews = await tx.clientReviewRequest.findMany({
        where: { requestedById: id, status: ApprovalStatus.PENDING },
        select: { id: true },
      });
      const pendingPropertyRequests =
        await tx.propertyApprovalRequest.findMany({
          where: {
            requestedById: id,
            status: ApprovalStatus.PENDING,
            property: {
              status: PropertyStatus.PENDING,
              deletedAt: null,
            },
          },
          select: { id: true },
        });

      await tx.employeeProfile.upsert({
        where: { userId: id },
        create: { userId: id, managerUserId: nextManagerUserId },
        update: { managerUserId: nextManagerUserId },
      });

      if (pendingClientReviews.length) {
        await tx.clientReviewRequest.updateMany({
          where: {
            id: { in: pendingClientReviews.map((row) => row.id) },
          },
          data: { assignedReviewerId: nextManagerUserId },
        });
      }

      const affectedPendingReviewIds = [
        ...pendingClientReviews.map((row) => row.id),
        ...pendingPropertyRequests.map((row) => row.id),
      ];
      const audit = await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'EMPLOYEE_ASSIGN_MANAGER',
          entityType: 'User',
          entityId: id,
          before: { managerUserId: previousManagerUserId },
          after: {
            managerUserId: nextManagerUserId,
            affectedPendingReviewIds,
            affectedPendingReviewCount: affectedPendingReviewIds.length,
            affectedPendingClientReviewCount: pendingClientReviews.length,
            affectedPendingPropertyReviewCount: pendingPropertyRequests.length,
          },
        },
        select: { id: true },
      });

      if (!affectedPendingReviewIds.length) return;

      const recipients = nextManagerUserId
        ? [nextManagerUserId]
        : (
            await tx.user.findMany({
              where: { role: Role.OWNER, isActive: true },
              select: { id: true },
            })
          ).map((owner) => owner.id);
      if (!recipients.length) return;

      const countLabel =
        affectedPendingReviewIds.length === 1
          ? 'طلب مراجعة معلّق واحد'
          : `${affectedPendingReviewIds.length} طلبات مراجعة معلّقة`;
      await tx.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          type: NotificationType.SYSTEM,
          title: 'طلبات مراجعة منقولة إليك',
          body: `تم نقل ${countLabel} للموظف ${target.name} إليك بعد تحديث المشرف المباشر.`,
          eventKey: `REVIEW_TRANSFER:${audit.id}`,
        })),
        skipDuplicates: true,
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

  private async assertAssignableManager(
    managerUserId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const manager = await db.user.findFirst({
      where: {
        id: managerUserId,
        role: Role.MANAGER,
        isActive: true,
      },
      select: { id: true },
    });
    if (!manager)
      throw new BadRequestException(
        'المدير المحدد غير موجود أو غير نشط. اختر مديراً نشطاً.',
      );
  }

  private async readOne(id: string): Promise<EmployeeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: EMPLOYEE_SELECT,
    });
    const [metrics, properties] = await Promise.all([
      this.pageMetrics([id]),
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
    ]);
    const base = this.serializeListItem(
      user,
      metrics.get(id) ?? this.emptyPageMetric(),
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
    metric: EmployeePageMetric,
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
      propertyCount: metric.propertyCount,
      propertiesByStatus: metric.propertiesByStatus,
      clientsCount: metric.clientsCount,
      assignedCount: metric.assignedCount,
      lateCount: metric.lateCount,
    };
  }
}
