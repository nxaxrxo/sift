/**
 * brief.mjs — the fast path from "what's new?" to an answer.
 *
 * This is the tool *I* use. When he asks for the latest interesting news, the
 * expensive way is to browse the web; this reads the board I already maintain and
 * prints a ranked brief in one call. No model, no fetching, no tokens spent on
 * discovery — the ranking was decided when the board was built.
 *
 * Deliberately readable as plain text: a brief is meant to be skimmed, and the
 * output is cheap because it is the answer rather than a page to interpret.
 *
 *   node scripts/brief.mjs                       # top 15 overall
 *   node scripts/brief.mjs --lane anime           # one lane
 *   node scripts/brief.mjs --q godot              # search titles + summaries
 *   node scripts/brief.mjs --hours 24 --top 20    # only the last day
 *   node scripts/brief.mjs --source pcgamer       # one outlet
 *   node scripts/brief.mjs --json                 # machine-readable
 *   node scripts/brief.mjs --local                # read dist/ instead of the live site
 *
 * Defaults to the published board, so it answers with exactly what the site shows.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const LIVE = "https://nxaxrxo.github.io/sift/api/board.json";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const lane = flag("lane", "").toLowerCase();
const query = flag("q", "").toLowerCase();
const source = flag("source", "").toLowerCase();
const hours = Number(flag("hours", "0"));
const top = Number(flag("top", "15"));
const asJson = has("json");

async function loadBoard() {
  const local = resolve(root, "dist/api/board.json");
  if (has("local")) {
    return JSON.parse(await readFile(local, "utf8"));
  }
  try {
    const response = await fetch(LIVE, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    // A published board that is briefly unreachable should not break a brief:
    // the local build is the same data, one run behind at worst.
    console.error(`(live board unavailable: ${error.message} — using local build)`);
    return JSON.parse(await readFile(local, "utf8"));
  }
}

function matches(item) {
  if (lane && !item.lanes.includes(lane)) return false;
  if (source && !item.sourceId.includes(source) && !item.sourceName.toLowerCase().includes(source)) {
    return false;
  }
  if (query) {
    const haystack = `${item.title} ${item.summary || ""}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (hours > 0) {
    const age = Date.now() - new Date(item.publishedAt).getTime();
    if (age > hours * 3600_000) return false;
  }
  return true;
}

function relative(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hrs = Math.round(minutes / 60);
  if (hrs < 36) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function clean(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function main() {
  const board = await loadBoard();
  const items = (board.items || []).filter(matches).slice(0, top);

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: board.generatedAt, count: items.length, items }, null, 2));
    return;
  }

  const filterLabel = [
    lane && `lane=${lane}`,
    query && `q="${query}"`,
    source && `source=${source}`,
    hours && `last ${hours}h`,
  ].filter(Boolean).join("  ");

  console.log(
    `SIFT — ${items.length} ${items.length === 1 ? "story" : "stories"}` +
      (filterLabel ? `  [${filterLabel}]` : "") +
      `\nboard built ${relative(board.generatedAt)}\n`,
  );

  if (!items.length) {
    console.log("nothing matched. try a broader filter, or --hours 0");
    return;
  }

  items.forEach((item, index) => {
    const meta = [item.sourceName, relative(item.publishedAt), item.lanes.join("/")].filter(Boolean).join(" · ");
    console.log(`${String(index + 1).padStart(2)}. [${item.score}] ${clean(item.title, 110)}`);
    console.log(`    ${meta}`);
    if (item.summary) console.log(`    ${clean(item.summary, 180)}`);
    console.log(`    ${item.url}\n`);
  });
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
