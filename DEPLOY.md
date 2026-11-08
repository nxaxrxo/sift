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

## If it stops updating

Check the Actions tab: <https://github.com/nxaxrxo/sift/actions>

- **A feed is failing** — normal, one or two a run. The ingest retries, counts them, and
  never fails the build over a single dead feed.
- **The publish step failed** — almost always a permissions or concurrency problem.
  `permissions: contents: write` in the workflow is what allows the push.
- **Pages shows a 404** — Pages serves `gh-pages` from `/`. Check
  <https://github.com/nxaxrxo/sift/settings/pages>.

A scheduled workflow is disabled automatically by GitHub after 60 days with no repository
activity. Pressing "Enable workflow" in the Actions tab turns it back on.
