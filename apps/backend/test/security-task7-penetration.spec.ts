import { Role } from '@arkan/shared';
import { NotificationType } from '@prisma/client';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
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
  resetRateLimiting,
  textBytes,
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

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

type TestAgent = ReturnType<typeof request.agent>;

async function csrfFor(agent: TestAgent): Promise<string> {
  const response = await agent.get('/auth/csrf').set('Origin', ORIGIN);
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

async function cookieLogin(agent: TestAgent, email: string) {
  const bootstrap = await csrfFor(agent);
  const response = await agent
    .post('/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', bootstrap)
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return {
    response,
    csrf: response.body.data.csrfToken as string,
    cookies: cookiesOf(response),
  };
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function tamperJwt(token: string, patch: Record<string, unknown>): string {
  const [header, payload, signature] = token.split('.') as [
    string,
    string,
    string,
  ];
  const decoded = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  return `${header}.${b64urlJson({ ...decoded, ...patch })}.${signature}`;
}

/** Sends an unauthenticated request without relying on dynamic overloading. */
function anonymousCall(
  app: TestContext['app'],
  method: string,
  url: string,
) {
  const api = request(app.getHttpServer());
  if (method === 'post') return api.post(url);
  if (method === 'patch') return api.patch(url);
  if (method === 'delete') return api.delete(url);
  return api.get(url);
}

const employeePayload = (
  seq: number,
  overrides: Record<string, unknown> = {},
) => ({
  listingType: 'SALE',
  governorate: 'Baghdad',
  district: 'Karrada',
  block: '9',
  plotNumber: String(970000 + seq),
  sizeSqm: '400.00',
  askingPrice: '250000.00',
  negotiable: true,
  description: 'Task 7 isolated security probe',
  floors: [{ type: 'GROUND', details: 'Ground floor' }, { type: 'FIRST' }],
  newContact: { type: 'BROKER', name: 'Task 7 Broker', phone: '77007000' },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Cookie / session / CSRF boundary
// ---------------------------------------------------------------------------

describeWithDatabase('Task 7 - cookie session boundaries', () => {
  let ctx: TestContext;
  let managerEmail: string;
  let employeeEmail: string;
  let demotionEmail: string;

  beforeAll(async () => {
    ctx = await createTestApp({
      env: {
        AUTH_COOKIE_MODE: 'cookie',
        FRONTEND_ORIGIN: ORIGIN,
        COOKIE_SECURE: 'false',
      },
    });
    await resetDatabase(ctx.prisma);
    managerEmail = (
      await createUser(ctx.prisma, {
        email: 't7.cookie.manager@test.local',
        name: 'T7 Cookie Manager',
        role: Role.MANAGER,
      })
    ).email;
    employeeEmail = (
      await createUser(ctx.prisma, {
        email: 't7.cookie.employee@test.local',
        name: 'T7 Cookie Employee',
        role: Role.EMPLOYEE,
      })
    ).email;
    demotionEmail = (
      await createUser(ctx.prisma, {
        email: 't7.cookie.demotion@test.local',
        name: 'T7 Cookie Demotion',
        role: Role.MANAGER,
      })
    ).email;
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
    process.env.AUTH_COOKIE_MODE = 'legacy';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    process.env.COOKIE_SECURE = 'false';
  });

  it('sets HttpOnly, SameSite=Lax, path-scoped cookies and a readable CSRF cookie', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const { response, cookies } = await cookieLogin(agent, managerEmail);

    expect(response.body.data.accessToken).toBeUndefined();
    expect(response.body.data.refreshToken).toBeUndefined();

    const access = cookies.find((c) => c.startsWith('arkan_dev_access='));
    const refresh = cookies.find((c) => c.startsWith('arkan_dev_refresh='));
    const csrf = cookies.find((c) => c.startsWith('arkan_dev_csrf='));

    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(access).toMatch(/Path=\//);
    expect(access).toMatch(/Max-Age=\d+/);

    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/SameSite=Lax/);
    expect(refresh).toMatch(/Path=\/auth/);

    expect(csrf).toBeTruthy();
    expect(csrf).not.toMatch(/HttpOnly/);
    expect(csrf).toMatch(/SameSite=Lax/);
  });

  it('does not fixate on an attacker-supplied refresh cookie', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const bootstrapResponse = await agent
      .get('/auth/csrf')
      .set('Origin', ORIGIN);
    const bootstrap = bootstrapResponse.body.data.csrfToken as string;
    const csrfCookie = cookieValue(
      cookiesOf(bootstrapResponse),
      'arkan_dev_csrf',
    );
    expect(csrfCookie).toBeTruthy();

    const loginResponse = await agent
      .post('/auth/login')
      .set(
        'Cookie',
        `arkan_dev_refresh=attacker-fixed-token; arkan_dev_csrf=${csrfCookie}`,
      )
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', bootstrap)
      .send({ email: managerEmail, password: PASSWORD });
    expect(loginResponse.status).toBe(200);

    const issued = cookiesOf(loginResponse);
    const newRefresh = cookieValue(issued, 'arkan_dev_refresh');
    const newCsrf = loginResponse.body.data.csrfToken as string;
    const newCsrfCookie = cookieValue(issued, 'arkan_dev_csrf');
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe('attacker-fixed-token');

    const replay = await request(ctx.app.getHttpServer())
      .post('/auth/refresh')
      .set(
        'Cookie',
        `arkan_dev_refresh=attacker-fixed-token; arkan_dev_csrf=${newCsrfCookie}`,
      )
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', newCsrf)
      .send({});
    expect(replay.status).toBe(401);
  });

  it('revokes the access cookie immediately on logout', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const { csrf, cookies } = await cookieLogin(agent, managerEmail);
    const oldCookies = cookieHeader(cookies);

    expect((await agent.get('/auth/me')).status).toBe(200);

    const logout = await agent
      .post('/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(logout.status).toBe(200);

    const after = await request(ctx.app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', oldCookies);
    expect(after.status).toBe(401);

    const refresh = await request(ctx.app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', oldCookies)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({});
    expect(refresh.status).toBe(401);
  });

  it('invalidates manager access immediately after a role demotion', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const { csrf } = await cookieLogin(agent, demotionEmail);

    expect((await agent.get('/employees')).status).toBe(200);

    await ctx.prisma.user.update({
      where: { email: demotionEmail },
      data: { role: Role.EMPLOYEE },
    });

    const demoted = await agent.get('/employees');
    expect([401, 403]).toContain(demoted.status);
    expect(JSON.stringify(demoted.body)).not.toMatch(/t7\.cookie\.employee/i);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(401);

    // Restoring the role must NOT resurrect the pre-change session: the
    // database trigger bumps authVersion and revokes every refresh token.
    await ctx.prisma.user.update({
      where: { email: demotionEmail },
      data: { role: Role.MANAGER },
    });
    expect(
      (await agent.get('/employees').set('X-CSRF-Token', csrf)).status,
    ).toBe(401);

    // A fresh login is the only way back.
    const fresh = request.agent(ctx.app.getHttpServer());
    await cookieLogin(fresh, demotionEmail);
    expect((await fresh.get('/employees')).status).toBe(200);
  });

  it('requires CSRF on every cookie mutation, including cross-site Fetch Metadata', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const { csrf } = await cookieLogin(agent, employeeEmail);

    const missing = await agent
      .post('/contacts')
      .set('Origin', ORIGIN)
      .send({ type: 'BROKER', name: 'No CSRF', phone: '77007111' });
    expect(missing.status).toBe(403);

    const wrong = await agent
      .post('/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'a'.repeat(43))
      .send({ type: 'BROKER', name: 'Wrong CSRF', phone: '77007112' });
    expect(wrong.status).toBe(403);

    const crossSite = await agent
      .post('/contacts')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'BROKER', name: 'Cross Site', phone: '77007113' });
    expect(crossSite.status).toBe(403);

    const crossOrigin = await agent
      .post('/contacts')
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'BROKER', name: 'Cross Origin', phone: '77007114' });
    expect(crossOrigin.status).toBe(403);

    const readAll = await agent
      .patch('/notifications/read-all')
      .set('Origin', ORIGIN)
      .send({});
    expect(readAll.status).toBe(403);

    const allowed = await agent
      .post('/contacts')
      .set('Origin', ORIGIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .set('X-CSRF-Token', csrf)
      .send({ type: 'BROKER', name: 'Allowed CSRF', phone: '77007115' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.name).toBe('Allowed CSRF');
  });

  it('rejects every private endpoint without a session and leaks no internals', async () => {
    const calls: Array<[string, string]> = [
      ['get', '/auth/me'],
      ['get', '/properties'],
      ['get', '/clients'],
      ['get', '/contacts'],
      ['get', '/follow-ups'],
      ['get', '/notifications'],
      ['get', '/notifications/unread-count'],
      ['get', '/dashboard/manager'],
      ['get', '/employees'],
      ['get', '/push/config'],
      ['get', '/push/subscriptions'],
      ['get', '/users/me/notification-preferences'],
      ['get', '/properties/trash'],
      ['post', '/contacts'],
      ['patch', '/notifications/read-all'],
    ];
    for (const [method, url] of calls) {
      const response = await anonymousCall(ctx.app, method, url).send({});
      expect({ url, status: response.status }).toEqual({ url, status: 401 });
      const raw = JSON.stringify(response.body);
      expect(raw).not.toMatch(/passwordHash|accessToken|refreshToken|stack/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Authorization, IDOR/BOLA, input, business logic, uploads
// ---------------------------------------------------------------------------

describeWithDatabase('Task 7 - authorization and input probes', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let ownerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let seq = 0;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 't7.manager@test.local',
      name: 'T7 Manager',
      role: Role.MANAGER,
    });
    const owner = await createUser(ctx.prisma, {
      email: 't7.owner@test.local',
      name: 'T7 Owner',
      role: Role.OWNER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 't7.employee.a@test.local',
      name: 'T7 Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 't7.employee.b@test.local',
      name: 'T7 Employee B',
      role: Role.EMPLOYEE,
    });
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeA.id }, create: { userId: employeeA.id }, update: {} });
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeB.id }, create: { userId: employeeB.id }, update: {} });
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    managerToken = await login(ctx.app, manager.email);
    ownerToken = await login(ctx.app, owner.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects tampered and unsigned JWTs instead of trusting the role claim', async () => {
    const valid = await api().get('/auth/me').set(auth(employeeAToken));
    expect(valid.status).toBe(200);
    expect(valid.body.data.role).toBe('EMPLOYEE');

    const escalated = tamperJwt(employeeAToken, { role: 'MANAGER' });
    const escalatedResponse = await api()
      .get('/employees')
      .set(auth(escalated));
    expect(escalatedResponse.status).toBe(401);

    const [header, payload] = employeeAToken.split('.') as [string, string];
    const unsigned = `${header}.${payload}.`;
    expect((await api().get('/auth/me').set(auth(unsigned))).status).toBe(401);

    const substituted = tamperJwt(employeeAToken, { sub: managerId });
    expect((await api().get('/auth/me').set(auth(substituted))).status).toBe(
      401,
    );
  });

  it('denies cross-employee IDOR/BOLA without leaking record data', async () => {
    const client = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({
        name: 'T7 Private Client',
        phone: '77008001',
        responsibleUserId: employeeAId,
      });
    expect(client.status).toBe(201);
    const clientId = client.body.data.id as string;

    expect((await api().get(`/clients/${clientId}`).set(auth(employeeAToken))).status).toBe(
      200,
    );
    const foreignClient = await api()
      .get(`/clients/${clientId}`)
      .set(auth(employeeBToken));
    expect(foreignClient.status).toBe(404);
    expect(JSON.stringify(foreignClient.body)).not.toMatch(
      /T7 Private Client|77008001/,
    );

    // Employees have no direct client write path at all (role-based 403 before
    // any lookup), so this cannot reveal whether the client exists.
    const foreignUpdate = await api()
      .patch(`/clients/${clientId}`)
      .set(auth(employeeBToken))
      .send({ notes: 'blocked' });
    expect(foreignUpdate.status).toBe(403);

    const contact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'BROKER', name: 'T7 Secret Broker', phone: '77008002' });
    expect(contact.status).toBe(201);
    const contactId = contact.body.data.id as string;
    const foreignContact = await api()
      .get(`/contacts/${contactId}`)
      .set(auth(employeeBToken));
    expect(foreignContact.status).toBe(404);
    expect(JSON.stringify(foreignContact.body)).not.toMatch(
      /T7 Secret Broker|77008002/,
    );

    const notification = await ctx.prisma.notification.create({
      data: {
        userId: employeeAId,
        type: NotificationType.SYSTEM,
        title: 'T7 private notification',
        body: 'T7 private body',
      },
    });
    const foreignNotification = await api()
      .patch(`/notifications/${notification.id}/read`)
      .set(auth(employeeBToken))
      .send({});
    expect(foreignNotification.status).toBe(404);
    expect(JSON.stringify(foreignNotification.body)).not.toMatch(
      /T7 private notification|T7 private body/,
    );

    const pending = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq),
      [{ buffer: pngBytes(), filename: 'pending.png' }],
    );
    expect(pending.status).toBe(201);
    const pendingId = pending.body.data.id as string;
    expect((await api().get(`/properties/${pendingId}`).set(auth(employeeBToken))).status).toBe(
      404,
    );
    expect(
      (await api().get(`/properties/${pendingId}/image`).set(auth(employeeBToken)))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/properties/${pendingId}/approve`)
          .set(auth(employeeBToken))
          .send({})
      ).status,
    ).toBe(403);

    const managerRoutes: Array<[string, string]> = [
      ['get', '/employees'],
      ['get', '/dashboard/manager'],
      ['get', '/properties/trash'],
      ['get', '/push/config'],
      ['get', '/users/me/notification-preferences'],
    ];
    for (const [method, url] of managerRoutes) {
      const response = await anonymousCall(ctx.app, method, url).set(
        auth(employeeBToken),
      );
      expect({ url, status: response.status }).toEqual({ url, status: 403 });
    }
  });

  it('rejects mass assignment of protected property, contact and client fields', async () => {
    const before = await ctx.prisma.property.count();
    const protectedProperty = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq, {
        status: 'AVAILABLE',
        reference: 'A-999999',
        createdByUserId: employeeBId,
        primaryImageId: '00000000-0000-0000-0000-000000000000',
      }),
      [],
    );
    expect(protectedProperty.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(before);

    const protectedNestedContact = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq, {
        newContact: {
          type: 'BROKER',
          name: 'Nested Mass Assignment',
          phone: '77008100',
          createdByUserId: employeeBId,
        },
      }),
      [],
    );
    expect(protectedNestedContact.status).toBe(400);

    const protectedContact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({
        type: 'BROKER',
        name: 'Contact Mass Assignment',
        phone: '77008101',
        createdByUserId: employeeBId,
      });
    expect(protectedContact.status).toBe(400);

    const client = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({
        name: 'T7 Mass Assignment Client',
        phone: '77008102',
        responsibleUserId: employeeAId,
      });
    expect(client.status).toBe(201);
    const protectedClient = await api()
      .patch(`/clients/${client.body.data.id}`)
      .set(auth(employeeAToken))
      .send({ createdByUserId: employeeBId });
    expect(protectedClient.status).toBe(400);
  });

  it('treats SQL/meta characters as data and rejects malformed input safely', async () => {
    const injection = "' OR 1=1--";
    const clients = await api()
      .get('/clients')
      .query({ search: injection })
      .set(auth(employeeAToken));
    expect(clients.status).toBe(200);
    expect(Array.isArray(clients.body.data.items)).toBe(true);

    const clientsWildcard = await api()
      .get('/clients')
      .query({ search: '%' })
      .set(auth(employeeAToken));
    expect(clientsWildcard.status).toBe(200);

    const properties = await api()
      .get('/properties')
      .query({ q: injection })
      .set(auth(employeeBToken));
    expect(properties.status).toBe(200);
    expect(Array.isArray(properties.body.data.items)).toBe(true);

    const propertiesWildcard = await api()
      .get('/properties')
      .query({ q: '%' })
      .set(auth(employeeBToken));
    expect(propertiesWildcard.status).toBe(200);

    expect((await api().get('/clients/not-a-uuid').set(auth(managerToken))).status).toBe(
      400,
    );
    expect(
      (await api().get('/contacts/not-a-uuid').set(auth(managerToken))).status,
    ).toBe(400);
    expect(
      (await api().get('/properties/not-a-uuid/image').set(auth(managerToken)))
        .status,
    ).toBe(400);

    const malformedPayload = await api()
      .post('/properties')
      .set(auth(employeeAToken))
      .field('payload', '{not-json');
    expect(malformedPayload.status).toBe(400);
    expect(JSON.stringify(malformedPayload.body)).not.toMatch(/stack|at Object/i);

    const malformedJson = await api()
      .post('/auth/login')
      .type('json')
      .send('{"email":');
    expect(malformedJson.status).toBe(400);
    expect(JSON.stringify(malformedJson.body)).not.toMatch(/stack|at Object/i);
  });

  it('hides a trashed property and its image from every normal read path', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq),
      [{ buffer: pngBytes(), filename: 'trash.png' }],
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approved.status).toBe(200);

    const url = `/properties/${id}/image`;
    expect((await api().get(`/properties/${id}`).set(auth(employeeAToken))).status).toBe(
      200,
    );
    expect((await api().get(url).set(auth(employeeAToken))).status).toBe(200);
    expect((await api().get(url).set(auth(employeeBToken))).status).toBe(200);

    // Trash is OWNER-only: a MANAGER may never move a row there.
    const managerTrashAttempt = await api()
      .post(`/properties/${id}/trash`)
      .set(auth(managerToken))
      .send({ reason: 'Task 7 isolation check' });
    expect(managerTrashAttempt.status).toBe(403);

    const trashed = await api()
      .post(`/properties/${id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'Task 7 isolation check' });
    expect(trashed.status).toBe(200);

    expect((await api().get(`/properties/${id}`).set(auth(employeeAToken))).status).toBe(
      404,
    );
    expect((await api().get(url).set(auth(employeeAToken))).status).toBe(404);
    expect((await api().get(url).set(auth(employeeBToken))).status).toBe(404);
    expect((await api().get(`/properties/${id}`).set(auth(managerToken))).status).toBe(
      404,
    );

    expect(
      (await api().get('/properties/trash').set(auth(managerToken))).status,
    ).toBe(403);

    const trashList = await api()
      .get('/properties/trash')
      .set(auth(ownerToken));
    expect(trashList.status).toBe(200);
    expect(
      (trashList.body.data.items as Array<{ id: string }>).some(
        (row) => row.id === id,
      ),
    ).toBe(true);
  });

  it('sanitises traversal filenames and rejects spoofed image contents', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq),
      [{ buffer: pngBytes(), filename: '../../../../evil.png' }],
    );
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('evil');

    const image = await api()
      .get(`/properties/${created.body.data.id}/image`)
      .set(auth(employeeAToken));
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else files.push(full);
      }
      return files;
    }
    const files = await walk(ctx.storageRoot);
    expect(files.some((file) => file.includes('evil'))).toBe(false);
    for (const file of files)
      expect(path.resolve(file).startsWith(path.resolve(ctx.storageRoot))).toBe(
        true,
      );

    const spoofed = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(++seq),
      [{ buffer: textBytes(), filename: 'spoofed.png' }],
    );
    expect(spoofed.status).toBe(400);
  });
});
