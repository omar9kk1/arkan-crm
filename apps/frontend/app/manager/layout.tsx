import type { ReactNode } from 'react';
import { ManagerLayout } from '../../components/layout/manager-layout';
import { RequireRole } from '../../features/auth/components/require-role';
import { Role } from '@arkan/shared';

const MANAGEMENT_ROLES = [Role.OWNER, Role.MANAGER] as const;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={MANAGEMENT_ROLES}>
      <ManagerLayout>{children}</ManagerLayout>
    </RequireRole>
  );
}
