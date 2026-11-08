/**
 * ingest.mjs Ã¢â‚¬â€ one pass over every source, start to finish.
 *
 * The contract: never throw. A dead feed, a 500, a timeout, a feed full of
 * garbage Ã¢â‚¬â€ each one is counted and skipped, and the run still finishes so the
 * board keeps its previous state instead of going blank because one outlet
 * rebooted a server.
 */

import { SOURCES } from "./config.mjs";
import { parseFeed, applyFallbackDate } from "./parse.mjs";
import { scoreItem, cardSummary, isStorable, setAnimeTerms } from "./score.mjs";
import { insertItems, promoteMatches, pruneOld, setMeta, getMeta } from "./db.mjs";
import { timeBucket, mixKey } from "./db.mjs";
import { ANIME_TERMS } from "./anime-terms.mjs";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PER_SOURCE = 40; // a feed's older tail is not worth the storage
const STALE_AFTER_MS = 45_000; // do not re-ingest more often than this
const LOCK_TTL_MS = 180_000; // a crashed run must not block forever

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-GB,en;q=0.9",
};

/** Weight first, so the strongest outlet is the one that wins a cross-post tie. */
const ORDERED_SOURCES = [...SOURCES].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1));

async function fetchSource(source, attempt = 0) {
  let response;
  try {
    response = await fetch(source.url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (error) {
    // A transient socket failure is not the feed being dead. One retry turns a
    // bad minute on the network into a small delay instead of a missing source.
    if (attempt < 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return fetchSource(source, 1);
    }
    throw error;
  }

  // Reddit (and a couple of others) answer 429 when several feeds land at once.
  // One quiet retry after a short pause is enough; a second 429 is a real signal
  // that this source wants to be polled less often.
  if (response.status === 429 && attempt === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return fetchSource(source, 1);
  }

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text || text.length < 200) throw new Error("empty body");
  return text;
}

/**
 * Fetch every source, but in small waves rather than all at once.
 *
 * Eighty-two simultaneous connections from one machine exhaust the local socket
 * pool, and the failures arrive as a burst of "fetch failed" on sources that are
 * perfectly healthy — which is exactly what happened when this ran in a single
 * `Promise.allSettled`. Six at a time still finishes a full sweep in seconds and
 * every source keeps its own retry.
 */
async function fetchAll(sources, concurrency = 6) {
  const outcomes = new Array(sources.length);
  let next = 0;

  const worker = async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= sources.length) return;
      try {
        outcomes[index] = { status: "fulfilled", value: await fetchSource(sources[index]) };
      } catch (reason) {
        outcomes[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return outcomes;
}

/**
 * @returns {{items:object[], ok:number, failed:object[], durationMs:number, inserted:number}}
 */
export async function runIngest(db, { force = false, now = new Date() } = {}) {
  const started = Date.now();
  setAnimeTerms(ANIME_TERMS);

  if (!force) {
    const last = Number((await getMeta(db, "last_sync")) || 0);
    if (last && started - last < STALE_AFTER_MS) {
      return { skipped: "fresh", ok: 0, failed: [], inserted: 0, durationMs: 0 };
    }
    const lock = Number((await getMeta(db, "sync_lock")) || 0);
    if (lock && started - lock < LOCK_TTL_MS) {
      return { skipped: "locked", ok: 0, failed: [], inserted: 0, durationMs: 0 };
    }
  }
  await setMeta(db, "sync_lock", started);

  const settled = await fetchAll(ORDERED_SOURCES);
  const failed = [];
  const candidates = [];

  for (const [index, outcome] of settled.entries()) {
    const source = ORDERED_SOURCES[index];
    if (outcome.status === "rejected") {
      failed.push({ id: source.id, error: String(outcome.reason?.message ?? outcome.reason) });
      continue;
    }

    let parsed = [];
    try {
      parsed = parseFeed(outcome.value, { source });
    } catch (error) {
      failed.push({ id: source.id, error: `parse: ${error?.message ?? error}` });
      continue;
    }

    const scored = applyFallbackDate(parsed, now)
      .slice(0, MAX_PER_SOURCE)
      .map((item) => ({ item, result: scoreItem(item, source, now) }))
      .filter(({ result }) => isStorable(result));

    for (const { item, result } of scored) {
      candidates.push({
        url_key: item.urlKey,
        url: item.url,
        title: item.title,
        title_key: item.titleKey,
        summary: cardSummary(item),
        image: item.image,
        source_id: source.id,
        source_name: source.name,
        kind: source.kind,
        lanes: result.lanes.join(","),
        score: result.score,
        published_at: item.publishedAt,
        bucket: timeBucket(item.publishedAt),
        mix: mixKey(item.urlKey),
        first_seen: new Date(now).toISOString(),
      });
    }
  }

  const inserted = await insertItems(db, candidates);
  const promoted = await promoteMatches(db, candidates);
  const pruned = await pruneOld(db, now);

  await setMeta(db, "last_sync", Date.now());
  await setMeta(db, "sync_lock", 0);
  await setMeta(db, "last_run", JSON.stringify({
    at: new Date(now).toISOString(),
    sources: ORDERED_SOURCES.length,
    failed: failed.map((entry) => `${entry.id}: ${entry.error}`),
    inserted,
    promoted,
    pruned,
    durationMs: Date.now() - started,
  }));

  return {
    sources: ORDERED_SOURCES.length,
    ok: ORDERED_SOURCES.length - failed.length,
    failed,
    inserted,
    promoted,
    pruned,
    durationMs: Date.now() - started,
  };
}

export const _internal = { ORDERED_SOURCES, STALE_AFTER_MS, LOCK_TTL_MS };
