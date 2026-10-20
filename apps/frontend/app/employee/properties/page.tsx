import { Suspense } from 'react';
import { EmployeePropertiesPage } from '../../../features/employee-properties/components/employee-properties-page';
/**
 * `useSearchParams` (deep-link `?property=`) suspends during prerendering, so
 * the client tree needs a Suspense boundary — no redesign, just the boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <EmployeePropertiesPage />
    </Suspense>
  );
}
