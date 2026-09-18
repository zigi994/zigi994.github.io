/* ============================================================
   Service worker registration

   Two things this deliberately does not do: register before
   `load` (the worker would compete with first paint for the
   same connection), and reload the page when a new worker
   arrives. A portfolio is read by scrolling, and yanking the
   document out from under a reader mid-scroll to save them one
   stale stylesheet is a bad trade. The update is swapped in
   while the tab is hidden instead, so the next navigation gets
   it for free.
   ============================================================ */

(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  /* file:// and IP-based previews have no worker support and throw a
     SecurityError on register, which would surface as a console error
     on every local double-click of index.html. */
  var host = location.hostname;
  var secure =
    location.protocol === 'https:' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]';
  if (!secure) return;

  /* Captured now, not inside the load handler, where currentScript is
     null. Resolving against the script's own URL keeps one file working
     from both / and /work/. */
  var src = document.currentScript && document.currentScript.src;
  var swUrl = src ? new URL('../sw.js', src).href : '/sw.js';

  var waiting = null;
  var swapped = false;
  var lastCheck = 0;

  function swap() {
    if (!waiting || swapped) return;
    swapped = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    waiting = null;
  }

  function onHidden() {
    if (document.visibilityState === 'hidden') swap();
  }

  function watch(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      /* An existing controller means this is an update rather than the
         very first install, so it has to wait its turn. */
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        waiting = worker;
        window.dispatchEvent(new CustomEvent('sw:update-ready'));
        onHidden();
      }
    });
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register(swUrl, { updateViaCache: 'none' })
      .then(function (reg) {
        /* updateViaCache:'none' matters on Pages specifically: without it
           the browser may serve sw.js from its own 10-minute HTTP cache
           and a deploy stays invisible for that long. */
        if (reg.waiting && navigator.serviceWorker.controller) {
          waiting = reg.waiting;
          onHidden();
        }
        watch(reg.installing);
        reg.addEventListener('updatefound', function () {
          watch(reg.installing);
        });

        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'hidden') {
            swap();
            return;
          }
          /* A tab left open for a day should still pick up a deploy;
             once an hour is enough to do that without being chatty. */
          var now = Date.now();
          if (now - lastCheck < 3600000) return;
          lastCheck = now;
          reg.update().catch(function () {});
        });
      })
      .catch(function (err) {
        console.warn('[sw] registration failed', err);
      });

    window.addEventListener('pagehide', swap);
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    /* No location.reload() here on purpose. The swap only happens on a
       hidden or unloading page, so the next navigation is already served
       by the new worker and the reader never sees a jump. */
  });
})();
