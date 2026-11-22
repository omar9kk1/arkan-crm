import { randomUUID } from 'node:crypto';
import { PaymentStatus, Prisma } from '@prisma/client';
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

jest.setTimeout(120000);

interface EmployeeMetricDto {
  id: string;
  email: string;
  propertyCount: number;
  clientsCount: number;
  dealsCount: number;
  commissionTotal: string;
}

/**
 * Real deal/commission metrics on the employee directory cards.
 * Uses the isolated test database only; no real payout is triggered.
 */
describeWithDatabase('Employee deal and commission metrics', () => {
  let ctx: TestContext;
  let ownerId: string;
  let ownerToken: string;
  let managerAToken: string;
  let employeeAToken: string;
  let employeeAId: string;
  let employeeBId: string;
  let employeeCId: string;
  let profileAId: string;
  let profileBId: string;

  const api = () => request(ctx.app.getHttpServer());

  const list = async (token: string): Promise<EmployeeMetricDto[]> => {
    const response = await api().get('/employees').set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as EmployeeMetricDto[];
  };

  const createProperty = (employeeUserId: string, profileId: string) =>
    ctx.prisma.property.create({
      data: {
        reference: `EMP-METRIC-${randomUUID().slice(0, 8)}`,
        title: 'Employee metrics property',
        area: 'منطقة الاختبار',
        governorate: 'العاصمة',
        district: 'الاختبار',
        listingType: 'SALE',
        status: 'AVAILABLE',
        currency: 'KWD',
        createdByUserId: employeeUserId,
        createdById: profileId,
      },
      select: { id: true },
    });

  const createClient = (profileId: string, name: string) =>
    ctx.prisma.client.create({
      data: {
        name,
        phone: `6${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        createdById: profileId,
        responsibleEmployeeId: profileId,
      },
      select: { id: true },
    });

  const createDeal = async (input: {
    propertyEmployeeId: string;
    clientEmployeeId: string;
    companyCommission?: string;
  }) => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(profileAId, 'Employee metric client');
    return ctx.prisma.deal.create({
      data: {
        reference: `D-METRIC-${randomUUID().slice(0, 8)}`,
        type: 'SALE',
        propertyId: property.id,
        clientId: client.id,
        recordedById: ownerId,
        propertyEmployeeId: input.propertyEmployeeId,
        clientEmployeeId: input.clientEmployeeId,
        price: new Prisma.Decimal('100.000'),
        companyCommission: new Prisma.Decimal(
          input.companyCommission ?? '9.999',
        ),
        currency: 'KWD',
        closedAt: new Date('2026-11-12T00:00:00.000Z'),
      },
      select: { id: true },
    });
  };

  const addCommission = (
    dealId: string,
    employeeId: string,
    role: 'PROPERTY_EMPLOYEE' | 'CLIENT_EMPLOYEE',
    amount: string,
    status: PaymentStatus,
  ) =>
    ctx.prisma.commission.create({
      data: {
        dealId,
        employeeId,
        commissionRole: role,
        createdById: ownerId,
        amount: new Prisma.Decimal(amount),
        currency: 'KWD',
        status,
      },
      select: { id: true, status: true, amount: true },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const owner = await createUser(ctx.prisma, {
      email: 'metric.owner@test.local',
      name: 'Metric Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'metric.manager.a@test.local',
      name: 'Metric Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'metric.manager.b@test.local',
      name: 'Metric Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'metric.employee.a@test.local',
      name: 'Metric Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'metric.employee.b@test.local',
      name: 'Metric Employee B',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    const employeeC = await createUser(ctx.prisma, {
      email: 'metric.employee.c@test.local',
      name: 'Metric Employee C',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    ownerId = owner.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    employeeCId = employeeC.id;
    profileAId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeA.id },
        select: { id: true },
      })
    ).id;
    profileBId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeB.id },
        select: { id: true },
      })
    ).id;
    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    employeeAToken = await login(ctx.app, employeeA.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns zero for employees without deals or commissions', async () => {
    const items = await list(ownerToken);
    for (const id of [employeeAId, employeeCId]) {
      const employee = items.find((item) => item.id === id)!;
      expect(employee.dealsCount).toBe(0);
      expect(employee.commissionTotal).toBe('0.000');
    }
  });

  it('counts each deal once, sums PENDING + PAID only, and skips company commission', async () => {
    // Deal 1: employee A is the property AND client employee of the same deal.
    const dealOne = await createDeal({
      propertyEmployeeId: profileAId,
      clientEmployeeId: profileAId,
    });
    await addCommission(
      dealOne.id,
      profileAId,
      'PROPERTY_EMPLOYEE',
      '1.234',
      PaymentStatus.PENDING,
    );
    await addCommission(
      dealOne.id,
      profileAId,
      'CLIENT_EMPLOYEE',
      '2.345',
      PaymentStatus.PAID,
    );

    // Deal 2: A is only the property employee; B is the client employee.
    const dealTwo = await createDeal({
      propertyEmployeeId: profileAId,
      clientEmployeeId: profileBId,
    });
    await addCommission(
      dealTwo.id,
      profileAId,
      'PROPERTY_EMPLOYEE',
      '0.001',
      PaymentStatus.PENDING,
    );
    await addCommission(
      dealTwo.id,
      profileBId,
      'CLIENT_EMPLOYEE',
      '0.500',
      PaymentStatus.PAID,
    );

    const ownerItems = await list(ownerToken);
    const a = ownerItems.find((item) => item.id === employeeAId)!;
    const b = ownerItems.find((item) => item.id === employeeBId)!;
    const c = ownerItems.find((item) => item.id === employeeCId)!;

    // Deal 1 is counted once even though A holds both roles.
    expect(a.dealsCount).toBe(2);
    // 1.234 (PENDING) + 2.345 (PAID) + 0.001 (PENDING); company 9.999 ignored.
    expect(a.commissionTotal).toBe('3.580');
    expect(b.dealsCount).toBe(1);
    expect(b.commissionTotal).toBe('0.500');
    expect(c.dealsCount).toBe(0);
    expect(c.commissionTotal).toBe('0.000');

    // The read path did not change payment status or amounts.
    const stored = await ctx.prisma.commission.findMany({
      where: { employeeId: { in: [profileAId, profileBId] } },
      select: { employeeId: true, amount: true, status: true },
    });
    const normalized = stored
      .map((row) => ({
        employeeId: row.employeeId,
        amount: row.amount.toFixed(3),
        status: row.status,
      }))
      .sort((a, b) => a.amount.localeCompare(b.amount));
    expect(normalized).toEqual([
      {
        employeeId: profileAId,
        amount: '0.001',
        status: PaymentStatus.PENDING,
      },
      {
        employeeId: profileBId,
        amount: '0.500',
        status: PaymentStatus.PAID,
      },
      {
        employeeId: profileAId,
        amount: '1.234',
        status: PaymentStatus.PENDING,
      },
      {
        employeeId: profileAId,
        amount: '2.345',
        status: PaymentStatus.PAID,
      },
    ]);
  });

  it('keeps MANAGER scoped to the team and EMPLOYEE away from the directory', async () => {
    const managerItems = await list(managerAToken);
    expect(managerItems.map((item) => item.id).sort()).toEqual(
      [employeeAId, employeeCId].sort(),
    );
    const a = managerItems.find((item) => item.id === employeeAId)!;
    expect(a.dealsCount).toBe(2);
    expect(a.commissionTotal).toBe('3.580');
    expect(managerItems.some((item) => item.id === employeeBId)).toBe(false);

    const denied = await api().get('/employees').set(auth(employeeAToken));
    expect(denied.status).toBe(403);
  });

  it('returns the same metrics on the authorized employee detail', async () => {
    const detail = await api()
      .get(`/employees/${employeeAId}`)
      .set(auth(ownerToken));
    expect(detail.status).toBe(200);
    const a = detail.body.data as EmployeeMetricDto;
    expect(a.dealsCount).toBe(2);
    expect(a.commissionTotal).toBe('3.580');
    // Existing card fields remain populated exactly as before.
    expect(a.propertyCount).toBeGreaterThanOrEqual(2);
    expect(a.clientsCount).toBeGreaterThanOrEqual(0);
  });
});
