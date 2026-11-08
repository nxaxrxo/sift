/**
 * preview.mjs — the local loop, with nothing on screen.
 *
 *   node scripts/preview.mjs start   # detached, hidden, port 8788
 *   node scripts/preview.mjs status
 *   node scripts/preview.mjs stop
 *   node scripts/preview.mjs shot [path]   # headless screenshot of the running site
 *
 * Why a script and not a shell one-liner: `wrangler pages dev` never exits, so it
 * must never be run in the foreground — it would hold the only lane of whoever
 * started it. Everything here is spawned with `detached` + hidden windows.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
const DEV = join(ROOT, ".dev");
const PID_FILE = join(DEV, "preview.pid");
const LOG_FILE = join(DEV, "preview.log");
const PORT = Number(process.env.PREVIEW_PORT || 8788);

const isWindows = process.platform === "win32";

function ensureDev() {
  mkdirSync(DEV, { recursive: true });
}

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  const pid = Number(raw);
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

function start() {
  ensureDev();
  const existing = readPid();
  if (existing && isAlive(existing)) {
    console.log(`already running (pid ${existing}) on http://localhost:${PORT}`);
    return;
  }

  const out = openSync(LOG_FILE, "w");
  const command = isWindows ? "npx.cmd" : "npx";
  const child = spawn(
    command,
    ["wrangler", "pages", "dev", "public", "--port", String(PORT), "--d1", "DB=sift-db", "--persist-to", ".dev/d1"],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
      shell: isWindows,
    },
  );
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
  const up = await reachable(`http://localhost:${PORT}/api/stats`, 2);
  console.log(`pid ${pid ?? "—"} alive=${alive} api=${up ? "up" : "down"} port=${PORT}`);
}

/**
 * Screenshot through the installed Edge/Chrome in headless mode. No dependencies,
 * no window, and the cursor is never touched.
 */
async function shot(target = ROOT) {
  ensureDev();
  const name = `shot-${Date.now()}.png`;
  const file = join(DEV, name);
  const url = `http://localhost:${PORT}/`;
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  const browser = candidates.find((path) => existsSync(path));
  if (!browser) {
    console.error("no headless browser found");
    process.exit(1);
  }

  const widths = [
    ["desktop", 1440, 2000],
    ["mobile", 420, 1600],
  ];
  const results = [];

  for (const [label, width, height] of widths) {
    const out = file.replace(".png", `-${label}.png`);
    await new Promise((done) => {
      const child = spawn(
        browser,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          `--window-size=${width},${height}`,
          `--screenshot=${out}`,
          "--virtual-time-budget=9000",
          url,
        ],
        { windowsHide: true, stdio: "ignore", detached: false },
      );
      child.on("exit", done);
      child.on("error", done);
    });
    results.push(out);
  }
  console.log(results.join("\n"));
}

const command = process.argv[2] || "status";

if (command === "start") {
  start();
  const up = await reachable(`http://localhost:${PORT}/api/stats`);
  console.log(up ? `ready on http://localhost:${PORT}` : "did not come up — check .dev/preview.log");
} else if (command === "stop") {
  stop();
} else if (command === "shot") {
  await shot();
} else {
  await status();
}
