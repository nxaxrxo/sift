/**
 * shot.mjs — real screenshots, at real device widths, with nothing on screen.
 *
 * Edge/Chrome clamp a headless window to roughly 496 CSS pixels, so
 * `--window-size=390` silently renders at ~496 and a "mobile" shot is a lie.
 * This drives the browser over the DevTools protocol instead and asks for a
 * 390-pixel viewport directly, which is what a phone actually reports.
 *
 *   node scripts/shot.mjs [url] [outDir]
 *
 * Zero dependencies: Node 22+ ships a global WebSocket, which is all CDP needs.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const TARGET_URL = process.argv[2] || "http://localhost:8788/";
const OUT = resolve(process.argv[3] || join(ROOT, ".dev"));
const PORT = Number(process.env.CDP_PORT || 9333);

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const SHOTS = [
  { name: "desktop", width: 1440, height: 1800, dsf: 1, mobile: false },
  { name: "tablet", width: 820, height: 1400, dsf: 1, mobile: false },
  { name: "mobile", width: 390, height: 1400, dsf: 2, mobile: true },
];

const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) {
  console.error("no Edge or Chrome found");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const child = spawn(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(OUT, "cdp-profile")}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);

async function endpoint() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      /* not listening yet */
    }
    await delay(250);
  }
  throw new Error("browser never opened a debugging port");
}

/** A minimal CDP client: every call may be scoped to a page session. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((done, fail) => {
    socket.addEventListener("open", () => done());
    socket.addEventListener("error", () => fail(new Error("cdp socket failed")));
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = message.id ? pending.get(message.id) : null;
    if (!waiter) return; // an event, not a reply
    pending.delete(message.id);
    if (message.error) waiter.fail(new Error(`${message.error.message} (${waiter.method})`));
    else waiter.done(message.result);
  });

  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((done, fail) => {
      const id = nextId++;
      pending.set(id, { done, fail, method });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });

  return { ready, send, close: () => socket.close() };
}

const cdp = connect(await endpoint());
await cdp.ready;

const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

// Every page call goes through the attached session.
const page = (method, params = {}) => cdp.send(method, params, sessionId);

await page("Page.enable");
await page("Runtime.enable");

const written = [];

for (const shot of SHOTS) {
  await page("Emulation.setDeviceMetricsOverride", {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.dsf,
    mobile: shot.mobile,
  });

  await page("Page.navigate", { url: TARGET_URL });
  // Time for the API to answer, the images to load and lazy work to settle.
  await delay(4500);

  // Read back what the layout actually did, so the picture can be trusted.
  const { result } = await page("Runtime.evaluate", {
    expression: `(() => {
      const board = document.getElementById("cards");
      const cards = board ? [...board.children].filter((n) => n.classList.contains("card")) : [];
      const doc = document.documentElement;
      const clipped = cards.filter((c) => {
        const t = c.querySelector(".card__title");
        if (!t) return false;
        return t.scrollHeight > t.clientHeight + 2 && !c.classList.contains("card--type");
      }).length;
      const broken = cards.filter((c) => {
        const m = c.querySelector(".card__media");
        if (!m) return false;
        const i = m.querySelector(".card__img");
        return !i || !i.complete || i.naturalWidth === 0;
      }).length;
      return JSON.stringify({
        viewport: doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        overflowX: doc.scrollWidth - doc.clientWidth,
        cards: cards.length,
        imageCards: cards.filter((c) => c.querySelector(".card__img")).length,
        typeCards: cards.filter((c) => c.classList.contains("card--type")).length,
        emptyMedia: broken,
        clampedTitles: clipped,
      });
    })()`,
    returnByValue: true,
  });

  const info = JSON.parse(result.value);

  // The viewport, not the whole scroll. A full-page capture at a phone viewport
  // is tens of thousands of pixels tall and, when scaled down to something
  // readable, is a grey thread with no detail in it. The top screen is what
  // needs inspecting, so that is what gets captured.
  const { data } = await page("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const file = join(OUT, `shot-${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));

  written.push({ name: shot.name, file, ...info });
}

console.log(JSON.stringify(written, null, 2));

cdp.close();
child.kill();
process.exit(0);
