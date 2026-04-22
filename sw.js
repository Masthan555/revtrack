// Minimal service worker — enough to make the site installable as a PWA.
// No offline caching yet (intentional: avoids stale asset issues during active
// development). Push-event handler will be added in a later change for the
// 10 PM IST reminders.

self.addEventListener('install', () => {
  // Activate immediately without waiting for existing tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any already-open pages on first activation.
  event.waitUntil(self.clients.claim());
});
