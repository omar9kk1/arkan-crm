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

const TEAM_A = 1005;
const TEAM_B = 10;

interface PageShape {
  items: Array<{ id: string; label: string; bucket: string }>;
  nextCursor: string | null;
  truncated: boolean;
  summary?: {
    total: number;
    overdue: number;
    today: number;
    upcoming: number;
    never: number;
    tabs: Record<string, number>;
  };
  employees?: Array<{ userId: string; name: string }>;
}

describeWithDatabase('Follow-up pagination and full coverage', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let employeeAId: string;
  let employeeBId: string;
  let profileAId: string;
  let profileBId: string;
  const clientIdsA: string[] = [];
  const namesA: string[] = [];
  const clientIdsB: string[] = [];
  const namesB: string[] = [];
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const owner = await createUser(ctx.prisma, {
      email: 'fp.owner@test.local',
      name: 'Followup Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'fp.manager.a@test.local',
      name: 'Followup Manager A',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'fp.manager.b@test.local',
      name: 'Followup Manager B',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'fp.employee.a@test.local',
      name: 'Followup Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'fp.employee.b@test.local',
      name: 'Followup Employee B',
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
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    profileAId = profileA.id;
    profileBId = profileB.id;

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);

    const rows: Prisma.ClientCreateManyInput[] = [];
    for (let i = 0; i < TEAM_A; i++) {
      const id = randomUUID();
      const name = `FollowUp Client ${String(i + 1).padStart(4, '0')}`;
      clientIdsA.push(id);
      namesA.push(name);
      rows.push({
        id,
        name,
        phone: `5${String(i).padStart(7, '0')}`,
        status: 'ACTIVE',
        requestData: JSON.stringify({
          version: 1,
          types: ['BUYER'],
          requests: {},
        }),
        responsibleEmployeeId: profileAId,
        createdById: profileAId,
        createdAt: new Date(Date.now() - i * 60000),
      });
    }
    for (let i = 0; i < TEAM_B; i++) {
      const id = randomUUID();
      const name = `FollowUp B Client ${String(i + 1).padStart(3, '0')}`;
      clientIdsB.push(id);
      namesB.push(name);
      rows.push({
        id,
        name,
        phone: `4${String(i).padStart(7, '0')}`,
        status: 'ACTIVE',
        requestData: JSON.stringify({
          version: 1,
          types: ['BUYER'],
          requests: {},
        }),
        responsibleEmployeeId: profileBId,
        createdById: profileBId,
        createdAt: new Date(Date.now() - i * 60000),
      });
    }
    await ctx.prisma.client.createMany({ data: rows });

    // Let the existing sync materialize the real subjects from canonical data.
    const syncA = await api().get('/follow-ups?limit=1').set(auth(employeeAToken));
    expect(syncA.status).toBe(200);
    const syncB = await api().get('/follow-ups?limit=1').set(auth(employeeBToken));
    expect(syncB.status).toBe(200);

    // Three genuinely overdue subjects for summary/status coverage.
    const overdueClients = await ctx.prisma.client.findMany({
      where: { name: { in: [namesA[0]!, namesA[1]!, namesA[2]!] } },
      select: { id: true },
    });
    await ctx.prisma.followUpSubject.updateMany({
      where: { clientId: { in: overdueClients.map((row) => row.id) } },
      data: { nextDueAt: new Date(Date.now() - 3 * 86400000) },
    });
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  const collectEmployeeOptions = async (
    token: string,
    baseQuery: Record<string, string | number> = {},
  ) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await api()
        .get('/follow-ups/manager/employees')
        .query({
          ...baseQuery,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })
        .set(auth(token));
      expect(response.status).toBe(200);
      const page = response.body.data as {
        items: Array<{ userId: string }>;
        nextCursor: string | null;
      };
      expect(page.items.length).toBeLessThanOrEqual(100);
      ids.push(...page.items.map((item) => item.userId));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(100);
    } while (cursor);
    return { ids, pages };
  };

  const collectPages = async (
    path: string,
    token: string,
    baseQuery: Record<string, string | number> = {},
  ) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let summary: PageShape['summary'];
    do {
      const response = await api()
        .get(path)
        .query({
          ...baseQuery,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        })
        .set(auth(token));
      expect(response.status).toBe(200);
      const page = response.body.data as PageShape;
      expect(page.items.length).toBeLessThanOrEqual(50);
      if (!cursor) summary = page.summary;
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(100);
    } while (cursor);
    return { ids, pages, summary };
  };

  it('reaches more than 1,000 personal follow-ups without skips or duplicates', async () => {
    const first = await api()
      .get('/follow-ups')
      .set(auth(employeeAToken));
    expect(first.status).toBe(200);
    const firstPage = first.body.data as PageShape;
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(firstPage.summary?.total).toBe(TEAM_A);
    expect(firstPage.summary?.overdue).toBe(3);
    expect(firstPage.summary?.tabs.buyers).toBe(TEAM_A);

    const { ids, pages } = await collectPages('/follow-ups', employeeAToken);
    expect(pages).toBeGreaterThan(20);
    expect(ids).toHaveLength(TEAM_A);
    expect(new Set(ids).size).toBe(TEAM_A);

    const bOnly = await api()
      .get('/follow-ups')
      .query({ search: namesB[0] })
      .set(auth(employeeAToken));
    expect((bOnly.body.data as PageShape).items).toHaveLength(0);
  });

  it('searches and filters across the full authorized dataset', async () => {
    const target = namesA[TEAM_A - 1]!;
    const search = await api()
      .get('/follow-ups')
      .query({ search: target, limit: 50 })
      .set(auth(employeeAToken));
    expect(search.status).toBe(200);
    const found = (search.body.data as PageShape).items;
    expect(found).toHaveLength(1);
    expect(found[0]?.label).toContain(target);

    const late = await api()
      .get('/follow-ups')
      .query({ status: 'OVERDUE', limit: 50 })
      .set(auth(employeeAToken));
    expect(late.status).toBe(200);
    const latePage = late.body.data as PageShape;
    expect(latePage.items).toHaveLength(3);
    expect(latePage.items.every((item) => item.bucket === 'OVERDUE')).toBe(true);

    const buyers = await api()
      .get('/follow-ups')
      .query({ tab: 'buyers', limit: 50 })
      .set(auth(employeeAToken));
    expect(buyers.status).toBe(200);
    expect((buyers.body.data as PageShape).summary?.tabs.buyers).toBe(TEAM_A);
    expect((buyers.body.data as PageShape).items.length).toBe(50);
  });

  it('enforces OWNER company-wide, MANAGER team and EMPLOYEE privacy scopes', async () => {
    const ownerSupervision = await api()
      .get('/follow-ups/manager/overview')
      .set(auth(ownerToken));
    expect(ownerSupervision.status).toBe(200);
    expect((ownerSupervision.body.data as PageShape).summary).toBeUndefined();
    expect((ownerSupervision.body.data as PageShape).employees).toBeUndefined();

    const ownerSummary = await api()
      .get('/follow-ups/manager/summary')
      .set(auth(ownerToken));
    expect(ownerSummary.status).toBe(200);
    expect(
      (ownerSummary.body.data as PageShape['summary'])?.total,
    ).toBe(TEAM_A + TEAM_B);

    const ownerEmployeeOptions = await collectEmployeeOptions(ownerToken);
    expect(ownerEmployeeOptions.ids.sort()).toEqual(
      [employeeAId, employeeBId].sort(),
    );

    const managerA = await collectPages('/follow-ups/manager/overview', managerAToken);
    expect(managerA.ids).toHaveLength(TEAM_A);
    const managerB = await collectPages('/follow-ups/manager/overview', managerBToken);
    expect(managerB.ids).toHaveLength(TEAM_B);

    const managerAOptions = await collectEmployeeOptions(managerAToken);
    expect(managerAOptions.ids).toEqual([employeeAId]);
    const managerBOptions = await collectEmployeeOptions(managerBToken);
    expect(managerBOptions.ids).toEqual([employeeBId]);

    const crossTeamSearch = await api()
      .get('/follow-ups/manager/overview')
      .query({ search: namesB[0] })
      .set(auth(managerAToken));
    expect((crossTeamSearch.body.data as PageShape).items).toHaveLength(0);

    const employeeSupervision = await api()
      .get('/follow-ups/manager/overview')
      .set(auth(employeeAToken));
    expect(employeeSupervision.status).toBe(403);

    const employeeBList = await collectPages('/follow-ups', employeeBToken);
    expect(employeeBList.ids).toHaveLength(TEAM_B);
  });

  it('returns the complete history for a subject beyond the first page', async () => {
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: {
        clientId: clientIdsA[TEAM_A - 1]!,
        kind: 'CLIENT_REQUEST',
      },
      select: { id: true },
    });
    await ctx.prisma.followUpEntry.createMany({
      data: Array.from({ length: 150 }, (_, i) => ({
        id: randomUUID(),
        subjectId: subject.id,
        authorId: profileAId,
        note: `history entry ${i}`,
        createdAt: new Date(Date.now() - i * 60000),
      })),
    });
    const history = await api()
      .get(`/follow-ups/${subject.id}/history`)
      .set(auth(employeeAToken));
    expect(history.status).toBe(200);
    expect((history.body.data as { entries: unknown[] }).entries).toHaveLength(
      150,
    );

    const foreign = await api()
      .get('/follow-ups')
      .query({ search: namesB[0] })
      .set(auth(employeeAToken));
    expect((foreign.body.data as PageShape).items).toHaveLength(0);
  });
});
