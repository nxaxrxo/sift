/**
 * preview.mjs — serve the built site locally, with nothing on screen.
 *
 *   node scripts/preview.mjs start   # detached, hidden, port 8788
 *   node scripts/preview.mjs status
 *   node scripts/preview.mjs stop
 *   node scripts/preview.mjs shot    # real screenshots via shot.mjs
 *
 * It serves `dist/`, because that is exactly what GitHub Pages serves — a preview
 * of anything else would be a preview of a site that does not exist. Run
 * `npm run build` first (or `npm run publish`).
 *
 * Why a script and not a shell one-liner: a file server never exits, so it must
 * never run in the foreground — it would hold the only lane of whoever started it.
 * Everything here is spawned detached, with a hidden window and a pid file.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, extname, normalize } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const DEV = join(ROOT, ".dev");
const PID_FILE = join(DEV, "preview.pid");
const LOG_FILE = join(DEV, "preview.log");
const PORT = Number(process.env.PREVIEW_PORT || 8788);

const isWindows = process.platform === "win32";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function ensureDev() {
  mkdirSync(DEV, { recursive: true });
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function reachable(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  return false;
}

/**
 * The server itself. It runs inside the detached child (see `serve`), and it is
 * deliberately dumb: files only, no API, because there is no API any more.
 */
function createStaticServer() {
  return createServer(async (request, response) => {
    const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
    const file = normalize(join(DIST, relative));

    // Never serve a byte outside dist/, whatever the request asks for.
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
}

/** Entry point for the detached child: serve, log, and stay out of the way. */
function serve() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("dist/ is missing — run `npm run build` first");
    process.exit(1);
  }
  createStaticServer().listen(PORT, "127.0.0.1", () => {
    console.log(`serving ${DIST} on http://localhost:${PORT}`);
  });
}

function start() {
  ensureDev();
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`already running (pid ${existing}) on http://localhost:${PORT}`);
    return;
  }

  const out = openSync(LOG_FILE, "w");
  const child = spawn(process.execPath, [import.meta.filename, "serve"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
  });
  child.unref();

  writeFileSync(PID_FILE, String(child.pid), "utf8");
  console.log(`started pid ${child.pid}, log ${LOG_FILE}`);
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log("not running");
    return;
  }
  try {
    if (isWindows) spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch (error) {
    console.log(`could not stop ${pid}: ${error.message}`);
  }
  rmSync(PID_FILE, { force: true });
  console.log(`stopped ${pid}`);
}

async function status() {
  const pid = readPid();
  const alive = Boolean(pid && isAlive(pid));
  const up = await reachable(`http://localhost:${PORT}/`, 2);
  console.log(`pid ${pid ?? "—"} alive=${alive} site=${up ? "up" : "down"} port=${PORT}`);
}

/**
 * Screenshots go through shot.mjs, which drives a real 1440 / 820 / 390 viewport
 * over the DevTools protocol. A headless `--window-size` is not trustworthy here:
 * both Edge and Chrome clamp it near 496px, so a "390" capture renders at 496.
 */
async function shot() {
  await new Promise((done) => {
    const child = spawn(process.execPath, [join(ROOT, "scripts", "shot.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", done);
    child.on("error", done);
  });
}

const command = process.argv[2] || "status";

if (command === "start") {
  start();
  const up = await reachable(`http://localhost:${PORT}/`);
  console.log(up ? `ready on http://localhost:${PORT}` : "did not come up — check .dev/preview.log");
} else if (command === "serve") {
  serve();
} else if (command === "stop") {
  stop();
} else if (command === "shot") {
  await shot();
} else {
  await status();
}
