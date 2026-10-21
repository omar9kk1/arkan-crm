import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Role } from '@arkan/shared';
import type { User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ThrottlerStorage } from '@nestjs/throttler';
import { environmentSchema } from '../../src/config/environment';
import { AuthModule } from '../../src/auth/auth.module';
import { ClientsModule } from '../../src/clients/clients.module';
import { ContactsModule } from '../../src/contacts/contacts.module';
import { EmployeesModule } from '../../src/employees/employees.module';
import { PropertiesModule } from '../../src/properties/properties.module';
import { NotificationsModule } from '../../src/notifications/notifications.module';
import { PushModule } from '../../src/push/push.module';
import { FilesModule } from '../../src/files/files.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { hashPassword } from '../../src/auth/password';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDatabase = Boolean(TEST_DATABASE_URL);

/** Actionable setup hint shown whenever the isolated database is unavailable. */
export const TEST_DATABASE_HELP = [
  'TEST_DATABASE_URL is not set, so database integration suites cannot run.',
  'They are FAILED on purpose (never silently skipped), so a run without the',
  'isolated test database can never report a misleading success.',
  '',
  'Point it ONLY at the dedicated test database — never at arkan_crm or any',
  'shared/production database — then re-run. PowerShell example:',
  '',
  '  $env:TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/arkan_crm_api_test?schema=public"',
  '  npm run test -w @arkan/backend',
].join('\n');

function describeMissingDatabase(name: string, _fn: () => void): void {
  describe(name, () => {
    it('requires the isolated TEST_DATABASE_URL to be set', () => {
      throw new Error(TEST_DATABASE_HELP);
    });
  });
}

/**
 * `describe` for suites that require the isolated test database.
 *
 * When TEST_DATABASE_URL is missing the suite registers ONE loudly failing
 * test instead of being skipped, so a full run (or a directly invoked
 * integration suite) FAILS with an actionable hint rather than passing with
 * quietly skipped security, privacy, authentication, property and
 * notification coverage. Pure unit suites use plain `describe` and stay
 * runnable on their own.
 */
export const describeWithDatabase: typeof describe = hasTestDatabase
  ? describe
  : (describeMissingDatabase as typeof describe);

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  storageRoot: string;
  close: () => Promise<void>;
}

const TEST_PASSWORD = 'ChangeMe123!';

/**
 * Builds a real Nest application (Auth + Clients + Contacts + Employees +
 * Properties + Notifications + Files) backed by the DEDICATED test database. It never touches the development
 * database: DATABASE_URL is repointed to TEST_DATABASE_URL before any PrismaClient
 * is constructed.
 */
export async function createTestApp(options?: {
  storageRoot?: string;
}): Promise<TestContext> {
  if (!TEST_DATABASE_URL)
    throw new Error('TEST_DATABASE_URL is not set; refusing to run writes.');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
  process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('hex');
  process.env.JWT_ACCESS_TTL_SECONDS = '900';
  process.env.JWT_ISSUER = 'arkan-test';
  process.env.JWT_AUDIENCE = 'arkan-test';
  const storageRoot =
    options?.storageRoot ??
    (await mkdtemp(path.join(tmpdir(), 'arkan-api-test-')));
  process.env.STORAGE_ROOT = storageRoot;

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validationSchema: environmentSchema,
      }),
      AuthModule,
      FilesModule,
      ClientsModule,
      ContactsModule,
      EmployeesModule,
      PropertiesModule,
      NotificationsModule,
      PushModule,
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  if (!process.env.TEST_VERBOSE) app.useLogger(false);
  await app.init();

  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    storageRoot,
    close: async () => {
      await app.close();
    },
  };
}

/** Truncates every application table in the ISOLATED test database. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (!rows.length) return;
  const list = rows
    .map((row) => `"public"."${row.tablename}"`)
    .join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

export async function createUser(
  prisma: PrismaService,
  input: { email: string; name: string; role: Role },
): Promise<User> {
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
}

export async function login(
  app: INestApplication,
  email: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: TEST_PASSWORD });
  if (response.status !== 200)
    throw new Error(
      `login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`,
    );
  return response.body.data.accessToken as string;
}

export const auth = (token: string): { Authorization: string } => ({
  Authorization: `Bearer ${token}`,
});

/**
 * Clears the shared in-memory auth rate-limit counters before a test.
 *
 * Integration suites authenticate far more often per minute from a single
 * address than a real user ever would (every test signs in again, sometimes
 * several times per test), so the production POST /auth/login limiter
 * (10/60s per IP) would otherwise 429 the middle of a suite. This only resets
 * shared state between tests — the limits themselves are untouched, and the
 * limiter's behaviour is asserted in auth-rate-limit.spec.ts.
 */
export function resetRateLimiting(app: INestApplication): void {
  const storage = app.get(ThrottlerStorage);
  storage.storage.clear();
  const internal = storage as unknown as {
    hitExpirations?: { clear?: () => void };
  };
  internal.hitExpirations?.clear?.();
}

// --- image fixtures -----------------------------------------------------------
// Genuine, decodable 40x30 JPEG/PNG/WebP images (a blue rectangle with a yellow
// top band), embedded as base64 so the helpers stay synchronous. The backend now
// decodes and re-encodes every upload, so a signature-only buffer is no longer a
// valid fixture. Regenerate with:
//   sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 32, g: 96, b: 160 } } })
//     .composite([{ input: <svg 40x30 with #ffcc00 top band>, top: 0, left: 0 }])
//     .png() | .jpeg() | .webp()
const PNG_FIXTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAYAAABe3VzdAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAVklEQVRYhe2UQQ0AQAzCkIK0SZugedrJYJf0wb9pAO1oL0dpgAVwMKh4z5aRDAZ196hdvZejNIABLAx2vGdmJIXBjnfNHHVhsE9GaQADWBjseM/880geBYf9FyjRlYMAAAAASUVORK5CYII=',
  'base64',
);
const JPEG_FIXTURE = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAeACgDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcG/8QAGhABAAEFAAAAAAAAAAAAAAAAAAMGFlWj0v/EABcBAQEBAQAAAAAAAAAAAAAAAAAGBAf/xAAgEQABAQgDAAAAAAAAAAAAAAAAAgEDBAUWF1KRU9HS/9oADAMBAAIRAxEAPwCtiH3zUeR0R8l81HkdEfKCtrNOR3tXg3VNC4q0zsuAh981HkdEfJfNR5HRHyW1mnI72rwKmhcVaZ2XAQ++ajyOiPkLazTkd7V4FTQuKtM7MyA7cQ4AAAAH/9k=',
  'base64',
);
const WEBP_FIXTURE = Buffer.from(
  'UklGRngAAABXRUJQVlA4IGwAAADQBACdASooAB4APm0qkUWkIqGYBABABsSgDE8uA/gGEAev/dgAGBrVTRtIefocAAD+9gFtN/Yg96j/H/774f/3+nScNfuKxi5+cNfuKxi///xvH+S7UPOkITA/0g8ykLKAjwcX8mN7ZS2wAAA=',
  'base64',
);

/** A real PNG plus optional zero padding (padding is ignored by decoders). */
export function pngBytes(extraBytes = 0): Buffer {
  return Buffer.concat([PNG_FIXTURE, Buffer.alloc(extraBytes)]);
}

export function jpegBytes(): Buffer {
  return Buffer.from(JPEG_FIXTURE);
}

export function webpBytes(): Buffer {
  return Buffer.from(WEBP_FIXTURE);
}

export function textBytes(): Buffer {
  return Buffer.from('this is definitely not an image', 'utf8');
}

export interface ImageFixture {
  buffer: Buffer;
  filename: string;
}

export function postProperty(
  app: INestApplication,
  token: string,
  payload: Record<string, unknown>,
  images: ImageFixture[],
) {
  const request_ = request(app.getHttpServer())
    .post('/properties')
    .set(auth(token))
    .field('payload', JSON.stringify(payload));
  for (const image of images)
    request_.attach('image', image.buffer, image.filename);
  return request_;
}
