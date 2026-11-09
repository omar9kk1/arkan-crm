import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@arkan/shared';
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

jest.setTimeout(120000);

const LIMIT_ENV_KEYS = [
  'RATE_LIMIT_WINDOW_SECONDS',
  'RATE_LIMIT_GLOBAL_PER_MIN',
  'RATE_LIMIT_LOGIN_PER_MIN',
  'RATE_LIMIT_REFRESH_PER_MIN',
  'RATE_LIMIT_CSRF_PER_MIN',
  'RATE_LIMIT_EXPENSIVE_READ_PER_MIN',
  'RATE_LIMIT_UPLOAD_PER_MIN',
  'RATE_LIMIT_PUSH_REGISTER_PER_MIN',
  'RATE_LIMIT_PUSH_TEST_PER_MIN',
  'TRUST_PROXY',
] as const;

describeWithDatabase('Rate limiting policies', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let managerToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    for (const key of LIMIT_ENV_KEYS) delete process.env[key];
    ctx = await createTestApp();
    app = ctx.app;
    await resetDatabase(ctx.prisma);
    await createUser(ctx.prisma, {
      email: 'rate.manager@test.local',
      name: 'Rate Manager',
      role: Role.MANAGER,
    });
    await createUser(ctx.prisma, {
      email: 'rate.employee@test.local',
      name: 'Rate Employee',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(app, 'rate.manager@test.local');
    employeeToken = await login(app, 'rate.employee@test.local');
  });

  afterAll(async () => {
    await ctx.close();
    for (const key of LIMIT_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of LIMIT_ENV_KEYS) delete process.env[key];
    resetRateLimiting(app);
  });

  it('returns 429 with Retry-After and recovers after the window', async () => {
    process.env.RATE_LIMIT_LOGIN_PER_MIN = '2';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '1';
    resetRateLimiting(app);

    for (let i = 0; i < 2; i += 1)
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'rate.manager@test.local',
          password: 'ChangeMe123!',
        })
        .expect(200);

    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'rate.manager@test.local',
        password: 'ChangeMe123!',
      });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'rate.manager@test.local',
        password: 'ChangeMe123!',
      })
      .expect(200);
  });

  it('forged X-Forwarded-For cannot bypass the login IP limit', async () => {
    process.env.RATE_LIMIT_LOGIN_PER_MIN = '2';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    for (const forwarded of ['203.0.113.1', '203.0.113.2']) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', forwarded)
        .send({
          email: 'rate.manager@test.local',
          password: 'ChangeMe123!',
        })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.3')
      .send({
        email: 'rate.manager@test.local',
        password: 'ChangeMe123!',
      })
      .expect(429);
  });

  it('keys authenticated limits by verified user, not shared IP', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '2';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    for (let i = 0; i < 2; i += 1)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(auth(managerToken))
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);

    const managerBlocked = await request(app.getHttpServer())
      .get('/auth/me')
      .set(auth(managerToken))
      .set('X-Forwarded-For', '203.0.113.50');
    expect(managerBlocked.status).toBe(429);

    // The employee shares the same socket/IP but has an independent allowance.
    for (let i = 0; i < 2; i += 1)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set(auth(employeeToken))
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
  });

  it('limits CSRF bootstrap by IP without changing auth behavior', async () => {
    process.env.RATE_LIMIT_CSRF_PER_MIN = '2';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    for (let i = 0; i < 2; i += 1)
      await request(app.getHttpServer())
        .get('/auth/csrf')
        .expect(200);

    const blocked = await request(app.getHttpServer()).get('/auth/csrf');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('limits uploads per authenticated user before body handling', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '600';
    process.env.RATE_LIMIT_UPLOAD_PER_MIN = '1';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    const first = await request(app.getHttpServer())
      .post('/properties')
      .set(auth(managerToken))
      .send({});
    expect(first.status).not.toBe(429);

    await request(app.getHttpServer())
      .post('/properties')
      .set(auth(managerToken))
      .send({})
      .expect(429);
  });

  it('limits push registration and test sends separately', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '600';
    process.env.RATE_LIMIT_PUSH_REGISTER_PER_MIN = '1';
    process.env.RATE_LIMIT_PUSH_TEST_PER_MIN = '1';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    const register = await request(app.getHttpServer())
      .put('/push/subscriptions')
      .set(auth(managerToken))
      .send({});
    expect(register.status).not.toBe(429);
    await request(app.getHttpServer())
      .put('/push/subscriptions')
      .set(auth(managerToken))
      .send({})
      .expect(429);

    resetRateLimiting(app);
    const testSend = await request(app.getHttpServer())
      .post('/push/test')
      .set(auth(managerToken))
      .send({});
    expect(testSend.status).not.toBe(429);
    await request(app.getHttpServer())
      .post('/push/test')
      .set(auth(managerToken))
      .send({})
      .expect(429);
  });

  it('keeps 401/403 semantics and normal polling under the global limit', async () => {
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '600';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
    resetRateLimiting(app);

    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/employees?limit=1')
      .set(auth(employeeToken))
      .expect(403);

    for (let i = 0; i < 15; i += 1) {
      await request(app.getHttpServer())
        .get('/notifications?limit=5')
        .set(auth(managerToken))
        .expect(200);
      await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set(auth(managerToken))
        .expect(200);
    }
    for (let i = 0; i < 5; i += 1)
      await request(app.getHttpServer())
        .get('/properties?limit=10')
        .set(auth(managerToken))
        .expect(200);
  });
});
