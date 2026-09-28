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
import type { LoginInput } from '../api/auth-api';
import { restoreSession, signIn, signOut } from '../session';

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
  const login = useCallback(async (input: LoginInput) => {
    const session = await signIn(input);
    setUser(session.user);
    setError(null);
    return session.user;
  }, []);
  const logout = useCallback(async () => {
    setUser(null);
    setError(null);
    await signOut();
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
