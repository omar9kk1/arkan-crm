import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  postProperty,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

type Dashboard = {
  period: string;
  chartBucket: 'hour' | 'day' | 'month';
  properties: {
    total: number;
    available: number;
    pending: number;
    sold: number;
    rented: number;
    rejected: number;
    archived: number;
    trash: number;
  };
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
  leaders: {
    clients: { name: string | null; count: number };
    properties: { name: string | null; count: number };
    deals: { name: string | null; count: number };
  };
  alerts: {
    lateFollowUps: number;
    pendingApprovals: number;
    duplicateAttempts: number;
  };
  activity: Array<{ title: string; detail: string }>;
};

describeWithDatabase('Manager dashboard real data', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;
  let managerId: string;
  let employeeId: string;
  let employeeProfileId: string;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'dashboard-manager@test.local',
      name: 'Dashboard Manager',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'dashboard-employee@test.local',
      name: 'Dashboard Employee',
      role: Role.EMPLOYEE,
    });
    const profile = await ctx.prisma.employeeProfile.upsert({ where: { userId: employee.id }, create: { userId: employee.id }, update: {} });
    managerId = manager.id;
    employeeId = employee.id;
    employeeProfileId = profile.id;
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const read = async (token: string, period = 'month') => {
    const response = await api()
      .get(`/dashboard/manager?period=${period}`)
      .set(auth(token));
    return response;
  };

  it('returns real zeros for every period on an empty database', async () => {
    for (const period of ['today', 'week', 'month', 'last_month', 'all']) {
      const response = await read(managerToken, period);
      expect(response.status).toBe(200);
      const data = response.body.data as Dashboard;
      expect(data.period).toBe(period);
      expect(data.properties).toMatchObject({
        total: 0,
        available: 0,
        pending: 0,
        sold: 0,
        rented: 0,
        rejected: 0,
        archived: 0,
        trash: 0,
      });
      expect(data.clients).toEqual({ total: 0, newInPeriod: 0 });
      expect(data.owners).toEqual({ total: 0, newInPeriod: 0 });
      expect(data.employees).toEqual({ total: 1, active: 1 });
      expect(data.deals).toMatchObject({
        countInPeriod: 0,
        totalValueInPeriod: '0',
        averageValueInPeriod: '0',
        totalCommissionInPeriod: '0',
      });
      expect(data.deals.dailyCounts.every((count) => count === 0)).toBe(true);
      expect(data.followUps).toEqual({ late: 0, completedInPeriod: 0 });
      expect(data.leaders).toEqual({
        clients: { name: null, count: 0 },
        properties: { name: null, count: 0 },
        deals: { name: null, count: 0 },
      });
      expect(data.alerts).toEqual({
        lateFollowUps: 0,
        pendingApprovals: 0,
        duplicateAttempts: 0,
      });
      expect(data.activity).toHaveLength(1);
      expect(data.activity[0]?.title).toBe('لا يوجد نشاط حديث');
    }
  });

  it('refuses an employee and returns real Manager aggregates', async () => {
    const denied = await read(employeeToken);
    expect(denied.status).toBe(403);

    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const property = async (
      reference: string,
      status: 'PENDING' | 'AVAILABLE' | 'SOLD' | 'RENTED' | 'REJECTED',
      overrides: Record<string, unknown> = {},
    ) =>
      ctx.prisma.property.create({
        data: {
          reference,
          title: `Dashboard ${reference}`,
          area: 'مدينة المطلاع',
          listingType: 'SALE',
          status,
          currency: 'KWD',
          createdByUserId: employeeId,
          ...overrides,
        },
      });

    const available = await property('DASH-1', 'AVAILABLE');
    const pending = await property('DASH-2', 'PENDING');
    const sold = await property('DASH-3', 'SOLD');
    await property('DASH-4', 'RENTED');
    await property('DASH-5', 'REJECTED');
    await property('DASH-6', 'AVAILABLE', { deletedAt: new Date() });
    // Provisional owner JSON must NOT become an official owner count.
    await ctx.prisma.property.update({
      where: { id: pending.id },
      data: {
        proposedOwner: {
          type: 'OWNER',
          name: 'Provisional Only',
          phone: '60000000',
          notes: null,
        },
      },
    });

    const client = (name: string, phone: string, createdAt?: Date) =>
      ctx.prisma.client.create({
        data: {
          name,
          phone,
          responsibleEmployeeId: employeeProfileId,
          ...(createdAt ? { createdAt } : {}),
        },
      });
    const firstClient = await client('Dashboard Client A', '60000001');
    const secondClient = await client('Dashboard Client B', '60000002');
    await client('Dashboard Old Client', '60000003', old);

    await ctx.prisma.contact.createMany({
      data: [
        {
          type: 'OWNER',
          name: 'Approved Owner',
          phone: '60000004',
          responsibleUserId: employeeId,
        },
        {
          type: 'OWNER',
          name: 'Old Approved Owner',
          phone: '60000005',
          responsibleUserId: null,
          createdAt: old,
        },
        {
          type: 'BROKER',
          name: 'Not an Owner',
          phone: '60000006',
          responsibleUserId: null,
        },
      ],
    });

    const inactive = await createUser(ctx.prisma, {
      email: 'dashboard-inactive@test.local',
      name: 'Inactive Employee',
      role: Role.EMPLOYEE,
    });
    await ctx.prisma.user.update({
      where: { id: inactive.id },
      data: { isActive: false },
    });

    const lateSubject = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `DASHBOARD:${pending.id}`,
        kind: 'PROPERTY_OWNER',
        propertyId: pending.id,
        responsibleUserId: managerId,
        activatedAt: yesterday,
        nextDueAt: yesterday,
        active: true,
      },
    });
    await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `DASHBOARD:FUTURE:${available.id}`,
        kind: 'PROPERTY_OWNER',
        propertyId: available.id,
        responsibleUserId: managerId,
        activatedAt: new Date(),
        nextDueAt: future,
        active: true,
      },
    });
    await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `DASHBOARD:INACTIVE:${sold.id}`,
        kind: 'PROPERTY_OWNER',
        propertyId: sold.id,
        responsibleUserId: managerId,
        activatedAt: yesterday,
        nextDueAt: yesterday,
        active: false,
      },
    });
    await ctx.prisma.followUpEntry.create({
      data: {
        subjectId: lateSubject.id,
        note: 'Dashboard completed follow-up',
        authorUserId: managerId,
      },
    });
    await ctx.prisma.followUpEntry.create({
      data: {
        subjectId: lateSubject.id,
        note: 'Old completed follow-up',
        authorUserId: managerId,
        createdAt: old,
      },
    });

    await ctx.prisma.deal.createMany({
      data: [
        {
          reference: 'DEAL-DASH-1',
          type: 'SALE',
          propertyId: available.id,
          clientId: firstClient.id,
          recordedById: employeeId,
          propertyEmployeeId: employeeProfileId,
          price: '100000.00',
          companyCommission: '2500.00',
          currency: 'KWD',
          closedAt: new Date(),
        },
        {
          reference: 'DEAL-DASH-2',
          type: 'SALE',
          propertyId: pending.id,
          clientId: secondClient.id,
          recordedById: employeeId,
          propertyEmployeeId: employeeProfileId,
          price: '200000.00',
          companyCommission: '5000.00',
          currency: 'KWD',
          closedAt: new Date(),
        },
        {
          reference: 'DEAL-DASH-OLD',
          type: 'SALE',
          propertyId: sold.id,
          clientId: firstClient.id,
          recordedById: employeeId,
          propertyEmployeeId: employeeProfileId,
          price: '500000.00',
          companyCommission: '10000.00',
          currency: 'KWD',
          closedAt: old,
        },
      ],
    });

    await ctx.prisma.notification.createMany({
      data: [
        {
          userId: managerId,
          type: 'SYSTEM',
          title: 'محاولة تسجيل عقار مكرر',
          body: 'Dashboard duplicate attempt',
          propertyId: available.id,
          eventKey: `DUPLICATE_ATTEMPT:${available.id}:${employeeId}:recent`,
        },
        {
          userId: managerId,
          type: 'SYSTEM',
          title: 'محاولة تسجيل عقار مكرر',
          body: 'Dashboard old duplicate attempt',
          propertyId: available.id,
          eventKey: `DUPLICATE_ATTEMPT:${available.id}:${employeeId}:old`,
          createdAt: old,
        },
      ],
    });

    await ctx.prisma.auditLog.createMany({
      data: [
        {
          actorId: managerId,
          action: 'PROPERTY_CREATE',
          entityType: 'Property',
          entityId: available.id,
          after: { status: 'AVAILABLE' },
        },
        {
          actorId: managerId,
          action: 'CLIENT_CREATE',
          entityType: 'Client',
          entityId: firstClient.id,
          after: { name: 'Dashboard Client A' },
        },
        {
          actorId: managerId,
          action: 'PROPERTY_APPROVE',
          entityType: 'Property',
          entityId: pending.id,
          after: { status: 'AVAILABLE' },
        },
      ],
    });

    const response = await read(managerToken);
    expect(response.status).toBe(200);
    const data = response.body.data as Dashboard;

    expect(data.properties).toMatchObject({
      total: 5,
      available: 1,
      pending: 1,
      sold: 1,
      rented: 1,
      rejected: 1,
      archived: 0,
      trash: 1,
    });
    expect(data.clients).toEqual({ total: 3, newInPeriod: 2 });
    expect(data.owners).toEqual({ total: 2, newInPeriod: 1 });
    expect(data.employees).toEqual({ total: 2, active: 1 });
    expect(data.deals.countInPeriod).toBe(2);
    expect(Number(data.deals.totalValueInPeriod)).toBe(300000);
    expect(Number(data.deals.averageValueInPeriod)).toBe(150000);
    expect(Number(data.deals.totalCommissionInPeriod)).toBe(7500);
    expect(data.deals.dailyCounts.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(data.followUps).toEqual({ late: 1, completedInPeriod: 1 });
    expect(data.leaders).toEqual({
      clients: { name: 'Dashboard Employee', count: 2 },
      properties: { name: 'Dashboard Employee', count: 5 },
      deals: { name: 'Dashboard Employee', count: 2 },
    });
    expect(data.alerts).toEqual({
      lateFollowUps: 1,
      pendingApprovals: 1,
      duplicateAttempts: 1,
    });
    expect(data.activity.map((item) => item.title).sort()).toEqual(
      ['تم اعتماد عقار', 'تم إضافة عميل جديد', 'تم تسجيل عقار جديد'].sort(),
    );
  });

  it('moves every affected counter after a real create + approval', async () => {
    const before = (await read(managerToken)).body.data as Dashboard;

    const created = await postProperty(
      ctx.app,
      employeeToken,
      {
        listingType: 'SALE',
        governorate: 'الجهراء',
        district: 'مدينة المطلاع',
        block: '99',
        plotNumber: 'DASH-API-1',
        sizeSqm: '310.00',
        askingPrice: '260000.00',
        negotiable: true,
        description: 'Dashboard live integration property',
        floors: [{ type: 'GROUND', details: 'مجلس' }],
        newContact: {
          type: 'OWNER',
          name: 'Dashboard Approved Owner',
          phone: '69990001',
        },
      },
      [{ buffer: pngBytes(), filename: 'dashboard.png' }],
    );
    expect(created.status).toBe(201);

    const afterCreate = (await read(managerToken)).body.data as Dashboard;
    expect(afterCreate.properties.total).toBe(before.properties.total + 1);
    expect(afterCreate.properties.pending).toBe(before.properties.pending + 1);
    // Provisional owner JSON must not change the approved Contact-owner count.
    expect(afterCreate.owners.total).toBe(before.owners.total);

    const approved = await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({ version: created.body.data.version });
    expect(approved.status).toBe(200);

    const afterApprove = (await read(managerToken)).body.data as Dashboard;
    expect(afterApprove.properties.available).toBe(
      before.properties.available + 1,
    );
    expect(afterApprove.properties.pending).toBe(before.properties.pending);
    // Approval promotes the provisional owner into an official Contact.
    expect(afterApprove.owners.total).toBe(before.owners.total + 1);
  });
});
