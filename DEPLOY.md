# Sift — deploy

**Live at https://nxaxrxo.github.io/sift/**

It runs itself. Nothing here needs doing unless the pipeline breaks.

---

## How it works

There is no server and no database account. The whole board is a static site: three
JSON files of data and the same HTML/CSS/JS it always had.

Every 15 minutes `.github/workflows/sync.yml` runs `scripts/publish.mjs`, which does four
things in order:

1. **Seed** — rebuild the database from the currently published board (seeded from the live
   URL, so a fresh runner starts with the full archive instead of an empty disk).
2. **Ingest** — read all 82 feeds, score them, insert what is new.
3. **Build** — write `dist/`: the site plus `api/board.json` (the whole board, already in
   board order) and `api/stats.json`.
4. **Publish** — commit `dist/` as an orphan commit and force-push it to `gh-pages`.

GitHub Pages serves that branch. `https://nxaxrxo.github.io/sift/`

---

## Why the archive survives

A GitHub runner starts with an empty disk, so step 1 is not optional: without seeding, every
run would ingest only the newest handful of items per feed and the board would reset to
roughly one hour of news, four times an hour, forever.

The seed reads `https://nxaxrxo.github.io/sift/api/board.json` — the last published state —
so history accumulates across runs with no stored state and no secret.

---

## Why `gh-pages` is force-pushed

Each publish is a single orphan commit, replacing the branch. Two reasons:

- **Size.** The board file is ~900 KB. Keeping every run's copy would add a megabyte every
  15 minutes forever.
- **Exactness.** An orphan tree cannot carry a file from a build that no longer exists.

The repository at `main` holds the source; `gh-pages` holds only the built site.

---

## Doing it by hand

```powershell
cd C:\Users\MarciNaro\Documents\VSCODE-PROJECTS\sift

npm run publish     # seed → ingest → build → push  (the whole thing)
npm run build       # rebuild dist/ from the local database only
npm run deploy      # push the existing dist/ without rebuilding
```

`npm run publish` is exactly what CI runs, so a local run and a scheduled run cannot behave
differently.

---

## The refresh right now: a local task, not the workflow

The GitHub workflow is parked at `docs/sync.yml.disabled`. GitHub refuses any push that
creates or edits `.github/workflows/*` unless the token carries the `workflow` scope, and
this machine's token has only `gist`, `read:org` and `repo`. The file itself is unchanged and
correct — only its location moved.

Until the scope exists, the board refreshes from a Windows scheduled task instead:

```powershell
Get-ScheduledTaskInfo -TaskName "SiftRefresh"    # last run + result
Start-ScheduledTask    -TaskName "SiftRefresh"   # run it now
Unregister-ScheduledTask -TaskName "SiftRefresh" -Confirm:$false
```

It runs `scripts/refresh-local.ps1` every 30 minutes, hidden, via the same `scripts/publish.mjs`
the workflow calls — so it seeds from the live board, ingests all 181 feeds, rebuilds and pushes
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

Two refreshers writing the same branch fight over the gh-pages worktree — drop the local task
when the workflow comes back, not before.

---

## If it stops updating

First: `(Get-ScheduledTaskInfo -TaskName "SiftRefresh").LastTaskResult` — `0` means the last
publish succeeded, `267009` means one is running now. Anything else is a real failure; read
`.dev/refresh.log`.

With the workflow live again, check the Actions tab:
<https://github.com/nxaxrxo/sift/actions>

- **A feed is failing** — normal, one or two a run. The ingest retries, counts them, and
  never fails the build over a single dead feed.
- **The publish step failed** — almost always a permissions or concurrency problem.
  `permissions: contents: write` in the workflow is what allows the push.
- **Pages shows a 404** — Pages serves `gh-pages` from `/`. Check
  <https://github.com/nxaxrxo/sift/settings/pages>.

A scheduled workflow is disabled automatically by GitHub after 60 days with no repository
activity. Pressing "Enable workflow" in the Actions tab turns it back on.
