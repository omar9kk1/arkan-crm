'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@arkan/shared';
import { useAuth } from './auth-provider';
import { roleHome } from '../api/auth-api';
import { Button } from '../../../components/ui/button';

export function RequireRole({
  role,
  children,
}: {
  role: Role | readonly Role[];
  children: ReactNode;
}) {
  const { user, checking, error, retry } = useAuth();
  const router = useRouter();
  const roleKey = Array.isArray(role) ? role.join(',') : role;
  const allowed = useMemo<readonly Role[]>(
    () => (Array.isArray(role) ? role : [role]),
    // The key is stable for a constant role list and avoids a new array each render.
    [roleKey],
  );
  useEffect(() => {
    if (checking || error) return;
    if (!user)
      router.replace(
        window.location.pathname === '/employee/attendance/nfc'
          ? `/login?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`
          : '/login',
      );
    else if (!allowed.includes(user.role)) router.replace(roleHome(user.role));
  }, [user, allowed, checking, error, router]);
  if (error)
    return (
      <main className="auth-status">
        <p role="alert">{error}</p>
        <Button onClick={retry}>إعادة التحقق من الجلسة</Button>
      </main>
    );
  if (checking || !user || !allowed.includes(user.role))
    return (
      <main className="auth-status" role="status">
        جارٍ التحقق من الجلسة...
      </main>
    );
  return children;
}
