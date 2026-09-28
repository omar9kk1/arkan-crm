import type { ReactNode } from 'react';
import { EmployeeLayout } from '../../components/layout/employee-layout';
import { RequireRole } from '../../features/auth/components/require-role';
import { Role } from '@arkan/shared';
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={Role.EMPLOYEE}>
      <EmployeeLayout>{children}</EmployeeLayout>
    </RequireRole>
  );
}
