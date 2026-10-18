import { ApiError, apiRequest, type RequestOptions } from '../api-client';
import {
  getStoredAccessToken,
  refreshAccessToken,
} from '../../features/auth/session';

/**
 * Performs an authenticated backend request against the current session.
 *
 * - Reuses the existing `arkan.auth.v1` session (no second login/session store).
 * - On 401 it rotates the refresh token once (single-flight) and retries the
 *   request exactly once; a refresh the backend refuses leaves the stored
 *   session cleared so `AuthProvider`/`RequireRole` can send the user to login.
 * - Tokens are only ever sent as an `Authorization` header — never as a query
 *   string or a `src` URL — so a private image URL can never leak a token.
 */
export async function authorizedRequest<T>(
  path: string,
  options: Omit<RequestOptions, 'accessToken'> = {},
): Promise<T> {
  const token = getStoredAccessToken();
  if (!token) throw new ApiError(401);
  try {
    return await apiRequest<T>(path, { ...options, accessToken: token });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw error;
    return apiRequest<T>(path, { ...options, accessToken: refreshed });
  }
}
