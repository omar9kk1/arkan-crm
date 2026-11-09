import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Role } from '@arkan/shared';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.setTimeout(240000);

const TOTAL = 1005;
const TEAM_A = 550;
const TEAM_B = 300;
const ACTIVE = 950;

interface PageShape {
  items: Array<{
    id: string;
    name: string;
    isActive: boolean;
    propertyCount: number;
    propertiesByStatus: Record<string, number>;
    clientsCount: number;
    assignedCount: number;
    lateCount: number;
  }>;
  nextCursor: string | null;
  summary?: {
    total: number;
    active: number;
    clientsTotal: number;
    lateTotal: number;
  };
}

describeWithDatabase('Employee directory pagination and isolation', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let managerAId: string;
  let managerBId: string;
  let employeeAId: string;
  let employeeBId: string;
  let employeeAProfileId: string;
  let teamAUserId: string;
  let teamAProfileId: string;
  let lastUserId: string;
  let lastProfileId: string;
  let ownerId: string;
  const userIds: string[] = [];
  const names: string[] = [];
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const owner = await createUser(ctx.prisma, {
      email: 'ep.owner@test.local',
      name: 'Employee Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'ep.manager.a@test.local',
      name: 'Employee Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'ep.manager.b@test.local',
      name: 'Employee Manager B',
      role: Role.MANAGER,
    });
    managerAId = managerA.id;
    managerBId = managerB.id;
    ownerId = owner.id;

    const passwordHash = await hashPassword('ChangeMe123!');
    const now = Date.now();
    const userRows: Prisma.UserCreateManyInput[] = [];
    const profileRows: Prisma.EmployeeProfileCreateManyInput[] = [];

    for (let i = 0; i < TOTAL; i++) {
      const id = randomUUID();
      const profileId = randomUUID();
      const team =
        i < TEAM_A ? 'A' : i < TEAM_A + TEAM_B ? 'B' : 'OWNER';
      const name = `Paged Employee ${String(i + 1).padStart(4, '0')}`;
      userIds.push(id);
      names.push(name);
      userRows.push({
        id,
        email: `paged.employee.${i + 1}@test.local`,
        name,
        role: Role.EMPLOYEE,
        isActive: i < ACTIVE,
        passwordHash,
        createdAt: new Date(now - i * 60000),
        updatedAt: new Date(now - i * 60000),
      });
      profileRows.push({
        id: profileId,
        userId: id,
        managerUserId:
          team === 'A' ? managerAId : team === 'B' ? managerBId : null,
      });
      if (i === 0) {
        employeeAId = id;
        employeeAProfileId = profileId;
      }
      if (i === TEAM_A) {
        employeeBId = id;
      }
      if (i === TEAM_A - 1) {
        teamAUserId = id;
        teamAProfileId = profileId;
      }
      if (i === TOTAL - 1) {
        lastUserId = id;
        lastProfileId = profileId;
      }
    }
    await ctx.prisma.user.createMany({ data: userRows });
    await ctx.prisma.employeeProfile.createMany({ data: profileRows });

    // Real aggregate fixtures for the first employee.
    const propertyOne = randomUUID();
    const propertyTwo = randomUUID();
    await ctx.prisma.property.createMany({
      data: [
        {
          id: propertyOne,
          reference: 'P-EMP-PERF-1',
          title: 'Employee perf property 1',
          area: 'Area',
          currency: 'KWD',
          listingType: 'SALE',
          status: 'PENDING',
          createdByUserId: employeeAId,
        },
        {
          id: propertyTwo,
          reference: 'P-EMP-PERF-2',
          title: 'Employee perf property 2',
          area: 'Area',
          currency: 'KWD',
          listingType: 'SALE',
          status: 'PENDING',
          createdByUserId: employeeAId,
        },
      ],
    });
    await ctx.prisma.propertyAssignment.create({
      data: {
        id: randomUUID(),
        propertyId: propertyOne,
        employeeId: employeeAProfileId,
        purpose: 'OWNER_FOLLOWUP',
      },
    });
    await ctx.prisma.client.create({
      data: {
        id: randomUUID(),
        name: 'Employee Perf Client',
        phone: '55500001',
        responsibleEmployeeId: employeeAProfileId,
        createdById: employeeAProfileId,
      },
    });
    await ctx.prisma.followUpSubject.create({
      data: {
        id: randomUUID(),
        targetKey: `CLIENT:${randomUUID()}`,
        kind: 'CLIENT',
        responsibleId: employeeAProfileId,
        activatedAt: new Date(now - 86400000),
        nextDueAt: new Date(now - 86400000),
        active: true,
      },
    });

    // 60 properties for the first employee, 70 for the last employee.
    const extraProperties: Prisma.PropertyCreateManyInput[] = [];
    for (let i = 0; i < 58; i++) {
      extraProperties.push({
        id: randomUUID(),
        reference: `P-EMP-EXTRA-A-${i}`,
        title: `Employee A extra ${i}`,
        area: 'Area',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
        createdByUserId: employeeAId,
      });
    }
    for (let i = 0; i < 70; i++) {
      extraProperties.push({
        id: randomUUID(),
        reference: `P-EMP-EXTRA-LAST-${i}`,
        title: `Employee last extra ${i}`,
        area: 'Area',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
        createdByUserId: lastUserId,
      });
    }
    await ctx.prisma.property.createMany({ data: extraProperties });

    // Distinct client counts for global sorting.
    const extraClients: Prisma.ClientCreateManyInput[] = [];
    for (let i = 0; i < 60; i++) {
      extraClients.push({
        id: randomUUID(),
        name: `Last employee client ${i}`,
        phone: `58${String(i).padStart(7, '0')}`,
        status: 'ACTIVE',
        responsibleEmployeeId: lastProfileId,
        createdById: lastProfileId,
      });
    }
    for (let i = 0; i < 40; i++) {
      extraClients.push({
        id: randomUUID(),
        name: `Team A client ${i}`,
        phone: `57${String(i).padStart(7, '0')}`,
        status: 'ACTIVE',
        responsibleEmployeeId: teamAProfileId,
        createdById: teamAProfileId,
      });
    }
    await ctx.prisma.client.createMany({ data: extraClients });

    // Five deals for the last employee (dealsCount global sort).
    const lastProperty = await ctx.prisma.property.findFirstOrThrow({
      where: { createdByUserId: lastUserId },
      select: { id: true },
    });
    const lastClient = await ctx.prisma.client.findFirstOrThrow({
      where: { responsibleEmployeeId: lastProfileId },
      select: { id: true },
    });
    await ctx.prisma.deal.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        id: randomUUID(),
        reference: `D-EMP-PERF-${i}`,
        type: 'SALE',
        propertyId: lastProperty.id,
        clientId: lastClient.id,
        recordedById: ownerId,
        propertyEmployeeId: lastProfileId,
        clientEmployeeId: lastProfileId,
        price: '100000.00',
        companyCommission: '1000.00',
        currency: 'KWD',
        closedAt: new Date(now - i * 3600000),
      })),
    });

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  const collect = async (
    token: string,
    query: Record<string, string | number> = {},
    path = '/employees',
  ) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await api()
        .get(path)
        .query({ limit: 50, ...query, ...(cursor ? { cursor } : {}) })
        .set(auth(token));
      expect(response.status).toBe(200);
      const page = response.body.data as PageShape;
      expect(page.items.length).toBeLessThanOrEqual(50);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(100);
    } while (cursor);
    return { ids, pages };
  };

  it('reaches more than 1,000 employees without skips or duplicates', async () => {
    const first = await api().get('/employees').set(auth(ownerToken));
    expect(first.status).toBe(200);
    const firstPage = first.body.data as PageShape;
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.summary).toMatchObject({
      total: TOTAL,
      active: ACTIVE,
      clientsTotal: 101,
      lateTotal: 1,
    });

    const { ids, pages } = await collect(ownerToken);
    expect(pages).toBeGreaterThan(20);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);

    const last = await api()
      .get('/employees')
      .query({ search: names[TOTAL - 1] })
      .set(auth(ownerToken));
    expect((last.body.data as PageShape).items).toHaveLength(1);
  });

  it('keeps OWNER-direct employees out of every manager list', async () => {
    const teamA = await collect(managerAToken);
    const teamB = await collect(managerBToken);
    expect(teamA.ids).toHaveLength(TEAM_A);
    expect(teamB.ids).toHaveLength(TEAM_B);
    expect(teamA.ids).not.toContain(userIds[TEAM_A]);
    expect(teamB.ids).not.toContain(userIds[0]);

    const searchOwnerDirect = await api()
      .get('/employees')
      .query({ search: names[TOTAL - 1] })
      .set(auth(managerAToken));
    expect((searchOwnerDirect.body.data as PageShape).items).toHaveLength(0);
  });

  it('returns full detail only within the caller scope', async () => {
    const ownerDetail = await api()
      .get(`/employees/${employeeAId}`)
      .set(auth(ownerToken));
    expect(ownerDetail.status).toBe(200);
    const ownerDto = ownerDetail.body.data as PageShape['items'][number] & {
      properties: Array<{ status: string }>;
    };
    expect(ownerDto.propertyCount).toBe(60);
    expect(ownerDto.propertiesByStatus.PENDING).toBe(2);
    expect(ownerDto.propertiesByStatus.AVAILABLE).toBe(58);
    expect(ownerDto.clientsCount).toBe(1);
    expect(ownerDto.assignedCount).toBe(1);
    expect(ownerDto.lateCount).toBe(1);
    // Detail keeps its existing first-50 contract; all pages come from the
    // dedicated property endpoint below.
    expect(ownerDto.properties).toHaveLength(50);

    expect(
      (await api().get(`/employees/${employeeAId}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/employees/${employeeBId}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/employees/${userIds[TOTAL - 1]}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
  });

  it('applies every sort globally before pagination', async () => {
    const topByClients = await api()
      .get('/employees')
      .query({ sort: 'clientsCount', limit: 50 })
      .set(auth(ownerToken));
    expect(topByClients.status).toBe(200);
    const clientsPage = topByClients.body.data as PageShape;
    expect(clientsPage.items[0]?.id).toBe(lastUserId);
    expect(clientsPage.items[1]?.id).toBe(teamAUserId);
    expect(clientsPage.items[2]?.id).toBe(employeeAId);
    expect(clientsPage.items[0]?.name).toBe(names[TOTAL - 1]);

    const topByProperties = await api()
      .get('/employees')
      .query({ sort: 'propertiesCount', limit: 50 })
      .set(auth(ownerToken));
    const propertiesPage = topByProperties.body.data as PageShape;
    expect(propertiesPage.items[0]?.id).toBe(lastUserId);
    expect(propertiesPage.items[0]?.propertyCount).toBe(70);
    expect(propertiesPage.items[1]?.id).toBe(employeeAId);
    expect(propertiesPage.items[1]?.propertyCount).toBe(60);

    const topByDeals = await api()
      .get('/employees')
      .query({ sort: 'dealsCount', limit: 50 })
      .set(auth(ownerToken));
    const dealsPage = topByDeals.body.data as PageShape;
    expect(dealsPage.items[0]?.id).toBe(lastUserId);

    // MANAGER sees their own team only, with the same global metric order.
    const managerTop = await api()
      .get('/employees')
      .query({ sort: 'clientsCount', limit: 50 })
      .set(auth(managerAToken));
    const managerPage = managerTop.body.data as PageShape;
    expect(managerPage.items[0]?.id).toBe(teamAUserId);
    expect(managerPage.items[1]?.id).toBe(employeeAId);
    expect(managerPage.items.map((item) => item.id)).not.toContain(
      lastUserId,
    );

    // Heavy metric ties (1,004 employees with 0 deals) must still page
    // exactly once per employee.
    const tied = await collect(ownerToken, { sort: 'dealsCount' });
    expect(tied.pages).toBeGreaterThan(20);
    expect(tied.ids).toHaveLength(TOTAL);
    expect(new Set(tied.ids).size).toBe(TOTAL);
    expect(tied.ids[0]).toBe(lastUserId);
  });

  it('keeps search and status filters authoritative under global sorting', async () => {
    const searched = await api()
      .get('/employees')
      .query({ search: names[TOTAL - 1], sort: 'clientsCount' })
      .set(auth(ownerToken));
    const searchedPage = searched.body.data as PageShape;
    expect(searchedPage.items.map((item) => item.id)).toEqual([lastUserId]);

    const inactive = await collect(ownerToken, {
      status: 'inactive',
      sort: 'propertiesCount',
    });
    expect(inactive.ids).toHaveLength(TOTAL - ACTIVE);
    expect(new Set(inactive.ids).size).toBe(TOTAL - ACTIVE);
    expect(inactive.ids).toContain(lastUserId);
    expect(inactive.ids).not.toContain(employeeAId);
  });

  it('paginates all authorized properties beyond the first 50', async () => {
    const firstPage = await api()
      .get(`/employees/${employeeAId}/properties`)
      .set(auth(ownerToken));
    expect(firstPage.status).toBe(200);
    const first = firstPage.body.data as {
      items: Array<{ id: string; reference: string; status: string }>;
      nextCursor: string | null;
      total: number;
    };
    expect(first.total).toBe(60);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();

    const secondPage = await api()
      .get(`/employees/${employeeAId}/properties`)
      .query({ cursor: first.nextCursor, limit: 50 })
      .set(auth(ownerToken));
    expect(secondPage.status).toBe(200);
    const second = secondPage.body.data as typeof first;
    expect(second.total).toBe(60);
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const ids = [
      ...first.items.map((property) => property.id),
      ...second.items.map((property) => property.id),
    ];
    expect(new Set(ids).size).toBe(60);

    // MANAGER A may read a team-A employee's properties, never another team
    // or an OWNER-direct employee.
    expect(
      (
        await api()
          .get(`/employees/${employeeAId}/properties`)
          .set(auth(managerAToken))
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .get(`/employees/${employeeBId}/properties`)
          .set(auth(managerAToken))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(`/employees/${lastUserId}/properties`)
          .set(auth(managerAToken))
      ).status,
    ).toBe(404);
  });

  it('keeps manager team data complete and counts independent of the page', async () => {
    const managers = await api().get('/managers').set(auth(ownerToken));
    expect(managers.status).toBe(200);
    const managerA = (managers.body.data.items as Array<{
      id: string;
      teamCount: number;
      team: Array<{ id: string; name: string; isActive: boolean }>;
    }>).find((manager) => manager.id === managerAId);
    const managerB = (managers.body.data.items as Array<{
      id: string;
      teamCount: number;
      team: Array<{ id: string; name: string; isActive: boolean }>;
    }>).find((manager) => manager.id === managerBId);
    expect(managerA?.teamCount).toBe(TEAM_A);
    expect(managerA?.team).toHaveLength(TEAM_A);
    expect(managerB?.teamCount).toBe(TEAM_B);
    expect(managerB?.team).toHaveLength(TEAM_B);

    const summaryA = await api()
      .get('/employees')
      .set(auth(managerAToken));
    expect((summaryA.body.data as PageShape).summary?.total).toBe(TEAM_A);
    const summaryB = await api()
      .get('/employees')
      .set(auth(managerBToken));
    expect((summaryB.body.data as PageShape).summary?.total).toBe(TEAM_B);
  });
});
