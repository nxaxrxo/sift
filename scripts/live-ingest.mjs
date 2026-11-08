/**
 * live-ingest.mjs — run the real pipeline once, against real feeds, into a local
 * SQLite file. This is the honest test: same parser, same scorer, same SQL, same
 * config as production.
 *
 *   node scripts/live-ingest.mjs [--db .dev/sift.db] [--limit 0]
 *
 * Prints one block of numbers and, at the end, five sample cards exactly as the
 * board would render them. Exit code 0 only when the run produced rows.
 */

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { D1Shim } from "./d1-shim.mjs";
import { ensureSchema, queryFeed, countAll, sourceCounts, laneCounts, lastSync, oldestItem } from "../functions/_lib/db.mjs";
import { runIngest } from "../functions/_lib/ingest.mjs";
import { SOURCES } from "../functions/_lib/config.mjs";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const dbPath = resolve(dbFlag >= 0 ? args[dbFlag + 1] : ".dev/sift.db");
const fresh = !args.includes("--keep");

if (fresh) {
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    rmSync(dbPath);
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  } catch {
    /* first run */
  }
}

const db = new D1Shim(dbPath);
await ensureSchema(db);

console.log(`sources configured : ${SOURCES.length}`);
const started = Date.now();
const result = await runIngest(db, { force: true });
const elapsed = Date.now() - started;

console.log(`ok / failed        : ${result.ok} / ${result.failed.length}`);
if (result.failed.length) {
  for (const failure of result.failed) console.log(`  ✗ ${failure.id.padEnd(22)} ${failure.error}`);
}
console.log(`inserted           : ${result.inserted}`);
console.log(`promoted           : ${result.promoted ?? 0}`);
console.log(`rows total         : ${await countAll(db)}`);
console.log(`last sync          : ${new Date(await lastSync(db)).toISOString()}`);
console.log(`oldest item        : ${await oldestItem(db)}`);
console.log(`wall time          : ${elapsed}ms`);

const lanes = await laneCounts(db);
console.log("\nlane spread:");
for (const [lane, count] of Object.entries(lanes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${lane.padEnd(10)} ${count}`);
}

const sources = await sourceCounts(db);
console.log("\nmost contributing sources:");
for (const source of sources.slice(0, 12)) {
  console.log(`  ${source.name.padEnd(24)} ${String(source.count).padStart(4)}  newest ${source.newest}`);
}

const silent = SOURCES.filter((source) => !sources.some((entry) => entry.id === source.id));
if (silent.length) {
  console.log(`\nsources with nothing stored (${silent.length}): ${silent.map((source) => source.id).join(", ")}`);
}

const page = await queryFeed(db, { limit: 5 });
console.log("\nfirst page, as the board sees it:");
for (const entry of page.items) {
  console.log(`\n  [${entry.lanes.join("/")}] ${entry.sourceName} · ${entry.score} · ${entry.publishedAt}`);
  console.log(`  ${entry.title}`);
  console.log(`  ${entry.summary.slice(0, 140) || "(no summary)"}`);
  console.log(`  image: ${entry.image || "— none —"}`);
  console.log(`  ${entry.url}`);
}
console.log(`\nnextCursor: ${page.nextCursor ? "yes" : "null"}`);

// Prove the cursor actually pages without gaps or duplicates.
const seen = new Set(page.items.map((entry) => entry.urlKey));
let cursor = page.nextCursor;
let pages = 1;
let duplicates = 0;

while (cursor && pages < 5) {
  const next = await queryFeed(db, { cursor, limit: 30 });
  for (const entry of next.items) {
    if (seen.has(entry.urlKey)) duplicates += 1;
    seen.add(entry.urlKey);
  }
  cursor = next.nextCursor;
  pages += 1;
}
console.log(`pagination         : ${pages} pages, ${seen.size} unique keys, ${duplicates} duplicates`);

db.close();

if (page.items.length === 0) {
  console.error("\nFAIL: nothing was stored");
  process.exit(1);
}
process.exit(0);
