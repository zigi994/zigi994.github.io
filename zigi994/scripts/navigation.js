/* ============================================================
   navigation.js — speculative prefetch

   Clicks are never intercepted. The page swap is declared in
   transitions.css and driven by the browser, so a browser with
   no View Transitions support navigates exactly as it always
   did — as does this one with JS switched off. All this file
   does is warm the next document so the click has nothing left
   to wait for.

   Classic script, loaded with defer — the DOM is ready and no
   module graph is involved.
   ============================================================ */

(function () {
  "use strict";

  const HOVER_DELAY = 110; // hover intent: a pass-over never fires
  const VIEW_DELAY = 420; // in-view links are a weaker signal than hover
  const VIEW_STEP = 500; // drip, so a grid of cards is never a burst
  const MAX_TOTAL = 6; // budget for the whole page visit
  const MAX_VIEW = 2; // of which the viewport pass may spend two

  // Only meaningful over HTTP(S); opening the folder from disk
  // would prefetch file:// URLs that no cache can reuse.
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  const conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  // A wasted prefetch on a metered or 2G connection costs the
  // visitor real money and real time.
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""))) return;

  const canPrefetch = (() => {
    const probe = document.createElement("link");
    return !!(probe.relList && probe.relList.supports && probe.relList.supports("prefetch"));
  })();

  /* ------------------------------------------------------------
     Eligibility
   Keyed without the hash, so a case URL and its #process variant
   are one document, and an in-page
     #anchor on the current page resolves to nothing to fetch.
     ------------------------------------------------------------ */
  const key = (url) => url.origin + url.pathname + url.search;
  const here = key(new URL(location.href));

  function destination(a) {
    if (!a || !a.getAttribute("href")) return null;
    if (a.target && a.target !== "_self") return null;
    if (a.hasAttribute("download")) return null;
    if (/\bexternal\b/.test(a.rel || "")) return null;

    let url;
    try {
      url = new URL(a.href, location.href);
    } catch (err) {
      return null;
    }

    // Rejects cross-origin, and also mailto:/tel:/javascript:,
    // whose origin serialises to "null".
    if (url.origin !== location.origin) return null;
    if (key(url) === here) return null;

    return url;
  }

  /* ------------------------------------------------------------
     Prefetch
     One plain same-origin GET per document, so the service
     worker sees an ordinary request it can answer from cache.
     ------------------------------------------------------------ */
  const prefetched = new Set();
  let spent = 0;

  function prefetch(url) {
    const href = key(url);
    if (prefetched.has(href) || spent >= MAX_TOTAL) return false;
    prefetched.add(href);
    spent += 1;

    if (canPrefetch) {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      document.head.appendChild(link);
    } else {
      fetch(href, { credentials: "same-origin", priority: "low" }).catch(() => {});
    }
    return true;
  }

  /* ------------------------------------------------------------
     Pointer and keyboard intent
     A single shared timer means at most one pending prefetch,
     however fast the pointer crosses a list of cards.
     ------------------------------------------------------------ */
  let timer = 0;

  function schedule(a, delay) {
    const url = destination(a);
    if (!url || prefetched.has(key(url))) return;
    clearTimeout(timer);
    timer = setTimeout(() => prefetch(url), delay);
  }

  function cancel() {
    clearTimeout(timer);
  }

  const links = [];

  document.querySelectorAll("a[href]").forEach((a) => {
    if (!destination(a)) return;
    links.push(a);

    a.addEventListener("pointerenter", () => schedule(a, HOVER_DELAY));
    a.addEventListener("pointerleave", cancel);
    a.addEventListener("focus", () => schedule(a, HOVER_DELAY));
    a.addEventListener("blur", cancel);
    // A press is a commitment, and touch has no hover: skip the delay.
    a.addEventListener("pointerdown", (e) => {
      if (e.button < 2) schedule(a, 0);
    });
  });

  /* ------------------------------------------------------------
     Viewport pass
     Warms what the visitor can actually see, one document at a
     time and only once the page has gone idle.
     ------------------------------------------------------------ */
  const queue = [];
  let dripping = false;

  function drip() {
    if (dripping) return;
    while (queue.length) {
      if (prefetch(queue.shift())) {
        dripping = true;
        setTimeout(() => {
          dripping = false;
          drip();
        }, VIEW_STEP);
        return;
      }
    }
  }

  function observeViewport() {
    if (!("IntersectionObserver" in window) || !links.length) return;

    let budget = MAX_VIEW;
    const io = new IntersectionObserver(
      (entries) => {
        // The budget is re-checked per entry: one callback can carry every
        // observed link at once, and disconnecting does not end the batch.
        entries.forEach((entry) => {
          if (budget <= 0 || !entry.isIntersecting) return;
          io.unobserve(entry.target);
          const url = destination(entry.target);
          if (!url || prefetched.has(key(url))) return;
          queue.push(url);
          setTimeout(drip, VIEW_DELAY);
          budget -= 1;
          if (budget <= 0) io.disconnect();
        });
      },
      { rootMargin: "240px 0px" }
    );

    links.forEach((a) => io.observe(a));
  }

  if (window.requestIdleCallback) {
    requestIdleCallback(observeViewport, { timeout: 2000 });
  } else {
    setTimeout(observeViewport, 1200);
  }

  window.__nav = { prefetched, prefetch };
})();
