// Service worker for RevTrack.
// - Makes the site installable as a PWA (install + activate).
// - Handles Web Push notifications (push event).
// - Focuses/opens the app when a notification is tapped (notificationclick).
// No offline caching yet — intentional so no stale-asset issues during deploys.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'RevTrack', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'RevTrack';
  const body = data.body || 'You have revisions due.';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'revtrack-digest', // newer digest replaces older one if both arrive
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        // Focus an existing tab/PWA for this origin.
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })(),
  );
});
