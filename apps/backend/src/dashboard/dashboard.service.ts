import { Injectable } from '@nestjs/common';
import { ContactType, Prisma, PropertyStatus, Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { clientOwnershipWhere } from '../clients/client-policy';
import { contactOwnershipWhere } from '../contacts/contact-policy';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import { isManager } from '../common/access/access-policy';
import type {
  ManagerDashboardDto,
  ManagerDashboardPeriod,
} from './dashboard.dto';

const HOUR_MS = 60 * 60 * 1000;
const KUWAIT_OFFSET_MS = 3 * HOUR_MS;

const ACTION_LABELS: Record<string, string> = {
  PROPERTY_CREATE: 'تم تسجيل عقار جديد',
  PROPERTY_UPDATE: 'تم تعديل عقار',
  PROPERTY_APPROVE: 'تم اعتماد عقار',
  PROPERTY_REJECT: 'تم رفض عقار',
  PROPERTY_TRASH: 'تم نقل عقار إلى المحذوفات',
  PROPERTY_RESTORE: 'تم استعادة عقار',
  PROPERTY_DUPLICATE_BLOCKED: 'تم منع تسجيل عقار مكرر',
  CLIENT_CREATE: 'تم إضافة عميل جديد',
  CLIENT_UPDATE: 'تم تحديث بيانات عميل',
  CONTACT_CREATE: 'تم إضافة جهة تواصل',
  CONTACT_UPDATE: 'تم تحديث جهة تواصل',
};

type ChartBucket = 'hour' | 'day' | 'month';

export interface PeriodWindow {
  /** Inclusive start, null for All Time. */
  start: Date | null;
  /** Exclusive end, null for All Time. */
  end: Date | null;
  bucket: ChartBucket;
  /** Fixed bucket count, or 0 for All Time (computed from real deals). */
  bucketCount: number;
  /** Start of TODAY in Kuwait, used by the current overdue metric. */
  todayStart: Date;
}

/** UTC instant of a Kuwait calendar midnight (UTC+3, no DST). */
function kuwaitMidnightUtc(
  year: number,
  month: number,
  day: number,
): Date {
  return new Date(Date.UTC(year, month, day) - KUWAIT_OFFSET_MS);
}

export function periodWindow(
  period: ManagerDashboardPeriod,
  now: Date,
): PeriodWindow {
  const kuwaitNow = new Date(now.getTime() + KUWAIT_OFFSET_MS);
  const year = kuwaitNow.getUTCFullYear();
  const month = kuwaitNow.getUTCMonth();
  const day = kuwaitNow.getUTCDate();
  const weekday = kuwaitNow.getUTCDay();
  const todayStart = kuwaitMidnightUtc(year, month, day);

  switch (period) {
    case 'today':
      return {
        start: todayStart,
        end: new Date(todayStart.getTime() + 24 * HOUR_MS),
        bucket: 'hour',
        bucketCount: 24,
        todayStart,
      };
    case 'week': {
      // Arabic Saturday–Friday week.
      const daysSinceSaturday = (weekday + 1) % 7;
      const start = new Date(
        todayStart.getTime() - daysSinceSaturday * 24 * HOUR_MS,
      );
      return {
        start,
        end: new Date(start.getTime() + 7 * 24 * HOUR_MS),
        bucket: 'day',
        bucketCount: 7,
        todayStart,
      };
    }
    case 'last_month': {
      const previousYear = month === 0 ? year - 1 : year;
      const previousMonth = (month + 11) % 12;
      return {
        start: kuwaitMidnightUtc(previousYear, previousMonth, 1),
        end: kuwaitMidnightUtc(year, month, 1),
        bucket: 'day',
        bucketCount: new Date(
          Date.UTC(previousYear, previousMonth + 1, 0),
        ).getUTCDate(),
        todayStart,
      };
    }
    case 'all':
      return {
        start: null,
        end: null,
        bucket: 'month',
        bucketCount: 0,
        todayStart,
      };
    case 'month':
    default:
      return {
        start: kuwaitMidnightUtc(year, month, 1),
        end: kuwaitMidnightUtc(year, month + 1, 1),
        bucket: 'day',
        bucketCount: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
        todayStart,
      };
  }
}

/** Kuwait hour of day (0–23) of a UTC instant. */
export function kuwaitHourOfDay(date: Date): number {
  return new Date(date.getTime() + KUWAIT_OFFSET_MS).getUTCHours();
}

/** Absolute Kuwait month index (year * 12 + month). */
function kuwaitMonthIndex(date: Date): number {
  const kuwait = new Date(date.getTime() + KUWAIT_OFFSET_MS);
  return kuwait.getUTCFullYear() * 12 + kuwait.getUTCMonth();
}

/** Optional inclusive/exclusive `createdAt`/`closedAt` range filter. */
function rangeFilter(
  window: PeriodWindow,
): { gte: Date; lt: Date } | undefined {
  if (!window.start || !window.end) return undefined;
  return { gte: window.start, lt: window.end };
}

function decimalString(value: unknown): string {
  if (value === null || value === undefined) return '0';
  return String(value);
}

/**
 * Exact decimal(15,3) (KWD fils) helpers. PostgreSQL returns the deal sums as
 * exact numeric text; accumulating them as integer fils avoids the
 * floating-point drift of summing `Number(price)` row by row. Values from an
 * older decimal(14,2) column still parse correctly (e.g. "1.50" = 1.500).
 */
function decimalToFils(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const fils =
    BigInt(whole || '0') * 1000n + BigInt((fraction + '000').slice(0, 3));
  return negative ? -fils : fils;
}

function filsToDecimalString(fils: bigint): string {
  const negative = fils < 0n;
  const absolute = negative ? -fils : fils;
  const fraction = (absolute % 1000n)
    .toString()
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / 1000n}${fraction ? `.${fraction}` : ''}`;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One Manager-only read used by the whole home dashboard. Every query is a
   * database aggregate/count; no per-row fan-out and no business-data writes.
   */
  async managerDashboard(
    viewer: AuthUser,
    period: ManagerDashboardPeriod = 'month',
  ): Promise<ManagerDashboardDto> {
    const now = new Date();
    const window = periodWindow(period, now);
    const periodRange = rangeFilter(window);
    const periodStart = periodRange?.gte ?? null;
    const periodEnd = periodRange?.lt ?? null;
    const managerId = isManager(viewer) ? viewer.id : null;

    // OWNER is company-wide. MANAGER metrics are restricted to the employees
    // currently assigned to that Manager (plus the Manager's own activity).
    const managerScoped = isManager(viewer);
    // Express the current team as relation predicates. Loading the full team
    // user/profile arrays on every dashboard request was pure overhead:
    // PostgreSQL can use the same indexes directly and the arrays are not
    // needed by any response field.
    const employeeScope: Prisma.UserWhereInput = managerScoped
      ? { employee: { managerUserId: viewer.id } }
      : {};
    const propertyScope = propertyVisibilityWhere(viewer);
    const clientScope = clientOwnershipWhere(viewer);
    const contactScope = contactOwnershipWhere(viewer);

    // Chart bucket expression evaluated in PostgreSQL with the same fixed
    // UTC+3 Kuwait offset the response has always used. The expression is
    // selected from a closed set, never from user input.
    const dealBucket: Prisma.Sql =
      window.bucket === 'hour'
        ? Prisma.sql`EXTRACT(hour FROM d."closedAt" + interval '3 hours')::int`
        : window.bucket === 'month'
          ? Prisma.sql`(EXTRACT(year FROM d."closedAt" + interval '3 hours')::int * 12 + EXTRACT(month FROM d."closedAt" + interval '3 hours')::int - 1)`
          : period === 'week' && window.start
            ? Prisma.sql`FLOOR(EXTRACT(epoch FROM (d."closedAt" - ${window.start}::timestamp)) / 86400)::int`
            : Prisma.sql`(EXTRACT(day FROM d."closedAt" + interval '3 hours')::int - 1)`;
    const dealManagerScope = managerScoped
      ? Prisma.sql`
          AND (
            d."propertyEmployeeId" IN (SELECT id FROM "EmployeeProfile" WHERE "managerUserId" = ${viewer.id}::uuid)
            OR d."clientEmployeeId" IN (SELECT id FROM "EmployeeProfile" WHERE "managerUserId" = ${viewer.id}::uuid)
          )`
      : Prisma.empty;

    const [
      propertyStatusRows,
      trashProperties,
      totalClients,
      newClients,
      totalOwners,
      newOwners,
      totalEmployees,
      activeEmployees,
      lateFollowUps,
      completedFollowUps,
      duplicateAttempts,
      dealBuckets,
      clientLeaderRows,
      propertyLeaderRows,
      dealLeaderRows,
      recentActivity,
    ] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: { ...propertyScope },
        _count: { _all: true },
      }),
      this.prisma.property.count({
        where: {
          deletedAt: { not: null },
          ...(managerScoped
            ? {
                OR: [
                  { createdByUserId: viewer.id },
                  {
                    createdByUser: {
                      employee: { managerUserId: viewer.id },
                    },
                  },
                ],
              }
            : {}),
        },
      }),
      this.prisma.client.count({ where: { ...clientScope } }),
      this.prisma.client.count({
        where: {
          ...clientScope,
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
      }),
      // Official owner Contacts only. Property.proposedOwner is provisional
      // JSON and is deliberately never counted here.
      this.prisma.contact.count({
        where: { type: ContactType.OWNER, ...contactScope },
      }),
      this.prisma.contact.count({
        where: {
          type: ContactType.OWNER,
          ...contactScope,
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
      }),
      this.prisma.user.count({
        where: { role: Role.EMPLOYEE, ...employeeScope },
      }),
      this.prisma.user.count({
        where: { role: Role.EMPLOYEE, isActive: true, ...employeeScope },
      }),
      this.prisma.followUpSubject.count({
        where: {
          active: true,
          nextDueAt: { lt: window.todayStart },
          ...(managerScoped
            ? {
                OR: [
                  { responsible: { managerUserId: viewer.id } },
                  { responsibleUserId: viewer.id },
                ],
              }
            : {}),
        },
      }),
      this.prisma.followUpEntry.count({
        where: {
          ...(periodRange ? { createdAt: periodRange } : {}),
          ...(managerScoped
            ? {
                OR: [
                  { author: { managerUserId: viewer.id } },
                  { authorUserId: viewer.id },
                ],
              }
            : {}),
        },
      }),
      this.prisma.notification.count({
        where: {
          userId: viewer.id,
          eventKey: { startsWith: 'DUPLICATE_ATTEMPT:' },
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
      }),
      // Deal totals + chart buckets are aggregated in PostgreSQL. The old
      // implementation transferred every matching deal (5,000 rows all-time)
      // and summed them in JavaScript.
      this.prisma.$queryRaw<
        Array<{
          bucket: number;
          count: number;
          value: string;
          commission: string;
        }>
      >(Prisma.sql`
        SELECT ${dealBucket} AS bucket,
               COUNT(*)::int AS "count",
               SUM(d.price)::text AS value,
               SUM(d."companyCommission")::text AS commission
        FROM "Deal" d
        WHERE TRUE
          ${
            periodRange
              ? Prisma.sql`AND d."closedAt" >= ${periodRange.gte}::timestamp AND d."closedAt" < ${periodRange.lt}::timestamp`
              : Prisma.empty
          }
          ${dealManagerScope}
        GROUP BY 1
        ORDER BY 1
      `),
      this.prisma.$queryRaw<Array<{ name: string; count: number }>>`
        SELECT u.name, COUNT(*)::int AS count
        FROM "Client" c
        JOIN "EmployeeProfile" e ON e.id = c."responsibleEmployeeId"
        JOIN "User" u ON u.id = e."userId"
        WHERE c."responsibleEmployeeId" IS NOT NULL
          AND u.role = 'EMPLOYEE'
          AND u."isActive" = true
          AND (${managerId}::uuid IS NULL OR e."managerUserId" = ${managerId}::uuid)
          AND (${periodStart}::timestamptz IS NULL OR c."createdAt" >= ${periodStart}::timestamptz)
          AND (${periodEnd}::timestamptz IS NULL OR c."createdAt" < ${periodEnd}::timestamptz)
        GROUP BY u.id, u.name
        ORDER BY count DESC, u.name ASC
        LIMIT 1
      `,
      this.prisma.$queryRaw<Array<{ name: string; count: number }>>`
        SELECT u.name, COUNT(*)::int AS count
        FROM "Property" p
        JOIN "User" u ON u.id = p."createdByUserId"
        JOIN "EmployeeProfile" e ON e."userId" = u.id
        WHERE p."deletedAt" IS NULL
          AND p."createdByUserId" IS NOT NULL
          AND u.role = 'EMPLOYEE'
          AND u."isActive" = true
          AND (${managerId}::uuid IS NULL OR e."managerUserId" = ${managerId}::uuid)
          AND (${periodStart}::timestamptz IS NULL OR p."createdAt" >= ${periodStart}::timestamptz)
          AND (${periodEnd}::timestamptz IS NULL OR p."createdAt" < ${periodEnd}::timestamptz)
        GROUP BY u.id, u.name
        ORDER BY count DESC, u.name ASC
        LIMIT 1
      `,
      this.prisma.$queryRaw<Array<{ name: string; count: number }>>`
        SELECT u.name, COUNT(*)::int AS count
        FROM "Deal" d
        JOIN "EmployeeProfile" e
          ON e.id = COALESCE(d."propertyEmployeeId", d."clientEmployeeId")
        JOIN "User" u ON u.id = e."userId"
        WHERE (d."propertyEmployeeId" IS NOT NULL OR d."clientEmployeeId" IS NOT NULL)
          AND u.role = 'EMPLOYEE'
          AND u."isActive" = true
          AND (${managerId}::uuid IS NULL OR e."managerUserId" = ${managerId}::uuid)
          AND (${periodStart}::timestamptz IS NULL OR d."closedAt" >= ${periodStart}::timestamptz)
          AND (${periodEnd}::timestamptz IS NULL OR d."closedAt" < ${periodEnd}::timestamptz)
        GROUP BY u.id, u.name
        ORDER BY count DESC, u.name ASC
        LIMIT 1
      `,
      this.prisma.auditLog.findMany({
        where: {
          action: { in: Object.keys(ACTION_LABELS) },
          ...(periodRange ? { createdAt: periodRange } : {}),
          ...(managerScoped
            ? {
                OR: [
                  { actor: { employee: { managerUserId: viewer.id } } },
                  { actorId: viewer.id },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { action: true, actor: { select: { name: true } } },
      }),
    ]);

    const statusCounts = new Map<PropertyStatus, number>();
    for (const row of propertyStatusRows) {
      statusCounts.set(row.status, row._count._all);
    }
    const countStatus = (status: PropertyStatus) =>
      statusCounts.get(status) ?? 0;
    const totalProperties = propertyStatusRows.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );

    let dealCount = 0;
    let totalDealValueFils = 0n;
    let totalCommissionFils = 0n;
    for (const bucket of dealBuckets) {
      dealCount += bucket.count;
      totalDealValueFils += decimalToFils(bucket.value);
      totalCommissionFils += decimalToFils(bucket.commission);
    }
    const totalDealValue = filsToDecimalString(totalDealValueFils);
    const totalCommission = filsToDecimalString(totalCommissionFils);

    // Chart buckets follow the selected period: hours for Today, days for
    // Week/Month/Last Month, and real calendar months for All Time.
    let dailyCounts: number[] = [];
    if (window.bucket === 'month' && !window.start) {
      if (dealBuckets.length > 0) {
        const currentMonth = kuwaitMonthIndex(now);
        const firstBucket = dealBuckets[0]?.bucket ?? currentMonth;
        const lastBucket =
          dealBuckets[dealBuckets.length - 1]?.bucket ?? currentMonth;
        const firstMonth = Math.min(firstBucket, currentMonth);
        const lastMonth = Math.max(lastBucket, currentMonth);
        dailyCounts = Array.from(
          { length: lastMonth - firstMonth + 1 },
          () => 0,
        );
        for (const bucket of dealBuckets) {
          const index = bucket.bucket - firstMonth;
          if (index >= 0 && index < dailyCounts.length) {
            dailyCounts[index] = (dailyCounts[index] ?? 0) + bucket.count;
          }
        }
      }
    } else {
      dailyCounts = Array.from({ length: window.bucketCount }, () => 0);
      for (const bucket of dealBuckets) {
        const index = bucket.bucket;
        if (index >= 0 && index < dailyCounts.length) {
          dailyCounts[index] = (dailyCounts[index] ?? 0) + bucket.count;
        }
      }
    }

    const leader = (rows: Array<{ name: string; count: number }>) => ({
      name: rows[0]?.name ?? null,
      count: Number(rows[0]?.count ?? 0),
    });

    const activity = recentActivity.length
      ? recentActivity.map((row) => ({
          title: ACTION_LABELS[row.action] ?? 'نشاط جديد',
          detail: `بواسطة ${row.actor.name}`,
        }))
      : [
          {
            title: 'لا يوجد نشاط حديث',
            detail: 'لم يُسجَّل نشاط بعد.',
          },
        ];

    return {
      period,
      chartBucket: window.bucket,
      properties: {
        total: totalProperties,
        available: countStatus(PropertyStatus.AVAILABLE),
        pending: countStatus(PropertyStatus.PENDING),
        sold: countStatus(PropertyStatus.SOLD),
        rented: countStatus(PropertyStatus.RENTED),
        rejected: countStatus(PropertyStatus.REJECTED),
        archived: countStatus(PropertyStatus.ARCHIVED),
        trash: trashProperties,
      },
      clients: {
        total: totalClients,
        newInPeriod: newClients,
      },
      owners: {
        total: totalOwners,
        newInPeriod: newOwners,
      },
      employees: {
        total: totalEmployees,
        active: activeEmployees,
      },
      deals: {
        countInPeriod: dealCount,
        totalValueInPeriod: totalDealValue,
        averageValueInPeriod: decimalString(
          dealCount ? Number(totalDealValue) / dealCount : 0,
        ),
        totalCommissionInPeriod: totalCommission,
        dailyCounts,
      },
      followUps: {
        late: lateFollowUps,
        completedInPeriod: completedFollowUps,
      },
      leaders: {
        clients: leader(clientLeaderRows),
        properties: leader(propertyLeaderRows),
        deals: leader(dealLeaderRows),
      },
      alerts: {
        lateFollowUps,
        pendingApprovals: countStatus(PropertyStatus.PENDING),
        duplicateAttempts,
      },
      activity,
    };
  }
}
