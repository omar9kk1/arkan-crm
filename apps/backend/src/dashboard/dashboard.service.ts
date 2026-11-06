import { Injectable } from '@nestjs/common';
import { ContactType, PropertyStatus, Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
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

/** Kuwait calendar day index (1-based) of a UTC instant. */
function kuwaitDayOfMonth(date: Date): number {
  return new Date(date.getTime() + KUWAIT_OFFSET_MS).getUTCDate();
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

function topEntry(
  counts: Map<string, number>,
  nameFor: (key: string) => string | null,
): { name: string | null; count: number } {
  const entries = [...counts.entries()]
    .map(([key, count]) => ({ name: nameFor(key), count }))
    .filter(
      (entry): entry is { name: string; count: number } => !!entry.name,
    )
    // Stable tie-break by display name so two equal leaders never flip
    // between refreshes.
    .sort(
      (a, b) =>
        b.count - a.count || a.name.localeCompare(b.name, 'ar'),
    );
  return {
    name: entries[0]?.name ?? null,
    count: entries[0]?.count ?? 0,
  };
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
      deals,
      employees,
      clientGroups,
      propertyGroups,
      recentActivity,
    ] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.property.count({ where: { deletedAt: { not: null } } }),
      this.prisma.client.count(),
      this.prisma.client.count({
        where: periodRange ? { createdAt: periodRange } : {},
      }),
      // Official owner Contacts only. Property.proposedOwner is provisional
      // JSON and is deliberately never counted here.
      this.prisma.contact.count({ where: { type: ContactType.OWNER } }),
      this.prisma.contact.count({
        where: {
          type: ContactType.OWNER,
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
      }),
      this.prisma.user.count({ where: { role: Role.EMPLOYEE } }),
      this.prisma.user.count({
        where: { role: Role.EMPLOYEE, isActive: true },
      }),
      this.prisma.followUpSubject.count({
        where: { active: true, nextDueAt: { lt: window.todayStart } },
      }),
      this.prisma.followUpEntry.count({
        where: periodRange ? { createdAt: periodRange } : {},
      }),
      this.prisma.notification.count({
        where: {
          userId: viewer.id,
          eventKey: { startsWith: 'DUPLICATE_ATTEMPT:' },
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
      }),
      this.prisma.deal.findMany({
        where: periodRange ? { closedAt: periodRange } : {},
        select: {
          price: true,
          companyCommission: true,
          closedAt: true,
          propertyEmployeeId: true,
          clientEmployeeId: true,
        },
      }),
      this.prisma.user.findMany({
        where: { role: Role.EMPLOYEE, isActive: true },
        select: {
          id: true,
          name: true,
          employee: { select: { id: true } },
        },
      }),
      this.prisma.client.groupBy({
        by: ['responsibleEmployeeId'],
        where: {
          responsibleEmployeeId: { not: null },
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['createdByUserId'],
        where: {
          deletedAt: null,
          createdByUserId: { not: null },
          ...(periodRange ? { createdAt: periodRange } : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: { in: Object.keys(ACTION_LABELS) },
          ...(periodRange ? { createdAt: periodRange } : {}),
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

    let totalDealValue = 0;
    let totalCommission = 0;
    const dealLeaderCounts = new Map<string, number>();
    for (const deal of deals) {
      totalDealValue += Number(deal.price);
      totalCommission += Number(deal.companyCommission);
      const employeeProfileId =
        deal.propertyEmployeeId ?? deal.clientEmployeeId;
      if (employeeProfileId) {
        dealLeaderCounts.set(
          employeeProfileId,
          (dealLeaderCounts.get(employeeProfileId) ?? 0) + 1,
        );
      }
    }

    // Chart buckets follow the selected period: hours for Today, days for
    // Week/Month/Last Month, and real calendar months for All Time.
    let dailyCounts: number[] = [];
    if (window.bucket === 'month' && !window.start) {
      if (deals.length > 0) {
        const currentMonth = kuwaitMonthIndex(now);
        const indices = deals.map((deal) => kuwaitMonthIndex(deal.closedAt));
        const firstMonth = Math.min(...indices, currentMonth);
        const lastMonth = Math.max(...indices, currentMonth);
        dailyCounts = Array.from(
          { length: lastMonth - firstMonth + 1 },
          () => 0,
        );
        for (const deal of deals) {
          const index = kuwaitMonthIndex(deal.closedAt) - firstMonth;
          if (index >= 0 && index < dailyCounts.length) {
            dailyCounts[index] = (dailyCounts[index] ?? 0) + 1;
          }
        }
      }
    } else {
      dailyCounts = Array.from({ length: window.bucketCount }, () => 0);
      for (const deal of deals) {
        const index =
          window.bucket === 'hour'
            ? kuwaitHourOfDay(deal.closedAt)
            : period === 'week' && window.start
              ? Math.floor(
                  (deal.closedAt.getTime() - window.start.getTime()) /
                    (24 * HOUR_MS),
                )
              : kuwaitDayOfMonth(deal.closedAt) - 1;
        if (index >= 0 && index < dailyCounts.length) {
          dailyCounts[index] = (dailyCounts[index] ?? 0) + 1;
        }
      }
    }

    const employeeIds = new Set(employees.map((employee) => employee.id));
    const profileToName = new Map<string, string>();
    const userIdToName = new Map<string, string>();
    for (const employee of employees) {
      userIdToName.set(employee.id, employee.name);
      if (employee.employee?.id) {
        profileToName.set(employee.employee.id, employee.name);
      }
    }

    const clientLeaderCounts = new Map<string, number>();
    for (const group of clientGroups) {
      if (!group.responsibleEmployeeId) continue;
      clientLeaderCounts.set(
        group.responsibleEmployeeId,
        group._count._all,
      );
    }
    const propertyLeaderCounts = new Map<string, number>();
    for (const group of propertyGroups) {
      if (!group.createdByUserId) continue;
      if (!employeeIds.has(group.createdByUserId)) continue;
      propertyLeaderCounts.set(group.createdByUserId, group._count._all);
    }

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
        countInPeriod: deals.length,
        totalValueInPeriod: decimalString(totalDealValue),
        averageValueInPeriod: decimalString(
          deals.length ? totalDealValue / deals.length : 0,
        ),
        totalCommissionInPeriod: decimalString(totalCommission),
        dailyCounts,
      },
      followUps: {
        late: lateFollowUps,
        completedInPeriod: completedFollowUps,
      },
      leaders: {
        clients: topEntry(
          clientLeaderCounts,
          (profileId) => profileToName.get(profileId) ?? null,
        ),
        properties: topEntry(
          propertyLeaderCounts,
          (userId) => userIdToName.get(userId) ?? null,
        ),
        deals: topEntry(
          dealLeaderCounts,
          (profileId) => profileToName.get(profileId) ?? null,
        ),
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
