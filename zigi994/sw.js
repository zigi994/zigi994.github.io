/* ============================================================
   Service worker

   GitHub Pages serves every file with a fixed `Cache-Control:
   max-age=600` and gives no way to configure response headers,
   so this worker is the only place where caching policy can
   actually be expressed. Three strategies, chosen per asset
   type rather than applied uniformly:

     html   network-first   — a deploy must be visible on the
                              next load, never one load later
     css/js network-first   — they have to come from the same
                              deploy as the document that asks
                              for them; see mustMatchDocument
     font/icon/json  stale-while-revalidate, keyed to BUILD_ID —
                              instant paint, refreshed in the
                              background, wiped on every deploy
     assets/*.img cache-first, in a cache that survives version
                              bumps — the filenames are stable
                              and the bytes never change

   BUILD_ID is rewritten with the commit SHA by the Pages
   workflow before upload; the literal token below is what runs
   during local preview.
   ============================================================ */

const BUILD_ID = '__BUILD_ID__';

const SHELL_CACHE = 'zigi-shell-' + BUILD_ID;

/* Deliberately unversioned. Image bytes are immutable under these
   names, so re-downloading ~3 MB of webp on every deploy would be
   pure waste. Stale images can only happen if a file is replaced
   in place, which the asset pipeline does not do. */
/* v2 retires the three removed project images from returning visitors as well as
   from the repository; activate() deletes the old zigi-media-v1 cache. */
const MEDIA_CACHE = 'zigi-media-v2';

/* Resolved from the worker's own URL so the same file works at the
   domain root and from a subdirectory preview. */
const SCOPE = new URL('./', self.location).href;
const at = (path) => new URL(path, SCOPE).href;

const OFFLINE_URL = at('offline.html');
const ASSETS_PATH = new URL('assets/', SCOPE).pathname;

/* Without the offline page there is no offline story at all, so this
   is the one precache failure worth rejecting install over. */
const CRITICAL = [OFFLINE_URL];

const PRECACHE = [
  /* The scope root, not index.html: that is the URL the sitemap declares,
     the one a visitor types, and the one every in-site link now points at.
     Caching both would store the homepage twice under two keys and leave
     whichever one the visitor actually arrived on a miss. */
  SCOPE,
  at('work/chashi.html'),
  at('work/linxi.html'),
  at('work/lionup.html'),
  at('work/mountain-stay.html'),
  at('work/quchong.html'),
  at('work/yuexing.html'),

  at('styles/tokens.css'),
  at('styles/base.css'),
  at('styles/components.css'),
  at('styles/home.css'),
  at('styles/case.css'),
  at('styles/concept.css'),
  at('styles/transitions.css'),

  at('scripts/motion.js'),
  at('scripts/home.js'),
  at('scripts/hero-gl.js'),
  at('scripts/case.js'),
  at('scripts/concept.js'),
  at('scripts/navigation.js'),
  at('scripts/sw-register.js'),

  /* Only the faces the stylesheets actually declare. The Inter files in
     the same directory are unreferenced leftovers. Fraunces ships italic
     as a separate family, so the roman file cannot serve it: without the
     italic here, an offline visitor gets a mechanical slant on exactly
     the runs the subset exists to render properly. */
  at('assets/fonts/bricolage-var.woff2'),
  at('assets/fonts/fraunces-var.woff2'),
  at('assets/fonts/fraunces-italic-var.woff2'),

  at('favicon.svg'),
  at('manifest.webmanifest'),
  /* motion.js fetches this for the image pipeline. */
  at('assets/manifest.json'),
];

const isMedia = (url) =>
  url.pathname.startsWith(ASSETS_PATH) &&
  /\.(?:webp|avif|png|jpe?g|gif|svg)$/i.test(url.pathname);

const isShellAsset = (url) =>
  /\.(?:css|m?js|woff2?|json|webmanifest|svg)$/i.test(url.pathname);

/* Stylesheets and scripts have to come from the same deploy as the document
   that references them; everything else in the shell does not.

   This is not hypothetical. Documents are network-first and the shell was
   uniformly stale-while-revalidate, so the first load after a deploy handed
   a returning visitor the new HTML with the previous build's CSS — the old
   worker is still in control for that one navigation and answers from its
   own cache before revalidating. Usually that just means a stale colour.
   The build that added the hero canvas made it fatal: with no rule to take
   it out of flow, a 1900px canvas laid out inline and pushed the entire
   hero off screen. First-time visitors were fine, which is exactly why it
   survived a local check.

   Fonts, icons and the LQIP manifest are keyed by stable filenames and
   render identically across builds, so they keep the instant-paint path. */
const mustMatchDocument = (url) => /\.(?:css|m?js)$/i.test(url.pathname);

const isDocument = (request, url) =>
  request.mode === 'navigate' ||
  request.destination === 'document' ||
  url.pathname.endsWith('/') ||
  /\.html?$/i.test(url.pathname);

const isCacheable = (response) =>
  !!response && response.status === 200 && response.type === 'basic';

/* ---------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      await cache.addAll(CRITICAL);

      /* addAll() is all-or-nothing: one 404 and the whole shell is
         lost, which would leave a permanently broken install every
         time a filename drifts. Adding entries individually keeps a
         missing file from costing us the other twenty-five. */
      const results = await Promise.allSettled(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );

      const missed = results
        .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
        .filter(Boolean);

      if (missed.length) {
        console.warn('[sw] precache skipped', missed.length, 'of', PRECACHE.length, missed);
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) {
        /* Lets the navigation request start in parallel with worker
           boot, so network-first HTML does not pay the startup cost. */
        try {
          await self.registration.navigationPreload.enable();
        } catch (err) {
          /* Not supported everywhere; the fetch path handles its absence. */
        }
      }

      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key === SHELL_CACHE || key === MEDIA_CACHE) return null;
          /* Scoped to our own prefix so a cache belonging to anything
             else on the origin is left alone. */
          if (!key.startsWith('zigi-')) return null;
          return caches.delete(key);
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  /* The page asks for this once it is safe to swap workers — see
     scripts/sw-register.js. The worker never forces it on its own. */
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------------------------------------------------------- */

async function networkFirst(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);

  try {
    let response = null;
    if (event.preloadResponse) response = await event.preloadResponse;
    if (!response) response = await fetch(request);

    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    /* The homepage is cached under the directory URL, so an old bookmark or
       an external link pointing at index.html is a different key. */
    if (new URL(request.url).pathname.endsWith('/index.html')) {
      const root = await caches.match(new URL('./', request.url).href);
      if (root) return root;
    }

    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('离线 / offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/* Same ordering as networkFirst but without the offline.html endgame: handing
   an HTML body back for a stylesheet request would be its own failure. The
   network attempt normally lands in the HTTP cache rather than on the wire,
   so the cost against stale-while-revalidate is a cache lookup, not a
   round trip. */
async function networkFirstAsset(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const revalidate = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    /* Keep the worker alive for the background refresh even though
       the response has already been handed to the page. */
    event.waitUntil(revalidate);
    return cached;
  }

  const response = await revalidate;
  if (response) return response;

  return new Response('', { status: 504, statusText: 'offline' });
}

async function cacheFirst(event) {
  const request = event.request;
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  /* Range requests are for media seeking; the Cache API cannot
     satisfy a 206 so the browser handles these directly. */
  if (request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* The browser fetches the worker script itself outside this handler, but
     anything else that requests it — a QA probe, a devtools reload — would
     otherwise pin an old copy of sw.js into the shell cache and make the
     next update invisible. */
  if (url.href === self.location.href) return;

  if (isDocument(request, url)) {
    event.respondWith(networkFirst(event));
    return;
  }

  if (isMedia(url)) {
    event.respondWith(cacheFirst(event));
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      mustMatchDocument(url) ? networkFirstAsset(event) : staleWhileRevalidate(event)
    );
  }
});
