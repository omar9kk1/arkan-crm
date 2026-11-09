'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { Icon } from '../../../components/ui/icon';
import { useAuth } from './auth-provider';

export function LogoutButton({
  iconOnly = false,
  className = '',
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const { logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const handler = async () => {
    setBusy(true);
    try {
      await logout();
      router.replace('/login');
    } catch {
      // In cookie mode the HttpOnly session remains if the server cannot
      // confirm logout. Stay on the page so the user can retry instead of
      // bouncing between /login and the authenticated shell.
    } finally {
      setBusy(false);
    }
  };
  if (iconOnly) {
    return (
      <Button
        disabled={busy}
        className={className}
        aria-label="تسجيل الخروج"
        title="تسجيل الخروج"
        onClick={handler}
      >
        <Icon name="logOut" width={18} height={18} />
      </Button>
    );
  }
  return (
    <Button disabled={busy} onClick={handler}>
      {busy ? 'جاري الخروج؟' : 'تسجيل الخروج'}
    </Button>
  );
}
