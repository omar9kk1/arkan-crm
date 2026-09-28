import type { ReactNode } from 'react';
import { ManagerLayout } from '../../components/layout/manager-layout';
import { RequireRole } from '../../features/auth/components/require-role';
import { Role } from '@arkan/shared';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={Role.MANAGER}>
      <ManagerLayout>{children}</ManagerLayout>
    </RequireRole>
  );
}
