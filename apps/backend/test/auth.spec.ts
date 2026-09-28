import 'reflect-metadata';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RefreshToken, User } from '@prisma/client';
import request from 'supertest';
import { Role } from '@arkan/shared';
import { AuthModule } from '../src/auth/auth.module';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { hashRefreshToken } from '../src/auth/auth.service';

@Controller('test')
class RestrictedController {
  @Roles(Role.MANAGER) @Get('manager') manager() {
    return { allowed: true };
  }
  @Roles(Role.EMPLOYEE) @Get('employee') employee() {
    return { allowed: true };
  }
}

describe('Auth HTTP flow (Prisma test double)', () => {
  let app: INestApplication;
  const users = new Map<string, User>();
  const sessions = new Map<string, RefreshToken>();
  const audit = jest.fn().mockResolvedValue({});
  const secret = 'test-only-secret-with-more-than-32-characters';
  const jwt = new JwtService({
    secret,
    signOptions: { issuer: 'arkan-api', audience: 'arkan-web', expiresIn: 900 },
  });
  const database = {
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { email?: string; id?: string } }) =>
          [...users.values()].find((user) =>
            where.id ? user.id === where.id : user.email === where.email,
          ) ?? null,
      ),
    },
    refreshToken: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
          const session = [...sessions.values()].find((value) =>
            where.id
              ? value.id === where.id
              : value.tokenHash === where.tokenHash,
          );
          return session
            ? { ...session, user: users.get(session.userId)! }
            : null;
        },
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<RefreshToken, 'createdAt' | 'revokedAt'>;
        }) => {
          const session = { ...data, createdAt: new Date(), revokedAt: null };
          sessions.set(session.id, session);
          return session;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; expiresAt?: { gt: Date } };
          data: { revokedAt: Date };
        }) => {
          const session = sessions.get(where.id);
          if (
            !session ||
            session.revokedAt ||
            (where.expiresAt && session.expiresAt <= where.expiresAt.gt)
          )
            return { count: 0 };
          session.revokedAt = data.revokedAt;
          return { count: 1 };
        },
      ),
    },
    auditLog: { create: audit },
    $transaction: async (
      work: (tx: unknown) => Promise<unknown>,
    ): Promise<unknown> => work(database),
  };
  beforeAll(async () => {
    const passwordHash = await hashPassword('ChangeMe123!');
    for (const role of [Role.MANAGER, Role.EMPLOYEE]) {
      users.set(role, {
        id: role,
        email: role.toLowerCase() + '@arkan.test',
        name: role,
        passwordHash,
        role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: secret,
              JWT_ACCESS_TTL_SECONDS: 900,
              JWT_ISSUER: 'arkan-api',
              JWT_AUDIENCE: 'arkan-web',
            }),
          ],
        }),
        AuthModule,
      ],
      controllers: [RestrictedController],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    sessions.clear();
    audit.mockClear();
    users.forEach((user) => {
      user.isActive = true;
    });
  });
  const login = async (role = Role.EMPLOYEE as Role) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: role.toLowerCase() + '@arkan.test',
        password: 'ChangeMe123!',
      })
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };
  it('hashes passwords with unique salts and verifies them', async () => {
    const first = await hashPassword('ChangeMe123!');
    const second = await hashPassword('ChangeMe123!');
    expect(first).not.toBe(second);
    expect(await verifyPassword('ChangeMe123!', first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
    expect(await verifyPassword('ChangeMe123!', 'invalid')).toBe(false);
  });
  it('logs in both roles and enforces role boundaries', async () => {
    for (const role of [Role.MANAGER, Role.EMPLOYEE]) {
      const tokens = await login(role);
      for (const route of ['manager', 'employee']) {
        await request(app.getHttpServer())
          .get('/test/' + route)
          .set('Authorization', 'Bearer ' + tokens.accessToken)
          .expect(role.toLowerCase() === route ? 200 : 403);
      }
      const me = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer ' + tokens.accessToken)
        .expect(200);
      expect(me.body.data).toEqual({ id: role, role });
      expect(
        [...sessions.values()].some(
          (row) => row.tokenHash === hashRefreshToken(tokens.refreshToken),
        ),
      ).toBe(true);
      expect(
        [...sessions.values()].some(
          (row) => row.tokenHash === tokens.refreshToken,
        ),
      ).toBe(false);
    }
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'AUTH_LOGIN' }),
      }),
    );
  });
  it('rejects wrong passwords, missing users and disabled accounts', async () => {
    for (const email of ['employee@arkan.test', 'missing@arkan.test']) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    }
    users.get(Role.EMPLOYEE)!.isActive = false;
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'employee@arkan.test', password: 'ChangeMe123!' })
      .expect(401);
  });
  it('rotates refresh tokens, rejects reuse and invalidates old access', async () => {
    const original = await login();
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(200);
    expect(response.body.data.refreshToken).not.toBe(original.refreshToken);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer ' + original.accessToken)
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer ' + response.body.data.accessToken)
      .expect(200);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'AUTH_REFRESH' }),
      }),
    );
  });
  it('allows only one concurrent refresh to consume a token', async () => {
    const original = await login();
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: original.refreshToken }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });
  it('logs out idempotently and rejects the revoked access and refresh tokens', async () => {
    const tokens = await login();
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer ' + tokens.accessToken)
      .expect(401);
    expect(
      audit.mock.calls.filter(([input]) => input.data.action === 'AUTH_LOGOUT'),
    ).toHaveLength(1);
  });
  it('rejects expired refresh tokens and disabled users on active sessions', async () => {
    const tokens = await login();
    users.get(Role.EMPLOYEE)!.isActive = false;
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer ' + tokens.accessToken)
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
    users.get(Role.EMPLOYEE)!.isActive = true;
    sessions.forEach((session) => {
      session.expiresAt = new Date(0);
    });
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  });
  it('rejects missing, malformed, expired and incorrectly signed JWTs', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    const tokens = await login();
    const claims = jwt.verify(tokens.accessToken);
    const payload = { sub: claims.sub, role: claims.role, sid: claims.sid };
    const invalid = [
      'invalid',
      jwt.sign(payload, { expiresIn: -1 }),
      jwt.sign(payload, { audience: 'other' }),
      jwt.sign(payload, { secret: 'other-secret' }),
    ];
    for (const value of invalid)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer ' + value)
        .expect(401);
  });
  it('validates payloads and rejects unknown refresh tokens', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'bad', password: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'employee@arkan.test',
        password: 'ChangeMe123!',
        role: 'MANAGER',
      })
      .expect(400);
    for (const route of ['refresh', 'logout'])
      await request(app.getHttpServer())
        .post('/auth/' + route)
        .send({})
        .expect(400);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'unknown' })
      .expect(401);
  });
});
