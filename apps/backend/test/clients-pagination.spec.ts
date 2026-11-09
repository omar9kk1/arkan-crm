import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Role } from '@arkan/shared';
import request from 'supertest';
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
const TEAM_A = 700;
const TEAM_B = 200;

interface PageShape<T> {
  items: T[];
  nextCursor: string | null;
}

interface ListItem {
  id: string;
  name: string;
  phone: string;
  nextFollowUp: string | null;
  lastFollowUpAt: string | null;
  requestData: string | null;
  propertiesCount: number;
  propertyInterestsCount: number;
}

interface RecommendationCandidate {
  id: string;
  name: string;
  requestData: string | null;
}

describeWithDatabase('Client list pagination and isolation', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let managerAId: string;
  let managerBId: string;
  let employeeAId: string;
  let profileAId: string;
  let profileBId: string;
  const clientIds: string[] = [];
  const clientNames: string[] = [];
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const owner = await createUser(ctx.prisma, {
      email: 'page.owner@test.local',
      name: 'Pagination Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'page.manager.a@test.local',
      name: 'Pagination Manager A',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'page.manager.b@test.local',
      name: 'Pagination Manager B',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'page.employee.a@test.local',
      name: 'Pagination Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'page.employee.b@test.local',
      name: 'Pagination Employee B',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    const profileA = await ctx.prisma.employeeProfile.findUniqueOrThrow({
      where: { userId: employeeA.id },
      select: { id: true },
    });
    const profileB = await ctx.prisma.employeeProfile.findUniqueOrThrow({
      where: { userId: employeeB.id },
      select: { id: true },
    });

    managerAId = managerA.id;
    managerBId = managerB.id;
    employeeAId = employeeA.id;
    profileAId = profileA.id;
    profileBId = profileB.id;

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);

    const rows: Prisma.ClientCreateManyInput[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const id = randomUUID();
      const name = `Paged Client ${String(i + 1).padStart(4, '0')}`;
      const team = i < TEAM_A ? 'A' : i < TEAM_A + TEAM_B ? 'B' : 'O';
      const profileId =
        team === 'A' ? profileAId : team === 'B' ? profileBId : null;
      clientIds.push(id);
      clientNames.push(name);
      rows.push({
        id,
        name,
        phone: `7${String(i).padStart(7, '0')}`,
        notes: `note ${i}`,
        status: i % 10 === 0 ? 'CLOSED' : 'ACTIVE',
        requestData: JSON.stringify({
          version: 1,
          types: [i % 3 === 0 ? 'BUYER' : i % 3 === 1 ? 'RENTER' : 'EXCHANGER'],
          requests: {},
        }),
        responsibleEmployeeId: profileId,
        createdById: profileId,
        createdByUserId:
          team === 'A' && i % 20 === 0
            ? managerAId
            : team === 'B' && i % 20 === 0
              ? managerBId
              : null,
        createdAt: new Date(Date.now() - i * 60000),
      });
    }
    await ctx.prisma.client.createMany({ data: rows });
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  const collectAll = async (token: string) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await api()
        .get('/clients')
        .query({ ...(cursor ? { cursor } : {}), limit: 50 })
        .set(auth(token));
      expect(response.status).toBe(200);
      const page = response.body.data as PageShape<ListItem>;
      expect(page.items.length).toBeLessThanOrEqual(50);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(100);
    } while (cursor);
    return { ids, pages };
  };

  it('reaches every client beyond 1,000 without duplicates or skips', async () => {
    const first = await api()
      .get('/clients')
      .set(auth(ownerToken));
    expect(first.status).toBe(200);
    const firstPage = first.body.data as PageShape<ListItem>;
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();

    const { ids, pages } = await collectAll(ownerToken);
    expect(pages).toBeGreaterThan(20);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids).toEqual(expect.arrayContaining(clientIds));
  });

  it('searches the whole dataset, including records beyond page one', async () => {
    const targetName = clientNames[TOTAL - 1];
    const response = await api()
      .get('/clients')
      .query({ search: targetName })
      .set(auth(ownerToken));
    expect(response.status).toBe(200);
    const page = response.body.data as PageShape<ListItem>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.name).toBe(targetName);

    const latePageName = clientNames[600];
    const withCursor = await api()
      .get('/clients')
      .query({ search: latePageName, limit: 50 })
      .set(auth(managerAToken));
    expect(withCursor.status).toBe(200);
    expect(
      (withCursor.body.data as PageShape<ListItem>).items.map(
        (item) => item.id,
      ),
    ).toContain(clientIds[600]);
  });

  it('keeps MANAGER and EMPLOYEE scopes inside the database query', async () => {
    const teamA = await collectAll(managerAToken);
    expect(teamA.ids).toHaveLength(TEAM_A);
    expect(teamA.ids).not.toContain(clientIds[TEAM_A]);

    const teamB = await collectAll(managerBToken);
    expect(teamB.ids).toHaveLength(TEAM_B);
    expect(teamB.ids).not.toContain(clientIds[0]);

    const employeeA = await collectAll(employeeAToken);
    expect(employeeA.ids).toHaveLength(TEAM_A);
    expect(employeeA.ids).not.toContain(clientIds[TEAM_A]);

    const employeeB = await collectAll(employeeBToken);
    expect(employeeB.ids).toHaveLength(TEAM_B);
    expect(employeeB.ids).not.toContain(clientIds[0]);

    const crossTeamSearch = await api()
      .get('/clients')
      .query({ search: clientNames[TEAM_A] })
      .set(auth(managerAToken));
    expect(
      (crossTeamSearch.body.data as PageShape<ListItem>).items,
    ).toHaveLength(0);

    expect(
      (
        await api()
          .get(`/clients/${clientIds[TEAM_A]}`)
          .set(auth(managerAToken))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(`/clients/${clientIds[0]}`)
          .set(auth(employeeBToken))
      ).status,
    ).toBe(404);
  });

  it('recommendation candidates cover every eligible client without a 1000 ceiling', async () => {
    const owner = await api()
      .get('/clients/recommendation-candidates')
      .set(auth(ownerToken));
    expect(owner.status).toBe(200);
    const ownerItems = owner.body.data
      .items as RecommendationCandidate[];
    expect(ownerItems).toHaveLength(TOTAL);
    expect(ownerItems.map((item) => item.id)).toContain(clientIds[696]);
    expect(Object.keys(ownerItems[0] ?? {}).sort()).toEqual([
      'id',
      'name',
      'requestData',
    ]);

    const managerA = await api()
      .get('/clients/recommendation-candidates')
      .set(auth(managerAToken));
    const managerAIds = (
      managerA.body.data.items as RecommendationCandidate[]
    ).map((item) => item.id);
    expect(managerAIds).toHaveLength(TEAM_A);
    expect(managerAIds).toContain(clientIds[696]);
    expect(managerAIds).not.toContain(clientIds[TEAM_A]);
    expect(managerAIds).not.toContain(clientIds[TOTAL - 1]);

    const employeeA = await api()
      .get('/clients/recommendation-candidates')
      .set(auth(employeeAToken));
    const employeeAIds = (
      employeeA.body.data.items as RecommendationCandidate[]
    ).map((item) => item.id);
    expect(employeeAIds).toHaveLength(TEAM_A);
    expect(employeeAIds).toContain(clientIds[696]);
    expect(employeeAIds).not.toContain(clientIds[TEAM_A]);

    const employeeB = await api()
      .get('/clients/recommendation-candidates')
      .set(auth(employeeBToken));
    const employeeBIds = (
      employeeB.body.data.items as RecommendationCandidate[]
    ).map((item) => item.id);
    expect(employeeBIds).toHaveLength(TEAM_B);
    expect(employeeBIds).not.toContain(clientIds[696]);
  });

  it('applies status and classification filters before pagination', async () => {
    const targetId = clientIds[1];
    const client = await ctx.prisma.client.findUniqueOrThrow({
      where: { id: targetId },
      select: { responsibleEmployeeId: true },
    });
    expect(client.responsibleEmployeeId).toBe(profileAId);

    const today = new Date();
    const todayStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    await ctx.prisma.followUp.create({
      data: {
        id: randomUUID(),
        employeeId: profileAId,
        clientId: targetId,
        dueAt: new Date(todayStart.getTime() - 86400000),
        status: 'PENDING',
        notes: 'perf late',
      },
    });

    const late = await api()
      .get('/clients')
      .query({ filter: 'late', limit: 100 })
      .set(auth(employeeAToken));
    expect(late.status).toBe(200);
    const latePage = late.body.data as PageShape<ListItem>;
    expect(latePage.items.some((item) => item.id === targetId)).toBe(true);
    expect(latePage.items.every((item) => item.nextFollowUp !== null)).toBe(
      true,
    );

    const buyers = await api()
      .get('/clients')
      .query({ classification: 'buyer', limit: 100 })
      .set(auth(employeeAToken));
    expect(buyers.status).toBe(200);
    expect((buyers.body.data as PageShape<ListItem>).items.length).toBeGreaterThan(0);
    expect(
      (buyers.body.data as PageShape<ListItem>).items.every((item) =>
        item.requestData?.includes('"BUYER"'),
      ),
    ).toBe(true);
  });

  it('keeps the detail endpoint complete while the list stays lightweight', async () => {
    const targetId = clientIds[2]!;
    const property = await ctx.prisma.property.create({
      data: {
        id: randomUUID(),
        reference: 'P-PERF-CLIENT-1',
        title: 'Pagination detail property',
        area: 'Area',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
        createdByUserId: employeeAId,
      },
      select: { id: true },
    });
    await ctx.prisma.followUp.create({
      data: {
        id: randomUUID(),
        employeeId: profileAId,
        clientId: targetId,
        dueAt: new Date(Date.now() + 86400000),
        status: 'PENDING',
        notes: 'detail follow-up',
      },
    });
    await ctx.prisma.clientPropertyInterest.create({
      data: {
        id: randomUUID(),
        clientId: targetId,
        propertyId: property.id,
        reason: 'detail interest',
      },
    });

    const list = await api()
      .get('/clients')
      .query({ search: clientNames[2] })
      .set(auth(employeeAToken));
    const listItem = (list.body.data as PageShape<ListItem>).items[0];
    expect(listItem).toBeDefined();
    expect(listItem).not.toHaveProperty('followUps');
    expect(listItem).not.toHaveProperty('properties');
    expect(listItem).not.toHaveProperty('propertyInterests');
    expect(listItem?.propertyInterestsCount).toBe(1);

    const detail = await api()
      .get(`/clients/${targetId}`)
      .set(auth(employeeAToken));
    expect(detail.status).toBe(200);
    const data = detail.body.data as {
      followUps: unknown[];
      propertyInterests: Array<{ propertyId: string }>;
      nextFollowUp: string | null;
    };
    expect(data.followUps).toHaveLength(1);
    expect(data.propertyInterests).toHaveLength(1);
    expect(data.propertyInterests[0]?.propertyId).toBe(property.id);
    expect(data.nextFollowUp).toBeTruthy();
  });
});
