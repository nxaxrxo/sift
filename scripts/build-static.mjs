/**
 * build-static.mjs — turn the database into a folder of plain files.
 *
 * Production runs this in GitHub Actions. GitHub Pages serves the result. There is
 * no server, no database at the edge, and no secret anywhere: the whole board is
 * files.
 *
 * Why not just page through SQL in the browser? Because SQLite does not run in a
 * browser without shipping a 1 MB wasm build, and the ordering that makes the board
 * feel right (bucket, score, hashed mix) is one line of SQL. So the SQL runs here,
 * once, and the browser receives the answer it would have received anyway.
 *
 * Output (into --out, default `dist`):
 *   index.html, assets/*        the site itself
 *   api/board.json              the entire board, already in board order
 *   api/stats.json              counts, sources, last sync
 *
 * The client pages through board.json by index, which gives the same infinite
 * scroll it had against the live API: 30 cards at a time, no gaps, no duplicates,
 * because the array is ordered once and never re-sorted.
 *
 *   node scripts/build-static.mjs [--db .dev/sift.db] [--out dist]
 */

import { mkdir, cp, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { D1Shim } from "./d1-shim.mjs";
import { SOURCES } from "../functions/_lib/config.mjs";
import { ensureSchema, countAll, laneCounts, sourceCounts, lastSync, oldestItem, newestItem, getMeta } from "../functions/_lib/db.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dbPath = resolve(root, flag("db", ".dev/sift.db"));
const outDir = resolve(root, flag("out", "dist"));
const publicDir = resolve(root, "public");

/**
 * The one query that defines the board. Kept as SQL against the same schema the
 * live API uses, so "what the page shows" and "what the API would have shown"
 * can never drift into two different orders.
 */
function boardQuery(minScore) {
  return {
    sql: `SELECT * FROM items WHERE score >= ? ORDER BY bucket DESC, score DESC, mix ASC, url_key ASC`,
    params: [minScore],
  };
}

function toApiItem(row) {
  return {
    urlKey: row.url_key,
    url: row.url,
    title: row.title,
    titleKey: row.title_key,
    summary: row.summary,
    image: row.image,
    sourceId: row.source_id,
    sourceName: row.source_name,
    kind: row.kind,
    lanes: row.lanes ? row.lanes.split(",").filter(Boolean) : [],
    score: row.score,
    publishedAt: row.published_at,
    bucket: row.bucket,
    mix: row.mix,
    firstSeen: row.first_seen,
  };
}

async function main() {
  const db = new D1Shim(dbPath);
  await ensureSchema(db);

  const { sql, params } = boardQuery(0);
  const { results } = await db.prepare(sql).bind(...params).all();
  const items = (results ?? []).map(toApiItem);

  const [total, lanes, sources, syncAt, oldest, newest, lastRunRaw] = await Promise.all([
    countAll(db),
    laneCounts(db),
    sourceCounts(db),
    lastSync(db),
    oldestItem(db),
    newestItem(db),
    getMeta(db, "last_run"),
  ]);

  const known = new Set(sources.map((entry) => entry.id));
  const silent = SOURCES.filter((entry) => !known.has(entry.id)).map((entry) => entry.id);

  let lastRun = null;
  if (lastRunRaw) {
    try {
      lastRun = JSON.parse(lastRunRaw);
    } catch {
      lastRun = { raw: lastRunRaw };
    }
  }

  const board = {
    generatedAt: new Date().toISOString(),
    items,
    meta: {
      total: items.length,
      lastSync: syncAt,
      oldest,
      newest,
      lanes,
    },
  };

  const stats = {
    total,
    perLane: lanes,
    perSource: sources,
    silentSources: silent,
    configuredSources: SOURCES.length,
    lastSync: syncAt,
    lastRun,
    oldest,
    newest,
  };

  // Rebuild the output folder from scratch: a stale file from a previous build is
  // a bug that only shows up in production, weeks later.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(publicDir, outDir, { recursive: true });

  await mkdir(resolve(outDir, "api"), { recursive: true });
  await writeFile(resolve(outDir, "api/board.json"), JSON.stringify(board), "utf8");
  await writeFile(resolve(outDir, "api/stats.json"), JSON.stringify(stats), "utf8");

  const bytes = JSON.stringify(board).length;
  console.log(`board: ${items.length} items, ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`oldest: ${oldest ?? "—"}  newest: ${newest?.publishedAt ?? "—"}`);
  console.log(`lanes: ${Object.keys(lanes).length}  sources: ${sources.length}`);
  console.log(`out: ${outDir}`);

  if (!items.length) throw new Error("Refusing to publish an empty board.");
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
