import { ApiError, apiRequest, type RequestOptions } from '../api-client';
import { AUTH_MODE } from '../auth-mode';
import {
  ensureCsrfToken,
  getStoredAccessToken,
  refreshAccessToken,
  usesCookieSession,
} from '../../features/auth/session';

/**
 * Performs an authenticated backend request against the current session.
 *
 * - Legacy: Bearer token from sessionStorage (unchanged).
 * - Dual: Bearer while the legacy session is still being migrated; cookie +
 *   CSRF once the cookie session is active.
 * - Cookie: HttpOnly cookies + X-CSRF-Token; no access token in JavaScript.
 *
 * A 401 triggers exactly one refresh. A 403 is never treated as session
 * expiry (it may be CSRF or authorization) and therefore never loops.
 */
export async function authorizedRequest<T>(
  path: string,
  options: Omit<RequestOptions, 'accessToken'> = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const cookieMode = AUTH_MODE === 'cookie' || (AUTH_MODE === 'dual' && usesCookieSession());

  if (cookieMode && unsafe) {
    // Ensure mutations, including multipart uploads, always carry CSRF.
    await ensureCsrfToken();
  }

  const send = async (): Promise<T> => {
    if (AUTH_MODE === 'legacy' || (AUTH_MODE === 'dual' && !usesCookieSession())) {
      const token = getStoredAccessToken();
      if (!token) throw new ApiError(401);
      return apiRequest<T>(path, { ...options, accessToken: token });
    }
    return apiRequest<T>(path, options);
  };

  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw error;
    return send();
  }
}
