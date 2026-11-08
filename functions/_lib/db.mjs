/**
 * db.mjs — the only file that knows SQL.
 *
 * D1 is SQLite over HTTP: every statement is a round trip, so the schema is
 * created once per isolate (cached in a module flag), writes are batched, and
 * reads are shaped to match one index each.
 *
 * The `items` table is the whole product. `meta` holds two things: when we last
 * synced, and a lock so two concurrent ingests cannot fight.
 */

import { RETENTION_DAYS } from "./config.mjs";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS items (
     url_key      TEXT PRIMARY KEY,
     url          TEXT NOT NULL,
     title        TEXT NOT NULL,
     title_key    TEXT NOT NULL,
     summary      TEXT NOT NULL DEFAULT '',
     image        TEXT,
     source_id    TEXT NOT NULL,
     source_name  TEXT NOT NULL,
     kind         TEXT NOT NULL,
     lanes        TEXT NOT NULL,
     score        INTEGER NOT NULL,
     published_at TEXT NOT NULL,
     bucket       TEXT NOT NULL,
     mix          TEXT NOT NULL DEFAULT '',
     first_seen   TEXT NOT NULL
   )`,
  // The board reads "best of this block, then the best of the block before".
  // `mix` sits inside that ordering so equal scores interleave between outlets
  // instead of stacking into a wall of one publisher — see `mixKey` below.
  `CREATE INDEX IF NOT EXISTS idx_items_board ON items(bucket DESC, score DESC, mix ASC, url_key ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_items_pub ON items(published_at DESC, score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_items_title ON items(title_key)`,
  `CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/**
 * A stable, meaningless sort key.
 *
 * The board orders by score inside a time block, and scores collide constantly —
 * every straight-news item from a weight-3 outlet scores exactly 40. Ordering
 * those by url_key meant one outlet's seven Ocarina of Time stories arrived as a
 * solid block. Hashing the URL spreads equal scores evenly between publishers,
 * deterministically: the same story always lands in the same place, so paging
 * never repeats or skips, and the board reads like a moodboard rather than a
 * single feed.
 */
export function mixKey(urlKey) {
  // FNV-1a, 32-bit, then a final avalanche.
  //
  // The avalanche is not decoration. FNV alone is linear in the input's last
  // byte, so two outlets' URLs that differ only in a trailing digit produce two
  // tight bands of hashes — one band entirely above the other — and the ties
  // stack by publisher again, which is the exact thing this key exists to stop.
  // A couple of xor-shifts and multiplies spreads each band across the range.
  const text = String(urlKey || "");
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash ^= hash >>> 16;

  // >>> 0 at the end matters: `^=` on a value above 2^31 yields a signed int, and
  // a negative hex string starts with "-", which would sort before every real key
  // and quietly reintroduce the bucketing this function removes.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The block an item belongs to: a 6-hour window, as ISO `YYYY-MM-DDTHH`.
 *
 * Six hours, not one, and the reason is the whole board. With hour buckets the
 * top of the board is simply "whatever was posted in the last sixty minutes",
 * so the outlet that posts most wins it — r/Games puts up a dozen self-promo
 * posts an hour and buried everything else. Six hours gives the scores room to
 * rank, so the best of the last half-day leads and the block before it follows.
 * Still strictly forward in time, still a moodboard, and it pages the same way.
 */
export function timeBucket(iso) {
  const text = String(iso || "");
  const hour = Number(text.slice(11, 13));
  if (!Number.isFinite(hour)) return text.slice(0, 13);
  const block = String(Math.floor(hour / 6) * 6).padStart(2, "0");
  return `${text.slice(0, 11)}${block}`;
}

/** Databases whose schema has already been created in this isolate. */
const readyDatabases = new WeakSet();

/** Create tables/indexes once per isolate. Safe to call on every request. */
export async function ensureSchema(db) {
  // Tracked per database object, not per module: a module-wide flag would skip
  // the schema for every database after the first, which is invisible in
  // production (one binding) and wrong everywhere else, tests included.
  if (readyDatabases.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  readyDatabases.add(db);
}

/* --------------------------------------------------------------------- meta */

export async function getMeta(db, key) {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

export async function setMeta(db, key, value) {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, String(value))
    .run();
}

export async function lastSync(db) {
  const raw = await getMeta(db, "last_sync");
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) ? value : 0;
}

/* -------------------------------------------------------------------- writes */

const COLUMNS = [
  "url_key", "url", "title", "title_key", "summary", "image", "source_id",
  "source_name", "kind", "lanes", "score", "published_at", "bucket", "mix", "first_seen",
];

/**
 * Insert items, ignoring anything we already have.
 *
 * Three gates, because two was not enough. The primary key (`url_key`) stops the
 * same URL twice; `WHERE NOT EXISTS` on `title_key` stops the same story
 * republished by a second outlet; and the `url_key` EXISTS check is what makes a
 * batch safe.
 *
 * That last one is not redundant. SQLite checks a UNIQUE/PK violation for the
 * whole statement, and inside a single INSERT..SELECT it does not see rows added
 * earlier in the same batch — so two feeds emitting the same link in one run
 * walked past the title gate and blew up the entire ingest with UNIQUE constraint
 * failed. Two of the niche outlets syndicate each other, which is exactly how
 * this surfaced. Because sources are processed highest-weight-first, the better
 * outlet still wins.
 */
function insertStatement(db, item) {
  const values = COLUMNS.map((column) => item[column]);
  const placeholders = COLUMNS.map(() => "?").join(", ");
  return db
    .prepare(
      `INSERT INTO items (${COLUMNS.join(", ")})
       SELECT ${placeholders}
       WHERE NOT EXISTS (SELECT 1 FROM items WHERE title_key = ? OR url_key = ?)`,
    )
    .bind(...values, item.title_key, item.url_key);
}

/** Write in chunks: D1 rejects very large batches, and 40 is comfortably inside. */
export async function insertItems(db, items) {
  if (!items.length) return 0;

  const CHUNK = 40;
  let written = 0;

  for (let index = 0; index < items.length; index += CHUNK) {
    const chunk = items.slice(index, index + CHUNK);
    const results = await db.batch(chunk.map((item) => insertStatement(db, item)));
    for (const result of results) {
      written += Number(result?.meta?.changes ?? 0);
    }
  }
  return written;
}

/**
 * A story a second outlet covers later should not stay buried under the weaker
 * source's score. Only raise, never lower.
 */
export async function promoteMatches(db, items) {
  const upgrades = items.filter((item) => item.score > 0);
  if (!upgrades.length) return 0;

  const CHUNK = 40;
  let changed = 0;

  for (let index = 0; index < upgrades.length; index += CHUNK) {
    const chunk = upgrades.slice(index, index + CHUNK);
    const results = await db.batch(
      chunk.map((item) =>
        db
          .prepare("UPDATE items SET score = ? WHERE title_key = ? AND score < ?")
          .bind(item.score, item.title_key, item.score),
      ),
    );
    for (const result of results) changed += Number(result?.meta?.changes ?? 0);
  }
  return changed;
}

/** Drop anything past retention. One bounded pass per ingest keeps the write small. */
export async function pruneOld(db, now = new Date(), limit = 500) {
  const cutoff = new Date(new Date(now).getTime() - RETENTION_DAYS * 86_400_000).toISOString();
  // DELETE ... LIMIT is an optional SQLite compile flag; D1 and stock SQLite both
  // reject it. A keyed subquery is the portable form and uses the same index.
  const result = await db
    .prepare(
      `DELETE FROM items WHERE url_key IN (
         SELECT url_key FROM items WHERE published_at < ? ORDER BY published_at LIMIT ?
       )`,
    )
    .bind(cutoff, limit)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

/* --------------------------------------------------------------------- reads */

function toApiItem(row) {
  return {
    urlKey: row.url_key,
    url: row.url,
    title: row.title,
    summary: row.summary,
    image: row.image,
    sourceId: row.source_id,
    sourceName: row.source_name,
    kind: row.kind,
    lanes: row.lanes ? row.lanes.split(",").filter(Boolean) : [],
    score: row.score,
    publishedAt: row.published_at,
    // The board's own ordering key, sent to the client so the "new" pill compares
    // exactly what the database sorts on instead of re-deriving it and drifting.
    bucket: row.bucket,
    firstSeen: row.first_seen,
  };
}/**
 * The board's ordering is (bucket, score, mix): the best of this six-hour block
 * first, then the best of the block before, and so on back through time. That is
 * what makes it a moodboard rather than a wire — you see today's important things
 * before yesterday's routine ones, and scrolling back walks the archive in steps.
 *
 * The cursor is the full sort tuple (bucket, score, mix, url_key). Paging on a
 * prefix of the ordering would silently drop the tail of every tie, and ties are
 * constant: 191 items sit on exactly 40.
 */
export async function queryFeed(db, { cursor, limit = 30, lanes = [], sources = [], query = "", minScore = 0 }) {
  const clauses = ["score >= ?"];
  const params = [minScore];

  if (cursor?.bucket) {
    const bucket = cursor.bucket;
    const score = cursor.score ?? 0;
    const mix = cursor.mix || "";
    clauses.push(
      "(bucket < ? OR (bucket = ? AND (score < ? OR (score = ? AND (mix > ? OR (mix = ? AND url_key > ?))))))",
    );
    params.push(bucket, bucket, score, score, mix, mix, cursor.urlKey || "");
  }
  if (sources.length) {
    clauses.push(`source_id IN (${sources.map(() => "?").join(", ")})`);
    params.push(...sources);
  }
  if (lanes.length) {
    // Lanes are OR-ed: "gaming,anime" means either, never both. AND-ing them made
    // every multi-lane filter return an empty board. The delimiters keep 'games'
    // from matching 'gaming'.
    clauses.push(`(${lanes.map(() => "(',' || lanes || ',') LIKE ?").join(" OR ")})`);
    for (const lane of lanes) params.push(`%,${lane},%`);
  }
  if (query) {
    clauses.push("(title LIKE ? OR summary LIKE ?)");
    const like = `%${query}%`;
    params.push(like, like);
  }

  const take = Math.min(Number(limit) || 30, 60);
  const sql =
    `SELECT * FROM items WHERE ${clauses.join(" AND ")} ` +
    "ORDER BY bucket DESC, score DESC, mix ASC, url_key ASC LIMIT ?";

  const { results } = await db
    .prepare(sql)
    .bind(...params, take + 1)
    .all();

  const rows = results ?? [];
  const trimmed = rows.slice(0, take);
  const hasMore = rows.length > trimmed.length;
  const last = trimmed[trimmed.length - 1];

  return {
    items: trimmed.map(toApiItem),
    nextCursor: hasMore && last
      ? { bucket: last.bucket, score: last.score, mix: last.mix, urlKey: last.url_key }
      : null,
  };
}

export async function countAll(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM items").first();
  return Number(row?.n ?? 0);
}

export async function oldestItem(db) {
  const row = await db.prepare("SELECT MIN(published_at) AS oldest FROM items").first();
  return row?.oldest ?? null;
}

export async function laneCounts(db) {
  const row = await db.prepare("SELECT lanes FROM items").all();
  const counts = {};
  for (const entry of row.results ?? []) {
    for (const lane of String(entry.lanes || "").split(",")) {
      if (!lane) continue;
      counts[lane] = (counts[lane] ?? 0) + 1;
    }
  }
  return counts;
}

export async function sourceCounts(db) {
  const { results } = await db
    .prepare(
      `SELECT source_id, source_name, COUNT(*) AS n, MAX(published_at) AS newest
       FROM items GROUP BY source_id ORDER BY n DESC`,
    )
    .all();
  return (results ?? []).map((row) => ({
    id: row.source_id,
    name: row.source_name,
    count: Number(row.n),
    newest: row.newest,
  }));
}

export async function newestItem(db) {
  const row = await db.prepare("SELECT url_key, published_at FROM items ORDER BY published_at DESC LIMIT 1").first();
  return row ? { urlKey: row.url_key, publishedAt: row.published_at } : null;
}

/** The best-scoring item in the newest hour — what the "N new" pill counts from. */
export async function newestBoardCursor(db) {
  const row = await db
    .prepare("SELECT bucket, score, url_key FROM items ORDER BY bucket DESC, score DESC, url_key DESC LIMIT 1")
    .first();
  return row ? { bucket: row.bucket, score: row.score, urlKey: row.url_key } : null;
}
