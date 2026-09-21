/* ============================================================
   concept.js — interactive bits inside the concept case studies
   ============================================================ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ------------------------------------------------------------
   灵犀: node canvas — select nodes, retarget wires, run prompt
   ------------------------------------------------------------ */
function initNodeUI() {
  const root = document.querySelector("[data-nodeui]");
  if (!root) return;

  const canvas = root.querySelector(".nodeui__canvas");
  const svg = root.querySelector(".nodeui__wires");
  const nodes = [...root.querySelectorAll(".nnode")];
  const insp = root.querySelector("[data-insp-title]");
  const input = root.querySelector(".nodeui__prompt input");
  const send = root.querySelector(".nodeui__send");
  const strength = root.querySelector("[data-strength]");
  const strengthOut = strength?.closest(".nodeui__slider")?.querySelector("em:last-child");

  // Wires are redrawn from live geometry so they stay attached on resize.
  const LINKS = [[0, 2], [1, 2], [2, 3]];

  function draw() {
    if (!svg || !canvas) return;
    const cr = canvas.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${cr.width} ${cr.height}`);
    svg.innerHTML = LINKS.map(([a, b]) => {
      const na = nodes[a], nb = nodes[b];
      if (!na || !nb) return "";
      const ra = na.getBoundingClientRect();
      const rb = nb.getBoundingClientRect();
      const x1 = ra.right - cr.left, y1 = ra.top + ra.height / 2 - cr.top;
      const x2 = rb.left - cr.left, y2 = rb.top + rb.height / 2 - cr.top;
      const dx = Math.max(28, (x2 - x1) * 0.55);
      return `<path d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`;
    }).join("");
  }

  const select = (node) => {
    nodes.forEach((n) => {
      const on = n === node;
      n.classList.toggle("is-sel", on);
      n.setAttribute("aria-pressed", String(on));
    });
    if (insp) insp.textContent = node.dataset.name || "节点";
    if (strength) {
      strength.value = node.dataset.strength || 60;
      if (strengthOut) strengthOut.textContent = strength.value;
    }
  };

  nodes.forEach((n) => {
    n.addEventListener("click", () => select(n));
    n.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      select(n);
    });
  });
  if (nodes[2]) select(nodes[2]);

  strength?.addEventListener("input", () => {
    const sel = root.querySelector(".nnode.is-sel");
    const bar = sel?.querySelector(".nnode__bar i");
    if (bar) bar.style.setProperty("--v", `${strength.value}%`);
    if (sel) sel.dataset.strength = strength.value;
    if (strengthOut) strengthOut.textContent = strength.value;
  });

  const run = () => {
    if (!input) return;
    const text = input.value.trim();
    const sel = root.querySelector(".nnode.is-sel") || nodes[2];
    const label = sel?.querySelector(".nnode__label");
    if (text && label) {
      label.textContent = text.slice(0, 18);
      if (!reduceMotion.matches) {
        sel.animate(
          [{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }],
          { duration: 520, easing: "cubic-bezier(.34,1.56,.64,1)" }
        );
      }
      input.value = "";
    }
  };

  send?.addEventListener("click", run);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });

  root.querySelectorAll(".nodeui__chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.classList.contains("is-on")));
    chip.addEventListener("click", () => {
      const group = chip.closest(".nodeui__group");
      group?.querySelectorAll(".nodeui__chip").forEach((c) => {
        const on = c === chip;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", String(on));
      });
    });
  });

  draw();
  window.addEventListener("resize", draw);
  if (document.fonts?.ready) document.fonts.ready.then(draw);
  // The canvas reveals on scroll, so re-measure once it has settled.
  setTimeout(draw, 600);
  setTimeout(draw, 1600);
}

/* ------------------------------------------------------------
   茶时: drag the collar to set brew temperature
   ------------------------------------------------------------ */
function initDevice() {
  const root = document.querySelector("[data-device]");
  if (!root) return;

  const ring = root.querySelector(".device__ring");
  const fill = root.querySelector(".device__fill");
  const knob = root.querySelector(".device__knob");
  const out = root.querySelector("[data-temp]");
  const note = root.querySelector("[data-temp-note]");
  const presets = [...document.querySelectorAll(".preset")];

  const MIN = 60, MAX = 100;
  const R = 86, CX = 100, CY = 100;
  const SWEEP = 280;            // degrees of usable travel
  const START = 90 + (360 - SWEEP) / 2;
  const LEN = 2 * Math.PI * R;

  let temp = 86;

  const tone = (t) => {
    const p = (t - MIN) / (MAX - MIN);
    // sage → amber → red as the water heats up
    const hue = 88 - p * 78;
    return `hsl(${hue} 52% ${58 - p * 6}%)`;
  };

  const NOTES = [
    [60, 74, "绿茶 · 不涩"],
    [74, 84, "白茶 · 清甜"],
    [84, 93, "乌龙 · 花香"],
    [93, 101, "普洱 · 醇厚"],
  ];

  function render() {
    const p = (temp - MIN) / (MAX - MIN);
    const arc = (SWEEP / 360) * LEN * p;
    fill.style.strokeDasharray = `${arc} ${LEN}`;
    fill.setAttribute("transform", `rotate(${START} ${CX} ${CY})`);

    const a = ((START + (SWEEP * p)) * Math.PI) / 180;
    knob.setAttribute("cx", (CX + R * Math.cos(a)).toFixed(2));
    knob.setAttribute("cy", (CY + R * Math.sin(a)).toFixed(2));

    const c = tone(temp);
    root.style.setProperty("--heat", c);
    root.style.setProperty("--steam", (0.25 + p * 0.75).toFixed(2));

    if (out) out.textContent = Math.round(temp);
    if (note) {
      const hit = NOTES.find(([lo, hi]) => temp >= lo && temp < hi);
      note.textContent = hit ? hit[2] : "";
      ring.setAttribute("aria-valuetext", `${Math.round(temp)} 摄氏度，${hit ? hit[2] : ""}`);
    }
    ring.setAttribute("aria-valuenow", String(Math.round(temp)));
    presets.forEach((b) => {
      const on = Number(b.dataset.temp) === Math.round(temp);
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function fromPointer(e) {
    const r = ring.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    deg = (deg - START + 360 + 360) % 360;
    if (deg > SWEEP) deg = deg - SWEEP < (360 - SWEEP) / 2 ? SWEEP : 0;
    temp = MIN + (deg / SWEEP) * (MAX - MIN);
    temp = clamp(temp, MIN, MAX);
    render();
  }

  let down = false;
  ring.addEventListener("pointerdown", (e) => {
    down = true;
    root.classList.add("is-turning");
    ring.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  ring.addEventListener("pointermove", (e) => { if (down) fromPointer(e); });
  const end = () => { down = false; root.classList.remove("is-turning"); };
  ring.addEventListener("pointerup", end);
  ring.addEventListener("pointercancel", end);

  ring.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    temp = clamp(temp + step, MIN, MAX);
    render();
  });

  presets.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.temp);
      if (reduceMotion.matches) {
        temp = target;
        render();
        return;
      }
      const from = temp;
      const t0 = performance.now();
      const step = (now) => {
        const k = clamp((now - t0) / 620, 0, 1);
        const eased = 1 - Math.pow(1 - k, 4);
        temp = from + (target - from) * eased;
        render();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });

  render();
}

function boot() {
  initNodeUI();
  initDevice();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
