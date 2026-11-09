import { Role, type AuthUser, type TokenPair } from '@arkan/shared';
import { apiRequest } from '../../../lib/api-client';
import { getCsrfToken, setCsrfToken } from '../../../lib/api/csrf-store';

export interface LoginInput {
  email: string;
  password: string;
}

/** Response of login/refresh in legacy, dual and cookie modes. */
export interface AuthResponse {
  user?: AuthUser;
  csrfToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

export const roleHome = (role: Role) =>
  role === Role.OWNER || role === Role.MANAGER ? '/manager' : '/employee';

function assertUser(user: AuthUser | undefined): AuthUser {
  if (
    !user ||
    typeof user.id !== 'string' ||
    !user.id ||
    (user.role !== Role.OWNER &&
      user.role !== Role.MANAGER &&
      user.role !== Role.EMPLOYEE)
  )
    throw new Error('تعذّر التحقق من بيانات الجلسة.');
  return user;
}

export function validateLegacyTokens(tokens: TokenPair): TokenPair {
  if (
    !tokens ||
    typeof tokens.accessToken !== 'string' ||
    !tokens.accessToken ||
    typeof tokens.refreshToken !== 'string' ||
    !tokens.refreshToken ||
    typeof tokens.expiresIn !== 'number' ||
    tokens.expiresIn <= 0
  )
    throw new Error('تعذّر إنشاء جلسة صالحة.');
  return tokens;
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const response = await apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: input,
  });
  if (response?.csrfToken) setCsrfToken(response.csrfToken);
  return response;
}

export async function getMe(accessToken?: string): Promise<AuthUser> {
  const user = await apiRequest<AuthUser>(
    '/auth/me',
    accessToken ? { accessToken } : {},
  );
  return assertUser(user);
}

/**
 * Bootstraps the double-submit CSRF cookie/token. Concurrent callers share ONE
 * in-flight request: two parallel GETs would otherwise let the later response
 * overwrite the cookie while the earlier caller still holds the earlier token
 * (a spurious 403 on the first mutation, e.g. login).
 */
let csrfInFlight: Promise<string> | null = null;

export async function fetchCsrf(): Promise<string> {
  if (csrfInFlight) return csrfInFlight;
  csrfInFlight = (async () => {
    const response = await apiRequest<{ csrfToken: string }>('/auth/csrf');
    if (!response?.csrfToken || typeof response.csrfToken !== 'string')
      throw new Error('تعذّر تجهيز حماية الطلب.');
    setCsrfToken(response.csrfToken);
    return response.csrfToken;
  })();
  try {
    return await csrfInFlight;
  } finally {
    csrfInFlight = null;
  }
}

export async function ensureCsrf(): Promise<string> {
  return getCsrfToken() ?? fetchCsrf();
}

/**
 * Refreshes with the cookie (no body) in cookie/dual-cookie mode, or with the
 * legacy opaque token during the migration window.
 */
export async function refresh(refreshToken?: string): Promise<AuthResponse> {
  const response = await apiRequest<AuthResponse>('/auth/refresh', {
    method: 'POST',
    body: refreshToken ? { refreshToken } : {},
  });
  if (response?.csrfToken) setCsrfToken(response.csrfToken);
  return response;
}

/** One-time dual-mode exchange of a legacy refresh token for cookies. */
export function migrateLegacy(refreshToken: string): Promise<AuthResponse> {
  return refresh(refreshToken);
}

export function logout(refreshToken?: string) {
  return apiRequest<{ loggedOut: boolean }>('/auth/logout', {
    method: 'POST',
    body: refreshToken ? { refreshToken } : {},
  });
}
