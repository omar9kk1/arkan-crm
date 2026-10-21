'use client';

import { useEffect } from 'react';
import { useAuth } from '../auth/components/auth-provider';
import { PUSH_SERVICE_WORKER_PATH, ensurePushBinding } from './push';

/**
 * Registers the Web Push service worker once per browser and keeps the
 * browser's opt-in attached to the CURRENT session.
 *
 * The registration is silent and idempotent: it never asks for a permission
 * and never changes the UI, so the in-app experience and the Astra design are
 * untouched. The permission is only ever requested when the manager flips the
 * "إشعارات خارج البرنامج" switch in the settings.
 */
export function PushServiceWorkerRegistration() {
  const { user } = useAuth();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const register = () => {
      void navigator.serviceWorker
        .register(PUSH_SERVICE_WORKER_PATH, { scope: '/' })
        .catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  // A signed-in session re-attaches the browser's existing opt-in to the new
  // session lineage (every browser/tab restart creates a new login).
  useEffect(() => {
    if (!user) return;
    void ensurePushBinding();
  }, [user]);

  return null;
}
