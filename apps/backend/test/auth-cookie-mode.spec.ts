import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  createTestApp,
  createUser,
  describeWithDatabase,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

const PASSWORD = 'ChangeMe123!';
const ORIGIN = 'http://localhost:3001';

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

type TestAgent = ReturnType<typeof request.agent>;

async function csrfFor(agent: TestAgent): Promise<string> {
  const response = await agent.get('/auth/csrf').set('Origin', ORIGIN);
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

describeWithDatabase('Secure cookie authentication (cookie mode)', () => {
  let ctx: TestContext;
  let managerEmail: string;
  let employeeEmail: string;
  let manager: TestAgent;
  let managerCsrf: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: {
        AUTH_COOKIE_MODE: 'cookie',
        FRONTEND_ORIGIN: ORIGIN,
        COOKIE_SECURE: 'false',
      },
    });
    await resetDatabase(ctx.prisma);
    const managerUser = await createUser(ctx.prisma, {
      email: 'cookie-manager@test.local',
      name: 'Cookie Manager',
      role: Role.MANAGER,
    });
    const employeeUser = await createUser(ctx.prisma, {
      email: 'cookie-employee@test.local',
      name: 'Cookie Employee',
      role: Role.EMPLOYEE,
    });
    managerEmail = managerUser.email;
    employeeEmail = employeeUser.email;
    manager = request.agent(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.close();
    process.env.AUTH_COOKIE_MODE = 'legacy';
    process.env.COOKIE_SECURE = 'false';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  });

  it('issues a cryptographically random CSRF token', async () => {
    const first = await csrfFor(manager);
    const second = await csrfFor(manager);
    expect(first).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(first).not.toBe(second);
  });

  it('requires CSRF for cookie login and refuses to create cookies without it', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: managerEmail, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(cookiesOf(response)).toHaveLength(0);
  });

  it('rejects a mismatched CSRF token', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    await csrfFor(agent);
    const response = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'a'.repeat(43))
      .send({ email: managerEmail, password: PASSWORD });
    expect(response.status).toBe(403);
  });

  it('logs in with HttpOnly access/refresh cookies and no tokens in JSON', async () => {
    managerCsrf = await csrfFor(manager);
    const response = await manager
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-CSRF-Token', managerCsrf)
      .send({ email: managerEmail, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({ role: Role.MANAGER });
    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.body.data.refreshToken).toBeUndefined();
    managerCsrf = response.body.data.csrfToken as string;
    expect(managerCsrf).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    const cookies = cookiesOf(response);
    const access = cookies.find((cookie) =>
      cookie.startsWith('arkan_dev_access='),
    );
    const refresh = cookies.find((cookie) =>
      cookie.startsWith('arkan_dev_refresh='),
    );
    const csrf = cookies.find((cookie) =>
      cookie.startsWith('arkan_dev_csrf='),
    );
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    expect(csrf).toBeDefined();
    expect(access).toContain('HttpOnly');
    expect(access).toContain('SameSite=Lax');
    expect(access).toContain('Path=/');
    expect(access).toContain('Max-Age=900');
    expect(access).not.toContain('Secure');
    expect(access).not.toContain('Domain=');
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Path=/auth');
    expect(refresh).toContain('Max-Age=604800');
    expect(refresh).not.toContain('Domain=');
    expect(csrf).not.toContain('HttpOnly');
    expect(response.headers['cache-control']).toBe('no-store');

    const me = await manager.get('/auth/me').set('Origin', ORIGIN);
    expect(me.status).toBe(200);
    expect(me.body.data).toEqual({
      id: expect.any(String),
      role: Role.MANAGER,
      capabilities: {
        approveProperties: true,
        rejectProperties: true,
      },
    });
  });

  it('requires CSRF for cookie-authenticated mutations', async () => {
    const without = await manager
      .post('/clients')
      .set('Origin', ORIGIN)
      .send({ name: 'Cookie Client', phone: '65550001' });
    expect(without.status).toBe(403);

    const withToken = await manager
      .post('/clients')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-CSRF-Token', managerCsrf)
      .send({ name: 'Cookie Client', phone: '65550001' });
    expect(withToken.status).toBe(201);
  });

  it('rejects cross-origin and cross-site CSRF attempts', async () => {
    const crossOrigin = request.agent(ctx.app.getHttpServer());
    const tokenA = await csrfFor(crossOrigin);
    const evilOrigin = await crossOrigin
      .post('/auth/login')
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', tokenA)
      .send({ email: managerEmail, password: PASSWORD });
    expect(evilOrigin.status).toBe(403);

    const crossSite = request.agent(ctx.app.getHttpServer());
    const tokenB = await csrfFor(crossSite);
    const badSite = await crossSite
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('X-CSRF-Token', tokenB)
      .send({ email: managerEmail, password: PASSWORD });
    expect(badSite.status).toBe(403);
  });

  it('rotates cookies on refresh and rejects the old refresh token', async () => {
    const rotationAgent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(rotationAgent);
    const login = await rotationAgent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: managerEmail, password: PASSWORD });
    const loginCookies = cookiesOf(login);
    const oldRefresh = cookieValue(loginCookies, 'arkan_dev_refresh');
    const loginCsrf = login.body.data.csrfToken as string;
    expect(oldRefresh).toBeTruthy();

    const missingCsrf = await rotationAgent
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .send({});
    expect(missingCsrf.status).toBe(403);

    const response = await rotationAgent
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-CSRF-Token', loginCsrf)
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.body.data.refreshToken).toBeUndefined();
    const refreshedCookies = cookiesOf(response);
    const newCsrfCookie = cookieValue(refreshedCookies, 'arkan_dev_csrf');
    const newCsrf = response.body.data.csrfToken as string;
    expect(newCsrfCookie).toBeTruthy();

    if (oldRefresh && newCsrfCookie) {
      const replay = await request(ctx.app.getHttpServer())
        .post('/auth/refresh')
        .set(
          'Cookie',
          `arkan_dev_refresh=${oldRefresh}; arkan_dev_csrf=${newCsrfCookie}`,
        )
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', newCsrf)
        .send({});
      expect(replay.status).toBe(401);
    }
  });

  it('serializes concurrent cookie refresh to a single rotation', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: managerEmail, password: PASSWORD });
    const loginCsrf = login.body.data.csrfToken as string;
    const cookieHeader = cookiesOf(login)
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const refresh = () =>
      request(ctx.app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookieHeader)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', loginCsrf)
        .send({});
    const responses = await Promise.all([refresh(), refresh()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
  });

  it('does not leave a live session after concurrent refresh and logout', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: managerEmail, password: PASSWORD });
    const loginCsrf = login.body.data.csrfToken as string;
    const cookies = cookiesOf(login);
    const cookieHeader = cookies
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const oldAccess = cookieValue(cookies, 'arkan_dev_access');
    expect(oldAccess).toBeTruthy();

    const [refreshResponse, logoutResponse] = await Promise.all([
      request(ctx.app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookieHeader)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', loginCsrf)
        .send({}),
      request(ctx.app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookieHeader)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', loginCsrf)
        .send({}),
    ]);
    expect([refreshResponse.status, logoutResponse.status]).toContain(200);

    if (oldAccess) {
      const after = await request(ctx.app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', `arkan_dev_access=${oldAccess}`)
        .set('Origin', ORIGIN);
      expect(after.status).toBe(401);
    }
  });

  it('rejects logout without CSRF, then clears cookies with a valid token', async () => {
    const denied = await manager
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .send({});
    expect(denied.status).toBe(403);

    const response = await manager
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', managerCsrf)
      .send({});
    expect(response.status).toBe(200);
    const cleared = cookiesOf(response);
    expect(
      cleared.some((cookie) => cookie.startsWith('arkan_dev_access=')),
    ).toBe(true);
    expect(
      cleared
        .find((cookie) => cookie.startsWith('arkan_dev_access='))
        ?.includes('Max-Age=0'),
    ).toBe(true);

    const me = await manager.get('/auth/me').set('Origin', ORIGIN);
    expect(me.status).toBe(401);
  });

  it('keeps employee role isolation with cookie authentication', async () => {
    const employee = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(employee);
    const login = await employee
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: employeeEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    expect((await employee.get('/auth/me').set('Origin', ORIGIN)).status).toBe(
      200,
    );
    expect(
      (await employee.get('/employees').set('Origin', ORIGIN)).status,
    ).toBe(403);
  });

  it('sets credentialed CORS only for explicit origins', async () => {
    const preflight = await request(ctx.app.getHttpServer())
      .options('/auth/login')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    const allowedHeaders = String(
      preflight.headers['access-control-allow-headers'] ?? '',
    ).toLowerCase();
    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('x-csrf-token');
  });

  it('revokes a disabled account immediately', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: employeeEmail, password: PASSWORD });
    await ctx.prisma.user.updateMany({
      where: { email: employeeEmail },
      data: { isActive: false },
    });
    expect((await agent.get('/auth/me').set('Origin', ORIGIN)).status).toBe(
      401,
    );
    await ctx.prisma.user.updateMany({
      where: { email: employeeEmail },
      data: { isActive: true },
    });
  });
});

describeWithDatabase('Dual-mode authentication remains Bearer-compatible', () => {
  let ctx: TestContext;
  let managerEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: {
        AUTH_COOKIE_MODE: 'dual',
        FRONTEND_ORIGIN: ORIGIN,
        COOKIE_SECURE: 'false',
      },
    });
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'dual-manager@test.local',
      name: 'Dual Manager',
      role: Role.MANAGER,
    });
    managerEmail = manager.email;
  });

  afterAll(async () => {
    await ctx.close();
    process.env.AUTH_COOKIE_MODE = 'legacy';
    process.env.COOKIE_SECURE = 'false';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  });

  it('keeps legacy login and Bearer access working without CSRF', async () => {
    const login = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: managerEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    expect(login.body.data.refreshToken).toEqual(expect.any(String));
    expect(cookiesOf(login)).toHaveLength(0);

    const me = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('treats a cookie-less, body-less refresh as no session', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .send({});
    expect(response.status).toBe(401);
  });

  it('issues cookies only after a valid CSRF flow in dual mode', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    const login = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: managerEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toEqual(expect.any(String));
    expect(cookiesOf(login).length).toBeGreaterThanOrEqual(2);
    expect((await agent.get('/auth/me').set('Origin', ORIGIN)).status).toBe(
      200,
    );
  });

  it('migrates a legacy refresh token to cookies only with CSRF', async () => {
    const legacy = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: managerEmail, password: PASSWORD });
    const legacyRefresh = legacy.body.data.refreshToken as string;
    const legacyAccess = legacy.body.data.accessToken as string;
    expect(legacyRefresh).toEqual(expect.any(String));
    expect(legacyAccess).toEqual(expect.any(String));

    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    const migrated = await agent
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ refreshToken: legacyRefresh });
    expect(migrated.status).toBe(200);
    expect(migrated.body.data.user).toMatchObject({ role: Role.MANAGER });
    expect(cookiesOf(migrated).some((c) => c.startsWith('arkan_dev_access='))).toBe(
      true,
    );
    // Cookies now authenticate independently of the legacy Bearer token.
    expect((await agent.get('/auth/me').set('Origin', ORIGIN)).status).toBe(
      200,
    );
  });

  it('never falls back from an invalid cookie to a valid Bearer token', async () => {
    const bearerLogin = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: managerEmail, password: PASSWORD });
    const bearer = bearerLogin.body.data.accessToken as string;

    const agent = request.agent(ctx.app.getHttpServer());
    const csrf = await csrfFor(agent);
    const cookieLogin = await agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: managerEmail, password: PASSWORD });
    const access = cookieValue(cookiesOf(cookieLogin), 'arkan_dev_access');
    expect(access).toBeTruthy();

    // A valid Bearer token must not rescue a request that presented an
    // invalid cookie access token.
    const invalidCookie = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', 'arkan_dev_access=invalid')
      .set('Authorization', `Bearer ${bearer}`);
    expect(invalidCookie.status).toBe(401);

    // Conversely the cookie remains authoritative when a bogus Bearer is
    // supplied alongside it.
    const validCookie = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `arkan_dev_access=${access}`)
      .set('Authorization', 'Bearer not-a-token');
    expect(validCookie.status).toBe(200);
  });

  it('still allows legacy body-token refresh/logout in dual mode', async () => {
    const login = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: managerEmail, password: PASSWORD });
    const refresh = await request(ctx.app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', ORIGIN)
      .send({ refreshToken: login.body.data.refreshToken });
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toEqual(expect.any(String));

    const logout = await request(ctx.app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .send({ refreshToken: refresh.body.data.refreshToken });
    expect(logout.status).toBe(200);
  });
});
