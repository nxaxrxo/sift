#!/usr/bin/env node
/**
 * One-command deploy.
 *
 * `npx wrangler login` is the only step that needs a browser and a human. Everything
 * after it — creating the database, wiring its id into wrangler.toml, creating the
 * Pages project, uploading the site, waking the board — is mechanical, and mechanical
 * steps typed by hand are steps that get mistyped. So this runs them in order and
 * stops at the first one that fails, saying which.
 *
 * Usage:  node scripts/deploy.mjs
 *         node scripts/deploy.mjs --status    (what is already done)
 */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROJECT = "sift";
const DB_NAME = "sift-db";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

const args = new Set(process.argv.slice(2));

/**
 * Run a command and return { code, stdout, stderr }, never throwing on exit codes.
 *
 * On Windows `npx` is a `.cmd` shim. Modern Node refuses to spawn one directly
 * (`EINVAL`) and the common fix, `shell: true`, concatenates arguments unescaped and
 * logs a deprecation warning on every call. So the shell is named explicitly and the
 * arguments are quoted here, which is the same thing with the escaping kept.
 */
function quoteArg(value) {
  const text = String(value);
  return /[\s"&|<>^]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function run(command, argv, { quiet = false } = {}) {
  const isWindows = process.platform === "win32";
  const file = isWindows && command === "npx" ? "npx.cmd" : command;
  const useShell = isWindows && /\.(cmd|bat)$/i.test(file);
  const spawnFile = useShell ? process.env.ComSpec || "cmd.exe" : file;
  const spawnArgs = useShell ? ["/d", "/s", "/c", [quoteArg(file), ...argv.map(quoteArg)].join(" ")] : argv;

  return new Promise((resolve) => {
    const child = spawn(spawnFile, spawnArgs, {
      cwd: ROOT,
      windowsVerbatimArguments: useShell,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: stderr + String(error) }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const wrangler = (argv, options) => run("npx", ["--yes", "wrangler@4.158.0", ...argv], options);

function step(text) {
  console.log(`\n=== ${text} ===`);
}

/** Is this machine logged in to Cloudflare? */
async function whoami() {
  const result = await wrangler(["whoami"], { quiet: true });
  const blob = `${result.stdout}\n${result.stderr}`;

  // Three ways wrangler says "no": the plain message, the non-interactive one that
  // demands CLOUDFLARE_API_TOKEN, and a bare exit code with nothing useful printed.
  const signedOut =
    /not authenticated/i.test(blob) ||
    /CLOUDFLARE_API_TOKEN/i.test(blob) ||
    (result.code !== 0 && !/account/i.test(blob));
  if (signedOut) return null;

  // `wrangler whoami` prints a table; the account id is the reliable part to pull.
  const id = blob.match(/\b([0-9a-f]{32})\b/);
  return { accountId: id ? id[1] : null, raw: blob };
}

/** Find an existing database by name, or create it. Returns its id. */
async function ensureDatabase() {
  const listed = await wrangler(["d1", "list", "--json"], { quiet: true });

  if (listed.code === 0) {
    try {
      const start = listed.stdout.indexOf("[");
      const parsed = start >= 0 ? JSON.parse(listed.stdout.slice(start)) : [];
      const found = parsed.find((entry) => entry.name === DB_NAME);
      if (found?.uuid) {
        console.log(`${DB_NAME} already exists: ${found.uuid}`);
        return found.uuid;
      }
    } catch {
      // Fall through to creating it: a parse failure means we cannot prove it exists.
    }
  }

  const created = await wrangler(["d1", "create", DB_NAME]);
  const blob = `${created.stdout}\n${created.stderr}`;
  if (created.code !== 0) {
    throw new Error(`could not create the database:\n${blob.trim()}`);
  }

  const id = blob.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
  if (!id) throw new Error(`database created but no id was printed:\n${blob.trim()}`);
  console.log(`created ${DB_NAME}: ${id[1]}`);
  return id[1];
}

/** Put the real id into wrangler.toml, wherever the placeholder still is. */
async function writeDatabaseId(id) {
  const file = path.join(ROOT, "wrangler.toml");
  const text = await readFile(file, "utf8");
  if (text.includes(id)) {
    console.log("wrangler.toml already points at this database");
    return;
  }
  if (!text.includes(PLACEHOLDER)) {
    const existing = text.match(/database_id\s*=\s*"([^"]+)"/);
    throw new Error(
      `wrangler.toml has database_id "${existing ? existing[1] : "?"}" and no placeholder.\n` +
        `Refusing to overwrite it — check the file by hand.`,
    );
  }
  await writeFile(file, text.replace(PLACEHOLDER, id), "utf8");
  console.log("wrangler.toml updated");
}

async function ensureProject() {
  const created = await wrangler(["pages", "project", "create", PROJECT, "--production-branch", "main"], {
    quiet: true,
  });
  const blob = `${created.stdout}\n${created.stderr}`;
  // "already exists" is a success for our purposes.
  if (created.code !== 0 && !/already exists/i.test(blob)) {
    throw new Error(`could not create the Pages project:\n${blob.trim()}`);
  }
  console.log(created.code === 0 ? `Pages project "${PROJECT}" created` : `Pages project "${PROJECT}" already exists`);
}

/** Wake the board so the first visitor does not stare at an empty page. */
async function wake(url) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/sync`, { signal: AbortSignal.timeout(60_000) });
      const body = await response.text();
      console.log(`sync attempt ${attempt}: HTTP ${response.status} ${body.slice(0, 160)}`);
      if (response.ok) return true;
    } catch (error) {
      console.log(`sync attempt ${attempt}: ${error?.message ?? error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 8_000));
  }
  return false;
}

async function main() {
  step("Cloudflare login");
  const account = await whoami();
  if (!account) {
    console.error(
      [
        "wrangler is not authenticated.",
        "",
        "Run this once, in a visible terminal, and finish the browser step:",
        "    npx wrangler login",
        "",
        "Then run this script again.",
      ].join("\n"),
    );
    process.exit(2);
  }
  console.log(`authenticated${account.accountId ? ` (account ${account.accountId})` : ""}`);

  if (args.has("--status")) {
    const listed = await wrangler(["d1", "list"], { quiet: false });
    console.log(listed.code === 0 ? "" : "could not list databases");
    return;
  }

  step("D1 database");
  const databaseId = await ensureDatabase();
  await writeDatabaseId(databaseId);

  step("Pages project");
  await ensureProject();

  step("Deploy");
  const deployed = await wrangler(["pages", "deploy", "public", "--project-name", PROJECT, "--commit-dirty=true"]);
  if (deployed.code !== 0) {
    throw new Error("deploy failed; the wrangler output above says why");
  }

  const urlMatch = `${deployed.stdout}\n${deployed.stderr}`.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]*pages\.dev/i);
  const url = urlMatch ? urlMatch[0] : `https://${PROJECT}.pages.dev`;

  step("First sync");
  const fed = await wake(url);

  step("Done");
  console.log(`site      ${url}`);
  console.log(`database  ${DB_NAME} (${databaseId})`);
  console.log(fed ? "board is fed — the first page will have cards" : "site is up, but the first sync has not answered yet; it will on the next visit");
  console.log(`\nPoint .github/workflows/sync.yml at ${url}/api/sync if the domain differs from ${url}.`);
}

main().catch((error) => {
  console.error(`\ndeploy stopped: ${error?.message ?? error}`);
  process.exit(1);
});
