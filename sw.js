self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

self.addEventListener('push', e => {
  if (!e.data) return;
  let data = {};
  try { data = e.data.json(); } catch { data = { title: '📚 RepasoPro', body: e.data.text() }; }

  const options = {
    body: data.body || 'Nuevo examen publicado',
    icon: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4da.png',
    badge: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4da.png',
    vibrate: [200, 100, 200],
    tag: 'repasopro-' + Date.now(),
    requireInteraction: false,
    data: { url: self.registration.scope }
  };

  e.waitUntil(
    self.registration.showNotification(data.title || '📚 RepasoPro', options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(self.registration.scope);
    })
  );
});
