import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { Role } from '@arkan/shared';
import {
  createTestApp,
  createUser,
  describeWithDatabase,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

const PREFIX = `test:rate-integration:${Date.now()}:${Math.random()
  .toString(16)
  .slice(2)}:`;

describeWithDatabase('Redis-backed app rate limiting', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication | undefined;
  let cleanup: Redis | undefined;
  let available = true;

  beforeAll(async () => {
    cleanup = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      connectTimeout: 1500,
      retryStrategy: () => null,
    });
    try {
      await cleanup.ping();
    } catch {
      available = false;
      console.warn('Redis is unavailable; app integration test was skipped');
      return;
    }

    process.env.RATE_LIMIT_STORAGE = 'redis';
    process.env.RATE_LIMIT_KEY_PREFIX = PREFIX;
    process.env.RATE_LIMIT_LOGIN_PER_MIN = '2';
    process.env.RATE_LIMIT_WINDOW_SECONDS = '1';
    ctx = await createTestApp();
    app = ctx.app;
    await resetDatabase(ctx.prisma);
    await createUser(ctx.prisma, {
      email: 'redis.rate@test.local',
      name: 'Redis Rate User',
      role: Role.MANAGER,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (cleanup) {
      try {
        const keys = await cleanup.keys(`${PREFIX}*`);
        if (keys.length) await cleanup.del(...keys);
        await cleanup.quit();
      } catch {
        /* best effort */
      }
    }
    delete process.env.RATE_LIMIT_STORAGE;
    delete process.env.RATE_LIMIT_KEY_PREFIX;
    delete process.env.RATE_LIMIT_LOGIN_PER_MIN;
    delete process.env.RATE_LIMIT_WINDOW_SECONDS;
  });

  it('enforces, reports Retry-After and recovers through Redis', async () => {
    if (!available || !app) return;
    const login = () =>
      request(app!.getHttpServer())
        .post('/auth/login')
        .send({
          email: 'redis.rate@test.local',
          password: 'ChangeMe123!',
        });

    await login().expect(200);
    await login().expect(200);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await login().expect(200);
  });
});
