import type { AuthUser, TokenPair } from '@arkan/shared';
import { ApiError } from '../../lib/api-client';
import * as api from './api/auth-api';
export interface Session extends TokenPair {
  user: AuthUser;
}
const STORAGE_KEY = 'arkan.auth.v1';
/** Broadcast by `session.ts` when the browser session stops being usable. */
export const SESSION_EXPIRED_EVENT = 'arkan:session-expired';
let revision = 0;
let pending: Promise<Session | null> | null = null;
let refreshing: Promise<string | null> | null = null;

function readTokens(): TokenPair | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TokenPair>;
    if (
      typeof value.accessToken === 'string' &&
      value.accessToken &&
      typeof value.refreshToken === 'string' &&
      value.refreshToken
    )
      return value as TokenPair;
  } catch {
    /* Corrupted development storage is treated as logged out. */
  }
  clearStoredSession();
  return null;
}
function save(session: TokenPair | Session) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    throw new Error(
      'تعذر حفظ الجلسة. اسمح بتخزين بيانات هذا الموقع ثم حاول مجددًا.',
    );
  }
}
export async function signIn(input: api.LoginInput): Promise<Session> {
  const tokens = await api.login(input);
  try {
    const session = { ...tokens, user: await api.getMe(tokens.accessToken) };
    save(session);
    revision++;
    return session;
  } catch (error) {
    await api.logout(tokens.refreshToken).catch(() => undefined);
    throw error;
  }
}
function clearStoredSession() {
  // Storage may be blocked by browser privacy settings.
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Already inaccessible. */
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Clear only this app's session, preserving unrelated preferences. */
  }
}
function announceSessionExpired() {
  try {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  } catch {
    /* Non-browser environment (SSR/unit tests) has no window to notify. */
  }
}

/** Access token of the current browser session, or `null` when signed out. */
export function getStoredAccessToken(): string | null {
  return readTokens()?.accessToken ?? null;
}

/**
 * Rotates the refresh token (single-flight so concurrent requests share one
 * rotation) and returns a fresh access token. A refresh that the backend
 * refuses clears the session so the app cannot keep retrying with a dead token.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const tokens = readTokens();
      if (!tokens) return null;
      try {
        const next = await api.refresh(tokens.refreshToken);
        save(next);
        return next.accessToken;
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          clearStoredSession();
          announceSessionExpired();
        }
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function restore(): Promise<Session | null> {
  const expected = revision;
  let tokens = readTokens();
  if (!tokens) return null;
  try {
    let user: AuthUser;
    try {
      user = await api.getMe(tokens.accessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (revision !== expected) return null;
      tokens = await api.refresh(tokens.refreshToken);
      if (revision !== expected) {
        await api.logout(tokens.refreshToken).catch(() => undefined);
        return null;
      }
      // Keep rotated tokens even if the subsequent profile request is offline.
      save(tokens);
      user = await api.getMe(tokens.accessToken);
    }
    if (revision !== expected) return null;
    const session = { ...tokens, user };
    save(session);
    return session;
  } catch (error) {
    if (revision !== expected) return null;
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      clearStoredSession();
      return null;
    }
    throw error;
  }
}
export function restoreSession(): Promise<Session | null> {
  // React StrictMode and multiple consumers share one refresh request.
  if (!pending)
    pending = restore().finally(() => {
      pending = null;
    });
  return pending;
}
export async function signOut(): Promise<void> {
  const tokens = readTokens();
  revision++;
  // This device's Web Push subscription is dropped BEFORE the session is
  // closed, so the browser stops being a push target immediately. The server
  // revokes the whole session lineage on logout as well, so the pushes stop
  // even if this call never reaches the server.
  // (Imported lazily: the push helper uses the authorized request layer,
  // which depends on this module.)
  const { disablePush } = await import('../notifications/push');
  await disablePush().catch(() => undefined);
  clearStoredSession();
  if (tokens) await api.logout(tokens.refreshToken);
}
