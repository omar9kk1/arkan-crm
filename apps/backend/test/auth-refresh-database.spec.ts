import { Role } from '@arkan/shared';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth/password';
import {
  auth,
  createTestApp,
  describeWithDatabase,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

const TEST_PASSWORD = 'ChangeMe123!';

/**
 * Session refresh against the REAL Prisma client and the isolated test
 * database — the regression guard for the "refresh/me answers 500/401 for a
 * perfectly valid session" failure.
 *
 * The auth path must resolve a session from the session columns ONLY. It must
 * never select unrelated `User` columns, otherwise a single pending migration
 * (a column that exists in `schema.prisma` but not yet in the database) breaks
 * login, `/auth/refresh` (500) and the JWT guard (`/auth/me` 401) for every
 * account at once.
 */
describeWithDatabase('Auth session refresh (real database)', () => {
  let ctx: TestContext;

  const api = () => request(ctx.app.getHttpServer());

  /**
   * Creates an account WITHOUT Prisma's default-filling write path: the auth
   * tests must not depend on any `User` column outside the session projection,
   * and they must stay runnable while an unrelated column is still awaiting its
   * migration. The raw INSERT only names the columns these tests use.
   */
  const createAccount = async (
    email: string,
    name: string,
    role: Role,
  ): Promise<string> => {
    const id = randomUUID();
    await ctx.prisma.$executeRaw`
      INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "isActive", "createdAt", "updatedAt")
      VALUES (${id}::uuid, ${email}, ${await hashPassword(TEST_PASSWORD)}, ${name}, ${role}::"Role", true, now(), now())`;
    return id;
  };

  const login = async (email: string) => {
    const response = await api()
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  for (const role of [Role.MANAGER, Role.EMPLOYEE]) {
    it(`renews a ${role} session and answers controlled 401s`, async () => {
      const email = `auth-refresh-${role.toLowerCase()}@arkan.test`;
      await createAccount(email, role, role);

      const original = await login(email);

      // The access token resolves through the guard (session + user state).
      const me = await api()
        .get('/auth/me')
        .set(auth(original.accessToken))
        .expect(200);
      expect(me.body.data).toEqual(
        expect.objectContaining({ role, id: expect.any(String) }),
      );

      // A valid session refreshes (rotation), never a 500.
      const rotated = await api()
        .post('/auth/refresh')
        .send({ refreshToken: original.refreshToken })
        .expect(200);
      expect(rotated.body.data.refreshToken).not.toBe(original.refreshToken);
      expect(rotated.body.data.accessToken).toEqual(expect.any(String));

      await api()
        .get('/auth/me')
        .set(auth(rotated.body.data.accessToken))
        .expect(200);

      // The consumed token is refused with 401 (not 500)…
      await api()
        .post('/auth/refresh')
        .send({ refreshToken: original.refreshToken })
        .expect(401);
      // …and so is an unknown / revoked one.
      await api()
        .post('/auth/refresh')
        .send({ refreshToken: 'unknown-refresh-token' })
        .expect(401);

      await api()
        .post('/auth/logout')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(200);
      await api()
        .post('/auth/refresh')
        .send({ refreshToken: rotated.body.data.refreshToken })
        .expect(401);
      await api()
        .get('/auth/me')
        .set(auth(rotated.body.data.accessToken))
        .expect(401);
    });
  }

  it('answers 401 (never 500) for missing, malformed and expired sessions', async () => {
    await api().get('/auth/me').expect(401);
    await api().post('/auth/refresh').send({}).expect(400);
    await api()
      .post('/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
      .expect(401);

    const email = 'auth-refresh-expired@arkan.test';
    await createAccount(email, 'Expired', Role.EMPLOYEE);
    const session = await login(email);
    await ctx.prisma.refreshToken.updateMany({
      where: {
        userId: (
          await ctx.prisma.user.findUniqueOrThrow({
            where: { email },
            select: { id: true },
          })
        ).id,
      },
      data: { expiresAt: new Date(0) },
    });
    await api()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });
});
