/**
 * publish.mjs — the whole job, in the order it has to happen.
 *
 *   seed (from the live board) → ingest real feeds → build dist/ → push gh-pages
 *
 * This is what the scheduled GitHub Action runs, and it is the same command a
 * human runs locally. One pipeline, one behaviour: there is no separate "CI mode"
 * that can drift from what was tested.
 *
 * The seed step is what makes this work on a fresh runner. Without it, each run
 * would start from an empty database and the archive would reset to whatever one
 * ingest happened to fetch.
 *
 *   node scripts/publish.mjs [--db .dev/sift.db] [--no-push]
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const db = flag("db", ".dev/sift.db");
const noPush = args.includes("--no-push");

const steps = [
  ["seed the archive from the live board", ["scripts/seed.mjs", "--db", db]],
  ["read the feeds", ["scripts/live-ingest.mjs", "--db", db]],
  ["build dist/", ["scripts/build-static.mjs", "--db", db]],
];

if (!noPush) {
  steps.push(["publish to gh-pages", ["scripts/deploy-pages.mjs", "--no-build"]]);
}

for (const [label, stepArgs] of steps) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, stepArgs, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n✔ published");
