/* Titan Inventory service worker.
 *
 * What this is for: the yard has patchy signal and the buildings have none. The app
 * should open in a conex and still answer "what do we have and where is it".
 *
 * Most of that already works without the network — counts come from the last sync
 * kept in localStorage, and the zone tree is part of the page. What the network is
 * genuinely needed for is writing: pulls, returns, edits and photo uploads all go to
 * Apps Script and correctly fail when it can't be reached.
 *
 * Three rules, chosen per-resource:
 *
 *   app shell   network-first  — a deploy lands immediately when online, and the
 *                                last good copy opens when there's no signal.
 *   photos      cache-first    — zone and building photos never change once shipped
 *                                (a new drone flight ships new filenames), so
 *                                revalidating them is wasted bytes on cell data.
 *   Apps Script never cached   — a cached getAll would show yesterday's counts as
 *                                if they were live, which is the one failure this
 *                                app must not have. An honest error beats a
 *                                confident wrong number.
 *
 * Bump CACHE_VERSION on deploy; old caches are dropped on activate.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `ti-shell-${CACHE_VERSION}`;
const PHOTO_CACHE = `ti-photos-${CACHE_VERSION}`;

// The repo ships about 40 photos; the cap is headroom for a couple of imagery
// refreshes before the oldest start dropping out.
const MAX_PHOTOS = 120;

const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll is all-or-nothing; one 404 would leave the app with no offline
      // copy at all, so each entry is allowed to fail on its own.
      .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, PHOTO_CACHE];
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n.startsWith('ti-') && !keep.includes(n))
        .map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Oldest-first eviction. Cache API keys come back in insertion order, so the
// front of the list is the least recently added.
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

async function cacheFirst(request, cacheName, cap) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Same-origin photos always report a real status; anything opaque here would be
  // a misconfiguration and shouldn't be stored as though it were good.
  if (res && res.status === 200 && res.type !== 'opaque') {
    await cache.put(request, res.clone());
    if (cap) trimCache(cacheName, cap);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request) || await cache.match('./index.html');
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Never touch the backend. Reads must be live or visibly fail; writes are POSTs
  // and are excluded above anyway.
  if (url.hostname === 'script.google.com') return;

  // Item photos live on Drive. Left uncached for now: those responses are opaque,
  // and opaque entries are padded heavily against the origin's storage quota, which
  // would be a poor trade while the item-photo count is still climbing from zero.
  if (url.hostname === 'drive.google.com') return;

  if (url.origin === self.location.origin) {
    if (/\/(zones|aerial)\/|\.(png|jpg|jpeg|webp)$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(req, PHOTO_CACHE, MAX_PHOTOS).catch(() => Response.error()));
      return;
    }
    event.respondWith(networkFirst(req));
  }
});
