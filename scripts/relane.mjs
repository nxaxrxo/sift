/**
 * One-off repair: re-derive lanes for sources that are laned by content.
 *
 * When Hacker News was declared ["gamedev","ai"], every one of its items inherited
 * both lanes no matter the subject — a maths puzzle sat in the AI lane. The config
 * is fixed, but the rows already in the database carry the old lane string, and
 * ingest only inserts new items. This re-scores exactly those rows and rewrites
 * their lanes. Nothing else is touched.
 */
import { D1Shim } from "./d1-shim.mjs";
import { SOURCES } from "../functions/_lib/config.mjs";
import { scoreItem } from "../functions/_lib/score.mjs";

const dbPath = process.argv.includes("--db")
  ? process.argv[process.argv.indexOf("--db") + 1]
  : ".dev/sift.db";

const byId = new Map(SOURCES.map((s) => [s.id, s]));
const lanedByContent = SOURCES.filter((s) => s.lanedByContent === true);

if (!lanedByContent.length) {
  console.log("no content-laned sources configured; nothing to do");
  process.exit(0);
}

const db = new D1Shim(dbPath);
let scanned = 0;
let changed = 0;
let dropped = 0;

for (const source of lanedByContent) {
  const page = await db
    .prepare("SELECT url_key, url, title, summary, lanes FROM items WHERE source_id = ?")
    .bind(source.id)
    .all();

  for (const row of page.results) {
    scanned += 1;
    const result = scoreItem(
      { title: row.title, summary: row.summary, url: row.url, publishedAt: null },
      source,
      new Date(),
    );

    // An item that matches no lane keeps an empty lane string: it still belongs on
    // the unfiltered board (it is a real Hacker News story), it just never appears
    // inside a lane view. Deleting it would only mean the next ingest fetched it
    // again, so this rewrites rather than removes.
    const next = result.lanes.join(",");
    if (next !== row.lanes) {
      await db.prepare("UPDATE items SET lanes = ? WHERE url_key = ?").bind(next, row.url_key).run();
      changed += 1;
      if (!next) dropped += 1;
    }
  }
}

console.log(`content-laned sources : ${lanedByContent.map((s) => s.id).join(", ")}`);
console.log(`rows scanned          : ${scanned}`);
console.log(`lanes rewritten       : ${changed}`);
console.log(`rows dropped          : ${dropped}`);
db.close();
process.exitCode = 0;
