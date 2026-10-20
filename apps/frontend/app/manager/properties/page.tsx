import { Suspense } from 'react';
import { ManagerProperties } from '../../../features/manager-properties/components/manager-properties';
/**
 * `useSearchParams` (deep-link `?property=`) suspends during prerendering, so
 * the client tree needs a Suspense boundary — no redesign, just the boundary.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ManagerProperties />
    </Suspense>
  );
}
