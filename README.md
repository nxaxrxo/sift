# Sift

A live moodboard of gaming, anime, gamedev and AI news, filtered to one person's taste.
No AI in the loop, no account, no tracking, no algorithm that "learns". Feeds in, rules scored,
cards out. Click a card and you land on the publisher.

**Live:** `https://sift.pages.dev`
**Cost to run:** £0. Cloudflare Pages free tier + one D1 database.

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
82 feeds ──► parse ──► score ──► dedupe ──► D1 (SQLite) ──► /api/feed ──► board
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
5. **Serve.** `/api/feed` pages on a `(publishedAt, urlKey)` tuple cursor, so nothing is skipped when ten
   stories share a second.

## Taste is a file, not a model

`functions/_lib/config.mjs` is the whole brain: the source list, the weights, and every word that
raises or buries a story. Edit it, redeploy, the board changes. There is no prompt anywhere.

## Run it locally

```powershell
node --test tests/                        # 36 tests, no dependencies
node scripts/live-ingest.mjs              # real feeds into .dev/sift.db, prints stats + sample cards
node scripts/preview.mjs start            # hidden wrangler dev on :8788
node scripts/preview.mjs shot             # headless screenshots at 1440 and 420 wide
node scripts/preview.mjs stop
```

`scripts/live-ingest.mjs` is the honest test: same parser, same scorer, same SQL as production, against
the live internet. It exits non-zero if it stores nothing.

## Deploy

```powershell
npx wrangler login                                    # once, interactive
npx wrangler d1 create sift-db                        # copies database_id into wrangler.toml
npx wrangler pages project create sift --production-branch main
npx wrangler pages deploy public --project-name sift
```

Then `https://sift.pages.dev`. The first page load triggers a sync automatically; `/api/sync` can also be
pinged by anything you like.

**Keeping it warm without opening the page:** add a GitHub Action (or any cron service) that hits
`https://sift.pages.dev/api/sync` every 10 minutes. Pages Functions do not have their own cron trigger;
this is the supported pattern.

## Layout

```
public/               the site: index.html, style.css, app.js, theme.js, font, favicon
functions/api/        feed.js · sync.js · stats.js
functions/_lib/       config.mjs (taste) · parse.mjs · clean.mjs · score.mjs · db.mjs · ingest.mjs
data/                 anime-titles.json (his MAL list + aliases)
scripts/              live-ingest.mjs · preview.mjs · d1-shim.mjs · build-anime-data.py
tests/                clean · parse · score (+ config validity)
docs/                 SPEC.md · DESIGN.md · SOURCES.md
```

## Rules this project holds itself to

- **Feed-first.** We never scrape an article page. Every outlet here publishes a feed for exactly this.
- **No AI at runtime.** Nothing on a card is generated; it is the publisher's own title and excerpt.
- **Never blank.** Every network call has a timeout, every failure is counted, and the board keeps its
  last good state.
- **Nothing about him leaves the page.** No analytics, no third-party script, no font CDN.
