/* ============================================================
   motion.js — shared interaction layer
   Zero dependencies. Every module is opt-in via data-attributes
   and degrades to static content if JS or motion is unavailable.
   ============================================================ */

// Set before anything else so the reveal styles can take effect without
// a flash of already-visible content.
document.documentElement.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------
   Central rAF ticker — one loop for every subscriber, so we
   never stack competing animation frames.
   ------------------------------------------------------------ */
const ticker = (() => {
  const subs = new Set();
  let running = false;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(now - last, 50);
    last = now;
    subs.forEach((fn) => fn(dt, now));
    if (subs.size) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  return {
    add(fn) {
      subs.add(fn);
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
      }
    },
    remove(fn) {
      subs.delete(fn);
    },
  };
})();

/* ------------------------------------------------------------
   Smooth scroll
   Lerps the real scroll position rather than transforming a
   wrapper, so position:sticky and fixed keep working.
   ------------------------------------------------------------ */
function initSmoothScroll() {
  if (reduceMotion.matches || !finePointer.matches) return null;

  const html = document.documentElement;
  html.classList.add("has-smooth-scroll");

  let target = window.scrollY;
  let current = target;
  let active = false;

  const maxScroll = () => html.scrollHeight - window.innerHeight;

  function tick() {
    current = lerp(current, target, 0.1);
    if (Math.abs(target - current) < 0.12) {
      current = target;
      active = false;
      ticker.remove(tick);
    }
    window.scrollTo(0, current);
  }

  function start() {
    if (!active) {
      active = true;
      ticker.add(tick);
    }
  }

  function scrollBy(delta) {
    target = clamp(target + delta, 0, maxScroll());
    start();
  }

  function scrollTo(y, instant = false) {
    target = clamp(y, 0, maxScroll());
    if (instant) {
      current = target;
      window.scrollTo(0, current);
      return;
    }
    start();
  }

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return;
      if (e.target.closest("[data-native-scroll]")) return;
      e.preventDefault();
      if (!active) current = window.scrollY;
      scrollBy(e.deltaY);
    },
    { passive: false }
  );

  // Keep the virtual position honest when something else scrolls us.
  window.addEventListener("scroll", () => {
    if (!active) {
      target = window.scrollY;
      current = target;
    }
  }, { passive: true });

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const page = window.innerHeight * 0.86;
    const map = {
      PageDown: page,
      PageUp: -page,
      ArrowDown: 90,
      ArrowUp: -90,
      Home: -1e7,
      End: 1e7,
      " ": e.shiftKey ? -page : page,
    };
    if (e.key in map) {
      e.preventDefault();
      if (!active) current = window.scrollY;
      scrollBy(map[e.key]);
    }
  });

  window.addEventListener("resize", () => {
    target = clamp(target, 0, maxScroll());
  });

  return { scrollTo, scrollBy };
}

/* ------------------------------------------------------------
   Anchor links routed through the smooth scroller
   ------------------------------------------------------------ */
function initAnchors(scroller) {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute("href");
    if (!id || id === "#") return;
    const el = document.querySelector(id);
    if (!el) return;

    e.preventDefault();
    const y = el.getBoundingClientRect().top + window.scrollY - 8;
    if (scroller) {
      scroller.scrollTo(y);
    } else {
      window.scrollTo({ top: y, behavior: reduceMotion.matches ? "auto" : "smooth" });
    }
    history.replaceState(null, "", id);
  });
}

/* ------------------------------------------------------------
   Reveal on enter
   ------------------------------------------------------------ */
function initReveal() {
  const items = document.querySelectorAll("[data-reveal], .reveal-lines, .media-reveal");
  if (!items.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
  );

  items.forEach((el) => io.observe(el));

  // Stagger siblings inside a shared group without hand-authored delays.
  document.querySelectorAll("[data-stagger]").forEach((group) => {
    const step = Number(group.dataset.stagger) || 90;
    [...group.children].forEach((child, i) => {
      child.style.setProperty("--reveal-delay", `${i * step}ms`);
    });
  });
}

/* ------------------------------------------------------------
   Headline splitting
   Tokenises so CJK breaks per glyph and Latin per word, then
   groups tokens into visual lines for the masked reveal.
   ------------------------------------------------------------ */
const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/;

function tokenise(text) {
  const out = [];
  let latin = "";
  for (const ch of text) {
    if (CJK.test(ch)) {
      if (latin) { out.push(latin); latin = ""; }
      out.push(ch);
    } else if (ch === " ") {
      if (latin) { out.push(latin); latin = ""; }
      out.push(" ");
    } else {
      latin += ch;
    }
  }
  if (latin) out.push(latin);
  return out;
}

function splitLines(el) {
  if (!el.dataset.splitSource) el.dataset.splitSource = el.textContent.trim();
  const source = el.dataset.splitSource;

  el.textContent = "";
  const probes = [];
  tokenise(source).forEach((tok) => {
    if (tok === " ") {
      el.appendChild(document.createTextNode(" "));
      return;
    }
    const s = document.createElement("span");
    s.className = "tok";
    s.style.display = "inline-block";
    s.textContent = tok;
    el.appendChild(s);
    probes.push(s);
  });

  // Group by vertical offset.
  const lines = [];
  let currentTop = null;
  probes.forEach((s) => {
    const top = Math.round(s.offsetTop);
    if (currentTop === null || Math.abs(top - currentTop) > 4) {
      currentTop = top;
      lines.push([]);
    }
    lines[lines.length - 1].push(s.textContent);
  });

  el.textContent = "";
  lines.forEach((tokens, i) => {
    const line = document.createElement("span");
    line.className = "line";
    const inner = document.createElement("span");
    inner.style.setProperty("--i", i);
    inner.textContent = tokens.join("");
    line.appendChild(inner);
    el.appendChild(line);
  });

  el.classList.add("is-split");
}

function initSplitText() {
  const targets = document.querySelectorAll(".reveal-lines");
  if (!targets.length) return;

  // Split now so the observer in initReveal can animate headlines that are
  // already on screen, then re-split once webfont metrics are final.
  const resplit = () => {
    targets.forEach((el) => {
      const wasIn = el.classList.contains("is-in");
      splitLines(el);
      if (wasIn) el.classList.add("is-in");
    });
  };

  targets.forEach(splitLines);
  if (document.fonts?.ready) document.fonts.ready.then(resplit);

  let w = window.innerWidth;
  let t;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - w) < 40) return;
    w = window.innerWidth;
    clearTimeout(t);
    t = setTimeout(resplit, 220);
  });
}

/* ------------------------------------------------------------
   Custom cursor
   ------------------------------------------------------------ */
function initCursor() {
  if (!finePointer.matches || reduceMotion.matches) return;

  const root = document.createElement("div");
  root.className = "cursor";
  root.innerHTML = `
    <div class="cursor__dot"></div>
    <div class="cursor__ring"><span class="cursor__text"></span></div>
  `;
  document.body.appendChild(root);
  document.body.classList.add("has-cursor");

  const dot = root.querySelector(".cursor__dot");
  const ring = root.querySelector(".cursor__ring");
  const text = root.querySelector(".cursor__text");

  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let dx = mx, dy = my;
  let rx = mx, ry = my;
  let visible = false;

  window.addEventListener("mousemove", (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!visible) {
      visible = true;
      dx = rx = mx;
      dy = ry = my;
      root.style.opacity = "1";
    }
  }, { passive: true });

  document.addEventListener("mouseleave", () => { root.style.opacity = "0"; });
  document.addEventListener("mouseenter", () => { root.style.opacity = "1"; });
  window.addEventListener("mousedown", () => root.classList.add("is-down"));
  window.addEventListener("mouseup", () => root.classList.remove("is-down"));

  root.style.opacity = "0";
  root.style.transition = "opacity 220ms linear";

  ticker.add(() => {
    dx = lerp(dx, mx, 0.62);
    dy = lerp(dy, my, 0.62);
    rx = lerp(rx, mx, 0.16);
    ry = lerp(ry, my, 0.16);
    dot.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
  });

  const HOVER = 'a, button, [data-cursor], input, textarea, select, summary, [role="button"]';

  document.addEventListener("mouseover", (e) => {
    const hit = e.target.closest(HOVER);
    if (!hit) return;
    const label = hit.dataset.cursor;
    if (label) {
      text.textContent = label;
      root.classList.add("is-labelled");
    } else {
      root.classList.add("is-hovering");
    }
  });

  document.addEventListener("mouseout", (e) => {
    if (!e.target.closest(HOVER)) return;
    root.classList.remove("is-hovering", "is-labelled");
  });
}

/* ------------------------------------------------------------
   Magnetic elements — subtle pull toward the pointer
   ------------------------------------------------------------ */
function initMagnetic() {
  if (!finePointer.matches || reduceMotion.matches) return;

  document.querySelectorAll("[data-magnetic]").forEach((el) => {
    const strength = Number(el.dataset.magnetic) || 0.28;
    let tx = 0, ty = 0, cx = 0, cy = 0, running = false;

    const tick = () => {
      cx = lerp(cx, tx, 0.15);
      cy = lerp(cy, ty, 0.15);
      el.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      if (Math.abs(cx - tx) < 0.05 && Math.abs(cy - ty) < 0.05 && tx === 0 && ty === 0) {
        el.style.transform = "";
        ticker.remove(tick);
        running = false;
      }
    };

    const wake = () => {
      if (!running) { running = true; ticker.add(tick); }
    };

    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - (r.left + r.width / 2)) * strength;
      ty = (e.clientY - (r.top + r.height / 2)) * strength;
      wake();
    });

    el.addEventListener("mouseleave", () => {
      tx = 0; ty = 0;
      wake();
    });
  });
}

/* ------------------------------------------------------------
   3D tilt
   ------------------------------------------------------------ */
function initTilt() {
  if (!finePointer.matches || reduceMotion.matches) return;

  document.querySelectorAll("[data-tilt]").forEach((el) => {
    const max = Number(el.dataset.tilt) || 7;
    el.style.transformStyle = "preserve-3d";
    el.style.transition = "transform 620ms var(--ease-out-expo)";

    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transition = "transform 120ms linear";
      el.style.transform =
        `perspective(1100px) rotateY(${px * max}deg) rotateX(${-py * max}deg)`;
    });

    el.addEventListener("mouseleave", () => {
      el.style.transition = "transform 780ms var(--ease-out-expo)";
      el.style.transform = "";
    });
  });
}

/* ------------------------------------------------------------
   Parallax — data-parallax is a multiplier of viewport travel
   ------------------------------------------------------------ */
function initParallax() {
  if (reduceMotion.matches) return;
  const items = [...document.querySelectorAll("[data-parallax]")];
  if (!items.length) return;

  const state = items.map((el) => ({
    el,
    amount: Number(el.dataset.parallax) || 0.12,
    visible: false,
  }));

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const s = state.find((x) => x.el === entry.target);
        if (s) s.visible = entry.isIntersecting;
      });
    },
    { rootMargin: "18% 0px" }
  );
  items.forEach((el) => io.observe(el));

  ticker.add(() => {
    const vh = window.innerHeight;
    state.forEach((s) => {
      if (!s.visible) return;
      const r = s.el.getBoundingClientRect();
      // -1 below the fold → 1 above it
      const progress = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      s.el.style.setProperty("--py", `${(progress * s.amount * vh * -0.5).toFixed(2)}px`);
    });
  });
}

/* ------------------------------------------------------------
   Progressive images — swap in the LQIP, fade on decode
   ------------------------------------------------------------ */
async function initImages() {
  let manifest = null;
  const base = document.body.dataset.base || "";
  try {
    const res = await fetch(`${base}assets/manifest.json`, { cache: "force-cache" });
    if (res.ok) manifest = await res.json();
  } catch {
    /* placeholders are a nicety, never a requirement */
  }

  document.querySelectorAll(".frame img").forEach((img) => {
    const key = img.dataset.lqip;
    if (manifest?.lqip && key && manifest.lqip[key]) {
      const frame = img.closest(".frame");
      if (frame) {
        frame.style.backgroundImage = `url("${manifest.lqip[key]}")`;
        if (frame.classList.contains("frame--pad")) frame.style.backgroundSize = "contain";
      }
    }
    if (img.complete && img.naturalWidth) {
      img.classList.add("is-loaded");
    } else {
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
      img.addEventListener("error", () => img.classList.add("is-loaded"), { once: true });
    }
  });
}

/* ------------------------------------------------------------
   Nav — condense on scroll, retract when moving down
   ------------------------------------------------------------ */
function initNav() {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  let last = window.scrollY;
  let ticking = false;

  const update = () => {
    const y = window.scrollY;
    nav.classList.toggle("is-stuck", y > 24);
    const menuOpen = document.body.classList.contains("is-locked");
    nav.classList.toggle("is-hidden", y > 420 && y > last + 4 && !menuOpen);
    last = y;
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });

  update();
}

/* ------------------------------------------------------------
   Accent theming
   data-accent      → scopes --accent to that element's subtree
   data-accent-zone → additionally drives the page-level accent
                      (nav, cursor, progress) while it owns the view
   ------------------------------------------------------------ */
function initAccent() {
  document.querySelectorAll("[data-accent]").forEach((el) => {
    el.style.setProperty("--accent", el.dataset.accent);
    if (el.dataset.accentInk) el.style.setProperty("--accent-ink", el.dataset.accentInk);
  });

  const zones = [...document.querySelectorAll("[data-accent-zone]")];
  if (!zones.length) return;

  const root = document.documentElement;
  const fallback = getComputedStyle(root).getPropertyValue("--accent").trim();
  let currentZone = null;
  let ticking = false;

  const update = () => {
    const mid = window.innerHeight * 0.42;
    let found = null;
    zones.forEach((z) => {
      const r = z.getBoundingClientRect();
      if (mid >= r.top && mid <= r.bottom) found = z;
    });
    if (found !== currentZone) {
      currentZone = found;
      root.style.setProperty("--accent", found ? found.dataset.accentZone : fallback);
      root.style.setProperty("--accent-ink", found?.dataset.accentInk || "#07080a");
    }
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });

  window.addEventListener("resize", update);
  update();
}

/* ------------------------------------------------------------
   Counters
   ------------------------------------------------------------ */
function initCounters() {
  const els = document.querySelectorAll("[data-counter]");
  if (!els.length) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);

      const to = Number(el.dataset.counter);
      const decimals = Number(el.dataset.decimals || 0);
      if (reduceMotion.matches) {
        el.textContent = to.toFixed(decimals);
        return;
      }

      const dur = Number(el.dataset.duration || 1500);
      const start = performance.now();
      const step = (now) => {
        const t = clamp((now - start) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - t, 4);
        el.textContent = (to * eased).toFixed(decimals);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.4 });

  els.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------
   Scroll progress bar
   ------------------------------------------------------------ */
function initProgress() {
  const bar = document.querySelector("[data-progress]");
  if (!bar) return;

  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.setProperty("--p", max > 0 ? clamp(window.scrollY / max, 0, 1) : 0);
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

/* ------------------------------------------------------------
   Local clock in the nav
   ------------------------------------------------------------ */
function initClock() {
  const el = document.querySelector("[data-clock]");
  if (!el) return;

  const tick = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    el.textContent = `Guangzhou ${parts}`;
  };

  tick();
  setInterval(tick, 15000);
}

/* ------------------------------------------------------------
   Drag-scroll rails with inertia
   ------------------------------------------------------------ */
function initDragRail() {
  document.querySelectorAll("[data-rail]").forEach((rail) => {
    let down = false, startX = 0, startLeft = 0, moved = false;

    rail.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = rail.scrollLeft;
      rail.setPointerCapture(e.pointerId);
      rail.classList.add("is-dragging");
    });

    rail.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      rail.scrollLeft = startLeft - dx;
    });

    const release = () => {
      down = false;
      rail.classList.remove("is-dragging");
    };
    rail.addEventListener("pointerup", release);
    rail.addEventListener("pointercancel", release);

    // Suppress the click that ends a drag.
    rail.addEventListener("click", (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
function boot() {
  const scroller = initSmoothScroll();
  initAnchors(scroller);
  initNav();
  initSplitText();
  initReveal();
  initImages();
  initCursor();
  initMagnetic();
  initTilt();
  initParallax();
  initAccent();
  initCounters();
  initProgress();
  initClock();
  initDragRail();

  document.documentElement.classList.add("is-ready");
  window.__motion = { ticker, scroller, lerp, clamp, reduceMotion };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { ticker, lerp, clamp, reduceMotion, finePointer };
