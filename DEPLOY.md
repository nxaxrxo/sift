# Sift â€” deploy

**Live at https://nxaxrxo.github.io/sift/**

It runs itself. Nothing here needs doing unless the pipeline breaks.

---

## How it works

There is no server and no database account. The whole board is a static site: three
JSON files of data and the same HTML/CSS/JS it always had.

Every 15 minutes `.github/workflows/sync.yml` runs `scripts/publish.mjs`, which does five
things in order:

1. **Seed** â€” rebuild the database from the currently published board (seeded from the live
   URL, so a fresh runner starts with the full archive instead of an empty disk).
2. **Ingest** â€” read all 156 feeds, score them, insert what is new.
3. **Purge** â€” `scripts/purge-language.mjs` deletes non-English rows and rows from sources no
   longer in the config. It runs *after* ingest because step 1 just restored the old published
   board, which still carries those rows.
4. **Build** â€” write `dist/`: the site plus `api/board.json` (the whole board, already in
   board order) and `api/stats.json`.
5. **Publish** â€” commit `dist/` as an orphan commit and force-push it to `gh-pages`.

GitHub Pages serves that branch. `https://nxaxrxo.github.io/sift/`

---

## Why the archive survives

A GitHub runner starts with an empty disk, so step 1 is not optional: without seeding, every
run would ingest only the newest handful of items per feed and the board would reset to
roughly one hour of news, four times an hour, forever.

The seed reads `https://nxaxrxo.github.io/sift/api/board.json` â€” the last published state â€”
so history accumulates across runs with no stored state and no secret.

---

## Why `gh-pages` is force-pushed

Each publish is a single orphan commit, replacing the branch. Two reasons:

- **Size.** The board file is ~1.6 MB. Keeping every run's copy would add that much every
  15 minutes forever.
- **Exactness.** An orphan tree cannot carry a file from a build that no longer exists.

The repository at `main` holds the source; `gh-pages` holds only the built site.

---

## Doing it by hand

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift

npm run publish     # seed â†’ ingest â†’ purge â†’ build â†’ push  (the whole thing)
npm run build       # rebuild dist/ from the local database only
npm run deploy      # push the existing dist/ without rebuilding
```

`npm run publish` is exactly what CI runs, so a local run and a scheduled run cannot behave
differently.

---

## Maintenance scripts

- **`scripts/purge-language.mjs`** â€” deletes rows that are not English and rows whose source
  is no longer listed in `config.mjs`. `--dry` reports the counts and deletes nothing. It is
  not optional housekeeping: `publish.mjs` calls it after ingest on every run, because the
  seed step restores the old published board (foreign rows and dead sources included) and
  ingest alone would leave them in place.
- **`scripts/maintenance.ps1`** â€” the manual wrapper: purge the local `.dev/sift.db`, then
  run a full `publish.mjs`, detached, with a lock (`.dev/manual.lock`), a log
  (`.dev/manual.log`) and a done-file (`.dev/manual.done`). Use it when you want the purge to
  run against the local database as well as the published board.
- **`scripts/refresh-local.ps1`** â€” the scheduled task's entry point. Same shape, no purge of
  its own; `publish.mjs` handles it.

### Two gotchas worth knowing

- `$ErrorActionPreference = "Stop"` in PowerShell promotes *any* stderr line to a terminating
  error â€” including Node's experimental-SQLite warning, which aborts the script before it
  does anything. That is why `maintenance.ps1` sets `"Continue"` before calling node and
  redirects output into its log.
- The local D1 stand-in (`scripts/d1-shim.mjs`) exposes `.first()`, not `.get()`. Production
  code is written against `.first()/all()/run()`; a `.get()` call will not exist on the shim.

---

## The refresh right now: a local task, not the workflow

The GitHub workflow is parked at `docs/sync.yml.disabled`. GitHub refuses any push that
creates or edits `.github/workflows/*` unless the token carries the `workflow` scope, and
this machine's token has only `gist`, `read:org` and `repo`. The file itself is unchanged and
correct â€” only its location moved.

Until the scope exists, the board refreshes from a Windows scheduled task instead:

```powershell
Get-ScheduledTaskInfo -TaskName "SiftRefresh"    # last run + result
Start-ScheduledTask    -TaskName "SiftRefresh"   # run it now
Unregister-ScheduledTask -TaskName "SiftRefresh" -Confirm:$false
```

It runs `scripts/refresh-local.ps1` every 30 minutes, hidden, via the same `scripts/publish.mjs`
the workflow calls - so it seeds from the live board, ingests all 156 feeds, rebuilds and pushes
`gh-pages`, exactly as CI would. A lock file stops two runs overlapping, since a publish takes
about three minutes. Log and exit code land in `.dev/refresh.log` and `.dev/refresh.done`.

**Restoring the workflow** once the token carries `workflow`:

```powershell
gh auth refresh -h github.com -s workflow     # device flow, needs him
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift
git mv docs/sync.yml.disabled .github/workflows/sync.yml
git commit -m "Restore the scheduled sync workflow" 
git push origin main
gh workflow run sync.yml
Unregister-ScheduledTask -TaskName "SiftRefresh" -Confirm:$false   # only then
```

Two refreshers writing the same branch fight over the gh-pages worktree â€” drop the local task
when the workflow comes back, not before.

---

## If it stops updating

First: `(Get-ScheduledTaskInfo -TaskName "SiftRefresh").LastTaskResult` â€” `0` means the last
publish succeeded, `267009` means one is running now. Anything else is a real failure; read
`.dev/refresh.log`.

With the workflow live again, check the Actions tab:
<https://github.com/nxaxrxo/sift/actions>

- **A feed is failing** â€” normal, one or two a run. The ingest retries, counts them, and
  never fails the build over a single dead feed.
- **Non-English content appeared** â€” the purge did not run, or a non-English feed was
  re-added to `config.mjs`. Check that `scripts/purge-language.mjs` is still a step in
  `scripts/publish.mjs` (right after ingest), run
  `node scripts/purge-language.mjs --db .dev/sift.db --dry` to see what would go, then fix
  the source list.
- **The publish step failed** â€” almost always a permissions or concurrency problem.
  `permissions: contents: write` in the workflow is what allows the push.
- **Pages shows a 404** â€” Pages serves `gh-pages` from `/`. Check
  <https://github.com/nxaxrxo/sift/settings/pages>.

A scheduled workflow is disabled automatically by GitHub after 60 days with no repository
activity. Pressing "Enable workflow" in the Actions tab turns it back on.

