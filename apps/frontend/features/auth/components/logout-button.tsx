'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { useAuth } from './auth-provider';
export function LogoutButton() {
  const { logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await logout();
        } catch {
          /* Local tokens are cleared even if the API is unreachable. */
        } finally {
          router.replace('/login');
          setBusy(false);
        }
      }}
    >
      {busy ? 'جارٍ الخروج…' : 'تسجيل الخروج'}
    </Button>
  );
}
