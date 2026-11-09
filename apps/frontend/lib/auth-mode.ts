export type AuthMode = 'legacy' | 'dual' | 'cookie';

/**
 * Build-time authentication mode. Legacy is the default so an existing
 * deployment that does not set NEXT_PUBLIC_AUTH_MODE is byte-for-byte
 * unchanged.
 */
export function resolveAuthMode(raw: string | undefined): AuthMode {
  const value = raw?.trim().toLowerCase();
  return value === 'dual' || value === 'cookie' ? value : 'legacy';
}

export const AUTH_MODE: AuthMode = resolveAuthMode(
  process.env.NEXT_PUBLIC_AUTH_MODE,
);

export const USES_COOKIE_AUTH = AUTH_MODE !== 'legacy';
