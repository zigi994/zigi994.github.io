/* ============================================================
   case.js — sticky device showcase
   ============================================================ */

function initShowcase() {
  document.querySelectorAll("[data-showcase]").forEach((root) => {
    const screens = [...root.querySelectorAll(".phone__screen img")];
    const steps = [...root.querySelectorAll(".showcase__step")];
    if (!screens.length || !steps.length) return;

    let active = -1;

    const setActive = (i) => {
      if (i === active) return;
      active = i;
      screens.forEach((s, n) => s.classList.toggle("is-active", n === i));
      steps.forEach((s, n) => s.classList.toggle("is-active", n === i));
    };

    setActive(0);

    // Pick the step whose midpoint sits closest to the viewport centre,
    // which keeps the device in sync in both scroll directions.
    let ticking = false;
    const update = () => {
      const mid = window.innerHeight / 2;
      let best = 0;
      let bestDist = Infinity;
      steps.forEach((step, i) => {
        const r = step.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      setActive(best);
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
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initShowcase);
} else {
  initShowcase();
}
