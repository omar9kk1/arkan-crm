'use client';

import { Role } from '@arkan/shared';
import { RequireRole } from '../../../features/auth/components/require-role';
import { FinancePage } from '../../../features/manager-finance/components/finance-page';

export default function Page() {
  return (
    <RequireRole role={Role.OWNER}>
      <FinancePage />
    </RequireRole>
  );
}
