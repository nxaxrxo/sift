/**
 * deploy-pages.mjs — publish `dist/` to the `gh-pages` branch.
 *
 * GitHub Pages serves a branch. There is no server to deploy to and no secret to
 * configure, so "deploy" is: build the folder, commit it on `gh-pages`, push.
 *
 * The branch is built as an orphan every time. That is deliberate: `gh-pages` is a
 * build artifact, not history. Rewriting it keeps the repo small (otherwise every
 * run commits a fresh 800 KB board file) and guarantees the published tree matches
 * `dist/` exactly — no file from a previous build can survive a run.
 *
 *   node scripts/deploy-pages.mjs [--db .dev/sift.db] [--no-build]
 *
 * Safe to re-run. Requires nothing but a working `git push`.
 */

import { spawnSync } from "node:child_process";
import { writeFile, mkdtemp, rm, mkdir, cp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const branch = "gh-pages";

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout || "";
}

async function main() {
  if (!skipBuild) {
    console.log("▶ building dist/");
    run(process.execPath, ["scripts/build-static.mjs"]);
  }

  const dist = join(root, "dist");
  const entries = await readdir(dist).catch(() => []);
  if (!entries.includes("index.html") || !entries.includes("api")) {
    throw new Error("dist/ is missing index.html or api/ — did the build fail?");
  }

  // Jekyll ignores files and folders starting with an underscore, which has bitten
  // more than one Pages site. An empty .nojekyll turns it off entirely.
  await writeFile(join(dist, ".nojekyll"), "", "utf8");

  const work = await mkdtemp(join(tmpdir(), "sift-pages-"));
  try {
    console.log("▶ staging gh-pages");
    run("git", ["worktree", "add", "--detach", work, "HEAD"], { quiet: true });

    // Orphan commit on an existing branch name: `checkout --orphan` refuses when
    // the branch already exists locally, which it does from the first deploy on.
    // So the orphan is created under a throwaway name and then forced onto
    // `gh-pages` — a plain `-B` would keep the old parent and grow the branch
    // forever, which is the thing an orphan avoids.
    const scratch = `site-${process.pid}`;
    run("git", ["checkout", "--orphan", scratch], { cwd: work, quiet: true });
    run("git", ["rm", "-rf", "--quiet", "--ignore-unmatch", "."], { cwd: work, quiet: true });

    for (const entry of await readdir(dist)) {
      await cp(join(dist, entry), join(work, entry), { recursive: true });
    }

    run("git", ["add", "-A"], { cwd: work, quiet: true });

    const when = new Date().toISOString();
    run(
      "git",
      [
        "-c", "user.email=narayanmiani@gmail.com",
        "-c", "user.name=nxaxrxo",
        "commit", "--quiet", "-m", `Publish the board (${when})`,
      ],
      { cwd: work, quiet: true },
    );

    run("git", ["branch", "-M", scratch, branch], { cwd: work, quiet: true });

    console.log("▶ pushing gh-pages");
    run("git", ["push", "--force", "origin", branch], { cwd: work });
    console.log("✔ published");
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", work], { cwd: root, stdio: "ignore" });
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}`);
  process.exitCode = 1;
});
