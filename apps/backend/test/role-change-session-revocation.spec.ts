import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

/**
 * Regression suite for the hierarchy session policy:
 * - role changes and deactivation permanently revoke every session (service
 *   path AND direct-SQL path via database triggers);
 * - old refresh tokens can never mint the new role;
 * - Manager -> Employee -> Manager never resurrects a token.
 */
jest.setTimeout(180000);

const PASSWORD = 'ChangeMe123!';
const ORIGIN = 'http://localhost:3001';

interface Tokens {
  access: string;
  refresh: string;
  role: string;
}

function decodeRole(token: string): string {
  const payload = token.split('.')[1] as string;
  return (
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role: string;
    }
  ).role;
}

async function loginTokens(
  ctx: TestContext,
  email: string,
): Promise<Tokens> {
  const response = await request(ctx.app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  const access = response.body.data.accessToken as string;
  return {
    access,
    refresh: response.body.data.refreshToken as string,
    role: decodeRole(access),
  };
}

function refresh(ctx: TestContext, refreshToken: string) {
  return request(ctx.app.getHttpServer())
    .post('/auth/refresh')
    .send({ refreshToken });
}

function me(ctx: TestContext, accessToken: string) {
  return request(ctx.app.getHttpServer())
    .get('/auth/me')
    .set(auth(accessToken));
}

function employees(ctx: TestContext, accessToken: string) {
  return request(ctx.app.getHttpServer())
    .get('/employees')
    .set(auth(accessToken));
}

function cookiesOf(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'] as unknown as
    | string
    | string[]
    | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function cookieValue(cookies: string[], name: string): string | null {
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return null;
  return match.slice(name.length + 1).split(';')[0] ?? null;
}

describeWithDatabase('Role change and session revocation policy', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  async function newManager(email: string) {
    return createUser(ctx.prisma, {
      email,
      name: email,
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
  }

  async function newEmployee(email: string, managerUserId: string) {
    return createUser(ctx.prisma, {
      email,
      name: email,
      role: Role.EMPLOYEE,
      managerUserId,
    });
  }

  it('Manager -> Employee revokes access and refresh permanently', async () => {
    const manager = await newManager('policy.demote@test.local');
    const tokens = await loginTokens(ctx, manager.email);
    expect(tokens.role).toBe('MANAGER');
    expect((await employees(ctx, tokens.access)).status).toBe(200);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { role: Role.EMPLOYEE },
    });

    expect((await employees(ctx, tokens.access)).status).toBe(401);
    expect((await me(ctx, tokens.access)).status).toBe(401);
    expect((await refresh(ctx, tokens.refresh)).status).toBe(401);

    const fresh = await loginTokens(ctx, manager.email);
    expect(fresh.role).toBe('EMPLOYEE');
    expect((await employees(ctx, fresh.access)).status).toBe(403);
  });

  it('Employee -> Manager cannot use a pre-promotion refresh token', async () => {
    const manager = await newManager('policy.promote.manager@test.local');
    const employee = await newEmployee(
      'policy.promote@test.local',
      manager.id,
    );
    const tokens = await loginTokens(ctx, employee.email);
    expect(tokens.role).toBe('EMPLOYEE');

    await ctx.prisma.user.update({
      where: { id: employee.id },
      data: { role: Role.MANAGER },
    });

    expect((await employees(ctx, tokens.access)).status).toBe(401);
    expect((await refresh(ctx, tokens.refresh)).status).toBe(401);

    const fresh = await loginTokens(ctx, employee.email);
    expect(fresh.role).toBe('MANAGER');
    expect((await employees(ctx, fresh.access)).status).toBe(200);
  });

  it('Manager -> Employee -> Manager never resurrects the original token', async () => {
    const manager = await newManager('policy.cycle@test.local');
    const tokens = await loginTokens(ctx, manager.email);
    expect((await me(ctx, tokens.access)).status).toBe(200);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { role: Role.EMPLOYEE },
    });
    expect((await employees(ctx, tokens.access)).status).toBe(401);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { role: Role.MANAGER },
    });
    expect((await employees(ctx, tokens.access)).status).toBe(401);
    expect((await refresh(ctx, tokens.refresh)).status).toBe(401);

    const fresh = await loginTokens(ctx, manager.email);
    expect(fresh.role).toBe('MANAGER');
  });

  it('direct-SQL disable -> re-enable never revives old sessions', async () => {
    const manager = await newManager('policy.db-disabled@test.local');
    const tokens = await loginTokens(ctx, manager.email);
    expect((await me(ctx, tokens.access)).status).toBe(200);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { isActive: false },
    });
    expect((await me(ctx, tokens.access)).status).toBe(401);
    expect((await refresh(ctx, tokens.refresh)).status).toBe(401);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { isActive: true },
    });
    expect((await me(ctx, tokens.access)).status).toBe(401);
    expect((await refresh(ctx, tokens.refresh)).status).toBe(401);

    const fresh = await loginTokens(ctx, manager.email);
    expect((await me(ctx, fresh.access)).status).toBe(200);
  });

  it('supported API disable permanently revokes every session', async () => {
    const owner = await createUser(ctx.prisma, {
      email: 'policy.admin@test.local',
      name: 'Policy Owner',
      role: Role.OWNER,
    });
    const manager = await newManager('policy.api.manager@test.local');
    const employee = await newEmployee(
      'policy.api-disabled@test.local',
      manager.id,
    );
    const first = await loginTokens(ctx, employee.email);
    const second = await loginTokens(ctx, employee.email);
    const admin = await loginTokens(ctx, owner.email);

    const disabled = await request(ctx.app.getHttpServer())
      .patch(`/employees/${employee.id}/activation`)
      .set(auth(admin.access))
      .send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect((await me(ctx, first.access)).status).toBe(401);
    expect((await me(ctx, second.access)).status).toBe(401);
    expect((await refresh(ctx, first.refresh)).status).toBe(401);
    expect((await refresh(ctx, second.refresh)).status).toBe(401);

    const enabled = await request(ctx.app.getHttpServer())
      .patch(`/employees/${employee.id}/activation`)
      .set(auth(admin.access))
      .send({ isActive: true });
    expect(enabled.status).toBe(200);
    expect((await me(ctx, first.access)).status).toBe(401);
    expect((await refresh(ctx, first.refresh)).status).toBe(401);

    const fresh = await loginTokens(ctx, employee.email);
    expect((await me(ctx, fresh.access)).status).toBe(200);
  });

  it('revokes every active browser session on one role change', async () => {
    const manager = await newManager('policy.multi@test.local');
    const first = await loginTokens(ctx, manager.email);
    const second = await loginTokens(ctx, manager.email);
    const third = await loginTokens(ctx, manager.email);

    await ctx.prisma.user.update({
      where: { id: manager.id },
      data: { role: Role.EMPLOYEE },
    });

    for (const tokens of [first, second, third]) {
      expect((await employees(ctx, tokens.access)).status).toBe(401);
      expect((await refresh(ctx, tokens.refresh)).status).toBe(401);
    }
  });
});

describeWithDatabase('Role change policy parity in cookie mode', () => {
  let ctx: TestContext;
  let employeeEmail: string;
  let employeeId: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: {
        AUTH_COOKIE_MODE: 'cookie',
        FRONTEND_ORIGIN: ORIGIN,
        COOKIE_SECURE: 'false',
      },
    });
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'policy.cookie.manager@test.local',
      name: 'Cookie Policy Manager',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'policy.cookie@test.local',
      name: 'Cookie Policy Employee',
      role: Role.EMPLOYEE,
      managerUserId: manager.id,
    });
    employeeEmail = employee.email;
    employeeId = employee.id;
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
    process.env.AUTH_COOKIE_MODE = 'legacy';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    process.env.COOKIE_SECURE = 'false';
  });

  it('cookie sessions are revoked on role change and cannot refresh into the new role', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const bootstrap = await agent.get('/auth/csrf').set('Origin', ORIGIN);
    const login = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
      .send({ email: employeeEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    const oldAccess = cookieValue(cookiesOf(login), 'arkan_dev_access');
    const csrf = login.body.data.csrfToken as string;
    expect(oldAccess).toBeTruthy();

    await ctx.prisma.user.update({
      where: { id: employeeId },
      data: { role: Role.MANAGER },
    });

    expect(
      (
        await request(ctx.app.getHttpServer())
          .get('/employees')
          .set(auth(oldAccess as string))
      ).status,
    ).toBe(401);
    expect(
      (
        await agent
          .post('/auth/refresh')
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf)
          .send({})
      ).status,
    ).toBe(401);

    // Fresh cookie login is required and now carries MANAGER.
    const bootstrap2 = await agent.get('/auth/csrf').set('Origin', ORIGIN);
    const relogin = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', bootstrap2.body.data.csrfToken)
      .send({ email: employeeEmail, password: PASSWORD });
    expect(relogin.status).toBe(200);
    expect(relogin.body.data.user.role).toBe('MANAGER');
    expect((await agent.get('/employees')).status).toBe(200);
  });
});
