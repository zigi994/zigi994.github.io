/* ============================================================
   home.js — hero field and interaction lab
   ============================================================ */

import { lerp, reduceMotion } from "./motion.js";

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
function boot() {
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
