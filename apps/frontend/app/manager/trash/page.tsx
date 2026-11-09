'use client';

import { Role } from '@arkan/shared';
import { RequireRole } from '../../../features/auth/components/require-role';
import { ManagerTrash } from '../../../features/manager-properties/components/manager-trash';

export default function Page() {
  return (
    <RequireRole role={Role.OWNER}>
      <ManagerTrash />
    </RequireRole>
  );
}
