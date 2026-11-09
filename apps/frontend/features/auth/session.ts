import type { AuthUser, TokenPair } from '@arkan/shared';
import { ApiError } from '../../lib/api-client';
import { AUTH_MODE } from '../../lib/auth-mode';
import { clearCsrfToken, getCsrfToken } from '../../lib/api/csrf-store';
import * as api from './api/auth-api';

export interface Session {
  user: AuthUser;
}
interface LegacySession extends Session, TokenPair {}

const STORAGE_KEY = 'arkan.auth.v1';
const AUTH_EVENT_KEY = 'arkan:auth-event';
const AUTH_CHANNEL = 'arkan:auth';
/** Broadcast by `session.ts` when the browser session stops being usable. */
export const SESSION_EXPIRED_EVENT = 'arkan:session-expired';

let revision = 0;
let pending: Promise<Session | null> | null = null;
let refreshing: Promise<boolean> | null = null;
/** True once this tab has a cookie-backed session (or is in cookie mode). */
let cookieSession = AUTH_MODE === 'cookie';
let channel: BroadcastChannel | null = null;

function readLegacySession(): LegacySession | null {
  if (AUTH_MODE === 'cookie') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LegacySession>;
    if (
      typeof value.accessToken === 'string' &&
      value.accessToken &&
      typeof value.refreshToken === 'string' &&
      value.refreshToken &&
      typeof value.expiresIn === 'number' &&
      value.expiresIn > 0 &&
      value.user &&
      typeof value.user.id === 'string' &&
      (value.user.role === 'OWNER' ||
        value.user.role === 'MANAGER' ||
        value.user.role === 'EMPLOYEE')
    )
      return value as LegacySession;
  } catch {
    /* Corrupted development storage is treated as logged out. */
  }
  clearLegacyStorage();
  return null;
}

function saveLegacy(session: LegacySession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    throw new Error('تعذّر حفظ الجلسة في هذا المتصفح.');
  }
}

function clearLegacyStorage(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage may be blocked. */
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Storage may be blocked. */
  }
}

function announceSessionExpired(): void {
  try {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  } catch {
    /* Non-browser environment. */
  }
}

function broadcastAuthEvent(type: 'logout' | 'expired'): void {
  try {
    if (channel) {
      channel.postMessage({ type });
      return;
    }
    // Safe, non-sensitive fallback when BroadcastChannel is unavailable.
    localStorage.setItem(
      AUTH_EVENT_KEY,
      JSON.stringify({ type, at: Date.now() }),
    );
  } catch {
    /* Cross-tab coordination is best effort. */
  }
}

function bindCrossTabEvents(): void {
  if (typeof window === 'undefined') return;
  try {
    const BroadcastChannelCtor = window.BroadcastChannel;
    if (BroadcastChannelCtor) {
      channel = new BroadcastChannelCtor(AUTH_CHANNEL);
      channel.addEventListener('message', (event: MessageEvent) => {
        const type = (event.data as { type?: unknown } | null)?.type;
        if (type !== 'logout' && type !== 'expired') return;
        cookieSession = false;
        clearLegacyStorage();
        clearCsrfToken();
        announceSessionExpired();
      });
    }
    window.addEventListener('storage', (event) => {
      if (event.key !== AUTH_EVENT_KEY || !event.newValue) return;
      try {
        const type = (JSON.parse(event.newValue) as { type?: unknown }).type;
        if (type !== 'logout' && type !== 'expired') return;
        cookieSession = false;
        clearLegacyStorage();
        clearCsrfToken();
        announceSessionExpired();
      } catch {
        /* Ignore malformed cross-tab events. */
      }
    });
  } catch {
    /* BroadcastChannel/storage may be blocked. */
  }
}

bindCrossTabEvents();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cross-tab refresh coordination. Web Locks is the primary mechanism; a
 * localStorage mutex is the bounded fallback. Inside the lock, callers first
 * probe `/auth/me` so a tab that lost the race can reuse the rotated cookie.
 */
async function withRefreshLock<T>(work: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== 'undefined'
      ? (
          navigator as Navigator & {
            locks?: {
              request: <R>(name: string, callback: () => Promise<R>) => Promise<R>;
            };
          }
        ).locks
      : undefined;
  if (locks?.request) return locks.request('arkan:auth-refresh', work);

  const key = 'arkan:auth-refresh-lock';
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const raw = localStorage.getItem(key);
      const current = raw
        ? (JSON.parse(raw) as { id?: string; expiresAt?: number })
        : null;
      if (!current || !current.expiresAt || current.expiresAt < Date.now()) {
        localStorage.setItem(
          key,
          JSON.stringify({ id, expiresAt: Date.now() + 5000 }),
        );
        const confirmed = JSON.parse(
          localStorage.getItem(key) ?? '{}',
        ) as { id?: string };
        if (confirmed.id === id) {
          try {
            return await work();
          } finally {
            try {
              const latest = JSON.parse(
                localStorage.getItem(key) ?? '{}',
              ) as { id?: string };
              if (latest.id === id) localStorage.removeItem(key);
            } catch {
              /* Best effort. */
            }
          }
        }
      }
    } catch {
      /* Storage can be blocked; fall through to the per-tab single flight. */
      break;
    }
    await delay(50);
  }
  return work();
}

/** Access token for legacy/dual-Bearer requests; null in cookie mode. */
export function getStoredAccessToken(): string | null {
  if (AUTH_MODE === 'cookie') return null;
  if (AUTH_MODE === 'dual' && cookieSession) return null;
  return readLegacySession()?.accessToken ?? null;
}

/** Whether this tab currently uses cookie authentication. */
export function usesCookieSession(): boolean {
  return AUTH_MODE === 'cookie' || (AUTH_MODE === 'dual' && cookieSession);
}

/** Ensures a CSRF token exists before a cookie login/refresh/mutation. */
export async function ensureCsrfToken(): Promise<string> {
  return api.ensureCsrf();
}

async function legacyRefresh(): Promise<boolean> {
  const stored = readLegacySession();
  if (!stored) return false;
  try {
    const next = await api.refresh(stored.refreshToken);
    const tokens = api.validateLegacyTokens(next as TokenPair);
    saveLegacy({ ...tokens, user: stored.user });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearLegacyStorage();
      clearCsrfToken();
      announceSessionExpired();
      broadcastAuthEvent('expired');
      return false;
    }
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}

async function cookieRefresh(): Promise<boolean> {
  return withRefreshLock(async () => {
    // Another tab may have already rotated the shared cookie.
    try {
      const user = await api.getMe();
      if (user) {
        cookieSession = true;
        return true;
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }

    try {
      await api.ensureCsrf();
      let response: api.AuthResponse;
      try {
        response = await api.refresh();
      } catch (error) {
        // A stale CSRF cookie is not an expired session. Refresh it once.
        if (error instanceof ApiError && error.status === 403) {
          await api.fetchCsrf();
          response = await api.refresh();
        } else {
          throw error;
        }
      }
      if (!response.user) await api.getMe();
      cookieSession = true;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        cookieSession = false;
        clearLegacyStorage();
        clearCsrfToken();
        announceSessionExpired();
        broadcastAuthEvent('expired');
        return false;
      }
      // 403 is CSRF, never an expired session. Let the caller surface it.
      if (error instanceof ApiError && error.status === 403) return false;
      throw error;
    }
  });
}

/**
 * Refreshes once. Returns true when the session is usable again. A 403 (CSRF)
 * is deliberately not treated as an expired session and never clears tokens.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      if (AUTH_MODE === 'legacy') return legacyRefresh();
      if (AUTH_MODE === 'dual' && !cookieSession) {
        const stored = readLegacySession();
        if (!stored) return cookieRefresh();
        try {
          await api.ensureCsrf();
          const response = await api.refresh(stored.refreshToken);
          if (response.user) {
            cookieSession = true;
            clearLegacyStorage();
            return true;
          }
          // Older dual/legacy backend: keep the Bearer session working.
          const tokens = api.validateLegacyTokens(response as TokenPair);
          saveLegacy({ ...tokens, user: stored.user });
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearLegacyStorage();
            return cookieRefresh();
          }
          if (error instanceof ApiError && error.status === 403) return false;
          throw error;
        }
      }
      return cookieRefresh();
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function restoreLegacy(): Promise<Session | null> {
  const stored = readLegacySession();
  if (!stored) return Promise.resolve(null);
  const expected = revision;
  return (async () => {
    try {
      let user: AuthUser;
      try {
        user = await api.getMe(stored.accessToken);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        if (revision !== expected) return null;
        const refreshed = await api.refresh(stored.refreshToken);
        if (revision !== expected) return null;
        const tokens = api.validateLegacyTokens(refreshed as TokenPair);
        saveLegacy({ ...tokens, user: stored.user });
        user = await api.getMe(tokens.accessToken);
      }
      if (revision !== expected) return null;
      return { user };
    } catch (error) {
      if (revision !== expected) return null;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        clearLegacyStorage();
        return null;
      }
      throw error;
    }
  })();
}

async function restoreCookie(): Promise<Session | null> {
  const expected = revision;
  try {
    const user = await api.getMe();
    if (revision !== expected) return null;
    cookieSession = true;
    return { user };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }

  const refreshed = await refreshAccessToken();
  if (revision !== expected || !refreshed) return null;
  try {
    const user = await api.getMe();
    if (revision !== expected) return null;
    cookieSession = true;
    return { user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/**
 * Dual migration: exchange a legacy refresh token for HttpOnly cookies exactly
 * once. Tokens are cleared only after a confirmed cookie response or a 401
 * invalidation. A CSRF 403 is not treated as invalidation.
 */
async function migrateLegacySession(): Promise<Session | null> {
  const stored = readLegacySession();
  if (!stored) return null;
  const expected = revision;
  try {
    await api.ensureCsrf();
    const response = await api.refresh(stored.refreshToken);
    if (revision !== expected) return null;
    if (response.user) {
      cookieSession = true;
      clearLegacyStorage();
      // `api.refresh` already stored the rotated CSRF token; keep it so the
      // first mutation after migration does not need another bootstrap round.
      return { user: response.user };
    }
    // Backend still in pure legacy mode: keep the renewed Bearer session.
    const tokens = api.validateLegacyTokens(response as TokenPair);
    saveLegacy({ ...tokens, user: stored.user });
    const user = await api.getMe(tokens.accessToken);
    return { user };
  } catch (error) {
    if (revision !== expected) return null;
    if (error instanceof ApiError && error.status === 401) {
      clearLegacyStorage();
      clearCsrfToken();
      cookieSession = false;
      return null;
    }
    // 403 means CSRF, not invalidation. Keep the legacy tokens for a retry.
    if (error instanceof ApiError && error.status === 403) throw error;
    throw error;
  }
}

async function restoreDual(): Promise<Session | null> {
  const stored = readLegacySession();
  if (stored) {
    const migrated = await migrateLegacySession();
    if (migrated) return migrated;
  }
  return restoreCookie();
}

export function restoreSession(): Promise<Session | null> {
  if (!pending)
    pending = (async () => {
      if (AUTH_MODE === 'legacy') return restoreLegacy();
      if (AUTH_MODE === 'cookie') {
        // Cookies are the only credential in this mode; legacy storage must
        // never survive a cookie-mode boot.
        clearLegacyStorage();
        return restoreCookie();
      }
      return restoreDual();
    })().finally(() => {
      pending = null;
    });
  return pending;
}

export async function signIn(input: api.LoginInput): Promise<Session> {
  if (AUTH_MODE === 'legacy') {
    const response = await api.login(input);
    const tokens = api.validateLegacyTokens(response as TokenPair);
    const user = await api.getMe(tokens.accessToken);
    saveLegacy({ ...tokens, user });
    revision += 1;
    return { user };
  }

  await api.ensureCsrf();
  const response = await api.login(input);
  if (response.user) {
    cookieSession = true;
    clearLegacyStorage();
    revision += 1;
    return { user: response.user };
  }
  // A dual backend that ignored the CSRF attempt can still return legacy
  // tokens. Keep that session working rather than failing the login.
  if (response.accessToken && response.refreshToken) {
    const tokens = api.validateLegacyTokens(response as TokenPair);
    const user = await api.getMe(tokens.accessToken);
    saveLegacy({ ...tokens, user });
    cookieSession = false;
    revision += 1;
    return { user };
  }
  throw new Error('تعذّر إنشاء جلسة صالحة.');
}

async function disablePushBestEffort(): Promise<void> {
  try {
    const { disablePush } = await import('../notifications/push');
    await disablePush();
  } catch {
    /* A failed push cleanup must not block a confirmed cookie logout. */
  }
}

export async function signOut(): Promise<void> {
  revision += 1;
  const stored = readLegacySession();

  if (AUTH_MODE === 'legacy') {
    await disablePushBestEffort();
    clearLegacyStorage();
    clearCsrfToken();
    if (stored) await api.logout(stored.refreshToken).catch(() => undefined);
    return;
  }

  if (cookieSession || AUTH_MODE === 'cookie') {
    await disablePushBestEffort();
    let loggedOut = false;
    try {
      await api.ensureCsrf();
      await api.logout();
      loggedOut = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // The session already expired/revoked; clearing local state is safe.
        loggedOut = true;
      } else if (error instanceof ApiError && error.status === 403) {
        // CSRF token rotated/stale: refresh it and retry exactly once.
        await api.fetchCsrf();
        await api.logout();
        loggedOut = true;
      } else {
        throw error;
      }
    }
    if (!loggedOut) throw new Error('تعذّر تسجيل الخروج. حاول مرة أخرى.');
    cookieSession = false;
    clearLegacyStorage();
    clearCsrfToken();
    broadcastAuthEvent('logout');
    return;
  }

  // Dual mode still using a legacy Bearer session.
  await disablePushBestEffort();
  clearLegacyStorage();
  clearCsrfToken();
  cookieSession = false;
  if (stored) await api.logout(stored.refreshToken).catch(() => undefined);
  broadcastAuthEvent('logout');
}

/** For tests/diagnostics: the current mode without exposing any credential. */
export function authRuntimeMode(): string {
  return AUTH_MODE;
}

/** For tests/diagnostics: whether a CSRF token is currently in memory. */
export function hasCsrfToken(): boolean {
  return Boolean(getCsrfToken());
}
