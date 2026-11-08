import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { D1Shim } from "../scripts/d1-shim.mjs";
import { ensureSchema, queryFeed, insertItems, mixKey } from "../functions/_lib/db.mjs";

const row = (over = {}) => ({
  url_key: over.url_key ?? "https://a.example/1",
  url: over.url ?? "https://a.example/1",
  title: over.title ?? "A headline",
  title_key: over.title_key ?? `k-${over.url_key ?? "1"}`,
  summary: "",
  image: null,
  source_id: over.source_id ?? "src-a",
  source_name: over.source_name ?? "Source A",
  kind: "news",
  lanes: over.lanes ?? "gaming",
  score: over.score ?? 40,
  published_at: over.published_at ?? "2026-11-08T09:00:00.000Z",
  bucket: over.bucket ?? "2026-11-08T06",
  mix: over.mix ?? mixKey(over.url_key ?? "https://a.example/1"),
  first_seen: "2026-11-08T10:00:00.000Z",
});

test("mixKey_isStableAndSpreads", () => {
  assert.equal(mixKey("https://a.example/1"), mixKey("https://a.example/1"));
  assert.notEqual(mixKey("https://a.example/1"), mixKey("https://a.example/2"));
  assert.match(mixKey("x"), /^[0-9a-f]{8}$/);
});

test("queryFeed_pagesEveryTieExactlyOnce", async () => {
  const db = new D1Shim(":memory:");
  await ensureSchema(db);

  // 40 items, all identical score, inside one block: the worst possible case for
  // cursor paging, and the exact shape that hid items before the tuple cursor.
  const rows = [];
  for (let index = 0; index < 40; index += 1) {
    rows.push(row({ url_key: `https://a.example/${index}`, score: 40 }));
  }
  await insertItems(db, rows);

  const seen = new Set();
  let cursor = null;
  let pages = 0;

  do {
    const page = await queryFeed(db, { cursor, limit: 7 });
    for (const entry of page.items) {
      assert.ok(!seen.has(entry.urlKey), `duplicate ${entry.urlKey}`);
      seen.add(entry.urlKey);
    }
    cursor = page.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);

  assert.equal(seen.size, 40, `paged ${seen.size} of 40`);
  assert.equal(pages, 6); // 5 full pages of 7 plus a tail of 5
  db.close();
});

test("queryFeed_interleavesSourcesOnATie", async () => {
  const db = new D1Shim(":memory:");
  await ensureSchema(db);

  const rows = [];
  for (let index = 0; index < 12; index += 1) {
    rows.push(row({
      url_key: `https://nintendo.example/${index}`,
      source_id: "nl",
      source_name: "Nintendo Life",
      score: 40,
    }));
    rows.push(row({
      url_key: `https://other.example/${index}`,
      source_id: "ot",
      source_name: "Other",
      score: 40,
    }));
  }
  await insertItems(db, rows);

  const page = await queryFeed(db, { limit: 20 });
  // Hashing spreads ties but cannot forbid an occasional run, so the honest
  // assertion is about what anyone actually sees: both publishers must appear in
  // the first six cards. Alphabetical ordering failed exactly that.
  const firstSix = page.items.slice(0, 6).map((entry) => entry.sourceId);
  assert.equal(new Set(firstSix).size, 2, `first six: ${firstSix.join(",")}`);

  const bySource = new Map();
  for (const entry of page.items) bySource.set(entry.sourceId, (bySource.get(entry.sourceId) || 0) + 1);
  const largest = Math.max(...bySource.values());
  assert.ok(largest <= page.items.length * 0.7, `one source took ${largest} of ${page.items.length}`);
  db.close();
});

test("queryFeed_respectsLaneFilter", async () => {
  const db = new D1Shim(":memory:");
  await ensureSchema(db);
  await insertItems(db, [
    row({ url_key: "https://a.example/g", lanes: "gaming" }),
    row({ url_key: "https://a.example/a", lanes: "gaming,anime" }),
    row({ url_key: "https://a.example/m", lanes: "games" }),
  ]);

  const anime = await queryFeed(db, { lanes: ["anime"], limit: 10 });
  assert.equal(anime.items.length, 1);
  assert.equal(anime.items[0].urlKey, "https://a.example/a");

  const games = await queryFeed(db, { lanes: ["games"], limit: 10 });
  assert.equal(games.items.length, 1, "'games' must not match 'gaming'");

  const both = await queryFeed(db, { lanes: ["gaming", "games"], limit: 10 });
  assert.equal(both.items.length, 3);
  db.close();
});

test("insertItems_dedupesOnTitleKey", async () => {
  const db = new D1Shim(":memory:");
  await ensureSchema(db);
  await insertItems(db, [
    row({ url_key: "https://eurogamer.example/x", title_key: "same-story", source_id: "eg" }),
    row({ url_key: "https://kotaku.example/y", title_key: "same-story", source_id: "kt" }),
  ]);
  const page = await queryFeed(db, { limit: 10 });
  assert.equal(page.items.length, 1, "the same story from two outlets is one card");
  db.close();
});

test("insertItems_sameUrlTwiceInOneBatchDoesNotExplode", async () => {
  // Two feeds syndicating the same link used to raise UNIQUE constraint failed and
  // abort the whole ingest: the title gate passed both rows, and the url_key
  // primary key only noticed when the batch was written.
  const db = new D1Shim(":memory:");
  await ensureSchema(db);

  const first = row({ url_key: "https://shared.example/piece", title_key: "title-one", source_id: "a" });
  const second = row({ url_key: "https://shared.example/piece", title_key: "title-two", source_id: "b" });

  const written = await insertItems(db, [first, second]);
  assert.equal(written, 1, "one row survives a duplicate url_key inside a single batch");

  const page = await queryFeed(db, { limit: 10 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].sourceId, "a", "the first (highest-weight) source keeps the story");
  db.close();
});

test("insertItems_duplicateUrlInLaterBatchIsIgnored", async () => {
  const db = new D1Shim(":memory:");
  await ensureSchema(db);

  await insertItems(db, [row({ url_key: "https://shared.example/piece", title_key: "title-one" })]);
  const written = await insertItems(db, [
    row({ url_key: "https://shared.example/piece", title_key: "title-two", source_id: "b" }),
  ]);

  assert.equal(written, 0);
  const page = await queryFeed(db, { limit: 10 });
  assert.equal(page.items.length, 1);
  db.close();
});
