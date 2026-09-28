import type { AuthUser, TokenPair } from '@arkan/shared';
import { ApiError } from '../../lib/api-client';
import * as api from './api/auth-api';

export interface Session extends TokenPair {
  user: AuthUser;
}
const STORAGE_KEY = 'arkan.auth.v1';
let revision = 0;
let pending: Promise<Session | null> | null = null;

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
  clearStoredSession();
  if (tokens) await api.logout(tokens.refreshToken);
}
