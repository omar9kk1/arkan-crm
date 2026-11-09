import 'reflect-metadata';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  Throttle,
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerStorage,
} from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { AuthCookieService } from '../src/auth/auth-cookie.service';
import { CsrfService } from '../src/auth/csrf.service';
import { Public } from '../src/auth/decorators/public.decorator';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

@Public()
@Controller('test-other')
class OtherController {
  @Get() ok() {
    return { allowed: true };
  }

  @Throttle({ default: { limit: 1000, ttl: 60_000 } })
  @Get('throttled-default') ok2() {
    return { allowed: true };
  }
}

describe('Auth rate limiting', () => {
  let app: INestApplication;
  const authServiceMock: Pick<AuthService, 'login' | 'refresh' | 'logout'> = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'access2',
      refreshToken: 'refresh2',
      expiresIn: 900,
    }),
    logout: jest.fn().mockResolvedValue({ loggedOut: true }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [
            () => ({
              JWT_ACCESS_SECRET: 'test-only-secret-with-more-than-32-characters',
              JWT_ACCESS_TTL_SECONDS: 900,
              JWT_ISSUER: 'arkan-api',
              JWT_AUDIENCE: 'arkan-web',
            }),
          ],
        }),
        ThrottlerModule.forRoot([
          {
            name: 'default',
            limit: 10,
            ttl: 60_000,
          },
        ]),
      ],
      controllers: [AuthController, OtherController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: AuthCookieService,
          useValue: {
            mode: 'legacy',
            accessToken: () => null,
            refreshToken: () => null,
            csrfToken: () => null,
            setSession: jest.fn(),
            issueCsrf: jest.fn(),
            clear: jest.fn(),
          },
        },
        {
          provide: CsrfService,
          useValue: {
            hasAttempt: () => false,
            assert: jest.fn(),
            issue: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            managerCapability: { findMany: jest.fn(async () => []) },
          },
        },
        ThrottlerGuard,
      ],
    }).compile();

    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    (authServiceMock.login as jest.Mock).mockClear();
    (authServiceMock.refresh as jest.Mock).mockClear();
    (authServiceMock.logout as jest.Mock).mockClear();
    const storage = app.get(ThrottlerStorage);
    if (storage && typeof storage.storage === 'object') {
      const map = storage.storage as Map<string, unknown>;
      map.clear();
      try {
        const internal = storage as unknown as {
          hitExpirations?: { clear?: () => void };
        };
        internal.hitExpirations?.clear?.();
      } catch (err) {
        void err;
      }
    }
  });

  it('allows login normally below the limit', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@arkan.test', password: 'password1234' })
        .expect(200);
    }
    expect(authServiceMock.login).toHaveBeenCalledTimes(5);
  });

  it('returns 429 when login exceeds limit', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `test2+${i}@arkan.test`, password: 'password1234' });
      if (res.status !== 200) {
        throw new Error(`Expected 200 on attempt ${i} but got ${res.status}`);
      }
    }
    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test3@arkan.test', password: 'password1234' });
    expect(blocked.status).toBe(429);
    expect(authServiceMock.login).toHaveBeenCalledTimes(10);
  });

  it('rate limits refresh separately', async () => {
    for (let i = 0; i < 30; i++) {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'token' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'token' })
      .expect(429);
    expect(authServiceMock.refresh).toHaveBeenCalledTimes(30);
  });

  it('does not throttle other API endpoints', async () => {
    for (let i = 0; i < 100; i++) {
      await request(app.getHttpServer())
        .get('/test-other')
        .expect(200);
    }
  });

  it('does not throttle other auth endpoints like logout/me', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refreshToken: 'token' })
        .expect(200);
    }
    expect(authServiceMock.logout).toHaveBeenCalledTimes(20);
  });
});
