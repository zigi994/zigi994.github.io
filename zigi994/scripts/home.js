/* ============================================================
   home.js — hero field, intro curtain, interaction lab
   ============================================================ */

import { ticker, lerp, clamp, reduceMotion, finePointer } from "./motion.js";

/* ------------------------------------------------------------
   Intro curtain
   Counts real decoded progress where possible, so the number
   means something instead of faking a load.
   ------------------------------------------------------------ */
function initIntro() {
  const intro = document.getElementById("intro");
  if (!intro) return;

  /* The curtain is a first impression, not a page transition. Coming back to
     the homepage — nav, breadcrumb, or Back — should land on the work rather
     than on a counter replaying to 100, which prefetch and View Transitions
     otherwise deliver instantly and then sit behind a black panel.
     sessionStorage scopes it to the tab, so a genuinely new visit still gets
     it; the navigation-type check covers private mode, where it throws. */
  const nav = performance.getEntriesByType("navigation")[0];
  let seen = false;
  try {
    seen = sessionStorage.getItem("zigi:intro") === "1";
    sessionStorage.setItem("zigi:intro", "1");
  } catch (e) {
    /* storage blocked; fall back to the navigation type alone */
  }
  if (seen || (nav && nav.type === "back_forward")) {
    intro.remove();
    return;
  }

  const out = intro.querySelector("[data-intro-count]");
  const bar = intro.querySelector(".intro__bar span");

  const finish = () => {
    intro.classList.add("is-done");
    document.body.classList.remove("is-locked");
    setTimeout(() => intro.remove(), 1400);
  };

  if (reduceMotion.matches) {
    out.textContent = "100";
    finish();
    return;
  }

  document.body.classList.add("is-locked");

  let shown = 0;
  let real = 0;
  const started = performance.now();

  const imgs = [...document.images];
  const total = Math.max(imgs.length, 1);
  let done = 0;
  imgs.forEach((img) => {
    const mark = () => {
      done += 1;
      real = done / total;
    };
    if (img.complete) mark();
    else {
      img.addEventListener("load", mark, { once: true });
      img.addEventListener("error", mark, { once: true });
    }
  });

  const step = () => {
    const elapsed = performance.now() - started;
    // Never outrun the floor, never stall on a slow image.
    const floor = clamp(elapsed / 1600, 0, 1);
    const target = Math.max(floor, real);
    shown = lerp(shown, target, 0.09);

    const pct = Math.min(100, Math.round(shown * 100));
    out.textContent = String(pct);
    bar.style.setProperty("--p", (pct / 100).toFixed(3));

    if (pct >= 100 || elapsed > 4200) {
      out.textContent = "100";
      bar.style.setProperty("--p", "1");
      setTimeout(finish, 220);
      return;
    }
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

/* ------------------------------------------------------------
   Hero dot field
   A matrix that swells toward the pointer — the page's first
   demonstration that things here respond to you.
   ------------------------------------------------------------ */
function initHeroField() {
  const canvas = document.querySelector("[data-field]");
  if (!canvas) return;

  if (reduceMotion.matches) {
    canvas.style.display = "none";
    return;
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  let dpr = 1, w = 0, h = 0;
  let cols = 0, rows = 0;
  const GAP = 30;
  const RADIUS = 190;

  let mx = -9999, my = -9999;
  let tx = -9999, ty = -9999;
  let phase = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / GAP) + 1;
    rows = Math.ceil(h / GAP) + 1;
  }

  resize();
  window.addEventListener("resize", resize);

  if (finePointer.matches) {
    window.addEventListener("mousemove", (e) => {
      const r = canvas.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
    }, { passive: true });

    document.addEventListener("mouseleave", () => { tx = -9999; ty = -9999; });
  }

  const accentRGB = () => {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim();
    // #rrggbb → r,g,b
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      return [
        parseInt(v.slice(1, 3), 16),
        parseInt(v.slice(3, 5), 16),
        parseInt(v.slice(5, 7), 16),
      ];
    }
    return [238, 92, 54]; // --accent fallback: lacquer vermillion
  };

  let rgb = accentRGB();
  let rgbCheck = 0;

  ticker.add((dt, now) => {
    // Idle out of view: the hero is only ~1 viewport tall.
    if (window.scrollY > h + 200) return;

    mx = lerp(mx, tx, 0.1);
    my = lerp(my, ty, 0.1);
    phase = now * 0.0006;

    if (now - rgbCheck > 400) {
      rgb = accentRGB();
      rgbCheck = now;
    }

    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = i * GAP;
        const y = j * GAP;

        // Slow breathing so the field is alive without a pointer.
        const drift = Math.sin(phase + i * 0.32 + j * 0.24);
        let size = 0.85 + drift * 0.28;
        let alpha = 0.1 + drift * 0.035;

        const dx = x - mx;
        const dy = y - my;
        const dist = Math.hypot(dx, dy);

        if (dist < RADIUS) {
          const f = 1 - dist / RADIUS;
          const ease = f * f;
          size += ease * 2.6;
          alpha += ease * 0.62;
        }

        if (alpha <= 0.012) continue;

        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.2, size), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.min(alpha, 0.9).toFixed(3)})`;
        ctx.fill();
      }
    }
  });
}

/* ------------------------------------------------------------
   Lab: easing comparison
   ------------------------------------------------------------ */
function initEasingDemo() {
  const stage = document.querySelector(".demo__stage--easing");
  if (!stage) return;

  const balls = [...stage.querySelectorAll(".easing-ball")];
  const trigger = stage.querySelector("[data-easing-run]");

  const measure = () => {
    balls.forEach((b) => {
      const row = b.parentElement;
      const track = row.getBoundingClientRect().width - 54 - 16;
      b.style.setProperty("--run", `${Math.max(40, track - 14)}px`);
    });
  };

  measure();
  window.addEventListener("resize", measure);

  let running = false;
  const play = () => {
    if (running) return;
    running = true;
    measure();
    balls.forEach((b) => {
      b.classList.remove("is-run");
      void b.offsetWidth; // restart the animation
      b.classList.add("is-run");
    });
    setTimeout(() => { running = false; }, 1250);
  };

  trigger?.addEventListener("click", play);

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        setTimeout(play, 320);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  io.observe(stage);
}

/* ------------------------------------------------------------
   Lab: fluid tabs
   ------------------------------------------------------------ */
function initFluidTabs() {
  document.querySelectorAll("[data-ftabs]").forEach((root) => {
    const pill = root.querySelector(".ftabs__pill");
    const btns = [...root.querySelectorAll(".ftabs__btn")];

    const move = (btn) => {
      pill.style.setProperty("--x", `${btn.offsetLeft}px`);
      pill.style.setProperty("--w", `${btn.offsetWidth}px`);
    };

    const select = (btn) => {
      btns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      move(btn);
    };

    btns.forEach((b) => b.addEventListener("click", () => select(b)));

    const active = root.querySelector(".ftabs__btn.is-active") || btns[0];
    const settle = () => active && move(active);
    if (document.fonts?.ready) document.fonts.ready.then(settle);
    else settle();
    window.addEventListener("resize", () => {
      const cur = root.querySelector(".ftabs__btn.is-active");
      if (cur) move(cur);
    });
  });
}

/* ------------------------------------------------------------
   Lab: rubber-band pull
   ------------------------------------------------------------ */
function initPull() {
  document.querySelectorAll("[data-pull]").forEach((root) => {
    const sheet = root.querySelector(".pull__sheet");
    const label = root.querySelector("[data-pull-label]");
    const MAX = 58;

    let down = false, startY = 0, y = 0, raf = 0;

    const render = () => sheet.style.setProperty("--y", `${y.toFixed(1)}px`);

    const springBack = () => {
      cancelAnimationFrame(raf);
      const step = () => {
        y = lerp(y, 0, 0.16);
        render();
        if (Math.abs(y) > 0.4) raf = requestAnimationFrame(step);
        else { y = 0; render(); }
      };
      raf = requestAnimationFrame(step);
    };

    root.addEventListener("pointerdown", (e) => {
      down = true;
      startY = e.clientY - y;
      cancelAnimationFrame(raf);
      root.setPointerCapture(e.pointerId);
      root.classList.add("is-grabbing");
    });

    root.addEventListener("pointermove", (e) => {
      if (!down) return;
      const raw = e.clientY - startY;
      // Resistance grows with distance — the pull "costs" more the further it goes.
      y = raw <= 0 ? raw * 0.18 : MAX * (1 - Math.exp(-raw / MAX));
      render();
      if (label) {
        label.textContent = y > MAX * 0.72 ? "松手刷新" : "向下拖动";
      }
    });

    const end = () => {
      if (!down) return;
      down = false;
      root.classList.remove("is-grabbing");
      if (label) label.textContent = y > MAX * 0.72 ? "已刷新" : "向下拖动";
      springBack();
      if (label) setTimeout(() => { label.textContent = "向下拖动"; }, 1100);
    };

    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
  });
}

/* ------------------------------------------------------------
   Lab: odometer
   ------------------------------------------------------------ */
function initOdometer() {
  const root = document.querySelector("[data-odo]");
  if (!root) return;

  const valueEl = root.querySelector("[data-odo-value]");
  let value = Number(valueEl.textContent.trim()) || 0;

  const build = (n) => {
    const digits = String(Math.max(0, Math.round(n)));
    // Rebuild only when the digit count changes; otherwise just retarget.
    if (valueEl.children.length !== digits.length) {
      valueEl.textContent = "";
      for (let i = 0; i < digits.length; i++) {
        const col = document.createElement("span");
        col.className = "odo__digit";
        const strip = document.createElement("span");
        for (let d = 0; d <= 9; d++) {
          const cell = document.createElement("i");
          cell.textContent = String(d);
          strip.appendChild(cell);
        }
        col.appendChild(strip);
        valueEl.appendChild(col);
      }
    }
    [...valueEl.children].forEach((col, i) => {
      col.firstElementChild.style.setProperty("--d", digits[i]);
    });
  };

  build(value);

  root.querySelectorAll("[data-odo-step]").forEach((btn) => {
    btn.addEventListener("click", () => {
      value = Math.max(0, value + Number(btn.dataset.odoStep));
      build(value);
    });
  });
}

/* ------------------------------------------------------------
   Lab: ripple + paw
   ------------------------------------------------------------ */
function initRipple() {
  const PAWS = ["🐾", "🐾", "🐾"];

  document.querySelectorAll("[data-ripple]").forEach((root) => {
    root.addEventListener("pointerdown", (e) => {
      const r = root.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      const wave = document.createElement("span");
      wave.className = "ripple__wave";
      wave.style.left = `${x}px`;
      wave.style.top = `${y}px`;
      root.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove());

      const paw = document.createElement("span");
      paw.className = "ripple__paw";
      paw.textContent = PAWS[Math.floor(Math.random() * PAWS.length)];
      paw.style.left = `${x}px`;
      paw.style.top = `${y}px`;
      root.appendChild(paw);
      paw.addEventListener("animationend", () => paw.remove());
    });
  });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
function boot() {
  initIntro();
  initHeroField();
  initEasingDemo();
  initFluidTabs();
  initPull();
  initOdometer();
  initRipple();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
