/**
 * seed.mjs — rebuild a database from the published board file.
 *
 * The scheduled build runs on a fresh GitHub runner with an empty disk. Without
 * this, every run would re-ingest only the newest 30-ish items per feed and the
 * board would silently restart from nothing each time — the archive would never
 * grow past whatever one run happened to fetch.
 *
 * So the pipeline is: seed from the live board.json, then ingest on top of it,
 * then publish. History accumulates because each run starts from the last
 * published state.
 *
 * The source defaults to the published site, not a local file: the runner has no
 * checkout of `dist/`, and committing a 900 KB board to `main` every 15 minutes
 * would bloat the repository for no benefit. The live URL is always the current
 * truth.
 *
 * The board file carries every column the ingest needs, including title_key and
 * mix, which is why the export keeps them: reconstructing those from scratch
 * would mean re-deriving the dedupe and ordering rules in a second place, and
 * two implementations of one rule always drift.
 *
 *   node scripts/seed.mjs [--from <url|path>] [--db .dev/sift.db] [--quiet-if-empty]
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { D1Shim } from "./d1-shim.mjs";
import { ensureSchema } from "../functions/_lib/db.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const DEFAULT_SOURCE = "https://nxaxrxo.github.io/sift/api/board.json";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const source = flag("from", DEFAULT_SOURCE);
const dbPath = resolve(root, flag("db", ".dev/sift.db"));

async function readBoard() {
  if (/^https?:\/\//i.test(source)) {
    try {
      const response = await fetch(source, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        console.log(`seed source returned ${response.status} — starting empty`);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.log(`seed source unreachable (${error.message}) — starting empty`);
      return null;
    }
  }
  try {
    return JSON.parse(await readFile(resolve(root, source), "utf8"));
  } catch {
    console.log(`no board file at ${source} — starting from an empty database`);
    return null;
  }
}

const COLUMNS = [
  "url_key", "url", "title", "title_key", "summary", "image",
  "source_id", "source_name", "kind", "lanes", "score",
  "published_at", "bucket", "mix", "first_seen",
];

async function main() {
  const board = await readBoard();
  if (!board) return;

  const items = board.items || [];
  if (!items.length) {
    console.log("board file is empty — nothing to seed");
    return;
  }

  const db = new D1Shim(dbPath);
  await ensureSchema(db);

  const placeholders = COLUMNS.map(() => "?").join(", ");
  const sql =
    `INSERT OR IGNORE INTO items (${COLUMNS.join(", ")}) VALUES (${placeholders})`;
  const statement = db.prepare(sql);

  let seeded = 0;
  for (const item of items) {
    const values = [
      item.urlKey,
      item.url,
      item.title,
      item.titleKey,
      item.summary ?? "",
      item.image ?? "",
      item.sourceId,
      item.sourceName,
      item.kind,
      Array.isArray(item.lanes) ? item.lanes.join(",") : (item.lanes || ""),
      item.score,
      item.publishedAt,
      item.bucket,
      item.mix,
      item.firstSeen,
    ];
    const result = await statement.bind(...values).run();
    seeded += result?.meta?.changes ?? 0;
  }

  console.log(`seeded ${seeded}/${items.length} items from ${source}`);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
