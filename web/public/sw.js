/*
 * Service worker for popup notifications (CLAUDE.md ข้อ 10).
 *
 * Chrome keeps this file and wakes it when the server sends a push, even with
 * no tab of the site open - that is what lets a popup appear in the corner of
 * the screen on its own. It does two things only: show the popup, and open the
 * claim when someone clicks it. No caching, no offline mode.
 *
 * Served from the site root so its scope covers every page, and with
 * Cache-Control: no-cache (nginx "location /"), so a new version is picked up on
 * the next visit rather than a year later.
 */

const FALLBACK_TITLE = 'ระบบเบิกค่าตอบแทนการตีพิมพ์';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || FALLBACK_TITLE, {
      body: data.body || '',
      // Same tag replaces the earlier popup about the same claim.
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  );
});

/** Only ever a page of this site: a link from a payload is not trusted further. */
function sameOriginTarget(raw) {
  try {
    const target = new URL(raw || '/', self.location.origin);
    return target.origin === self.location.origin ? target.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = sameOriginTarget(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      // Reuse a tab that is already open rather than piling up new ones.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        } catch {
          // A tab this worker does not control cannot be navigated; open one.
          break;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
