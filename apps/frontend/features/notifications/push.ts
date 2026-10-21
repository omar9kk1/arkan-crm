'use client';

import { authorizedRequest } from '../../lib/api/authorized';

/**
 * The browser side of Web Push, for the manager's "إشعارات خارج البرنامج"
 * switch. Everything here is device-scoped: the switch turns the push ON or
 * OFF for THIS browser only, and every other device keeps its own state.
 *
 * The server never learns the device identity from the browser: it binds the
 * subscription to the authenticated account and to the session lineage the
 * backend resolved from the live session.
 */

export interface PushConfig {
  configured: boolean;
  publicKey: string | null;
  subject: string | null;
}

export interface PushStatus {
  /** Whether this browser can receive push at all. */
  supported: boolean;
  /** Whether push is currently ON for this browser. */
  enabled: boolean;
  permission: NotificationPermission | 'unsupported';
}

export const PUSH_SERVICE_WORKER_PATH = '/sw.js';

/** Whether this browser exposes the Push API at all. */
export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The VAPID public key and the server's readiness. */
export async function getPushConfig(): Promise<PushConfig> {
  return authorizedRequest<PushConfig>('/push/config');
}

/** The VAPID public key (a base64url string) as the bytes the API expects. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

/** Registers the service worker (idempotent) and returns its registration. */
export async function registerPushWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(
    PUSH_SERVICE_WORKER_PATH,
    { scope: '/' },
  );
  await navigator.serviceWorker.ready;
  return registration;
}

/** The current state of the push switch for THIS browser. */
export async function currentPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) {
    return { supported: false, enabled: false, permission: 'unsupported' };
  }
  const permission = Notification.permission;
  if (permission !== 'granted') {
    return { supported: true, enabled: false, permission };
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    if (!subscription) return { supported: true, enabled: false, permission };
    // The server is the source of truth for "is this device subscribed".
    const status = await authorizedRequest<{ subscribed: boolean }>(
      '/push/subscriptions',
    );
    return { supported: true, enabled: status.subscribed, permission };
  } catch {
    return { supported: true, enabled: false, permission };
  }
}

/**
 * Turns the push ON for this browser.
 *
 * The permission request happens FIRST and synchronously inside the click
 * handler that called this function — browsers only accept a permission
 * request made in direct response to a user gesture, so it must not be
 * preceded by an await.
 */
export async function enablePush(): Promise<
  { enabled: boolean; error?: string }
> {
  if (!pushSupported()) {
    return {
      enabled: false,
      error: 'هذا المتصفح لا يدعم الإشعارات الخارجية.',
    };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      enabled: false,
      error: 'لم يُمنح إذن الإشعارات في هذا المتصفح.',
    };
  }
  try {
    const config = await getPushConfig();
    if (!config.configured || !config.publicKey) {
      return {
        enabled: false,
        error: 'الإشعارات الخارجية غير مُهيأة على الخادم.',
      };
    }
    const registration = await registerPushWorker();
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      }));
    const keys = subscription.toJSON().keys ?? {};
    await authorizedRequest('/push/subscriptions', {
      method: 'PUT',
      body: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: keys.p256dh ?? '',
          auth: keys.auth ?? '',
        },
        userAgent: navigator.userAgent.slice(0, 400),
      },
    });
    return { enabled: true };
  } catch (cause) {
    return {
      enabled: false,
      error:
        cause instanceof Error
          ? cause.message
          : 'تعذر تفعيل الإشعارات الخارجية.',
    };
  }
}

/**
 * Re-binds the browser's existing opt-in to the CURRENT session.
 *
 * The PushManager subscription belongs to the BROWSER, while the server binds
 * it to the session lineage. The session is stored in `sessionStorage`, so it
 * is re-created on every browser/tab restart — a new login means a new
 * lineage, and the old binding would silently stop the pushes even though the
 * manager never turned them off.
 *
 * The re-bind is authenticated: the server re-attaches the SAME endpoint to
 * the CURRENT session lineage. It happens only when the browser still holds
 * the manager's explicit opt-in, and an explicit logout removes that opt-in
 * entirely (so a signed-out device never re-binds itself).
 */
export async function ensurePushBinding(): Promise<{
  bound: boolean;
  reason?: string;
}> {
  if (!pushSupported()) return { bound: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted')
    return { bound: false, reason: 'no-permission' };
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;
    if (!subscription) return { bound: false, reason: 'no-subscription' };
    const status = await authorizedRequest<{ subscribed: boolean }>(
      '/push/subscriptions',
    );
    if (status.subscribed) return { bound: true };
    const keys = subscription.toJSON().keys ?? {};
    await authorizedRequest('/push/subscriptions', {
      method: 'PUT',
      body: {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: keys.p256dh ?? '',
          auth: keys.auth ?? '',
        },
        userAgent: navigator.userAgent.slice(0, 400),
      },
    });
    return { bound: true };
  } catch {
    // A rejected re-bind (e.g. the account is not a manager) simply leaves the
    // device without outside-app notifications.
    return { bound: false, reason: 'error' };
  }
}

/**
 * Asks the server for one test message on this manager's own devices. It
 * creates no business record and no in-app notification row.
 */
export async function fetchPushTest(): Promise<{ sent: number; devices: number }> {
  return authorizedRequest<{ sent: number; devices: number }>('/push/test', {
    method: 'POST',
  });
}

/**
 * Turns the push OFF for this browser: the server drops the subscription and
 * the browser unsubscribes. Other devices are untouched.
 */
export async function disablePush(): Promise<{ enabled: boolean }> {
  try {
    if (pushSupported()) {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      if (subscription) {
        // Best effort: the server-side session revocation is the real
        // guarantee, this only removes the row immediately.
        await authorizedRequest('/push/subscriptions', {
          method: 'DELETE',
          body: { endpoint: subscription.endpoint },
        }).catch(() => undefined);
        await subscription.unsubscribe().catch(() => undefined);
      }
    }
  } catch {
    /* The browser may block storage; the server-side revocation still applies. */
  }
  return { enabled: false };
}
