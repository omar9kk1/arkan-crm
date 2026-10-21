import { Suspense } from 'react';
import ClientsPage from '../../../features/manager-clients/components/clients-page';
/**
 * `useSearchParams` (the notification deep-link `?client=` / `?owner=` /
 * `?broker=`) suspends during prerendering, so the client tree needs a
 * Suspense boundary — same contract as the properties pages.
 */
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ClientsPage />
    </Suspense>
  );
}
