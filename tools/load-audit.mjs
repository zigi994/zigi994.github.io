/* ============================================================
   load-audit.mjs — first-visit loading and layout, per device

     node tools/load-audit.mjs [--label NAME] [--only phone,tablet]
                               [--no-display] [--no-load] [--site DIR]

   Serves zigi994/ itself (gzip for text, byte ranges for media,
   GitHub Pages' max-age=600) instead of going through serve.ps1,
   which is single-threaded and sends every file uncompressed.

   For each device a fresh headless Chrome profile loads the page
   cold, throttled, with the service worker bypassed, and records:
   FCP / LCP / CLS / long tasks, when the hero figure first shows,
   what was downloaded by the load event and in the first 10 s,
   and a filmstrip of the first seconds. The display pass then
   drops throttling and scrolls every section, capturing each one
   and listing anything that runs past the viewport edge.

   Output: tools/_qa/load/<label>/ (report.json + PNG/JPEG).
   ============================================================ */

import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
/* --site points the audit at another checkout, e.g. a worktree of origin/main. */
const site = path.resolve(opt("site", path.join(repo, "zigi994")));
const label = opt("label", "run");
const only = opt("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const outRoot = path.join(here, "_qa", "load", label);

/* Throughput in bytes per second, latency as round-trip ms. */
const mbps = (n) => Math.round((n * 1e6) / 8);
const DEVICES = [
  {
    name: "desktop",
    width: 1440, height: 900, dpr: 1, mobile: false, touch: false,
    cpu: 1, net: { latency: 20, down: mbps(40), up: mbps(10) },
    netLabel: "40 Mbps / 20 ms",
  },
  {
    name: "tablet",
    width: 820, height: 1180, dpr: 2, mobile: true, touch: true,
    cpu: 2, net: { latency: 60, down: mbps(20), up: mbps(5) },
    netLabel: "20 Mbps / 60 ms, CPU 2x",
  },
  {
    name: "phone",
    width: 390, height: 844, dpr: 3, mobile: true, touch: true,
    cpu: 4, net: { latency: 150, down: mbps(9), up: mbps(1.5) },
    netLabel: "4G 9 Mbps / 150 ms, CPU 4x",
  },
];

/* Layout-only sizes: no throttled load, just the section walk. */
const LAYOUT_ONLY = [
  { name: "laptop", width: 1366, height: 768, dpr: 1, mobile: false, touch: false },
  { name: "tablet-landscape", width: 1180, height: 820, dpr: 2, mobile: true, touch: true },
  { name: "phone-small", width: 360, height: 780, dpr: 3, mobile: true, touch: true, noShots: true },
];

/* Scroll stops for the display pass, one per section of the homepage. `at`
   is a fraction of the element's own scroll travel; `ready` is a selector
   to wait for (up to 8 s) before the shutter, for content that loads late. */
const STOPS = [
  { name: "01-hero", top: 0 },
  { name: "02-about", sel: "#about" },
  { name: "03-work", sel: "#work" },
  { name: "04-ui", sel: ".project--ui" },
  { name: "05-lab", sel: "#lab" },
  { name: "06-yx-hero", sel: ".yx-hero", ready: ".yx-turn__stage.is-ready" },
  { name: "07-yx-lock", sel: ".yx-lock" },
  { name: "08-yx-faces", sel: ".yx-faces" },
  { name: "09-yx-ext", sel: ".yx-ext" },
  { name: "10-yx-board", sel: ".yx-ext__board" },
  { name: "11-tea", sel: ".project--tea" },
  { name: "12-brand", sel: ".project--brand" },
  { name: "13-footer", sel: "footer" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- */
/* Static server                                                     */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".xml", ".txt", ".svg"]);

function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404, { "content-type": "text/plain" }).end("404");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const headers = {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": "max-age=600",
        "accept-ranges": "bytes",
      };
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
      if (range && !COMPRESSIBLE.has(ext)) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["content-length"] = end - start + 1;
        res.writeHead(206, headers);
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
        const body = zlib.gzipSync(await fsp.readFile(file), { level: 6 });
        headers["content-encoding"] = "gzip";
        headers["content-length"] = body.length;
        res.writeHead(200, headers).end(body);
        return;
      }
      headers["content-length"] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  server.keepAliveTimeout = 30000;
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* ---------------------------------------------------------------- */
/* Chrome + CDP                                                      */

const CHROME = [
  process.env.CHROME,
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.ProgramFiles || "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
].find((p) => p && fs.existsSync(p));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`JS: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

async function launchChrome(width, height) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "zigi-load-"));
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      `--window-size=${width},${height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--hide-scrollbars",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(150);
    try {
      port = Number((await fsp.readFile(path.join(dir, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    } catch {}
  }
  if (!port) throw new Error("Chrome did not open a DevTools port");
  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ws = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!ws) await sleep(150);
  }
  if (!ws) throw new Error("no page target");
  const cdp = await Cdp.connect(ws);
  const kill = async () => {
    try { cdp.close(); } catch {}
    try { execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    for (let i = 0; i < 10; i++) {
      try { await fsp.rm(dir, { recursive: true, force: true }); break; } catch { await sleep(300); }
    }
  };
  return { cdp, kill };
}

async function emulate(cdp, d) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: d.width, height: d.height, deviceScaleFactor: d.dpr, mobile: d.mobile,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", d.touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  /* Touch emulation alone leaves (hover: hover) and (pointer: fine) matching,
     so the media features the site branches on are emulated explicitly. */
  await cdp.send("Emulation.setEmulatedMedia", {
    features: d.touch
      ? [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" },
         { name: "any-hover", value: "none" }, { name: "any-pointer", value: "coarse" }]
      : [{ name: "hover", value: "hover" }, { name: "pointer", value: "fine" }],
  });
}

async function shoot(cdp, d, file, { jpeg = false, scale } = {}) {
  const s = scale ?? (d.dpr > 1 ? 1 / Math.min(d.dpr, 2) : 1);
  /* The clip is in document coordinates, so a clip at 0,0 on a scrolled page
     asks for a region that is no longer painted and comes back black. */
  const { cssVisualViewport: vv } = await cdp.send("Page.getLayoutMetrics");
  const shot = await cdp.send("Page.captureScreenshot", {
    format: jpeg ? "jpeg" : "png",
    ...(jpeg ? { quality: 62 } : {}),
    clip: { x: vv.pageX, y: vv.pageY, width: d.width, height: d.height, scale: s },
  });
  await fsp.writeFile(file, Buffer.from(shot.data, "base64"));
}

/* ---------------------------------------------------------------- */
/* In-page instrumentation, installed before any page script runs.   */

const PROBE = `(() => {
  const qa = (window.__qa = { lcp: [], cls: 0, fcp: null, longtasks: [], heroLive: null, heroFallback: null, elements: {} });
  const describe = (el) => {
    if (!el) return null;
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).join(".") : "";
    return el.tagName.toLowerCase() + cls + (el.getAttribute && el.getAttribute("src") ? "[" + el.getAttribute("src") + "]" : "");
  };
  const watch = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch (e) {} };
  watch("paint", (e) => { if (e.name === "first-contentful-paint") qa.fcp = e.startTime; });
  watch("largest-contentful-paint", (e) => qa.lcp.push({ t: e.startTime, size: e.size, el: describe(e.element), url: e.url || null }));
  watch("layout-shift", (e) => { if (!e.hadRecentInput) qa.cls += e.value; });
  watch("longtask", (e) => qa.longtasks.push([e.startTime, e.duration]));
  watch("element", (e) => { if (!(e.identifier in qa.elements)) qa.elements[e.identifier] = e.renderTime || e.loadTime; });
  const check = () => {
    const c = document.querySelector("[data-hero-fluid]");
    const v = document.querySelector("[data-hero-video]");
    if (qa.heroLive === null && c && c.classList.contains("is-live")) qa.heroLive = performance.now();
    if (qa.heroFallback === null && v && v.classList.contains("is-fallback")) qa.heroFallback = performance.now();
  };
  new MutationObserver(check).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
})();`;

const OVERFLOW = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const clips = (el) => {
    const s = getComputedStyle(el);
    return /(hidden|clip|auto|scroll)/.test(s.overflowX) || /paint|strict|content/.test(s.contain);
  };
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
  };
  const found = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const s = getComputedStyle(el);
    if (s.position === "fixed" || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) {
      if (clips(p)) {
        const pr = p.getBoundingClientRect();
        if (pr.right <= vw + 1 && pr.left >= -1) { clipped = true; break; }
      }
      p = p.parentElement;
    }
    if (clipped) continue;
    if (found.some((f) => f.el.contains(el))) continue;
    found.push({ el, name: name(el), left: Math.round(r.left), right: Math.round(r.right) });
  }
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: found.slice(0, 8).map(({ name, left, right }) => ({ name, left, right })),
  };
})()`;

/* ---------------------------------------------------------------- */
/* Load pass                                                         */

async function loadPass(origin, d, dir) {
  const { cdp, kill } = await launchChrome(d.width, d.height);
  const requests = new Map();
  const chunks = [];
  const errors = [];
  let t0 = null;
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable", { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await emulate(cdp, d);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false, latency: d.net.latency, downloadThroughput: d.net.down, uploadThroughput: d.net.up,
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });

    cdp.on("Network.requestWillBeSent", (p) => {
      if (t0 === null && p.type === "Document") t0 = p.timestamp;
      if (!requests.has(p.requestId)) {
        requests.set(p.requestId, { url: p.request.url, type: p.type, start: p.timestamp, end: null, bytes: 0, status: null });
      }
    });
    cdp.on("Network.responseReceived", (p) => {
      const r = requests.get(p.requestId);
      if (r) { r.status = p.response.status; r.mime = p.response.mimeType; }
    });
    cdp.on("Network.dataReceived", (p) => chunks.push([p.timestamp, p.encodedDataLength]));
    cdp.on("Network.loadingFinished", (p) => {
      const r = requests.get(p.requestId);
      if (r) { r.end = p.timestamp; r.bytes = p.encodedDataLength; }
    });
    cdp.on("Network.loadingFailed", (p) => {
      const r = requests.get(p.requestId);
      if (r && !p.canceled) errors.push(`failed ${r.url} ${p.errorText}`);
      if (r) r.end = p.timestamp;
    });
    cdp.on("Runtime.exceptionThrown", (p) => errors.push(`exception ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
    cdp.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error" || p.type === "warning") errors.push(`console.${p.type} ${p.args.map((a) => a.value ?? a.description).join(" ")}`);
    });
    let loadFired = null;
    cdp.on("Page.loadEventFired", (p) => { loadFired = p.timestamp; });

    const frames = [];
    const marks = [500, 1000, 1500, 2000, 3000, 4500, 6500, 9000];
    const started = performance.now();
    await cdp.send("Page.navigate", { url: origin + "/" });

    for (const m of marks) {
      const wait = m - (performance.now() - started);
      if (wait > 0) await sleep(wait);
      const file = path.join(dir, `film-${String(m).padStart(5, "0")}.jpg`);
      await shoot(cdp, d, file, { jpeg: true, scale: 360 / d.width });
      frames.push({ t: Math.round(performance.now() - started), file: path.basename(file) });
    }

    /* Run until the network has been quiet for 3 s, capped at 30 s. */
    const lastChunk = () => (chunks.length ? chunks[chunks.length - 1][0] : 0);
    const inFlight = () => [...requests.values()].some((r) => r.end === null);
    const deadline = started + 30000;
    while (performance.now() < deadline) {
      const last = lastChunk();
      await sleep(500);
      if (loadFired && !inFlight() && lastChunk() === last) {
        await sleep(2500);
        if (lastChunk() === last && !inFlight()) break;
      }
    }

    const page = await cdp.eval(`(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const qa = window.__qa;
      const fcp = qa.fcp || 0;
      const tbt = qa.longtasks.filter(([s]) => s >= fcp).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
      const v = document.querySelector("[data-hero-video]");
      return {
        fcp: qa.fcp, lcp: qa.lcp[qa.lcp.length - 1] || null, cls: qa.cls, tbt,
        longest: Math.max(0, ...qa.longtasks.map(([, d]) => d)),
        longtasks: qa.longtasks.length,
        firstLongtasks: qa.longtasks.slice(0, 12).map(([s, d]) => [Math.round(s), Math.round(d)]),
        dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
        heroLive: qa.heroLive, heroFallback: qa.heroFallback, elements: qa.elements,
        video: v ? { src: v.currentSrc, readyState: v.readyState, paused: v.paused } : null,
        fonts: [...document.fonts].filter((f) => f.status === "loaded").length,
        hover: matchMedia("(hover: hover) and (pointer: fine)").matches,
      };
    })()`);

    const rel = (ts) => (ts && t0 ? Math.round((ts - t0) * 1000) : null);
    const list = [...requests.values()].map((r) => ({
      url: r.url.replace(origin, ""), type: r.type, status: r.status,
      bytes: r.bytes, start: rel(r.start), end: rel(r.end),
    }));
    for (const r of list) if (r.status >= 400) errors.push(`HTTP ${r.status} ${r.url}`);
    const loadMs = rel(loadFired);
    const bytesBy = (ms) => chunks.filter(([ts]) => rel(ts) <= ms).reduce((s, [, b]) => s + b, 0);
    const byType = {};
    for (const r of list) {
      const k = r.type || "Other";
      byType[k] = byType[k] || { n: 0, bytes: 0 };
      byType[k].n += 1;
      byType[k].bytes += r.bytes;
    }
    return {
      device: d.name, viewport: `${d.width}x${d.height}@${d.dpr}x`, net: d.netLabel,
      ...page, loadEvent: loadMs,
      requests: list.length,
      bytesAtLoad: loadMs ? bytesBy(loadMs) : null,
      bytesAt3s: bytesBy(3000),
      bytesAt10s: bytesBy(10000),
      bytesTotal: list.reduce((s, r) => s + r.bytes, 0),
      byType, frames, errors,
      biggest: [...list].sort((a, b) => b.bytes - a.bytes).slice(0, 10),
      waterfall: list.sort((a, b) => (a.start ?? 0) - (b.start ?? 0)),
    };
  } finally {
    await kill();
  }
}

/* ---------------------------------------------------------------- */
/* Display pass                                                      */

async function displayPass(origin, d, dir) {
  const { cdp, kill } = await launchChrome(d.width, d.height);
  const errors = [];
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await emulate(cdp, d);
    cdp.on("Runtime.exceptionThrown", (p) => errors.push(`exception ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
    cdp.on("Network.responseReceived", (p) => { if (p.response.status >= 400) errors.push(`HTTP ${p.response.status} ${p.response.url}`); });

    await cdp.send("Page.navigate", { url: origin + "/" });
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      if ((await cdp.eval("document.readyState")) === "complete") break;
    }
    await cdp.eval("document.fonts.ready.then(() => true)");
    await sleep(1800);

    const stops = [];
    for (const s of STOPS) {
      const y = await cdp.eval(`(() => {
        const s = ${JSON.stringify(s)};
        if (s.top !== undefined) return s.top;
        const el = document.querySelector(s.sel);
        if (!el) return null;
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (s.at === undefined) return Math.max(0, top - 72);
        return top + (el.offsetHeight - window.innerHeight) * s.at;
      })()`);
      if (y === null) {
        stops.push({ name: s.name, missing: true });
        continue;
      }
      await cdp.eval(`window.scrollTo({ top: ${Math.round(y)}, behavior: "instant" }), true`);
      /* Settle reveals, then make whatever is in view real before the shutter. */
      await sleep(700);
      await cdp.eval(`(async () => {
        const imgs = [...document.images].filter((i) => {
          const r = i.getBoundingClientRect();
          return r.bottom > -innerHeight && r.top < innerHeight * 2;
        });
        imgs.forEach((i) => { i.loading = "eager"; });
        await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
        return true;
      })()`);
      if (s.ready) {
        await cdp.eval(`(async () => {
          for (let i = 0; i < 80 && !document.querySelector(${JSON.stringify(s.ready)}); i++) {
            await new Promise((r) => setTimeout(r, 100));
          }
          return true;
        })()`);
      }
      await sleep(900);
      const overflow = await cdp.eval(OVERFLOW);
      const entry = { name: s.name, y: Math.round(y), ...overflow };
      if (!d.noShots) {
        const file = path.join(dir, `${s.name}.png`);
        await shoot(cdp, d, file);
        entry.file = path.basename(file);
      }
      stops.push(entry);
    }
    return { device: d.name, viewport: `${d.width}x${d.height}@${d.dpr}x`, stops, errors };
  } finally {
    await kill();
  }
}

/* ---------------------------------------------------------------- */

const kb = (b) => (b == null ? "-" : `${Math.round(b / 1024)} KB`);
const ms = (v) => (v == null ? "-" : `${Math.round(v)} ms`);

async function main() {
  if (!CHROME) throw new Error("Chrome not found; set CHROME=path/to/chrome.exe");
  const server = await startServer(site);
  const origin = `http://localhost:${server.address().port}`;
  await fsp.rm(outRoot, { recursive: true, force: true });
  await fsp.mkdir(outRoot, { recursive: true });
  const report = { label, origin, load: [], display: [] };
  const pick = (list) => list.filter((d) => !only.length || only.includes(d.name));

  try {
    if (!flag("no-load")) {
      for (const d of pick(DEVICES)) {
        const dir = path.join(outRoot, d.name);
        await fsp.mkdir(dir, { recursive: true });
        process.stdout.write(`load    ${d.name.padEnd(17)}`);
        const r = await loadPass(origin, d, dir);
        report.load.push(r);
        const hero = r.heroLive ?? r.elements?.["hero-poster"] ?? r.heroFallback;
        console.log(
          `FCP ${ms(r.fcp)}  LCP ${ms(r.lcp?.t)}  hero ${ms(hero)}  load ${ms(r.loadEvent)}  ` +
            `TBT ${ms(r.tbt)}  CLS ${r.cls.toFixed(3)}  @load ${kb(r.bytesAtLoad)}  10s ${kb(r.bytesAt10s)}  ` +
            `total ${kb(r.bytesTotal)} / ${r.requests} req`
        );
      }
    }
    if (!flag("no-display")) {
      for (const d of [...pick(DEVICES), ...pick(LAYOUT_ONLY)]) {
        const dir = path.join(outRoot, d.name);
        await fsp.mkdir(dir, { recursive: true });
        process.stdout.write(`display ${d.name.padEnd(17)}`);
        const r = await displayPass(origin, d, dir);
        report.display.push(r);
        const bad = r.stops.filter((s) => s.missing || s.scrollWidth > s.vw || s.offenders?.length);
        console.log(bad.length ? `${bad.length} stop(s) with overflow or missing` : "no overflow");
        for (const s of bad) {
          console.log(`        ${s.name}: ${s.missing ? "selector missing" : `scrollWidth ${s.scrollWidth}/${s.vw}`} ` +
            (s.offenders || []).map((o) => `${o.name}[${o.left}..${o.right}]`).join(" "));
        }
        for (const e of r.errors) console.log(`        ! ${e}`);
      }
    }
  } finally {
    server.close();
    await fsp.writeFile(path.join(outRoot, "report.json"), JSON.stringify(report, null, 2));
    console.log(`report  ${path.relative(repo, path.join(outRoot, "report.json"))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
