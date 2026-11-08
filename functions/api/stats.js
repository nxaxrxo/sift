/**
 * GET /api/stats — what the machine actually did.
 *
 * Exists so the board can be diagnosed without SQL: how many rows, which sources
 * are contributing, which are dead, and when the last run happened. Also the file
 * a health check or a cron pinger reads.
 */

import { ensureSchema, countAll, laneCounts, sourceCounts, lastSync, oldestItem, newestItem, getMeta } from "../_lib/db.mjs";
import { SOURCES } from "../_lib/config.mjs";
import { json, apiError } from "../_middleware.js";

export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return apiError("no-database", "The board has no database bound to it.", 500);

  try {
    await ensureSchema(env.DB);

    const [total, lanes, sources, syncAt, oldest, newest, lastRun] = await Promise.all([
      countAll(env.DB),
      laneCounts(env.DB),
      sourceCounts(env.DB),
      lastSync(env.DB),
      oldestItem(env.DB),
      newestItem(env.DB),
      getMeta(env.DB, "last_run"),
    ]);

    const known = new Set(sources.map((entry) => entry.id));
    const silent = SOURCES.filter((entry) => !known.has(entry.id)).map((entry) => entry.id);

    let parsedRun = null;
    if (lastRun) {
      try {
        parsedRun = JSON.parse(lastRun);
      } catch {
        parsedRun = { raw: lastRun };
      }
    }

    return json({
      total,
      perLane: lanes,
      perSource: sources,
      silentSources: silent,
      configuredSources: SOURCES.length,
      lastSync: syncAt,
      lastRun: parsedRun,
      oldest,
      newest,
    });
  } catch (error) {
    console.error("stats failed", error?.stack ?? error);
    return apiError("stats-failed", "Stats could not be read.", 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return apiError("method-not-allowed", "Use GET.", 405);
}
