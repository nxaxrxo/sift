# SIFT — the specification

**What it is:** a self-hosted, zero-AI, always-fresh moodboard of gaming / anime / gamedev / AI news,
built from the taste rules of the Daily Beacon but with **no LLM in the loop**. Feeds are fetched,
scored by rules, stored, and rendered as an image-first masonry board that scrolls back forever.

**Why:** the Daily Beacon costs tokens every edition because an agent writes it. Sift costs nothing.
Rules score, SQL sorts, CSS paints. It is the same taste, published continuously instead of every 48h.

**Hosting:** one Cloudflare Pages project (`*.pages.dev`), static frontend + Pages Functions API +
one D1 database. No servers to run, no build step, no npm runtime dependencies.

---

## 1. Non-negotiables

1. **No AI at runtime, ever.** No API keys, no model calls, no per-item summarisation. Every string on
   a card comes from the feed itself (title + trimmed summary) or from our own config.
2. **Feed-first fetching only.** We consume publisher-provided RSS/Atom/YouTube feeds. We never scrape
   article HTML and never bypass a paywall. (Ziff Davis outlets — Eurogamer, RPS, IGN, GamesIndustry.biz
   — explicitly forbid scraping but publish these feeds for syndication; the feed is the sanctioned path.)
3. **Nothing may block the page.** Every network call has a timeout; a dead source is counted and
   skipped, never thrown.
4. **Zero runtime dependencies.** No React, no lodash, no feedparser npm. A hand-written XML item
   extractor, plain JS, plain CSS.
5. **The board is the product.** Opening it must feel like Pinterest for his taste: dense, colourful,
   scannable, no chrome fighting the images.
6. **Never disturb the owner's machine.** Local dev servers run detached and hidden.

## 2. Repository layout

```
sift/
  public/                  static frontend (no build step)
    index.html
    assets/app.js          ES module, no framework
    assets/style.css
    favicon.svg
  functions/
    api/feed.js            GET  /api/feed        cursor-paged item list
    api/sync.js            POST /api/sync        kick a background ingest if stale
    api/stats.js           GET  /api/stats       counts per lane + per source + lastSync
    _middleware.js         security headers, JSON error envelope
    _lib/config.mjs        SOURCES + TASTE + tunables  <- the file the owner edits
    _lib/parse.mjs         XML -> items (RSS2, Atom, RDF/RSS1.0)
    _lib/clean.mjs         HTML strip, entity decode, url normalise, title key
    _lib/score.mjs         pure scoring function + lane tagging
    _lib/db.mjs            D1 schema bootstrap, upsert, query, retention
    _lib/ingest.mjs        fetch all sources -> normalise -> score -> store
  data/anime-titles.json   owned copy of the Beacon's MAL title list (+ english aliases)
  docs/SOURCES.md           the verified source inventory (mirrors _lib/config.mjs)
  tests/*.test.mjs         node --test, no deps
  scripts/preview.mjs      local dev + screenshot helper
  wrangler.toml
  README.md
  docs/SPEC.md docs/SOURCES.md docs/DESIGN.md
```

## 3. Data model (D1 / SQLite)

```sql
CREATE TABLE IF NOT EXISTS items (
  url_key      TEXT PRIMARY KEY,   -- normalised url, dedupe key
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  title_key    TEXT NOT NULL,      -- lowercased alphanumeric-only, secondary dedupe
  summary      TEXT NOT NULL DEFAULT '',
  image        TEXT,
  source_id    TEXT NOT NULL,
  source_name  TEXT NOT NULL,
  kind         TEXT NOT NULL,      -- 'news' | 'video'
  lanes        TEXT NOT NULL,      -- comma list, e.g. 'games,indie'
  score        INTEGER NOT NULL,
  published_at TEXT NOT NULL,      -- ISO 8601 UTC
  bucket       TEXT NOT NULL,      -- 6-hour block, 'YYYY-MM-DDTHH' — the board's first sort key
  mix          TEXT NOT NULL,      -- 8-char hash of url_key, so equal scores interleave
  first_seen   TEXT NOT NULL       -- ISO 8601 UTC
);
CREATE INDEX IF NOT EXISTS idx_items_board ON items(bucket DESC, score DESC, mix ASC, url_key ASC);
CREATE INDEX IF NOT EXISTS idx_items_pub   ON items(published_at DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_items_title ON items(title_key);
CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id, published_at DESC);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- Schemas are created with `CREATE TABLE IF NOT EXISTS` on every ingest — self-healing, no migration step.
- `meta.last_sync` = epoch ms of the last completed ingest.
- `meta.sync_lock` = epoch ms when an ingest started; ignored if older than 180s (crash recovery).
- Retention: delete rows older than **120 days** once per ingest (`LIMIT 500` per pass).
- Storage: ~40 sources × 30 new items/day ≈ 1.2k rows/day, ~5k after dedupe. D1 free tier is ample.

## 4. Sources

`functions/_lib/config.mjs` exports `SOURCES`:

```js
{ id, name, url, kind: 'news'|'video', weight: 1|2|3, lanes: ['gaming','anime',...], home }
```

Rules: `id` is a stable slug (used in the URL filter and localStorage). `weight` is the Beacon's
source weight (3 = must-read outlet, 2 = good, 1 = tail). `lanes` are the coarse buckets the UI filters
on. The full verified source list lives in `docs/SOURCES.md` - that file is the inventory of truth;
`docs/SOURCES.md` records the research behind it (which feeds worked, which were dead, robots notes).

Lane vocabulary (fixed, used by UI and API): `games` (his actively-played titles — source feeds),
`gaming`, `anime`, `gamedev`, `ai`, `tech`, `business`, `indie`, `creator`.

Steam per-app news feeds give exact patch notes for the games he actually plays — those carry
`lanes: ['games']` and weight 3, and they are the single highest-signal source type in the system.

YouTube feeds (`https://www.youtube.com/feeds/videos.xml?channel_id=…`) give 15 recent uploads each
with a thumbnail. Only channels the Beacon's CHANNEL POLICY allows (commentary / documentary /
essays — never gameplay, clips, branded entertainment).

## 5. Ingest pipeline (one run)

1. **Guard.** If `last_sync` < 45s ago, or `sync_lock` is fresh (< 180s), return immediately.
   Set `sync_lock`. Never run two ingests at once.
2. **Fetch.** All sources in parallel, `AbortSignal.timeout(12_000)`, browser-ish User-Agent,
   per-source try/catch, max 6 concurrent per host family not required (different hosts).
3. **Parse.** RSS2 `<item>`, Atom `<entry>`, RDF `<item rdf:about>`. Extract: title, link, pubDate
   (`pubDate`, `dc:date`, `published`, `updated`), summary (`description`, `summary`,
   `content:encoded`), image (`media:content`, `media:thumbnail`, `enclosure` with an image type,
   first `<img src>` inside the description/content, YouTube `i.ytimg.com/vi/<id>` fallback).
4. **Clean.** Decode entities (`&amp;` `&#8217;` `&nbsp;` …), strip tags, collapse whitespace,
   trim summary to ~240 chars on a word boundary, drop "Read more"/"Continue reading" tails,
   normalise URLs (strip `utm_*`, `fbclid`, `ref`, `?s=`, fragments).
5. **Score & tag** (§6). Items that hit a hard drop rule are discarded before storage.
6. **Store.** `INSERT OR IGNORE` on `url_key`; skip if a different `url_key` shares the same
   `title_key` (cross-posted story from two outlets — keep the higher-weight one by inserting in
   weight order). Bump `score` upward if a higher-weighted source republishes it.
7. **Finish.** Write `last_sync`, clear `sync_lock`, run retention.
8. Return a summary object `{sources, ok, failed, inserted, durationMs}` for logs.

Feeds emit 10–140 items each; ingest everything the feed offers (no lookback window) so the board
has depth on day one. Freshness is handled by ordering, not by filtering.

## 6. Scoring — the taste, without an LLM

Pure function `scoreItem(item, source) -> { score, lanes, drop }`. Deterministic, testable.

```
score = sourceWeight * 10            // 10 / 20 / 30
      + freshnessBonus(publishedAt)  // <6h +20, <12h +12, <24h +6, <72h +2, else 0
      + sum(boost hits)              // see TASTE.boost, first hit per key only
      - sum(penalty hits)            // see TASTE.penalty
```
Clamp to 0–100. `lanes` = source lanes ∪ every boost key matched.

**TASTE.boost** (config, editable — regex-free word matching on `title + summary`, case-insensitive,
word-boundary where the term is short):

| key | pts | matcher |
|---|---|---|
| `mygames` | 30 | Warframe, Hytale, Helldivers, Crimson Desert, No Man's Sky, Palworld, Deep Rock Galactic, R.E.P.O., Aion 2, DragonSword, Aniimo, GRAIN ROT, Far Far West |
| `godot` | 26 | Godot (engine / releases / features) |
| `anime_title` | 22 | any title in `data/anime-titles.json` incl. english aliases |
| `indie_hit` | 18 | indie, roguelite, breakout, "sold", "concurrent players" near indie words |
| `gamedev` | 14 | Unreal, Unity, Blender, procedural, shader, devlog |
| `ai_dev` | 12 | agent, coding model, benchmark, inference, open-weight |
| `creator` | 10 | source.kind === 'video' && source weight ≥ 2 |

**TASTE.penalty** (never a ban — just buries the card):

| key | pts | matcher |
|---|---|---|
| `politics` | −60 | election, parliament, senate, "says president", war, ceasefire, sanctions |
| `celebrity` | −50 | red carpet, relationship, "ex", divorce, outfit, "slams", feud |
| `spoilers` | −40 | "the ending", "plot twist", spoilers |
| `leaks` | −40 | "rumour", "reportedly", "it is believed", "unconfirmed" |
| `sports` | −40 | transfer, match, goal, league standings |
| `lootbox` | −45 | loot box, gacha rates, battle pass pricing |
| `guides` | −35 | "how to", "where to find", "walkthrough", "best build" |
| `deals` | −30 | "deal", "discount", "% off", "price drop" |

**TASTE.drop** (hard discard, nothing stored): adult content, casino/gambling promotion,
non-English-only headlines, obvious SEO filler (title < 12 chars, or `[sponsored]`).

Scoring must be **pure and unit-tested** with fixtures — no fetch, no DB, no clock injection
problems (pass `now` in as an argument).

## 7. API

All responses JSON. Errors: `{ error: { code, message } }` with a proper status.

### GET /api/feed
Query: `cursor` (opaque; pass back exactly what `nextCursor` returned), `limit` (default 30, max 60),
`lanes` (comma list, OR-ed), `sources` (comma list of ids), `q` (substring on title/summary),
`minScore` (default 0).

```json
{ "items": [ { "urlKey","url","title","summary","image","sourceId","sourceName","kind",
               "lanes":["gaming","anime"],"score":72,"publishedAt","bucket","firstSeen" } ],
  "nextCursor": "2026-11-08T06|40|f246ca7c|https://animenewsnetwork.com/news/…",
  "meta": { "lastSync": 1762565400000, "total": 4820 } }
```

Ordering: `bucket DESC, score DESC, mix ASC, url_key ASC`.

- `bucket` is a **six-hour block**, not an hour. With hour blocks the top of the board was simply
  "whatever was posted in the last sixty minutes", so the outlet that posts most owned it.
- `mix` is a hash of `url_key`. Scores collide constantly (191 rows sat on exactly 40), and without it
  those ties stack by publisher into a wall of one outlet. It is deterministic, so paging is stable.
- The cursor is that whole tuple. Paging on a prefix of it silently drops the tail of every tie.

`nextCursor` is null when the page is short.

### POST /api/sync
Kicks an ingest via `context.waitUntil()` and answers immediately:
`{ "queued": true, "lastSync": 1762565400000, "running": false }`. Debounced per §5.
Also accepts GET (idempotent enough for a cron pinger).

### GET /api/stats
`{ total, perLane: {...}, perSource: [{id,name,count,lastItemAt}], lastSync, oldest }`

Security headers in `_middleware.js`: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, a strict `Content-Security-Policy` (`default-src 'self'`,
`img-src 'self' data: https:`, `script-src 'self'`, no inline script), `X-Frame-Options: DENY`.
Cache: `no-store` on the API (freshness matters more than bytes).

## 8. Frontend

Single page, no router. Layout:

```
┌ masthead ─────────────────────────────────────────────┐
│ SIFT ···············  ● live · updated 24s ago   [◐]  │
│ one-line what-this-is                                  │
├ filter rail (sticky) ──────────────────────────────────┤
│ [All] [My games] [Gaming] [Anime] [Gamedev] [AI] ...  🔍│
├ masonry board ─────────────────────────────────────────┤
│ ▢ ▢ ▢ │ ▢ ▢ │ ...   infinite scroll, 30/page          │
└────────────────────────────────────────────────────────┘
```

- **Masonry**: CSS multi-column (`column-width` ~320px) — zero JS, no gaps, no layout thrash.
  Cards `break-inside: avoid`. Source order is score-then-recency, so the first screen is the best
  material; columns are acceptable because it is a moodboard, not a timeline.
- **Card**: image (16:9, lazy, `background` shimmer placeholder, `referrerpolicy="no-referrer"`),
  then a 1px-ruled body: source chip + lane dot, title (3-line clamp), summary (2-line clamp),
  footer `2h ago · Score 72`. Whole card is one `<a target="_blank" rel="noopener">`.
  Cards without an image get a typographic tile (source initial in a display serif over a
  deterministic hue from `source_id`).
- **Live**: poll `/api/sync` on load and every 60s while the tab is visible, then poll
  `/api/feed?cursor=<newest>` to prepend new cards with a subtle 200ms fade. Show a "N new" pill
  instead of jumping the scroll position.
- **Infinite scroll**: `IntersectionObserver` on a sentinel → fetch next page with `cursor`.
  Skeleton cards while loading. Stop when `nextCursor` is null, then show "you've reached the
  beginning" with the date.
- **Filters**: lane pills write to the query string (`?lanes=games,anime`) and reset the list.
  Search box debounced 300ms → `q`. Both reflected in the URL so a refresh keeps the view.
- **Not interested**: a `×` in the card corner (hover/focus only) hides it, stored in
  `localStorage.notInterested` and applied client-side. No server write.
- **Theme**: light is default (paper `#faf8f4`), dark follows `prefers-color-scheme` unless toggled;
  choice persisted. Both themes must hit WCAG AA on body text.
- **Empty / error states**: real sentences, a retry button, never a spinner-forever.
- **Performance**: `content-visibility: auto` on cards, `loading="lazy"` + `decoding="async"` on
  images, no web fonts blocking render (self-host nothing; use a system stack with one display
  fallback), total JS < 25 KB unminified.

## 9. Local development

```powershell
npx wrangler pages dev public --d1 DB=sift-db --port 8788      # hmm: use the script below
node scripts/preview.mjs start      # detached, hidden, port 8788, writes .dev/done
node scripts/preview.mjs shot       # headless Edge screenshot -> .dev/shot.png
node scripts/preview.mjs stop
```

`scripts/preview.mjs` owns the whole loop: creates the local D1, starts `wrangler pages dev` hidden,
waits for the port, runs an ingest once, screenshots at 1440×2000 and 420×1600.

## 10. Acceptance (must all pass before "done")

1. `node --test tests/` — parser fixtures (RSS2, Atom, RDF, CDATA, entity soup), scorer table,
   url/title normalisation. All green.
2. Local ingest against the real source list: **≥ 30 sources OK, ≥ 300 items inserted**, no uncaught
   error in the log, ingest wall time < 25s.
3. `/api/feed` pages correctly: page 1 → cursor → page 2, no duplicates, no gap, `nextCursor` null
   at the end.
4. `/api/feed?lanes=anime` and `?q=godot` return only matching rows.
5. A dropped-category item (politics/lootbox fixture) never appears in `/api/feed`.
6. Screenshots at desktop and mobile width show a full board (≥ 12 cards visible), no clipped text,
   no empty grey box where an image failed.
7. Total frontend payload < 40 KB gzip (excluding images).

## 11. Deploy

```
npx wrangler d1 create sift-db               # paste database_id into wrangler.toml
npx wrangler pages project create sift       # first time
npx wrangler pages deploy                    # public/ + functions/
```
Then the site lives at `https://sift.pages.dev`. Optional: a GitHub Action every 10 minutes calling
`/api/sync` keeps the board warm without him opening the page (cron is not available on Pages).

## 12. What this is not

- Not a reader. No full-text view, no reader mode, no saved articles. Click goes to the publisher.
- Not a recommender that learns. Rules only — the owner edits `config.mjs` when his taste changes.
- Not a replacement for the Beacon's writing. It links out; it never writes prose about a story.
