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

  /* Per-frame smoothing has to be converted into a rate, or the feel is tied to
     the panel. A flat 0.1 per frame reached 90% of a flick in 184ms on a 144Hz
     screen and about 366ms at 60Hz -- the same gesture travelling at two
     different speeds depending on the monitor. Solving for the same 185ms on a
     60Hz frame gives 0.185, and raising it to dt/16.667 holds that curve at any
     refresh rate. The faster end is the reference on purpose: it is the one the
     easing was evidently tuned against. */
  const EASE_PER_60HZ_FRAME = 0.185;

  function tick(dt) {
    current = lerp(current, target, 1 - Math.pow(1 - EASE_PER_60HZ_FRAME, dt / (1000 / 60)));
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

  const show = (el) => el.classList.add("is-in");

  // threshold 0 rather than a fraction: several case-study figures are taller
  // than the viewport, and requiring a percentage of the *element* to be
  // visible can leave a full-bleed panel clipped away while it fills the
  // screen. rootMargin alone gives the "enters from the bottom" feel.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0 }
  );

  items.forEach((el) => io.observe(el));

  // Safety net. A reveal that never fires means content the visitor can never
  // read, which is a far worse failure than a missed animation — so anything
  // already in or above the viewport is shown straight away, and a late sweep
  // catches anything the observer missed (throttled tab, restored scroll
  // position, layout that settles after fonts load).
  const sweep = () => {
    items.forEach((el) => {
      if (el.classList.contains("is-in")) return;
      if (el.getBoundingClientRect().top < window.innerHeight) {
        show(el);
        io.unobserve(el);
      }
    });
  };

  sweep();
  window.addEventListener("load", sweep, { once: true });
  setTimeout(sweep, 1200);

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

  /* The centre of the viewport is a placeholder, not a position, and nothing may
     be painted there. Revealing used to be the mouseenter handler's job, and
     that event was handled without reading its coordinates -- so a pointer
     already resting over the page when the document loaded got a ring parked
     at dead centre while the real pointer was somewhere else. Every in-site
     navigation lands in exactly that state, because the hand does not move off
     the link it just clicked. The next click then snapped the ring across the
     screen, which is the jump this was reported as. */
  let mx = window.innerWidth / 2;
  let my = window.innerHeight / 2;
  let dx = mx, dy = my;
  let rx = mx, ry = my;
  let placed = false;
  let shown = false;

  /* Press feedback lives here rather than in a CSS `scale`, and the centring
     -50% is here rather than in a CSS `translate`, because the individual
     transform properties compose in a fixed order -- translate, rotate, scale,
     then `transform` -- so a CSS `scale: 0.82` multiplied the coordinates this
     writes into `transform`. At (1120, 300) the ring rendered at (918, 246):
     the press threw it 202px up-left, further the further it was from the
     origin. One element, one transform property, one owner. */
  let press = 1;
  let pressTarget = 1;

  const paint = () => {
    const centre = "translate(-50%, -50%)";
    dot.style.transform = `translate3d(${dx}px, ${dy}px, 0) ${centre} scale(${press})`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) ${centre} scale(${press})`;
  };

  const show = () => {
    if (shown) return;
    shown = true;
    root.style.opacity = "1";
  };

  /* Any mouse event will do -- they all carry clientX/clientY -- and the first
     one snaps all four trailing values instead of easing, so the ring never
     glides in from the placeholder either. */
  const track = (e) => {
    mx = e.clientX;
    my = e.clientY;
    if (!placed) {
      placed = true;
      dx = rx = mx;
      dy = ry = my;
      /* Land the transform in this same task. The ticker would otherwise not run
         until the next frame, and revealing first left one frame of an opaque
         ring still drawn on the placeholder -- the jump made small, not gone. */
      paint();
    }
    show();
  };

  /* mouseenter does not bubble, so on document it fires only for the document
     itself: re-entering the window after leaving it. It is listed here rather
     than given its own position-less handler precisely because that split was
     the bug. */
  ["mousemove", "mousedown", "mouseover", "mouseenter"].forEach((ev) => {
    document.addEventListener(ev, track, { passive: true });
  });

  document.addEventListener("mouseleave", () => {
    shown = false;
    root.style.opacity = "0";
  });
  window.addEventListener("mousedown", () => { pressTarget = 0.82; });
  window.addEventListener("mouseup", () => { pressTarget = 1; });

  root.style.opacity = "0";
  root.style.transition = "opacity 220ms linear";

  ticker.add(() => {
    dx = lerp(dx, mx, 0.62);
    dy = lerp(dy, my, 0.62);
    rx = lerp(rx, mx, 0.16);
    ry = lerp(ry, my, 0.16);
    press = lerp(press, pressTarget, 0.34);
    paint();
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
   Lion stage — the IP mark as the ground of its own case pages
   ------------------------------------------------------------ */
async function initLionStage() {
  const stage = document.querySelector("[data-lion]");
  if (!stage) return;

  /* Inlined rather than used as <img> because the sway needs the crest and the
     brow to be separate elements, and fetched rather than written into the
     markup because it is 30 KB of path data that the service worker already
     keeps as one cached file for both pages that want it. */
  let markup;
  try {
    const res = await fetch(stage.dataset.lion, { cache: "force-cache" });
    if (!res.ok) return;
    markup = await res.text();
  } catch {
    return; // Decorative: a failed fetch has to leave the page as it was.
  }

  const drift = document.createElement("div");
  drift.className = "lionstage__drift";
  const idle = document.createElement("div");
  idle.className = "lionstage__idle";
  idle.innerHTML = markup;

  const art = idle.querySelector("svg");
  if (!art) return;
  art.classList.add("lionstage__art");
  /* The stage is already aria-hidden, but the SVG carries no title and must not
     be a tab stop in any browser that still treats one as focusable. */
  art.setAttribute("focusable", "false");

  drift.append(idle);
  stage.append(drift);
  stage.classList.add("is-ready");

  if (reduceMotion.matches) return;

  /* Drift is the only thing JS moves, and it is the one layer no keyframe
     touches -- see the note in case.css about why that separation is strict.

     scrollHeight is read on resize rather than per frame: it forces layout, and
     doing that inside the ticker is how a decorative background starts costing
     real frames on a 12000px case page. */
  const DRIFT = 0.09;
  let travel = 0;
  const measure = () => {
    travel = document.documentElement.scrollHeight - window.innerHeight;
  };
  measure();
  window.addEventListener("resize", measure, { passive: true });

  let last = null;
  ticker.add(() => {
    const progress = travel > 0 ? clamp(window.scrollY / travel, 0, 1) : 0;
    // Centred on the page middle, so the mark sits where it was designed to at
    // half scroll and leans the other way at each end.
    const y = (0.5 - progress) * DRIFT * window.innerHeight;
    const next = y.toFixed(2);
    if (next === last) return; // Idle pages should not rewrite the same matrix.
    last = next;
    drift.style.transform = `translate3d(0, ${next}px, 0)`;
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

      /* One placeholder can only stand in for one image. Where a frame holds a
         composition -- quchong's hero is five phones arranged on a designed
         gradient -- the LQIP of whichever img happens to come first is not a
         preview of the frame, and painting it replaces art direction with a
         blurred fragment of one child. Leave those frames to their backdrop. */
      const sole = frame && frame.querySelectorAll("img").length === 1;

      if (sole) {
        /* Longhands, never the `background` shorthand, and never background-image
           alone. Eleven frames carry an inline `background: linear-gradient(...)`
           from the markup; that shorthand has already reset size and repeat to
           auto/repeat, so assigning only background-image left an 8x19 thumbnail
           tiling several thousand times -- it read as a woven hatch, not as a
           blurred photo. Setting all four longhands makes this independent of
           whatever the inline shorthand did.

           The authored gradient is kept as a second layer rather than
           overwritten: a frame--pad contains its image instead of covering, so
           without the gradient beneath, the LQIP would sit on bare transparency. */
        const authored = frame.style.backgroundImage;
        const lqip = `url("${manifest.lqip[key]}")`;
        /* A `background: <colour>` shorthand leaves this longhand serialized as
           the keyword `initial`, not as `none`. Composing against that yields
           `url(...), initial`, which is not a valid layer list, so the browser
           discards the whole assignment and the placeholder vanishes without
           error -- three frames on yuexing lost theirs exactly that way. */
        const stacked = authored && !/^(?:none|initial|inherit|unset|revert)$/.test(authored.trim());
        frame.style.backgroundImage = stacked ? `${lqip}, ${authored}` : lqip;
        frame.style.backgroundRepeat = "no-repeat";
        frame.style.backgroundPosition = "center";
        frame.style.backgroundSize = frame.classList.contains("frame--pad")
          ? stacked ? "contain, cover" : "contain"
          : "cover";
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
  initLionStage();
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
