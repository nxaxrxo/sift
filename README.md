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
| cadence | every 2 days, 03:00 | one pull, then on Refresh |
| cost | tokens per edition | nothing |
| depth | one screen of prose | scroll back 120 days |
| click | opens the source at the end | the whole card is the link |

It is not a replacement for the Beacon's writing. It replaces the *checking*.

## How it works

```
149 feeds → parse → score → dedupe → SQLite → build → board.json → the page
 (per run)             taste            url + title key          cursor paged
```

The sources are deliberately not the ones every aggregator carries. Alongside the big
outlets sit indie-only press and criticism, engine blogs (Bevy, Defold, GameMaker), game
preservation and emulation projects (Hidden Palace, ScummVM, melonDS), the fighting-game
scene and AI research rather than vendor blogging. Every URL was fetched and confirmed live
before it was added.

**English only.** The board carries 149 English-language feeds. Regional and non-English
editions were taken out — Japanese, French, Polish, Spanish, Italian, Portuguese, German,
Dutch, Nordic and Chinese desks — while the English edition of the same brand stayed
(Automaton, Eurogamer, Gamereactor, IGN). A foreign story syndicated by an English feed is
dropped at scoring time by `isEnglishText()`, and already-stored rows are purged by
`scripts/purge-language.mjs`, which runs inside every publish.

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

### Reading it

- **Refresh is the only source of new material.** Nothing polls in the background. New
  items arrive when you press the Refresh button (or the `R` key, or retry from the error
  state), so the board never reflows under you mid-scroll.
- **Every card carries a calendar date** — `8 Nov`, or `20 Oct 2026` when the year differs.
  A timestamp is never in the future; a feed with a broken clock shows "just now". Items
  seven days or older show the date alone, and the full timestamp is on hover.
- **The theme is borderless.** No borders or thin lines anywhere except `:focus-visible`;
  depth comes from solid colour steps. Media is 4:3, columns are 330px, summaries run to
  four lines (six on type cards).

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

## Asking it for news

```
node scripts/brief.mjs --top 15
node scripts/brief.mjs --lane anime --hours 24
node scripts/brief.mjs --q "silksong"
```

Reads the published board and prints a ranked brief — one command, no research pass. Flags:
`--lane`, `--q`, `--hours`, `--source`, `--top`, `--json`, `--local`.

## Deploy

**Live at https://nxaxrxo.github.io/sift/**

It publishes itself. `scripts/publish.mjs` does the whole job: seed the database from the
live board, read all 149 feeds, purge anything not in English, rebuild the site, force-push
an orphan `gh-pages` branch that Pages serves. There is no server, no database account, and
no secret.

The scheduled GitHub workflow is currently **parked at `docs/sync.yml.disabled`** — GitHub
refuses a push that touches `.github/workflows/*` unless the token carries the `workflow`
scope, which this machine's token does not. Until that is authorised, a Windows scheduled
task named `SiftRefresh` runs the identical pipeline every 30 minutes. `DEPLOY.md` has the
one-command restore.

Two things worth knowing:

- **The archive survives a fresh runner.** A scheduled build starts on an empty disk, so
  `scripts/seed.mjs` first restores the database from the currently published board (the live
  URL), then ingests on top of it. Without that step the board would reset to a single ingest
  every 15 minutes.
- **The seed also restores old rows.** Because the published board still contains whatever
  was there before, the pipeline purges after ingest: `scripts/purge-language.mjs` drops
  non-English rows and rows from sources no longer in the config, before the build.
- **`gh-pages` is an artifact, not history.** Each publish is an orphan commit, force-pushed.
  That keeps the repository small — otherwise every run would add another ~1.6 MB board file —
  and guarantees the published tree matches `dist/` exactly.

To publish by hand:

```powershell
npm run publish      # seed → ingest → purge → build → push gh-pages
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
