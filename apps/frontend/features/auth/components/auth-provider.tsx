'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import type { AuthUser } from '@arkan/shared';
import { AUTH_MODE } from '../../../lib/auth-mode';
import type { LoginInput } from '../api/auth-api';
import { restoreSession, signIn, signOut, SESSION_EXPIRED_EVENT } from '../session';

interface AuthContextValue {
  user: AuthUser | null;
  checking: boolean;
  error: string | null;
  login(input: LoginInput): Promise<AuthUser>;
  logout(): Promise<void>;
  retry(): void;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkedPath, setCheckedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let active = true;
    async function checkSession() {
      try {
        const session = await restoreSession();
        if (active) {
          setUser(session?.user ?? null);
          setError(null);
        }
      } catch (reason) {
        if (active) {
          setUser(null);
          setError(
            reason instanceof Error ? reason.message : 'تعذر التحقق من الجلسة.',
          );
        }
      } finally {
        if (active) setCheckedPath(pathname);
      }
    }
    void checkSession();
    return () => {
      active = false;
    };
  }, [pathname, attempt]);
  // When a refresh the backend refuses clears the stored session, drop the
  // in-memory user so `RequireRole` sends the browser back to the login screen
  // (and every screen clears any private data it was showing).
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setError('انتهت الجلسة. الرجاء تسجيل الدخول من جديد.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);
  const login = useCallback(async (input: LoginInput) => {
    const session = await signIn(input);
    setUser(session.user);
    setError(null);
    return session.user;
  }, []);
  const logout = useCallback(async () => {
    if (AUTH_MODE === 'legacy') {
      // Preserve the existing local-first logout behavior for Bearer mode.
      setUser(null);
      setError(null);
      await signOut();
      return;
    }
    // HttpOnly cookies cannot be cleared by JavaScript. Only drop the
    // in-memory user after the server confirmed the logout, otherwise the
    // next reload would silently sign the user back in.
    await signOut();
    setUser(null);
    setError(null);
  }, []);
  return (
    <AuthContext.Provider
      value={{
        user,
        checking: checkedPath !== pathname,
        error,
        login,
        logout,
        retry: () => {
          setCheckedPath(null);
          setAttempt((value) => value + 1);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}
