# Changes

## 2026-11-08 — first build

### The board's ordering was rebuilt twice, because the first version looked broken

Hour buckets sorted the front page by "what was posted in the last sixty minutes", which
handed the top of the board to whoever posts most. r/Games posts a dozen self-promo threads an
hour, so eleven of the first thirty cards were "Hi everyone, I'm the developer of…". Changing
the bucket to **six hours** gave the scores room to rank, and adding a hashed `mix` key as the
final sort term stops equal scores (191 rows sat on exactly 40) from stacking into one outlet's
wall. The cursor carries the whole tuple, so paging is still exact.

### Cards with no image are type cards

The first version drew a 16:9 hole with the source's initial in it. A moodboard full of grey
boxes with letters reads as broken, and half the column was wasted. Those cards now drop the
media block entirely and take a larger headline and a longer excerpt.

### Real bugs the tests caught

- `ensureSchema` cached "schema created" in a module-level flag, so the second database in a
  process never got a schema at all. Now tracked per database object.
- Multi-lane filtering was AND-ed, so `?lanes=gaming,anime` matched nothing. Now OR-ed.
- `mixKey` produced signed hex — a leading `-` sorts before every real key and quietly put the
  publisher walls back. Now forced unsigned.
- `parseDate` read a zone-less timestamp as local time, so the same feed ordered differently
  depending on the machine running the ingest. Now read as UTC.
- `pruneOld` used `DELETE … LIMIT`, which D1 and stock SQLite both reject. Replaced with a keyed
  subquery.
- Card summaries could be a bare `Article URL: https://…` (Hacker News). Metadata is stripped;
  a card with nothing readable is headline-only.

### Fetching

Eighty-two simultaneous fetches exhausted the local socket pool and produced a burst of "fetch
failed" on healthy feeds — 36 sources lost in one run. Fetches now go six at a time with one
quiet retry, which brought it to 81 of 82 in 5.6 seconds.

### Screenshots were lying

Edge and Chrome clamp a headless window to roughly 496 CSS pixels, so `--window-size=390`
rendered at 496 and the "mobile" shot was never mobile. `scripts/shot.mjs` drives the browser
over the DevTools protocol instead, asks for a real 390-pixel viewport, and prints what the
layout actually measured — overflow, broken images, clamped headlines — so a screenshot can be
checked instead of trusted.

### Not done, and why

- **Push to GitHub** — repo created, commit made, push refused 403: the logged-in token has
  metadata-only access. See `DEPLOY.md`.
- **Cloudflare deploy** — wrangler is not authenticated and no token exists on this machine.
  See `DEPLOY.md`.
