import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  type TestContext,
} from './support/test-app';
import {
  periodWindow,
  type PeriodWindow,
} from '../src/dashboard/dashboard.service';
import type { ManagerDashboardPeriod } from '../src/dashboard/dashboard.dto';

jest.setTimeout(180000);

type PeriodDashboard = {
  period: ManagerDashboardPeriod;
  chartBucket: 'hour' | 'day' | 'month';
  properties: { total: number };
  clients: { total: number; newInPeriod: number };
  owners: { total: number; newInPeriod: number };
  employees: { total: number; active: number };
  deals: {
    countInPeriod: number;
    totalValueInPeriod: string;
    averageValueInPeriod: string;
    totalCommissionInPeriod: string;
    dailyCounts: number[];
  };
  followUps: { late: number; completedInPeriod: number };
  alerts: {
    lateFollowUps: number;
    pendingApprovals: number;
    duplicateAttempts: number;
  };
  activity: Array<{ title: string; detail: string }>;
};

const PERIODS: ManagerDashboardPeriod[] = [
  'today',
  'week',
  'month',
  'last_month',
  'all',
];

const inWindow = (date: Date, window: PeriodWindow): boolean => {
  if (!window.start || !window.end) return true;
  return date >= window.start && date < window.end;
};

describeWithDatabase('Manager dashboard period filtering', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;
  let managerId: string;
  let employeeId: string;
  let propertyId: string;
  let clientId: string;
  let subjectId: string;
  let dates: Date[] = [];
  let amounts: number[] = [];
  let commissions: number[] = [];
  const api = () => request(ctx.app.getHttpServer());

  const read = (period: ManagerDashboardPeriod) =>
    api()
      .get(`/dashboard/manager?period=${period}`)
      .set(auth(managerToken));

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'period-manager@test.local',
      name: 'Period Manager',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'period-employee@test.local',
      name: 'Period Employee',
      role: Role.EMPLOYEE,
    });
    const profile = await ctx.prisma.employeeProfile.upsert({ where: { userId: employee.id }, create: { userId: employee.id }, update: {} });
    managerId = manager.id;
    employeeId = employee.id;
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);

    const now = new Date();
    const today = periodWindow('today', now);
    const week = periodWindow('week', now);
    const month = periodWindow('month', now);
    const lastMonth = periodWindow('last_month', now);
    const hour = 60 * 60 * 1000;

    // Every period boundary is represented, plus exact start/end edges for
    // Today, a week-start instant, month-start, last-month and an old record.
    dates = [
      new Date(today.start!.getTime()),
      new Date(today.start!.getTime() + hour),
      new Date(today.end!),
      new Date(week.start!.getTime() + hour),
      new Date(month.start!.getTime() + hour),
      new Date(lastMonth.start!.getTime() + hour),
      new Date('2025-01-15T12:00:00.000Z'),
    ];
    amounts = dates.map((_, index) => 100_000 + index * 1_000);
    commissions = dates.map((_, index) => 1_000 + index * 100);

    const property = await ctx.prisma.property.create({
      data: {
        reference: 'PERIOD-DASH-PROP',
        title: 'Period dashboard property',
        area: 'مدينة المطلاع',
        listingType: 'SALE',
        status: 'AVAILABLE',
        currency: 'KWD',
        createdByUserId: employeeId,
      },
    });
    propertyId = property.id;
    const client = await ctx.prisma.client.create({
      data: {
        name: 'Period Client',
        phone: '67770001',
        responsibleEmployeeId: profile.id,
        createdAt: dates[0]!,
      },
    });
    clientId = client.id;

    for (let index = 0; index < dates.length; index += 1) {
      const createdAt = dates[index]!;
      await ctx.prisma.client.create({
        data: {
          name: `Period Client ${index}`,
          phone: `6777100${index}`,
          responsibleEmployeeId: profile.id,
          createdAt,
        },
      });
      await ctx.prisma.contact.create({
        data: {
          type: 'OWNER',
          name: `Period Owner ${index}`,
          phone: `6777200${index}`,
          responsibleUserId: employeeId,
          createdAt,
        },
      });
      await ctx.prisma.notification.create({
        data: {
          userId: managerId,
          type: 'SYSTEM',
          title: 'محاولة تسجيل عقار مكرر',
          body: `Period duplicate ${index}`,
          propertyId,
          eventKey: `DUPLICATE_ATTEMPT:${propertyId}:${employeeId}:${index}`,
          createdAt,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          actorId: managerId,
          action: 'PROPERTY_CREATE',
          entityType: 'Property',
          entityId: propertyId,
          after: { status: 'AVAILABLE' },
          createdAt,
        },
      });
      await ctx.prisma.deal.create({
        data: {
          reference: `PERIOD-DEAL-${index}`,
          type: 'SALE',
          propertyId,
          clientId,
          recordedById: employeeId,
          propertyEmployeeId: profile.id,
          price: String(amounts[index]),
          companyCommission: String(commissions[index]),
          currency: 'KWD',
          closedAt: createdAt,
        },
      });
    }

    const subject = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `PERIOD-SUBJECT:${propertyId}`,
        kind: 'PROPERTY_OWNER',
        propertyId,
        responsibleUserId: managerId,
        activatedAt: now,
        nextDueAt: new Date(now.getTime() + 24 * hour),
        active: true,
      },
    });
    subjectId = subject.id;
    for (let index = 0; index < dates.length; index += 1) {
      await ctx.prisma.followUpEntry.create({
        data: {
          subjectId,
          note: `Period entry ${index}`,
          authorUserId: managerId,
          createdAt: dates[index],
        },
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('applies every period with correct inclusive/exclusive boundaries', async () => {
    const now = new Date();
    for (const period of PERIODS) {
      const window = periodWindow(period, now);
      const inPeriod = dates
        .map((date, index) => ({ date, index }))
        .filter(({ date }) => inWindow(date, window));
      const expectedCount = inPeriod.length;
      const expectedValue = inPeriod.reduce(
        (sum, { index }) => sum + amounts[index]!,
        0,
      );
      const expectedCommission = inPeriod.reduce(
        (sum, { index }) => sum + commissions[index]!,
        0,
      );

      const response = await read(period);
      expect(response.status).toBe(200);
      const data = response.body.data as PeriodDashboard;
      expect(data.period).toBe(period);
      expect(data.chartBucket).toBe(
        period === 'today'
          ? 'hour'
          : period === 'all'
            ? 'month'
            : 'day',
      );
      expect(data.deals.countInPeriod).toBe(expectedCount);
      expect(Number(data.deals.totalValueInPeriod)).toBe(expectedValue);
      expect(Number(data.deals.totalCommissionInPeriod)).toBe(
        expectedCommission,
      );
      expect(
        Number(data.deals.averageValueInPeriod),
      ).toBeCloseTo(expectedCount ? expectedValue / expectedCount : 0);
      expect(
        data.deals.dailyCounts.reduce((sum, value) => sum + value, 0),
      ).toBe(expectedCount);
      // The base client used by the deals shares dates[0]'s timestamp.
      expect(data.clients.newInPeriod).toBe(
        expectedCount + (inWindow(dates[0]!, window) ? 1 : 0),
      );
      expect(data.owners.newInPeriod).toBe(expectedCount);
      expect(data.followUps.completedInPeriod).toBe(expectedCount);
      expect(data.alerts.duplicateAttempts).toBe(expectedCount);
      expect(data.activity).toHaveLength(Math.min(3, expectedCount));

      // Current totals do not become historical snapshots.
      expect(data.properties.total).toBe(1);
      expect(data.clients.total).toBe(dates.length + 1);
      expect(data.owners.total).toBe(dates.length);
      expect(data.employees).toEqual({ total: 1, active: 1 });
      expect(data.followUps.late).toBe(0);
      expect(data.alerts.pendingApprovals).toBe(0);
    }
  });

  it('handles rapid period changes without mixing responses', async () => {
    const now = new Date();
    const responses = await Promise.all(
      PERIODS.map(async (period) => ({
        period,
        response: await read(period),
      })),
    );
    for (const { period, response } of responses) {
      expect(response.status).toBe(200);
      const data = response.body.data as PeriodDashboard;
      const window = periodWindow(period, now);
      const expectedCount = dates.filter((date) =>
        inWindow(date, window),
      ).length;
      expect(data.period).toBe(period);
      expect(data.deals.countInPeriod).toBe(expectedCount);
    }
  });

  it('rejects an employee and an invalid period', async () => {
    const denied = await api()
      .get('/dashboard/manager?period=month')
      .set(auth(employeeToken));
    expect(denied.status).toBe(403);

    const invalid = await api()
      .get('/dashboard/manager?period=not-a-period')
      .set(auth(managerToken));
    expect(invalid.status).toBe(400);
  });
});
