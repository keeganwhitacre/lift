/* sw.js — Lift PWA Service Worker
   Handles:
   1. Offline caching (cache-first for the app shell)
   2. Rest timer notifications via postMessage → setTimeout → showNotification
      This works around the fact that Notification API requires a SW context
      to show persistent notifications on mobile.
*/
// Bump this version (e.g., from v2 to v3) so the browser updates the cache!
const CACHE = 'lift-v7'; 

// Add exercises.json, plus your manifest and icon so it works 100% offline
const SHELL = [
  './',
  './exercises.json',
  './manifest.json',
  './icon-192.png'
];

/* ── Install: cache app shell ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

/* ── Activate: clean old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for same-origin ── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

/* ── Message: schedule a rest-timer notification ──
   The page sends:
     { type: 'SCHEDULE_NOTIFICATION', delayMs: 90000, title: 'Rest Over', body: 'Next set.' }
   We use a setTimeout in the SW — this persists even when the page is backgrounded
   on Android. On iOS, SW lifetime is limited, but we do a best-effort attempt.
   
   We also handle CANCEL_NOTIFICATION to clear a pending timer.
*/
let pendingNotifTimer = null;

self.addEventListener('message', e => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'SCHEDULE_NOTIFICATION') {
    // Cancel any existing pending notification
    if (pendingNotifTimer) { clearTimeout(pendingNotifTimer); pendingNotifTimer = null; }

    pendingNotifTimer = setTimeout(async () => {
      pendingNotifTimer = null;

      // Check if any client is focused — if so, skip the notification
      // (the in-app timer UI is visible)
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const anyFocused = clients.some(c => c.focused);

      // Always fire — the page can dismiss if it wants
      self.registration.showNotification(msg.title || 'Rest complete', {
        body:    msg.body    || 'Start your next set.',
        icon:    './icon-192.png',
        badge:   './icon-192.png',
        tag:     'rest-timer',          // replaces any prior notification with same tag
        renotify: false,
        silent:  false,
        vibrate: [100, 50, 100],
        data:    { url: './' },
        actions: [
          { action: 'dismiss', title: 'Got it' }
        ]
      });
    }, msg.delayMs || 90000);
  }

  if (msg.type === 'CANCEL_NOTIFICATION') {
    if (pendingNotifTimer) { clearTimeout(pendingNotifTimer); pendingNotifTimer = null; }
    // Also close any visible rest-timer notification
    self.registration.getNotifications({ tag: 'rest-timer' }).then(ns => {
      ns.forEach(n => n.close());
    });
  }
});

/* ── Notification click: focus or open the app ── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes('lift') || c.url.endsWith('/'));
      if (existing) return existing.focus();
      return self.clients.openWindow(e.notification.data?.url || './');
    })
  );
});
