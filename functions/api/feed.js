/**
 * GET /api/feed — the board's only data source.
 *
 * Query: cursor=<publishedAt>[|<urlKey>], limit, lanes, sources, q, minScore
 * The cursor is opaque to clients: they pass back exactly what `nextCursor` gave
 * them. Internally it is a (publishedAt, urlKey) tuple so no item can be skipped
 * when several share a second — which, on a busy news morning, they do.
 */

import { ensureSchema, queryFeed, lastSync, countAll, oldestItem, newestItem } from "../_lib/db.mjs";
import { LANES } from "../_lib/config.mjs";
import { json, apiError } from "../_middleware.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 60;

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseCursor(raw) {
  if (!raw) return null;
  const [bucket, score, mix = "", urlKey = ""] = String(raw).split("|");
  if (!bucket) return null;
  const numeric = Number(score);
  return { bucket, score: Number.isFinite(numeric) ? numeric : 0, mix, urlKey };
}

export { parseCursor };

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return apiError("no-database", "The board has no database bound to it.", 500);

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  const lanes = parseList(url.searchParams.get("lanes")).filter((lane) =>
    LANES.some((entry) => entry.id === lane),
  );
  const sources = parseList(url.searchParams.get("sources"));
  const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
  const minScoreRaw = Number(url.searchParams.get("minScore"));
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0;

  try {
    await ensureSchema(env.DB);

    const [page, syncAt, total, oldest] = await Promise.all([
      queryFeed(env.DB, { cursor: parseCursor(url.searchParams.get("cursor")), limit, lanes, sources, query, minScore }),
      lastSync(env.DB),
      countAll(env.DB),
      oldestItem(env.DB),
    ]);

    const cursor = page.nextCursor
      ? `${page.nextCursor.bucket}|${page.nextCursor.score}|${page.nextCursor.mix}|${page.nextCursor.urlKey}`
      : null;

    return json({
      items: page.items,
      nextCursor: cursor,
      meta: { lastSync: syncAt, total, oldest, lanes: LANES },
    });
  } catch (error) {
    console.error("feed failed", error?.stack ?? error);
    return apiError("feed-failed", "The feed could not be read.", 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return apiError("method-not-allowed", "Use GET.", 405);
}
