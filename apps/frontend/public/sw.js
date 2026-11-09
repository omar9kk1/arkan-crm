/*
 * ARKAN CRM — Web Push service worker (minimal).
 *
 * It does ONE job: show a push that the backend sent for an in-app
 * notification, and open the exact authorized record when the user clicks it.
 * The payload carries only the notification's own title/body (already
 * privacy-safe) and the in-app deep link, so no client data is duplicated
 * here and nothing sensitive is stored in the browser.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || 'أركان الخليج العقارية';
  const body = payload.body || '';
  const url = payload.url || '/';
  const notificationId = payload.notificationId || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // The same notification replaces its predecessor instead of stacking.
      tag: notificationId || title,
      renotify: false,
      // The toast must stay until the manager looks at it: without this the
      // notification disappears after a few seconds and is easily missed.
      requireInteraction: true,
      silent: false,
      icon: '/brand/arkan-gulf-logo.png',
      badge: '/brand/arkan-gulf-logo.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/';
  // Only same-origin app paths are ever opened. A notification payload can
  // never turn a click into an open redirect to another origin.
  const target =
    typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')
      ? raw
      : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
