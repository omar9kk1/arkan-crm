'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@arkan/shared';
import { useAuth } from './auth-provider';
import { roleHome } from '../api/auth-api';
import { Button } from '../../../components/ui/button';

export function RequireRole({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const { user, checking, error, retry } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (checking || error) return;
    if (!user)
      router.replace(
        window.location.pathname === '/employee/attendance/nfc'
          ? `/login?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`
          : '/login',
      );
    else if (user.role !== role) router.replace(roleHome(user.role));
  }, [user, role, checking, error, router]);
  if (error)
    return (
      <main className="auth-status">
        <p role="alert">{error}</p>
        <Button onClick={retry}>إعادة المحاولة</Button>
      </main>
    );
  if (checking || !user || user.role !== role)
    return (
      <main className="auth-status" role="status">
        جارٍ التحقق من الجلسة…
      </main>
    );
  return children;
}
