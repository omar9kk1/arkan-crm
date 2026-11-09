import { resolveCorsOrigins } from '../config/cors-origins';

export type AuthCookieMode = 'legacy' | 'dual' | 'cookie';

export interface AuthCookieConfig {
  mode: AuthCookieMode;
  nodeEnv: string;
  secure: boolean;
  sameSite: 'Lax';
  hostOnly: true;
  accessName: string;
  refreshName: string;
  csrfName: string;
  accessPath: string;
  refreshPath: string;
  csrfPath: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
  csrfMaxAgeMs: number;
  allowedOrigins: string[];
}

const REFRESH_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthCookieInput {
  mode?: string;
  nodeEnv?: string;
  secure?: boolean | string;
  frontendOrigin?: string;
  accessTtlSeconds?: number;
}

/**
 * Resolves cookie security from configuration and fails closed for unsafe
 * production settings. This function has no I/O so it can be unit-tested.
 */
export function resolveAuthCookieConfig(
  input: AuthCookieInput,
): AuthCookieConfig {
  const mode = (input.mode ?? 'legacy') as AuthCookieMode;
  if (!['legacy', 'dual', 'cookie'].includes(mode))
    throw new Error(
      'AUTH_COOKIE_MODE must be one of legacy, dual, or cookie',
    );

  const nodeEnv = input.nodeEnv ?? 'development';
  const production = nodeEnv === 'production';
  const frontendOrigin = input.frontendOrigin?.trim() || 'http://localhost:3000';
  const origins = resolveCorsOrigins(frontendOrigin, nodeEnv);

  if (!origins.length)
    throw new Error('FRONTEND_ORIGIN must explicitly configure allowed origins');

  let secure: boolean;
  if (typeof input.secure === 'boolean') secure = input.secure;
  else if (typeof input.secure === 'string')
    secure = input.secure.trim().toLowerCase() === 'true';
  else secure = production;

  if (production) {
    if (!secure)
      throw new Error(
        'COOKIE_SECURE must be true in production; refusing to issue insecure auth cookies',
      );
    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`Invalid FRONTEND_ORIGIN: ${origin}`);
      }
      if (parsed.protocol !== 'https:')
        throw new Error(
          'Production FRONTEND_ORIGIN must use HTTPS before cookie authentication can be enabled',
        );
    }
  }

  const ttl = Math.max(60, Math.floor(input.accessTtlSeconds ?? 900));
  const prefix = production;

  return {
    mode,
    nodeEnv,
    secure,
    sameSite: 'Lax',
    hostOnly: true,
    accessName: prefix ? '__Host-arkan_access' : 'arkan_dev_access',
    refreshName: prefix ? '__Secure-arkan_refresh' : 'arkan_dev_refresh',
    csrfName: prefix ? '__Host-arkan_csrf' : 'arkan_dev_csrf',
    accessPath: '/',
    // The refresh cookie must also be available to /auth/logout so an expired
    // access token can still revoke the session.
    refreshPath: '/auth',
    csrfPath: '/',
    accessMaxAgeMs: ttl * 1000,
    refreshMaxAgeMs: REFRESH_LIFETIME_MS,
    csrfMaxAgeMs: REFRESH_LIFETIME_MS,
    allowedOrigins: origins,
  };
}
