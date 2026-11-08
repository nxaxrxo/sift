/**
 * config.mjs — the taste contract, expressed as data.
 *
 * EVERYTHING the owner would want to change lives in this file: which sites are
 * read, how much each one is trusted, and which words raise or bury a story.
 * There is no model, no API key and no training anywhere in Sift — this file is
 * the whole brain. Edit it, redeploy, and the board changes.
 *
 * Naming: `id` is a stable slug (it shows up in URLs and localStorage), `weight`
 * is 1-3 and behaves like the Daily Beacon's source weight.
 */

/* ------------------------------------------------------------------ SOURCES */

/** Steam's per-app news feed. Patch notes for the games he actually plays. */
const steam = (id, name, app, lane = "games") => ({
  id,
  name,
  url: `https://store.steampowered.com/feeds/news/app/${app}/?cc=us&l=english`,
  kind: "news",
  weight: 3,
  lanes: [lane, "games"],
  home: `https://store.steampowered.com/news/app/${app}`,
});

/** A YouTube channel feed: 15 most recent uploads, real thumbnails, real dates. */
const yt = (id, name, channelId, weight, lanes) => ({
  id,
  name,
  url: `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
  kind: "video",
  weight,
  lanes,
  home: `https://www.youtube.com/channel/${channelId}`,
});

const news = (id, name, url, weight, lanes, home) => ({
  id,
  name,
  url,
  kind: "news",
  weight,
  lanes,
  home: home || new URL(url).origin,
});

export const SOURCES = [
  /* ---------------------------------------------- the patch notes that matter */
  steam("steam-warframe", "Warframe", 230410),
  steam("steam-helldivers2", "Helldivers 2", 553850),
  steam("steam-nms", "No Man's Sky", 275850),
  steam("steam-palworld", "Palworld", 1623730),
  steam("steam-drg", "Deep Rock Galactic", 548430),
  steam("steam-repo", "R.E.P.O.", 3241660),
  steam("steam-aion2", "Aion 2", 3393110),
  steam("steam-crimson", "Crimson Desert", 3321460),
  steam("steam-aniimo", "Aniimo", 4126040),
  steam("steam-grainrot", "GRAIN ROT", 4450620),
  steam("steam-farfarwest", "Far Far West", 3124540),
  steam("steam-dragonsword", "DragonSword: Awakening", 4570720),

  /* ------------------------------------------------------------- games press */
  news("eurogamer", "Eurogamer", "https://www.eurogamer.net/feed", 3, ["gaming"]),
  news("pcgamer", "PC Gamer", "https://www.pcgamer.com/rss/", 3, ["gaming", "tech"]),
  news("rps", "Rock Paper Shotgun", "https://www.rockpapershotgun.com/feed", 3, ["gaming", "indie"]),
  news("ign", "IGN", "https://feeds.ign.com/ign/games-all", 2, ["gaming"]),
  news("gamespot", "GameSpot", "https://www.gamespot.com/feeds/mashup/", 2, ["gaming"]),
  news("gamesradar", "GamesRadar", "https://www.gamesradar.com/rss/", 2, ["gaming"]),
  news("pcgamesn", "PCGamesN", "https://www.pcgamesn.com/mainrss.xml", 2, ["gaming"]),
  news("vgc", "VGC", "https://www.videogameschronicle.com/feed/", 2, ["gaming", "business"]),
  news("kotaku", "Kotaku", "https://kotaku.com/rss", 2, ["gaming"]),
  news("dexerto", "Dexerto", "https://www.dexerto.com/feed/", 2, ["gaming", "creator"]),
  news("nintendolife", "Nintendo Life", "https://www.nintendolife.com/feeds/latest", 2, ["gaming"]),
  news("pushsquare", "Push Square", "https://www.pushsquare.com/feeds/latest", 2, ["gaming"]),
  news("purexbox", "Pure Xbox", "https://www.purexbox.com/feeds/latest", 2, ["gaming"]),
  news("timeextension", "Time Extension", "https://www.timeextension.com/feeds/latest", 1, ["gaming"]),
  news("gematsu", "Gematsu", "https://www.gematsu.com/feed", 2, ["gaming", "anime"]),
  news("rpgsite", "RPG Site", "https://www.rpgsite.net/feed", 1, ["gaming"]),
  news("siliconera", "Siliconera", "https://www.siliconera.com/feed/", 1, ["gaming", "anime"]),
  news("automaton", "Automaton", "https://automaton-media.com/en/feed/", 1, ["gaming", "indie"]),
  news("gamingonlinux", "GamingOnLinux", "https://www.gamingonlinux.com/article_rss.php", 1, ["gaming", "indie"]),
  news("indiegamesplus", "Indie Games Plus", "https://indiegamesplus.com/feed", 1, ["indie", "gaming"]),

  /* -------------------------------------------------------------- industry */
  news("gamesindustry", "GamesIndustry.biz", "https://www.gamesindustry.biz/feed", 2, ["business", "gaming"]),
  news("gamedeveloper", "Game Developer", "https://www.gamedeveloper.com/rss.xml", 2, ["gamedev", "business"]),
  news("variegaming", "Variety Gaming", "https://variety.com/v/gaming/feed/", 1, ["business"]),

  /* ------------------------------------------------------------ dev + engines */
  news("godot", "Godot Engine", "https://godotengine.org/rss.xml", 3, ["gamedev"]),
  news("80lv", "80.lv", "https://80.lv/feed/", 1, ["gamedev"]),

  /* ------------------------------------------------------------------ anime */
  news("ann", "Anime News Network", "https://www.animenewsnetwork.com/all/rss.xml", 2, ["anime"]),
  news("animecorner", "Anime Corner", "https://animecorner.me/feed/", 1, ["anime"]),

  /* --------------------------------------------------------------- ai + tech */
  news("arstech", "Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", 2, ["tech"]),
  news("arstech-gaming", "Ars Technica Gaming", "https://feeds.arstechnica.com/arstechnica/gaming", 2, ["gaming", "tech"]),
  news("vergeai", "The Verge AI", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", 2, ["ai", "tech"]),
  news("techcrunchai", "TechCrunch AI", "https://techcrunch.com/category/artificial-intelligence/feed/", 2, ["ai", "tech"]),
  news("huggingface", "Hugging Face", "https://huggingface.co/blog/feed.xml", 1, ["ai", "gamedev"]),
  news("tomshardware", "Tom's Hardware", "https://www.tomshardware.com/feeds/all", 1, ["tech"]),
  news("wccftech", "Wccftech", "https://wccftech.com/feed/", 1, ["tech"]),
  news("digitalfoundry", "Digital Foundry", "https://feeds.feedburner.com/digitalfoundry", 2, ["gaming", "tech"]),
  news("hn", "Hacker News", "https://hnrss.org/frontpage?points=150", 1, ["gamedev", "ai"], "https://news.ycombinator.com"),

  /* ------------------------------------------------------------------- steam */
  news("steam-news", "Steam", "https://store.steampowered.com/feeds/news.xml", 1, ["gaming"], "https://store.steampowered.com/news/"),
  news("reddit-games", "r/Games", "https://www.reddit.com/r/Games/top/.rss?t=day", 1, ["gaming"], "https://www.reddit.com/r/Games"),

  /* ---------------------------------------------- the creators he actually watches
     CHANNEL POLICY from the Beacon applies: commentary, reviews, documentaries and
     essays only. Gameplay uploads, clip channels and branded entertainment are out. */
  yt("yt-asmongold", "Asmongold TV", "UCQeRaTukNYft1_6AZPACnog", 3, ["creator", "gaming"]),
  yt("yt-penguinz0", "penguinz0", "UCq6VFHwMzcMXbuKyG7SQYIg", 3, ["creator"]),
  yt("yt-moistgaming", "MoistCr1TiKaL Gaming", "UCxfr3b8IuHSzu22UHnAvHWg", 3, ["creator", "gaming"]),
  yt("yt-angryjoe", "AngryJoeShow", "UCsgv2QHkT2ljEixyulzOnUQ", 3, ["creator", "gaming"]),
  yt("yt-dunkey", "videogamedunkey", "UCsvn_Po0SmunchJYOWpOxMg", 3, ["creator", "gaming"]),
  yt("yt-ih", "Internet Historian", "UCR1D15p_vdP3HkrH8wgjQRw", 3, ["creator"]),
  yt("yt-eyepatch", "Super Eyepatch Wolf", "UCtGoikgbxP4F3rgI9PldI9g", 3, ["creator", "anime"]),
  yt("yt-nakeyjakey", "NakeyJakey", "UCSdma21fnJzgmPodhC9SJ3g", 3, ["creator", "gaming"]),
  yt("yt-kiratv", "KiraTV", "UCcKSEzhtEkzfCT8_DzyMfpg", 3, ["creator", "gaming"]),
  yt("yt-pyro", "Pyrocynical", "UCN5xN8gIljvWYnsj06V8WbQ", 3, ["creator", "gaming"]),
  yt("yt-joshstrife", "Josh Strife Says", "UCKr-aOmHkFUg6P9B8A_6jgQ", 3, ["creator", "gaming"]),
  yt("yt-threat", "Threat Interactive", "UC2ksme4hP4Nx97ilFTQ0K0Q", 3, ["creator", "gamedev"]),
  yt("yt-visualventure", "Visual Venture", "UCt3JiNkefsfbA2N4SgEkoiQ", 3, ["creator"]),
  yt("yt-nexpo", "Nexpo", "UCpFFItkfZz1qz5PpHpqzYBw", 3, ["creator"]),
  yt("yt-blamejorge", "blameitonjorge", "UCU3oAyhHDXjgbxazqOEG2UA", 3, ["creator"]),
  yt("yt-curiousarchive", "Curious Archive", "UCweDKPSF65wRw5VHFUJYiow", 3, ["creator"]),
  yt("yt-fern", "fern", "UCODHrzPMGbNv67e84WDZhQQ", 3, ["creator"]),
  yt("yt-ahoy", "Ahoy", "UCE1jXbVAGJQEORz9nZqb5bQ", 3, ["creator", "gaming"]),
  yt("yt-vsauce", "Vsauce", "UC6nSFpj9HTCZ5t-N3Rm3-HA", 3, ["creator"]),
  yt("yt-real science", "Real Science", "UC176GAQozKKjhz62H8u9vQQ", 3, ["creator"]),
  yt("yt-cryton", "Cryton", "UCb9gttCzPcabOnq1nFYPwsw", 3, ["creator"]),
  yt("yt-poi", "poi", "UCRVXfhLRsLWi3_IKnMDiI1Q", 2, ["creator"]),
  yt("yt-scaryinteresting", "Scary Interesting", "UCNXvmGafmrtJ7VPSqjRRbwg", 2, ["creator"]),
  yt("yt-nerdwriter", "Nerdwriter1", "UCJkMlOu7faDgqh4PfzbpLdg", 2, ["creator"]),
  yt("yt-daryltalks", "Daryl Talks Games", "UCJfJWct8jN1RpCuVWk3zHTA", 2, ["creator", "gaming"]),
  yt("yt-jimbrowning", "Jim Browning", "UCBNG0osIBAprVcZZ3ic84vw", 2, ["creator"]),
  yt("yt-gigguk", "Gigguk", "UC7dF9qfBMXrSlaaFFDvV_Yg", 3, ["creator", "anime"]),
  yt("yt-aiexplained", "AI Explained", "UCNJ1Ymd5yFuUPtn21xtRbbw", 3, ["creator", "ai"]),
  yt("yt-mattwolfe", "Matt Wolfe", "UChpleBmo18P08aKCIgti38g", 3, ["creator", "ai"]),
  yt("yt-2minpapers", "Two Minute Papers", "UCbfYPyITQ-7l4upoX8nvctg", 3, ["creator", "ai"]),
  yt("yt-bycloud", "bycloud", "UCgfe2ooZD3VJPB6aJAnuQng", 3, ["creator", "ai"]),
  yt("yt-aisearch", "AI Search", "UCIgnGlGkVRhd4qNFcEwLL4A", 3, ["creator", "ai"]),
];

/* -------------------------------------------------------------------- TASTE */

/**
 * A "hit" needs the term to appear as a whole word-ish run, so "godot" does not
 * fire inside "godotlike" nonsense and "anime" inside "animated". `stems` are
 * matched with looser boundaries on purpose.
 */
export const TASTE = {
  /** Raised scores. Each key fires at most once per item. */
  boost: [
    {
      key: "mygames",
      pts: 30,
      terms: [
        "warframe", "hytale", "helldivers", "crimson desert", "no man's sky",
        "palworld", "deep rock galactic", "r.e.p.o", "aion 2", "dragonsword",
        "aniimo", "grain rot", "far far west",
      ],
    },
    { key: "godot", pts: 26, terms: ["godot", "godot engine", "gdscript"] },
    { key: "anime", pts: 22, terms: [] }, // filled from data/anime-titles.json
    {
      key: "indiehit",
      pts: 18,
      terms: ["indie game", "roguelite", "roguelike", "breakout hit", "sold over", "concurrent players"],
    },
    {
      key: "gamedev",
      pts: 14,
      terms: [
        "unreal engine", "unity", "blender", "shader", "procedural generation",
        "devlog", "game jam", "level design", "voxel",
      ],
    },
    {
      key: "aidev",
      pts: 12,
      terms: [
        "coding model", "agentic", "benchmark", "open-weight", "open weights",
        "local model", "context window", "token price", "inference cost",
      ],
    },
    { key: "creator", pts: 10, terms: [] }, // kind === 'video' && weight >= 2
  ],

  /** Buried, never banned — a big event inside a boring genre still surfaces. */
  penalty: [
    {
      key: "politics",
      pts: -60,
      terms: [
        "election", "parliament", "senate", "congress", "prime minister",
        "president trump", "white house", "ceasefire", "sanctions", "nato",
        "referendum", "political party",
      ],
    },
    {
      key: "celebrity",
      pts: -50,
      terms: [
        "red carpet", "divorce", "ex-girlfriend", "ex-boyfriend", "dating",
        "wedding", "outfit", "slams", "feud", "rumoured romance",
      ],
    },
    { key: "spoilers", pts: -40, terms: ["spoiler", "plot twist", "the ending explained", "major cameo"] },
    {
      key: "rumour",
      pts: -40,
      terms: ["rumour", "rumor", "reportedly", "unconfirmed", "it is believed", "leaker"],
    },
    { key: "sports", pts: -40, terms: ["transfer window", "premier league", "stanley cup", "world cup", "touchdown"] },
    { key: "lootbox", pts: -45, terms: ["loot box", "lootbox", "gacha rates", "battle pass price"] },
    {
      key: "guides",
      pts: -35,
      terms: ["how to ", "where to find", "walkthrough", "best build", "tier list", "location guide"],
    },
    { key: "deals", pts: -30, terms: ["% off", "price drop", "deal of the day", "discount code", "best deals"] },
    {
      // r/Games is half self-promotion: a developer introducing their own game.
      // Some of it is good, but a wall of it is exactly the noise this thing
      // exists to remove, so it gets buried rather than boosted.
      key: "selfpromo",
      pts: -35,
      terms: [
        "hi all", "hi games", "hi everyone", "hey everyone", "hey all", "hello everyone", "hello all",
        "one of the developers", "one of the devs", "solo developer", "solo dev",
        "small indie team", "we are a small team", "we're a small team", "our small team",
        "my first game", "our first game", "my new game", "our new game",
        "introduce our", "introduce my", "we are proud to announce", "we're proud to announce",
        "please wishlist", "wishlist it", "please check it out", "feedback welcome",
        "demo out now", "we just released", "i just released", "happy indie sunday",
        // A Steam store link in the excerpt is the clearest tell of all: an outlet's
        // news item quotes the shop, a developer's post advertises it.
        "store.steampowered.com", "steam (early access)", "steam page", "early access out now",
      ],
    },
  ],

  /** Discarded before storage. Never shown, never counted. */
  drop: [
    ["porn", "xxx", "nsfw", "onlyfans"],
    ["casino", "betting odds", "free spins", "sportsbook"],
    ["sponsored content", "[ad]", "[promoted]"],
  ],

  /** Freshness bonus curve, in hours. */
  freshness: [
    [6, 20],
    [12, 12],
    [24, 6],
    [72, 2],
  ],
};

/** How long a row is kept before the ingest prunes it. */
export const RETENTION_DAYS = 120;
/** Below this an item is stored but never rendered (hard junk). */
export const MIN_SCORE = 1;

export const LANES = [
  { id: "games", label: "My games", note: "Warframe, Hytale, Helldivers, Palworld, NMS…" },
  { id: "gaming", label: "Gaming", note: "The news wire" },
  { id: "indie", label: "Indie", note: "Small studios, first-day breakouts" },
  { id: "anime", label: "Anime", note: "His 9-10/10 list only" },
  { id: "gamedev", label: "Gamedev", note: "Godot, engines, tools" },
  { id: "ai", label: "AI", note: "Models, agents, real benchmarks" },
  { id: "tech", label: "Tech", note: "Hardware, platforms" },
  { id: "business", label: "Industry", note: "Money, closures, moves" },
  { id: "creator", label: "Creators", note: "The 30 channels he actually watches" },
];
