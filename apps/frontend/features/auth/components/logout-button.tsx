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
    } catch {
      /* Local tokens are cleared even if the API is unreachable. */
    } finally {
      router.replace('/login');
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
