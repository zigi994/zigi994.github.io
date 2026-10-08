/* ============================================================
   home.js — hero field and interaction lab
   ============================================================ */

import { lerp, reduceMotion } from "./motion.js";
import { initYxModel } from "./yx-model.js";

/* ------------------------------------------------------------
   Lab: easing comparison
   ------------------------------------------------------------ */
function initEasingDemo() {
  const stage = document.querySelector(".demo__stage--easing");
  if (!stage) return;

  const balls = [...stage.querySelectorAll(".easing-ball")];
  const trigger = stage.closest(".demo")?.querySelector("[data-easing-run]");

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
    const panels = btns.map((btn) =>
      document.getElementById(btn.getAttribute("aria-controls"))
    );

    const move = (btn) => {
      pill.style.setProperty("--x", `${btn.offsetLeft}px`);
      pill.style.setProperty("--w", `${btn.offsetWidth}px`);
    };

    const select = (btn, focus = false) => {
      btns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      panels.forEach((panel, i) => {
        if (panel) panel.hidden = btns[i] !== btn;
      });
      move(btn);
      if (focus) btn.focus();
    };

    btns.forEach((b) => b.addEventListener("click", () => select(b)));
    root.addEventListener("keydown", (e) => {
      const current = btns.indexOf(document.activeElement);
      if (current < 0) return;
      let next = current;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % btns.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + btns.length) % btns.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = btns.length - 1;
      else return;
      e.preventDefault();
      select(btns[next], true);
    });

    const active = root.querySelector(".ftabs__btn.is-active") || btns[0];
    if (active) select(active);
    const settle = () => {
      const current = root.querySelector(".ftabs__btn.is-active");
      if (current) move(current);
    };
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
    const status = document.getElementById("pull-status");
    const MAX = 58;

    let down = false, startY = 0, y = 0, raf = 0;

    const render = () => sheet.style.setProperty("--y", `${y.toFixed(1)}px`);

    const springBack = () => {
      cancelAnimationFrame(raf);
      if (reduceMotion.matches) {
        y = 0;
        render();
        return;
      }
      const step = () => {
        y = lerp(y, 0, 0.16);
        render();
        if (Math.abs(y) > 0.4) raf = requestAnimationFrame(step);
        else { y = 0; render(); }
      };
      raf = requestAnimationFrame(step);
    };

    const announce = (message) => {
      if (status) status.textContent = message;
    };

    const resetLabel = () => {
      if (label) label.textContent = "向下拖动";
    };

    const refresh = () => {
      y = reduceMotion.matches ? 0 : MAX * 0.82;
      render();
      if (label) label.textContent = "已刷新";
      announce("刷新完成");
      setTimeout(() => {
        resetLabel();
        springBack();
      }, reduceMotion.matches ? 120 : 420);
    };

    root.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
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
      if (y > MAX * 0.72) {
        refresh();
      } else {
        resetLabel();
        announce("未达到刷新阈值");
        springBack();
      }
    };

    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    root.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      refresh();
    });
  });
}

/* ------------------------------------------------------------
   Lab: touch and keyboard feedback for the magnetic button
   ------------------------------------------------------------ */
function initMagneticFeedback() {
  document.querySelectorAll(".magnet").forEach((button) => {
    const status = document.getElementById(button.getAttribute("aria-describedby"));
    button.addEventListener("click", () => {
      button.classList.remove("is-pressed");
      void button.offsetWidth;
      button.classList.add("is-pressed");
      if (status) status.textContent = "已确认：压缩并回弹";
      setTimeout(() => button.classList.remove("is-pressed"), reduceMotion.matches ? 20 : 320);
    });
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
  document.querySelectorAll("[data-ripple]").forEach((root) => {
    const status = document.getElementById(root.getAttribute("aria-describedby"));
    const fire = (x, y) => {
      const wave = document.createElement("span");
      wave.className = "ripple__wave";
      wave.style.left = `${x}px`;
      wave.style.top = `${y}px`;
      root.appendChild(wave);
      wave.addEventListener("animationend", () => wave.remove());

      const paw = document.createElement("span");
      paw.className = "ripple__paw";
      paw.style.left = `${x}px`;
      paw.style.top = `${y}px`;
      root.appendChild(paw);
      paw.addEventListener("animationend", () => paw.remove());
      if (status) status.textContent = "触点已收到";
      setTimeout(() => {
        wave.remove();
        paw.remove();
      }, 1000);
    };

    root.addEventListener("pointerdown", (e) => {
      const r = root.getBoundingClientRect();
      fire(e.clientX - r.left, e.clientY - r.top);
    });

    root.addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      const r = root.getBoundingClientRect();
      fire(r.width / 2, r.height / 2);
    });
  });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
function initFlips() {
  const toggle = (btn) => {
    const on = btn.classList.toggle("is-flipped");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  };
  document.querySelectorAll("[data-flip]").forEach((btn) => {
    btn.addEventListener("click", () => toggle(btn));
  });
  document.querySelectorAll(".project__cta").forEach((hint) => {
    hint.addEventListener("click", () => {
      const btn = hint.closest(".project")?.querySelector("[data-flip]");
      if (btn) toggle(btn);
    });
  });
}

function initUiStory() {
  const root = document.querySelector("[data-ui-story]");
  const glass = root?.querySelector(".handset__glass");
  const reel = root?.querySelector("[data-ui-reel]");
  if (!root || !glass || !reel) return;
  const steps = [...root.querySelectorAll("[data-ui-step]")];
  const screens = [...reel.querySelectorAll("img")];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const mark = () => {
    const h = glass.clientHeight || 1;
    const i = Math.min(screens.length - 1, Math.max(0, Math.round(glass.scrollTop / h)));
    steps.forEach((step, n) => step.closest(".ui-step")?.classList.toggle("is-on", n === i));
    const tag = root.querySelector("[data-ui-tag]");
    const name = steps[i]?.querySelector("b")?.textContent;
    if (tag && name) tag.textContent = name;
  };

  let ticking = false;
  glass.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      mark();
      ticking = false;
    });
  }, { passive: true });

  steps.forEach((step, i) => {
    step.addEventListener("click", () => {
      glass.scrollTo({
        top: screens[i].offsetTop,
        behavior: reduced.matches ? "auto" : "smooth"
      });
    });
  });

  mark();
}

function initYx() {
  const root = document.querySelector("[data-yx]");
  if (!root) return;
  const shows = [...root.querySelectorAll("[data-yx-show]")];
  const picks = [...root.querySelectorAll("[data-yx-pick]")];
  const name = root.querySelector("[data-yx-name]");
  if (!shows.length || shows.length !== picks.length) return;
  let index = 0;
  let timer = 0;
  let held = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const show = (i) => {
    index = i;
    shows.forEach((img, n) => img.classList.toggle("is-on", n === i));
    picks.forEach((btn, n) => {
      const on = n === i;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (name) name.textContent = picks[i].dataset.label || "";
  };

  const stop = () => { clearInterval(timer); timer = 0; };
  const play = () => {
    stop();
    if (reduced.matches || held) return;
    timer = setInterval(() => show((index + 1) % shows.length), 1600);
  };

  picks.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      show(i);
      play();
    });
  });
  const stage = root.querySelector(".yx-stage");
  stage?.addEventListener("mouseenter", () => { held = true; stop(); });
  stage?.addEventListener("mouseleave", () => { held = false; play(); });
  reduced.addEventListener("change", play);
  show(0);
  play();
  initYxTurn(root);
}

function initYxTurn(root) {
  initYxModel(root);
  initYxExt(root);
}

function initYxExt(root) {
  const ext = root.querySelector("[data-yx-ext]");
  if (!ext) return;
  const reelOrder = ["drink", "scent", "snack", "lion", "pick", "gift"];
  const stops = [
    { id: "drink", at: 17 },
    { id: "pick", at: 25 },
    { id: "snack", at: 41.7 },
    { id: "lion", at: 56.2 },
    { id: "cart", at: 72.9 },
    { id: "gift", at: 88.6 }
  ];
  const names = {
    drink: "茶饮", scent: "茶香", snack: "茶点", lion: "醒狮",
    pick: "采茶", gift: "茶礼", cart: "早茶"
  };
  const lines = {
    drink: "端着一杯茶。茶壶在旁边。",
    scent: "闭着眼，叶子绕着他转。",
    snack: "蒸笼打开，他捧着一只包子。",
    lion: "换上舞狮的头。穗子是红的。",
    pick: "手里一捧刚摘的叶子。",
    gift: "红衣服，茶壶和礼盒一起送出去。",
    cart: "推着一车早茶。蒸笼叠在车上。"
  };
  const reel = ext.querySelector("[data-yx-ext-reel]");
  const track = document.createElement("div");
  track.className = "yx-ext__track";
  const source = [...reel.querySelectorAll("[data-yx-ext-show]")];
  source.forEach((card) => track.appendChild(card));
  source.forEach((card) => {
    const copy = card.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.tabIndex = -1;
    track.appendChild(copy);
  });
  reel.appendChild(track);
  const cards = [...track.querySelectorAll("[data-yx-ext-show]")];
  const counter = ext.querySelector("[data-yx-ext-counter]");
  const slip = ext.querySelector("[data-yx-ext-slip]");
  const glow = ext.querySelector("[data-yx-ext-glow]");
  const slipName = ext.querySelector("[data-yx-ext-slip-name]");
  const boardName = ext.querySelector("[data-yx-ext-board]");
  const name = ext.querySelector("[data-yx-ext-name]");
  const line = ext.querySelector("[data-yx-ext-line]");
  let id = "drink";
  let held = false;
  let dragging = false;
  let frame = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const show = (slipPct) => {
    ext.dataset.theme = id;
    const label = names[id];
    if (name) {
      name.replaceChildren(...[...label].map((ch) => {
        const span = document.createElement("span");
        span.textContent = ch;
        return span;
      }));
    }
    if (line) line.textContent = lines[id];
    if (boardName) boardName.textContent = label;
    cards.forEach((card) => {
      const on = card.dataset.theme === id && !card.hasAttribute("aria-hidden");
      card.classList.toggle("is-on", on);
      if (!card.hasAttribute("aria-hidden")) card.setAttribute("aria-pressed", on ? "true" : "false");
    });
    const si = stops.findIndex((s) => s.id === id);
    const onCounter = si >= 0;
    ext.classList.toggle("is-offcounter", !onCounter);
    if (onCounter) {
      slip.style.left = (slipPct == null ? stops[si].at : slipPct) + "%";
      glow.style.left = stops[si].at + "%";
      if (slipName) slipName.textContent = label;
      counter.setAttribute("aria-valuenow", String(si));
      counter.setAttribute("aria-valuetext", label);
    }
  };
  const watch = () => {
    cancelAnimationFrame(frame);
    if (reduced.matches || held) return;
    const step = () => {
      if (held || reduced.matches) return;
      const box = reel.getBoundingClientRect();
      const mid = box.left + box.width / 2;
      let best = null;
      let bestD = Infinity;
      cards.forEach((card) => {
        const r = card.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestD) { bestD = d; best = card; }
      });
      if (best && best.dataset.theme !== id) {
        id = best.dataset.theme;
        show();
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  const hold = (on) => {
    held = on;
    ext.classList.toggle("is-hold", on || dragging);
    if (on) cancelAnimationFrame(frame);
    else watch();
  };
  const nearest = (clientX) => {
    const rect = counter.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    let best = 0;
    let bestD = Infinity;
    stops.forEach((s, i) => {
      const d = Math.abs(s.at - pct);
      if (d < bestD) { bestD = d; best = i; }
    });
    return { index: best, pct: Math.min(94, Math.max(5, pct)) };
  };

  cards.forEach((card) => {
    const point = () => {
      if (dragging) return;
      id = card.dataset.theme;
      cards.forEach((c) => c.classList.toggle("is-hot", c === card));
      hold(true);
      show();
    };
    card.addEventListener("pointerenter", point);
    if (!card.hasAttribute("aria-hidden")) card.addEventListener("focus", point);
  });
  reel.addEventListener("pointerleave", () => {
    if (dragging) return;
    cards.forEach((c) => c.classList.remove("is-hot"));
    hold(counter.matches(":hover"));
  });
  reel.addEventListener("focusout", (e) => {
    if (reel.contains(e.relatedTarget)) return;
    cards.forEach((c) => c.classList.remove("is-hot"));
  });
  reel.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const i = Math.max(0, reelOrder.indexOf(id));
    id = reelOrder[(i + dir + reelOrder.length) % reelOrder.length];
    hold(true);
    show();
  });

  const scrub = (clientX, follow) => {
    const hit = nearest(clientX);
    id = stops[hit.index].id;
    show(follow ? hit.pct : null);
  };
  counter.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    hold(true);
    ext.classList.add("is-drag");
    try { counter.setPointerCapture(e.pointerId); } catch (err) { /* pointer capture is optional */ }
    scrub(e.clientX, true);
  });
  counter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    scrub(e.clientX, true);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    ext.classList.remove("is-drag");
    show();
    hold(reel.matches(":hover") || counter.matches(":hover"));
  };
  counter.addEventListener("pointerup", endDrag);
  counter.addEventListener("pointercancel", endDrag);
  counter.addEventListener("pointerleave", () => {
    if (dragging) return;
    hold(reel.matches(":hover"));
  });
  counter.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    let si = stops.findIndex((s) => s.id === id);
    if (si < 0) si = 0;
    id = stops[(si + dir + stops.length) % stops.length].id;
    hold(true);
    show();
  });

  reduced.addEventListener("change", () => { if (reduced.matches) hold(true); else hold(false); });
  show();
  watch();
}

function initTea() {
  const root = document.querySelector("[data-tea]");
  if (!root) return;
  const dial = root.querySelector("[data-tea-dial]");
  const ring = root.querySelector(".tea__ring");
  const range = root.querySelector("[data-tea-range]");
  const arc = root.querySelector("[data-tea-arc]");
  const deg = root.querySelector("[data-tea-deg]");
  const taste = root.querySelector("[data-tea-taste]");
  const line = root.querySelector("[data-tea-line]");
  const liquor = root.querySelector("[data-tea-liquor]");
  const steam = root.querySelector(".tea__steam");
  const leaf = root.querySelector("[data-tea-leaf]");
  const circumference = 452;

  const tasteOf = (t) => {
    if (t < 76) return { name: "清甜", line: "花香很浅，汤色淡。", liquor: "#f4e6b0", steam: "2.8s" };
    if (t < 85) return { name: "鲜爽", line: "白毫银针合适。毫香出来了。", liquor: "#e4c15a", steam: "2.1s" };
    if (t < 93) return { name: "香浓", line: "兰花香，回甘。", liquor: "#c9842a", steam: "1.4s" };
    return { name: "苦底", line: "烫过了。苦从底里起来。", liquor: "#7a3b14", steam: "0.85s" };
  };
  const apply = (t) => {
    const info = tasteOf(t);
    const p = (t - 70) / 30;
    range.value = String(t);
    deg.textContent = String(t);
    taste.textContent = info.name;
    line.textContent = info.line;
    liquor.style.background = info.liquor;
    arc.style.strokeDashoffset = String(circumference * (0.68 - p * 0.58));
    arc.style.strokeOpacity = String(0.45 + p * 0.55);
    steam.style.setProperty("--steam", info.steam);
    leaf.style.setProperty("--open", String(p));
    dial.setAttribute("aria-valuenow", String(t));
    dial.setAttribute("aria-valuetext", t + "度，" + info.name);
  };
  const fromPointer = (e) => {
    const rect = ring.getBoundingClientRect();
    const ang = Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2));
    const turn = (ang * 180 / Math.PI + 450) % 360;
    apply(Math.round(70 + (turn / 360) * 30));
  };
  let dragging = false;
  dial.addEventListener("pointerdown", (e) => {
    dragging = true;
    stopDemo();
    dial.classList.add("is-drag");
    try { dial.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    fromPointer(e);
  });
  dial.addEventListener("pointermove", (e) => { if (dragging) fromPointer(e); });
  const end = () => { dragging = false; dial.classList.remove("is-drag"); };
  dial.addEventListener("pointerup", end);
  dial.addEventListener("pointercancel", end);
  dial.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const dir = (e.key === "ArrowRight" || e.key === "ArrowUp") ? 1 : -1;
    apply(Math.min(100, Math.max(70, Number(range.value) + dir)));
  });

  const hint = root.querySelector("[data-tea-hint]");
  const steps = [...root.querySelectorAll("[data-tea-step]")];
  const bench = root.querySelector(".tea__bench");
  const hints = {
    hold: "手指落在绿环上。中间的数字不用按。",
    turn: "顺时针从清甜走到苦底，弧会越来越满。",
    watch: "杯子的颜色和这一行字，就是现在的味道。"
  };
  let frame = 0;
  let fingerTimer = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stopDemo = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(fingerTimer);
    dial.classList.remove("is-show-finger");
    bench.classList.remove("is-show-side");
  };
  const playTo = (from, to) => {
    cancelAnimationFrame(frame);
    if (reduced) { apply(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 1700);
      const eased = 1 - Math.pow(1 - p, 3);
      apply(Math.round(from + (to - from) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    apply(from);
    frame = requestAnimationFrame(step);
  };
  const showStep = (name) => {
    stopDemo();
    steps.forEach((btn) => {
      const on = btn.dataset.teaStep === name;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    hint.textContent = hints[name];
    if (name === "hold") {
      apply(82);
      dial.classList.add("is-show-finger");
      fingerTimer = window.setTimeout(() => dial.classList.remove("is-show-finger"), 1600);
    } else if (name === "turn") {
      playTo(72, 98);
    } else {
      playTo(74, 90);
      bench.classList.add("is-show-side");
    }
  };
  steps.forEach((btn) => {
    btn.addEventListener("click", () => showStep(btn.dataset.teaStep));
  });

  apply(82);
}

function initBrand() {
  const root = document.querySelector("[data-brand]");
  if (!root) return;
  const view = root.querySelector("[data-brand-view]");
  const line = root.querySelector("[data-brand-line]");
  const use = root.querySelector("[data-brand-use]");
  const picks = [...root.querySelectorAll("[data-brand-pick]")];
  const inks = [...root.querySelectorAll("[data-brand-ink]")];
  const systems = {
    id: {
      src: "assets/ip/yx/brand/id.jpg",
      w: 506,
      h: 336,
      line: "角色、叶子、窗花和四个颜色，先定在这一张上。",
      alt: "识别板：狮小团正侧背、茶叶、窗花，和茶绿、米白、朱红、暖金"
    },
    pack: {
      src: "assets/ip/yx/brand/pack.jpg",
      w: 508,
      h: 336,
      line: "茶罐、茶袋是绿的。朱红只留给礼盒。",
      alt: "包装：茶罐、茶袋、纸杯和红绿礼盒"
    },
    merch: {
      src: "assets/ip/yx/brand/merch.jpg",
      w: 506,
      h: 336,
      line: "徽章、挂件、杯子和本子，小东西上也是这张脸。",
      alt: "周边：徽章、贴纸、钥匙扣、帆布袋、马克杯、手机壳和毛绒公仔"
    },
    space: {
      src: "assets/ip/yx/brand/space.jpg",
      w: 508,
      h: 336,
      line: "门头、杯套、立牌，再走到院子里的装置。",
      alt: "空间：门头、纸杯、菜单、立牌和院子里的装置"
    }
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let shown = "id";

  const show = (id) => {
    const info = systems[id];
    if (!info || id === shown && view.getAttribute("src") === info.src) {
      picks.forEach((btn) => {
        const on = btn.dataset.brandPick === id;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      return;
    }
    shown = id;
    picks.forEach((btn) => {
      const on = btn.dataset.brandPick === id;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    const paint = () => {
      view.src = info.src;
      view.width = info.w;
      view.height = info.h;
      view.alt = info.alt;
      line.textContent = info.line;
      view.classList.remove("is-swap");
    };
    if (reduced.matches) {
      paint();
      return;
    }
    view.classList.add("is-swap");
    window.setTimeout(paint, 160);
  };

  picks.forEach((btn, i) => {
    btn.addEventListener("click", () => show(btn.dataset.brandPick));
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : -1;
      const next = picks[(i + dir + picks.length) % picks.length];
      next.focus();
      show(next.dataset.brandPick);
    });
  });

  inks.forEach((btn) => {
    btn.addEventListener("click", () => {
      inks.forEach((other) => {
        const on = other === btn;
        other.classList.toggle("is-on", on);
        other.setAttribute("aria-pressed", on ? "true" : "false");
      });
      root.style.setProperty("--brand-ink", btn.dataset.brandInk);
      use.textContent = btn.dataset.use;
    });
  });

  picks[0].classList.add("is-on");
  inks[0].classList.add("is-on");
  root.style.setProperty("--brand-ink", "#7E905C");
}

function boot() {
  initUiStory();
  initYx();
  initTea();
  initBrand();
  initFlips();
  initEasingDemo();
  initFluidTabs();
  initPull();
  initMagneticFeedback();
  initOdometer();
  initRipple();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
