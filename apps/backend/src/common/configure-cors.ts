import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveAuthCookieConfig } from '../auth/auth-cookie.config';

/**
 * Shared CORS setup for the real server and the test application.
 * Credentials are enabled only when cookie authentication is actually active;
 * origins are always explicit and never wildcarded.
 */
export function configureCors(
  app: INestApplication,
  config: ConfigService,
) {
  const cookieConfig = resolveAuthCookieConfig({
    mode: config.get<string>('AUTH_COOKIE_MODE'),
    nodeEnv: config.get<string>('NODE_ENV'),
    secure: config.get<boolean | string>('COOKIE_SECURE'),
    frontendOrigin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    accessTtlSeconds: config.get<number>('JWT_ACCESS_TTL_SECONDS'),
  });
  app.enableCors({
    origin: cookieConfig.allowedOrigins,
    credentials: cookieConfig.mode !== 'legacy',
    // Authorization is retained for the legacy/dual Bearer migration window.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'Idempotency-Key',
    ],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
  return cookieConfig;
}
