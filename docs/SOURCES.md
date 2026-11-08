# SIFT — where the news comes from

Every source below was fetched, by hand, from this machine on 2026-11-08 and answered with a real
feed. The list is the inventory of truth; `functions/_lib/config.mjs` mirrors it in code, and
`docs/SPEC.md` explains how each one is scored.

## The one rule

**We consume feeds. We never scrape article pages.** Every outlet here publishes an RSS/Atom
syndication feed precisely so software can read it. Several of them — every Ziff Davis site — carry a
`robots.txt` that forbids *automated retrieval of website content*, while still serving that feed.
Reading the feed is the sanctioned path; fetching the article HTML is not, and Sift does not do it.

## Verified working (HTTP 200, real items)

### Patch notes for the games he actually plays — weight 3, lane `games`

Steam publishes a per-app news feed. This is the highest-signal source type on the board: it is the
developer talking directly, and it covers exactly the games on his actively-played list.

| app | id | feed |
|---|---|---|
| Warframe | 230410 | `store.steampowered.com/feeds/news/app/230410/` |
| Helldivers 2 | 553850 | …`/553850/` |
| No Man's Sky | 275850 | …`/275850/` |
| Palworld | 1623730 | …`/1623730/` |
| Deep Rock Galactic | 548430 | …`/548430/` |
| R.E.P.O. | 3241660 | …`/3241660/` |
| Aion 2 | 3393110 | …`/3393110/` |
| Crimson Desert | 3321460 | …`/3321460/` |
| Aniimo | 4126040 | …`/4126040/` |
| GRAIN ROT | 4450620 | …`/4450620/` |
| Far Far West | 3124540 | …`/3124540/` |
| DragonSword: Awakening | 4570720 | …`/4570720/` |

10 items each — every patch note the developer has published recently, with a header image.

**Hytale has no public feed.** `hytale.com/news` is HTML only, `hytale.com/feed` 404s, and Hytale is not
on Steam yet, so there is nothing legitimate to poll. It is covered indirectly by the gaming press and
by Asmongold, who covers it constantly. Revisit when they ship a blog with a feed.

### Games press

| outlet | weight | feed | notes |
|---|---|---|---|
| Eurogamer | 3 | `eurogamer.net/feed` | 100 items, `media:content` images |
| PC Gamer | 3 | `pcgamer.com/rss/` | 50 items, very large payload (~1 MB) |
| Rock Paper Shotgun | 3 | `rockpapershotgun.com/feed` | 100 items |
| IGN | 2 | `feeds.ign.com/ign/games-all` | 20 items, full `content:encoded` |
| GameSpot | 2 | `gamespot.com/feeds/mashup/` | 15 items |
| GamesRadar | 2 | `gamesradar.com/rss/` | 50 items |
| PCGamesN | 2 | `pcgamesn.com/mainrss.xml` | 75 items |
| VGC | 2 | `videogameschronicle.com/feed/` | 10 items, `Crawl-delay: 5` in robots |
| Kotaku | 2 | `kotaku.com/rss` | 20 items, `media:content` images |
| Dexerto | 2 | `dexerto.com/feed/` | 50 items |
| Nintendo Life | 2 | `nintendolife.com/feeds/latest` | 25 items |
| Push Square | 2 | `pushsquare.com/feeds/latest` | 25 items |
| Pure Xbox | 2 | `purexbox.com/feeds/latest` | 25 items |
| Time Extension | 1 | `timeextension.com/feeds/latest` | retro |
| Gematsu | 2 | `gematsu.com/feed` | japanese games, anime adaptations |
| RPG Site | 1 | `rpgsite.net/feed` | 25 items |
| Siliconera | 1 | `siliconera.com/feed/` | 15 items, japan |
| Automaton | 1 | `automaton-media.com/en/feed/` | 30 items, japanese dev news in english |
| GamingOnLinux | 1 | `gamingonlinux.com/article_rss.php` | 50 items |
| Indie Games Plus | 1 | `indiegamesplus.com/feed` | 10 items |
| Digital Foundry | 2 | `feeds.feedburner.com/digitalfoundry` | 15 items, no summary |

### Industry / dev / engines

| outlet | weight | feed |
|---|---|---|
| GamesIndustry.biz | 2 | `gamesindustry.biz/feed` (100 items) |
| Game Developer | 2 | `gamedeveloper.com/rss.xml` (50) |
| Variety Gaming | 1 | `variety.com/v/gaming/feed/` (10) |
| Godot Engine | 3 | `godotengine.org/rss.xml` (15) |
| 80.lv | 1 | `80.lv/feed/` (10) |

### Anime

| outlet | weight | feed |
|---|---|---|
| Anime News Network | 2 | `animenewsnetwork.com/all/rss.xml` (142 items, no images — typographic tiles) |
| Anime Corner | 1 | `animecorner.me/feed/` (25) |

### AI / tech

| outlet | weight | feed |
|---|---|---|
| Ars Technica | 2 | `feeds.arstechnica.com/arstechnica/index` (20) |
| Ars Technica Gaming | 2 | `feeds.arstechnica.com/arstechnica/gaming` (20) |
| The Verge AI | 2 | `theverge.com/rss/ai-artificial-intelligence/index.xml` (10) |
| TechCrunch AI | 2 | `techcrunch.com/category/artificial-intelligence/feed/` (20) |
| Hugging Face | 1 | `huggingface.co/blog/feed.xml` (899 — the whole blog; score does the filtering) |
| Tom's Hardware | 1 | `tomshardware.com/feeds/all` (50) |
| Wccftech | 1 | `wccftech.com/feed/` (20) |
| Hacker News (150+ pts) | 1 | `hnrss.org/frontpage?points=150` (14) |

### Aggregators

| outlet | weight | feed |
|---|---|---|
| Steam news | 1 | `store.steampowered.com/feeds/news.xml` (20) |
| r/Games | 2 | `reddit.com/r/Games/top/.rss?t=day` (13) |

Reddit rate-limits: the `.rss` form works, `top.json` returns 403. One feed, once a minute, is inside
the limit.

### YouTube — weight 3, lane `creator`

`youtube.com/feeds/videos.xml?channel_id=…` is a real Atom feed: title, publish date, and a
`media:group` with a thumbnail at `i.ytimg.com/vi/<id>/hqdefault.jpg`. All 30 channels below answered
with 15 entries each.

Chosen from the Beacon's `channels.json` **tier 1-2 and enabled only** — the channel policy there
(commentary, reviews, documentaries, essays; never gameplay, clips or branded entertainment) applies
unchanged here.

Asmongold TV · penguinz0 · MoistCr1TiKaL Gaming · AngryJoeShow · videogamedunkey · Internet Historian ·
Super Eyepatch Wolf · NakeyJakey · KiraTV · Pyrocynical · Josh Strife Says · Threat Interactive ·
Visual Venture · Nexpo · blameitonjorge · Curious Archive · fern · Ahoy · Vsauce · Real Science ·
Cryton · poi · Scary Interesting · Nerdwriter1 · Daryl Talks Games · Jim Browning · Gigguk ·
AI Explained · Matt Wolfe · Two Minute Papers · bycloud · AI Search

**Deliberately excluded** (disabled in the Beacon for exactly this reason): MrBeast, Anatoly,
Dr Insanity, Naked Criminal, Papa Meat, Flashgitz, Viva La DIRT League, and every pure gameplay or
clip channel.

## Verified dead / rejected

| candidate | why not |
|---|---|
| `hytale.com/feed`, `/rss`, `/api/news` | 404 — no feed exists |
| `noisypixel.net/feed/` | HTTP 520 (Cloudflare error from their own origin) |
| `rss.moddb.com/games/news/feed/rss.xml` | 404 |
| `nexusmods.com/rss/news.xml` | 403 — bot-blocked |
| `unrealengine.com/rss/news` | 403 — bot-blocked |
| `crunchyroll.com/newsrss` | 200 but zero items |
| `nintendolife`/`pushsquare`/`timeextension` alternate paths | only `/feeds/latest` works |
| **Nexus Mods, ModDB scraping** | would need HTML scraping — out of scope by design |
| **Eurogamer/IGN article HTML** | Ziff Davis robots.txt forbids automated content retrieval; the feed is the legal path |

## Robots notes that matter

- **Ziff Davis** (Eurogamer, RPS, IGN, GamesIndustry.biz): forbids automated *content* retrieval, allows
  feeds. We only read feeds and we only store a headline, a trimmed excerpt and a thumbnail URL.
- **VGC**: `Crawl-delay: 5`. One request per minute is far inside that.
- **PCGamesN / GamesRadar** (Network N / Future): indexes-only wording. Same reasoning — feed, never page.
- **Dexerto**: blocks AI crawlers by name; a plain feed reader with a browser UA is what the feed is for.

## Adding a source

1. `curl` the candidate feed and confirm it returns real `<item>` or `<entry>` elements.
2. Add one line to `SOURCES` in `functions/_lib/config.mjs`: `news("id", "Name", url, weight, [lanes])`
   or `yt("id", "Name", channelId, weight, [lanes])`.
3. Add a row to this file with its weight and anything odd about its feed.
4. `node --test tests/` — the config test asserts every source has a unique id, an https url and a
   valid weight, so a typo fails before it deploys.
