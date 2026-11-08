# SIFT — design contract

The board is the product. Everything below is a hard contract: the frontend implementation must match
this file exactly, and changing the look means editing this file first.

---

## 1. The direction: **Darkroom**

A photographic darkroom, not a dashboard. Near-black warm paper. Images float on it like wet prints,
each with a coloured edge mark. No chrome, no glass, no gradients, no card shadows. The only colour on
the page comes from the photographs themselves and from one 3px mark per card.

**Why this and not a light Pinterest clone:** the Daily Beacon is already a dark broadsheet and he liked
it. Sift is the same reader looking at pictures instead of columns. A light board would look like every
other aggregator; a warm dark board with saturated edge marks does not exist in this niche.

**Explicitly banned** (from the project's anti-pattern audit):

- glassmorphism / `backdrop-filter`
- purple-blue gradients, gradient text, glow shadows
- 12px uniform border-radius pills everywhere
- Inter / Space Grotesk / DM Sans
- fade-in-up on every card
- icon-card grids, drop shadows on cards
- emoji as UI labels

## 2. Palette

Dark is the default. Light is the daytime variant; both must pass WCAG AA on body text.

### Dark (default)

| token | hex | use |
|---|---|---|
| `--board` | `#0c0b0a` | page background |
| `--board-2` | `#131211` | sticky rails, skeletons |
| `--card` | `#191817` | card body under the image |
| `--ink` | `#f2ece2` | headlines, primary text |
| `--ink-2` | `#a9a29a` | summaries, meta |
| `--ink-3` | `#6f6a64` | timestamps, axis labels |
| `--rule` | `#262421` | hairlines |
| `--rule-2` | `#3a3733` | hairline on hover/focus |

### Light

| token | hex |
|---|---|
| `--board` | `#f7f4ee` |
| `--board-2` | `#efeae2` |
| `--card` | `#fffdf9` |
| `--ink` | `#17150f` |
| `--ink-2` | `#55504a` |
| `--ink-3` | `#847e75` |
| `--rule` | `#e0d9cf` |
| `--rule-2` | `#c6bdaf` |

### Lane colours

One saturated hue per lane, used **only** as a 3px vertical mark on the card's leading edge and as the
active filter pill. All ≥ 4.5:1 against `--board` in dark mode.

| lane | hex | name |
|---|---|---|
| `games` | `#f2613f` | ember |
| `gaming` | `#e8a33d` | amber |
| `indie` | `#c3e88d` | lime |
| `anime` | `#e879b9` | magenta |
| `gamedev` | `#6fc3ba` | teal |
| `ai` | `#82b6e8` | sky |
| `tech` | `#b39ddb` | periwinkle |
| `business` | `#dcc36e` | gold |
| `creator` | `#de9670` | clay |

An item carries one or more lanes; the card shows the mark of its **first** lane (order = the pool
order in `config.mjs`).

## 3. Type

- **Display / headlines:** `Fraunces` — a variable serif with optical sizing, self-hosted at
  `assets/fraunces-latin.woff2` (one file, `font-display: swap`, `preload`). Fallback stack:
  `Georgia, 'Iowan Old Style', 'Times New Roman', serif`.
- **Everything else:** system UI stack.
- **Meta / numbers:** system mono stack, `font-variant-numeric: tabular-nums`.

Scale (fluid, `clamp`):

| token | size | use |
|---|---|---|
| `--t-masthead` | `clamp(2rem, 1.4rem + 3vw, 4.5rem)` | the wordmark |
| `--t-card-title` | `clamp(1.02rem, 0.97rem + 0.24vw, 1.16rem)` | card headline, weight 700 |
| `--t-body` | `0.95rem` | card summary |
| `--t-meta` | `0.72rem` | source chip, timestamp, uppercase, `letter-spacing: .08em` |

Rules: card title `line-height 1.22`, 3-line clamp. Summary `line-height 1.45`, `--ink-2`, 2-line clamp.
No paragraph on the board is ever longer than 3 sentences — it is a moodboard, not a reader.

## 4. Layout

```
╔════════════════════════════════════════════════════════════════════╗
║  SIFT                                           ● live   2m   ◐   ║   masthead, 1 row
║  the noise, sifted.                                                ║   one-line subtitle
╠════════════════════════════════════════════════════════════════════╣
║ [All] [My games] [Gaming] [Anime] [Gamedev] [AI] …     ⌕ search   ║   sticky filter rail
╠════════════════════════════════════════════════════════════════════╣
║  ┌────┐ ┌────┐ ┌────┐                                              ║
║  │ ▢  │ │ ▢  │ │ ▢  │   masonry, 1-5 columns                     ║
║  └────┘ │    │ └────┘   column-width 300px                          ║
║  ┌────┐ └────┘ ┌────┐                                              ║
╚════════════════════════════════════════════════════════════════════╝
```

- Shell max-width `1560px`, gutters `clamp(12px, 2.4vw, 40px)`.
- Masonry = CSS `columns`. `column-width: 300px; column-gap: 14px;` cards `break-inside: avoid;
  margin-bottom: 14px;`. Never JS masonry.
- **Masthead** is not a hero: one row, ~72px tall, wordmark left, live dot + clock + theme toggle right.
  The subtitle sits under it in `--ink-3`, one short line, and disappears under 640px.
- **Filter rail** sticks to the top (`position: sticky; top: 0; z-index: 20`), background `--board`
  at 96% + a 1px bottom hairline. Pills are text with a 1px border, `border-radius: 2px` (not 999px),
  uppercase mono meta type; the active pill is filled with its lane colour and `--board` text.
- **The board itself has no heading.** No "Latest", no "Your feed". The first card starts immediately.

## 5. Card

```
┌─────────────────────────┐
│▌  [ 16:9 image ]        │  ▌ = 3px lane mark, full card height, left edge
│                         │
├─────────────────────────┤
│ SRC · 2h                │  mono meta, --ink-3
│ The actual headline     │  Fraunces 700, 3-line clamp, --ink
│ One or two sentences of │  --ink-2, 2-line clamp, 2 sentences max
│ summary text.           │
└─────────────────────────┘
```

- Whole card is an `<a>`; hover raises `--rule-2` on all borders and pushes the title to full `--ink`.
  **No transform, no scale, no shadow.** Hover feedback is a border colour and a 120ms underline on the
  title only.
- Image: `aspect-ratio: 16/9`, `object-fit: cover`, `loading="lazy"`, `decoding="async"`,
  `referrerpolicy="no-referrer"`. Before load, the frame shows `--board-2` with a 1px `--rule` border.
- **Broken / missing image:** the frame becomes a typographic tile — the source's initial letter in
  Fraunces at `clamp(2.6rem, 5vw, 3.4rem)`, colour = that source's lane colour at 55% opacity, on
  `--board-2`. Deterministic, never a broken-image icon.
- Videos get a small `▶ 12:04`-style chip in the image corner only when a duration is known; otherwise
  a 2px triangle glyph, `--ink` at 80%, bottom-right, 10px inset.
- Dismiss (`×`) appears top-right of the image on hover/focus only, 26px, `--ink` on a `--board`
  at 70% square. Never visible on touch devices without tap.
- Card border: `1px solid var(--rule)`. No radius beyond `2px`.

## 6. States that must exist

| state | behaviour |
|---|---|
| first load | 8 skeleton cards (same column flow, `--board-2` blocks, 1.6s pulse on opacity only) |
| new items arrive | a floating pill bottom-centre: `12 new` → tap scrolls to top and merges |
| infinite scroll | `IntersectionObserver` on a 1px sentinel 800px before the end; loads 30 more |
| end of board | `That's everything since 12 July.` + the count, centred, `--ink-3` |
| empty filter | `Nothing in that lane yet.` + a `Clear filters` button |
| API error | `The feed didn't answer.` + `Try again` + the HTTP status in mono |
| no JS | `<noscript>` block: a real sentence explaining it needs JS, plus the link to the raw feed URL |
| reduced motion | all transitions off; skeletons static |

## 7. Interaction details

- Filters and search live in the URL: `?lanes=anime,gamedev&q=godot`. Back button works.
- Search: `input type="search"`, mono, 1px underline only, debounce 300ms, `Esc` clears.
- Keyboard: `/` focuses search, `Esc` blurs, `j`/`k` move card focus, `Enter` opens. Cards are real
  anchors so Tab works natively — the `j`/`k` layer is additive.
- Dismissed cards: `localStorage['sift.hidden']` = array of `urlKey`, capped at 500, applied before
  paint by removing nodes. A `Show hidden (3)` control sits at the end of the board and clears them.
- Theme toggle cycles `auto → dark → light`, stored in `localStorage['sift.theme']`, applied by setting
  `data-theme` on `<html>` (no flash: an inline 3-line script in `<head>` sets it before first paint).
- Live: `GET /api/sync` on load (fires an ingest if stale) then every 60s while visible;
  after each, `GET /api/feed?cursor=<newest>` and if non-empty show the "N new" pill rather than
  inserting mid-scroll.

## 8. Accessibility

- Contrast: `--ink` on `--board` ≥ 12:1, `--ink-2` ≥ 5.2:1, `--ink-3` ≥ 3.4:1 (meta only, never body).
- Every card link has an accessible name = its headline; the dismiss button has `aria-label="Hide “<title>”"`.
- Focus ring: `outline: 2px solid currentColor; outline-offset: 2px` — never removed.
- Live pill is `role="status" aria-live="polite"`.
- The lane mark is decorative (`aria-hidden`); the lane is also written in the meta line as text.

## 9. Budgets

| item | budget |
|---|---|
| `index.html` | < 9 KB |
| `style.css` | < 16 KB |
| `app.js` | < 18 KB |
| `fraunces-latin.woff2` | < 40 KB |
| first contentful paint (local) | < 500ms |
| cards rendered per page | 30, max 240 in DOM (trim oldest beyond that) |
