import { Suspense } from 'react';
import { ManagerFollowups } from '../../../features/manager-followups/components/manager-followups-page';
/**
 * `useSearchParams` (notification deep link `?follow-up=`) suspends during
 * prerendering, so the client tree needs a Suspense boundary — the same
 * boundary the manager properties page applies.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ManagerFollowups />
    </Suspense>
  );
}
