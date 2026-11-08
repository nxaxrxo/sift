/**
 * /api/sync — ask the board to go and look.
 *
 * GET is what the page and a cron pinger use; POST is what a script uses. Both do
 * the same thing: if the last ingest is older than the staleness window, kick one
 * off in the background and answer immediately. The request never waits for 60
 * feeds to come back.
 *
 * Failure is soft on purpose: if a sync cannot start, the board still serves what
 * it has. `{ queued: false }` is a normal answer, not an error.
 */

import { ensureSchema, lastSync, getMeta, newestItem } from "../_lib/db.mjs";
import { runIngest } from "../_lib/ingest.mjs";
import { SOURCES } from "../_lib/config.mjs";
import { json, apiError } from "../_middleware.js";

const STALE_AFTER_MS = 45_000;

async function handle(context) {
  const { env, waitUntil } = context;
  if (!env.DB) return apiError("no-database", "The board has no database bound to it.", 500);

  try {
    await ensureSchema(env.DB);

    const now = Date.now();
    const last = await lastSync(env.DB);
    const lockRaw = Number((await getMeta(env.DB, "sync_lock")) || 0);
    const locked = Boolean(lockRaw) && now - lockRaw < 180_000;
    const fresh = Boolean(last) && now - last < STALE_AFTER_MS;

    if (locked) {
      return json({ queued: false, running: true, lastSync: last, reason: "locked" });
    }
    if (fresh) {
      return json({ queued: false, running: false, lastSync: last, reason: "fresh" });
    }

    // Mark the lock here as well: two racers can both pass the checks above before
    // the background job writes its own lock, and this closes that gap.
    await env.DB.prepare(
      "INSERT INTO meta (key, value) VALUES ('sync_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
      .bind(String(now))
      .run();

    const work = runIngest(env.DB, { force: true }).catch((error) => {
      console.error("sync failed", error?.stack ?? error);
    });

    if (typeof waitUntil === "function") {
      waitUntil(work);
      return json({ queued: true, running: true, lastSync: last, sources: SOURCES.length });
    }

    // No waitUntil (some local dev hosts): do it inline so the feature still works,
    // and cap the wait so a slow source list cannot hang the request forever.
    const result = await Promise.race([work, new Promise((resolve) => setTimeout(() => resolve(null), 25_000))]);
    const newest = await newestItem(env.DB);
    return json({ queued: false, running: false, lastSync: await lastSync(env.DB), result, newest });
  } catch (error) {
    console.error("sync endpoint failed", error?.stack ?? error);
    return apiError("sync-failed", "The sync could not be started.", 500);
  }
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}

export async function onRequest(context) {
  const method = context.request.method;
  if (method === "GET" || method === "POST") return handle(context);
  return apiError("method-not-allowed", "Use GET or POST.", 405);
}
