/**
 * purge-language.mjs — remove non-English stories from an existing database.
 *
 * Two things make this necessary rather than tidy:
 *
 *   1. Config no longer lists the non-English editions (32 feeds), but ingest
 *      only ever INSERTs. Every story they already contributed is still sitting
 *      in the table, and it would stay there for the full retention window.
 *   2. An English feed can syndicate the odd foreign item. The scorer now drops
 *      those at ingest, but again only for new items.
 *
 * So this walks what is already stored and deletes what the current rules would
 * never have admitted. `--dry` reports without touching anything.
 */
import { D1Shim } from "./d1-shim.mjs";
import { SOURCES } from "../functions/_lib/config.mjs";
import { isEnglishText } from "../functions/_lib/score.mjs";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const dbPath = args.includes("--db") ? args[args.indexOf("--db") + 1] : ".dev/sift.db";

const liveSources = new Set(SOURCES.map((source) => source.id));

const db = new D1Shim(dbPath);
const page = await db.prepare("SELECT url_key, source_id, title, summary FROM items").all();

let scanned = 0;
let goneSource = 0;
let foreign = 0;
const deleted = [];

for (const row of page.results) {
  scanned += 1;

  let reason = null;
  if (!liveSources.has(row.source_id)) reason = "source-removed";
  else if (!isEnglishText(`${row.title} ${row.summary || ""}`)) reason = "not-english";

  if (!reason) continue;
  if (reason === "source-removed") goneSource += 1;
  else foreign += 1;
  deleted.push({ urlKey: row.url_key, reason, title: row.title });
}

if (!dry) {
  for (const entry of deleted) {
    await db.prepare("DELETE FROM items WHERE url_key = ?").bind(entry.urlKey).run();
  }
}

console.log(`${dry ? "DRY RUN — nothing deleted" : "purged"}`);
console.log(`rows scanned          : ${scanned}`);
console.log(`source no longer listed: ${goneSource}`);
console.log(`not English            : ${foreign}`);
console.log(`total to remove        : ${deleted.length}`);

const left = await db.prepare("SELECT COUNT(*) AS n FROM items").first();
console.log(`rows remaining         : ${left.n}`);
db.close();
process.exitCode = 0;
