# Sift

A live moodboard of gaming, anime, gamedev and AI news, filtered to one person's taste.
No AI in the loop, no account, no tracking, no algorithm that "learns". Feeds in, rules scored,
cards out. Click a card and you land on the publisher.

**Live:** `https://nxaxrxo.github.io/sift/`
**Cost to run:** Zero. Static files on GitHub Pages, rebuilt by a scheduled Action.

---

## Why this exists

The Daily Beacon writes an edition every two days and costs tokens every time, because an agent reads
everything and writes it up. Sift answers the same question — *what happened that I care about* — with
rules instead of a model:

| | Daily Beacon | Sift |
|---|---|---|
| what it is | a written newspaper | a moodboard of links |
| cadence | every 2 days, 03:00 | continuous, re-read every 60s |
| cost | tokens per edition | nothing |
| depth | one screen of prose | scroll back 120 days |
| click | opens the source at the end | the whole card is the link |

It is not a replacement for the Beacon's writing. It replaces the *checking*.

## How it works

```
82 feeds → parse → score → dedupe → SQLite → build → board.json → the page
 (every 60s)            rules            url + title key          cursor paged
```

1. **Fetch.** Every source in parallel, 12s timeout each. A dead feed is counted and skipped; the run
   always finishes.
2. **Parse.** RSS 2.0, Atom and RDF, with a hand-written extractor — CDATA, entity soup and malformed
   items included. Images come from `media:content`, `media:thumbnail`, an enclosure, the first `<img>`
   in the body, or the YouTube thumbnail.
3. **Score.** `weight × 10 + freshness + boosts − penalties`, clamped 0-100. Boosted: the games he
   actually plays, Godot, his own anime list, indie breakouts, gamedev, AI tooling, the creators he
   watches. Penalised (never banned): politics, celebrity, rumours, guides, deals.
4. **Dedupe.** Two gates: canonical URL as the primary key, and a normalised title key so the same story
   from three outlets becomes one card — the highest-weight outlet wins.
5. **Serve.** The board is ordered once by `(bucket, score, mix, urlKey)` and written to
   `api/board.json`; the page slices that array as you scroll. Ordering in one place means
   no cursor arithmetic and no way for the client to disagree with the database about what
   comes next.

## Taste is a file, not a model

`functions/_lib/config.mjs` is the whole brain: the source list, the weights, and every word that
raises or buries a story. Edit it, redeploy, the board changes. There is no prompt anywhere.

## Run it locally

```powershell
npm test                                  # 44 tests, no dependencies
node scripts/live-ingest.mjs              # real feeds into .dev/sift.db, prints stats + sample cards
node scripts/preview.mjs start        # serves dist/ on :8788, hidden
node scripts/preview.mjs shot             # headless screenshots at 1440 / 820 / 390
node scripts/preview.mjs stop
```

`scripts/live-ingest.mjs` is the honest test: same parser, same scorer, same SQL as production, against
the live internet. It exits non-zero if it stores nothing.

## Deploy

It publishes itself. `.github/workflows/sync.yml` runs every 15 minutes and does the whole
job: read the feeds, rebuild the site, push it to the `gh-pages` branch that Pages serves.

There is no server, no database account, and no secret. GitHub's own token does the pushing,
scoped by `permissions: contents: write` in the workflow file.

**Live at https://nxaxrxo.github.io/sift/**

Two things worth knowing:

- **The archive survives a fresh runner.** A scheduled build starts on an empty disk, so
  `scripts/seed.mjs` first restores the database from the currently published board (the live
  URL), then ingests on top of it. Without that step the board would reset to a single ingest
  every 15 minutes.
- **`gh-pages` is an artifact, not history.** Each publish is an orphan commit, force-pushed.
  That keeps the repository small — otherwise every run would add another ~900 KB board file —
  and guarantees the published tree matches `dist/` exactly.

To publish by hand:

```powershell
npm run publish      # seed → ingest → build → push gh-pages
npm run build        # just rebuild dist/ from the local database
npm run deploy       # push dist/ without rebuilding
```

## Layout

```
public/               the site: index.html, style.css, app.js, theme.js, font, favicon
functions/_lib/       config.mjs (taste) · parse.mjs · clean.mjs · score.mjs · db.mjs · ingest.mjs
data/                 anime-titles.json (his MAL list + aliases)
scripts/              publish.mjs · seed.mjs · build-static.mjs · deploy-pages.mjs · live-ingest.mjs
tests/                clean · parse · score · db
docs/                 SPEC.md · DESIGN.md · SOURCES.md
dist/                 the built site (generated — never edit, never commit)
```

`functions/_lib` is the only folder still named for the edge platform it once ran on. It holds
the scoring and ingestion rules, which are unchanged and still tested; the name is cosmetic.

## Rules this project holds itself to

- **Feed-first.** We never scrape an article page. Every outlet here publishes a feed for exactly this.
- **No AI at runtime.** Nothing on a card is generated; it is the publisher's own title and excerpt.
- **Never blank.** Every network call has a timeout, every failure is counted, and the board keeps its
  last good state.
- **Nothing about him leaves the page.** No analytics, no third-party script, no font CDN.
