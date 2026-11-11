#!/usr/bin/env node
/**
 * Is every configured source still delivering?
 *
 * The board shrank from 2212 items to 1740 without a single error being raised:
 * 32 YouTube feeds had stopped returning anything and the ingest simply recorded
 * "ok / failed" and carried on. A feed that dies is invisible unless something
 * looks for it, so this script looks.
 *
 * It fetches every source the same way the ingest does and prints one line per
 * source that returns nothing usable. Exit code is 1 when any source is dead,
 * so a scheduled run can be noticed.
 *
 *   node scripts/source-health.mjs            # human table
 *   node scripts/source-health.mjs --json     # machine readable
 *   node scripts/source-health.mjs --quiet    # only the summary line
 */

import { SOURCES } from "../functions/_lib/config.mjs";
import { parseFeed } from "../functions/_lib/parse.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const quiet = args.includes("--quiet");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-GB,en;q=0.9",
};

const TIMEOUT_MS = 20_000;
const CONCURRENCY = 6;

async function probe(source) {
  const started = Date.now();
  let status = 0;
  let parsed = 0;
  let error = null;

  // Two attempts: a single socket reset is not a dead feed, and treating it as
  // one would fill this report with lies.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(source.url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      status = response.status;
      if (!response.ok) {
        error = `HTTP ${response.status}`;
        if (response.status < 500) break; // 404 will not become 200 on a retry
        continue;
      }
      const body = await response.text();
      parsed = parseFeed(body, { source }).length;
      if (parsed > 0) {
        error = null;
        break;
      }
      error = "feed returned no items";
    } catch (thrown) {
      error = thrown?.name === "TimeoutError" ? `timeout after ${TIMEOUT_MS}ms` : thrown.message;
    }
  }

  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    status,
    parsed,
    ms: Date.now() - started,
    dead: parsed === 0,
    error,
  };
}

async function run() {
  const queue = [...SOURCES];
  const results = [];

  // Same shape as the ingest pool: a fixed number of workers draining a shared
  // queue, so 149 sources do not open 149 sockets at once.
  async function worker() {
    while (queue.length) {
      const source = queue.shift();
      if (!source) return;
      results.push(await probe(source));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, SOURCES.length) }, () => worker()),
  );

  results.sort((a, b) => Number(b.dead) - Number(a.dead) || a.id.localeCompare(b.id));
  const dead = results.filter((r) => r.dead);

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ total: results.length, dead: dead.length, sources: results }, null, 2)}\n`,
    );
  } else if (!quiet) {
    console.log(`sources checked : ${results.length}`);
    console.log(`delivering      : ${results.length - dead.length}`);
    console.log(`dead            : ${dead.length}`);
    if (dead.length) {
      console.log("");
      for (const row of dead) {
        console.log(`  ✗ ${row.id.padEnd(22)} [${row.kind}] ${String(row.error).padEnd(28)} ${row.name}`);
      }
    }
  }

  if (quiet || asJson) {
    console.log(`sources ${results.length}, dead ${dead.length}`);
  }

  process.exitCode = dead.length ? 1 : 0;
}

await run();
