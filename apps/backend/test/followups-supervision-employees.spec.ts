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
  type TestContext,
} from './support/test-app';

jest.setTimeout(240000);

const TEAM_A = 1005;
const TEAM_B = 10;

describeWithDatabase('Supervision employee filter options', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let managerAId: string;
  let managerBId: string;
  let directUserId: string;
  const teamAIds: string[] = [];
  const teamBIds: string[] = [];
  const names: string[] = [];
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'sup.opts.owner@test.local',
      name: 'Supervision Options Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'sup.opts.manager.a@test.local',
      name: 'Supervision Options Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'sup.opts.manager.b@test.local',
      name: 'Supervision Options Manager B',
      role: Role.MANAGER,
    });
    managerAId = managerA.id;
    managerBId = managerB.id;
    const passwordHash = await hashPassword('ChangeMe123!');
    const now = Date.now();
    const users: Prisma.UserCreateManyInput[] = [];
    const profiles: Prisma.EmployeeProfileCreateManyInput[] = [];
    const subjects: Prisma.FollowUpSubjectCreateManyInput[] = [];

    const addEmployee = (
      index: number,
      managerUserId: string | null,
      team: 'A' | 'B' | 'direct',
    ) => {
      const id = randomUUID();
      const profileId = randomUUID();
      const name = `Supervision Employee ${String(index + 1).padStart(4, '0')}`;
      if (team === 'A') teamAIds.push(id);
      if (team === 'B') teamBIds.push(id);
      if (team === 'direct') directUserId = id;
      names.push(name);
      users.push({
        id,
        email: `sup.opts.employee.${index + 1}@test.local`,
        name,
        role: Role.EMPLOYEE,
        isActive: true,
        passwordHash,
        createdAt: new Date(now - index * 1000),
        updatedAt: new Date(now - index * 1000),
      });
      profiles.push({ id: profileId, userId: id, managerUserId });
      subjects.push({
        id: randomUUID(),
        targetKey: `SUP-OPT:${profileId}`,
        kind: 'CLIENT',
        responsibleId: profileId,
        activatedAt: new Date(now - 86400000),
        nextDueAt: new Date(now + 86400000),
        active: true,
      });
    };

    for (let i = 0; i < TEAM_A; i++) addEmployee(i, managerAId, 'A');
    for (let i = 0; i < TEAM_B; i++) addEmployee(TEAM_A + i, managerBId, 'B');
    addEmployee(TEAM_A + TEAM_B, null, 'direct');

    await ctx.prisma.user.createMany({ data: users });
    await ctx.prisma.employeeProfile.createMany({ data: profiles });
    await ctx.prisma.followUpSubject.createMany({ data: subjects });

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const collectOptions = async (
    token: string,
    query: Record<string, string | number> = {},
  ) => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await api()
        .get('/follow-ups/manager/employees')
        .query({
          ...query,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        })
        .set(auth(token));
      expect(response.status).toBe(200);
      const page = response.body.data as {
        items: Array<{ userId: string; name: string }>;
        nextCursor: string | null;
      };
      ids.push(...page.items.map((item) => item.userId));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(20);
    } while (cursor);
    return { ids, pages };
  };

  it('paginates every team employee beyond 1,000 options', async () => {
    const options = await collectOptions(managerAToken);
    expect(options.pages).toBeGreaterThan(10);
    expect(options.ids).toHaveLength(TEAM_A);
    expect(new Set(options.ids).size).toBe(TEAM_A);

    const search = await api()
      .get('/follow-ups/manager/employees')
      .query({ search: names[TEAM_A - 1], limit: 100 })
      .set(auth(managerAToken));
    expect(search.status).toBe(200);
    expect(
      (search.body.data as { items: Array<{ userId: string }> }).items.map(
        (item) => item.userId,
      ),
    ).toEqual([teamAIds[TEAM_A - 1]]);
  });

  it('keeps employee options team-isolated and excludes OWNER-direct', async () => {
    const managerAOptions = await collectOptions(managerAToken);
    expect(managerAOptions.ids).not.toContain(directUserId);
    expect(managerAOptions.ids).not.toContain(teamBIds[0]);

    const managerBOptions = await collectOptions(managerBToken);
    expect(managerBOptions.ids.sort()).toEqual([...teamBIds].sort());
    expect(managerBOptions.ids).not.toContain(directUserId);
  });

  it('returns the exact full-scope summary independently of the page', async () => {
    const page = await api()
      .get('/follow-ups/manager/overview')
      .set(auth(managerAToken));
    expect(page.status).toBe(200);
    expect((page.body.data as { summary?: unknown }).summary).toBeUndefined();
    expect((page.body.data as { employees?: unknown }).employees).toBeUndefined();

    const summary = await api()
      .get('/follow-ups/manager/summary')
      .set(auth(managerAToken));
    expect(summary.status).toBe(200);
    expect((summary.body.data as { total: number }).total).toBe(TEAM_A);

    const owner = await api()
      .get('/follow-ups/manager/summary')
      .set(auth(ownerToken));
    expect((owner.body.data as { total: number }).total).toBe(
      TEAM_A + TEAM_B + 1,
    );
  });
});
