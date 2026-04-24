// Friendgroup dev service worker (classic, no module imports)
// This file lives in public/ so Vite always serves it as text/javascript
// regardless of vite-plugin-pwa build state or Host header.

var SW_VERSION = 'friendgroup-dev-sw-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function () {
  // Dev SW does not cache — all requests fall through to network.
});

self.addEventListener('push', function (event) {
  var raw = '{}';
  if (event.data) {
    raw = event.data.text();
  }

  var payload = {};
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    payload = {};
  }

  var title =
    typeof payload.title === 'string'
      ? payload.title
      : 'Friendgroup notification';

  var body =
    typeof payload.body === 'string'
      ? payload.body
      : 'You have a new update in Friendgroup.';

  var eventId =
    typeof payload.eventId === 'string' ? payload.eventId : null;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: eventId ? '/events/' + eventId : '/' },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl =
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clients) {
        for (var i = 0; i < clients.length; i++) {
          var c = clients[i];
          if ('focus' in c) {
            try {
              if (new URL(c.url).pathname === targetUrl) {
                return c.focus();
              }
            } catch (e) {}
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
