import { test } from "node:test";
import assert from "node:assert/strict";

import { scoreItem, setAnimeTerms, cardSummary, isStorable, isEnglishText } from "../functions/_lib/score.mjs";
import { SOURCES } from "../functions/_lib/config.mjs";
import { ANIME_TERMS } from "../functions/_lib/anime-terms.mjs";
import { timeBucket } from "../functions/_lib/db.mjs";

const NOW = new Date("2026-11-08T12:00:00Z");

const newsSource = (weight = 2, lanes = ["gaming"]) => ({
  id: "test-news",
  name: "Test News",
  kind: "news",
  weight,
  lanes,
});

const videoSource = (weight = 3) => ({
  id: "test-video",
  name: "Test Video",
  kind: "video",
  weight,
  lanes: ["creator"],
});

const item = (overrides = {}) => ({
  title: "A headline about something",
  summary: "A short summary of what happened in the world today.",
  publishedAt: "2026-11-08T09:00:00Z", // 3h old
  ...overrides,
});

test.before(() => setAnimeTerms(ANIME_TERMS));

test("scoreItem_weightAndFreshnessOnly", () => {
  const result = scoreItem(item(), newsSource(2), NOW);
  // 20 (weight) + 20 (under 6h) = 40
  assert.equal(result.score, 40);
  assert.equal(result.drop, null);
});

test("scoreItem_freshnessCurveFallsOff", () => {
  const sixHours = scoreItem(item({ publishedAt: "2026-11-08T03:00:00Z" }), newsSource(1), NOW);
  const dayOld = scoreItem(item({ publishedAt: "2026-11-07T12:00:00Z" }), newsSource(1), NOW);
  const weekOld = scoreItem(item({ publishedAt: "2026-11-01T12:00:00Z" }), newsSource(1), NOW);
  assert.ok(sixHours.score > dayOld.score);
  assert.ok(dayOld.score > weekOld.score);
  assert.equal(weekOld.score, 10); // weight only
});

test("scoreItem_myGameBoostIsTheStrongestSignal", () => {
  const warframe = scoreItem(item({ title: "Warframe Devstream 198 overview" }), newsSource(1, ["games"]), NOW);
  const random = scoreItem(item({ title: "Some other game got a patch" }), newsSource(1, ["games"]), NOW);
  assert.equal(warframe.score - random.score, 30);
  assert.ok(warframe.lanes.includes("games"));
  assert.ok(warframe.boosts.includes("mygames"));
});

test("scoreItem_godotBoostFiresOnEngineNews", () => {
  const result = scoreItem(item({ title: "Godot 4.4 ships a faster renderer" }), newsSource(1, ["gamedev"]), NOW);
  assert.ok(result.boosts.includes("godot"));
  assert.ok(result.lanes.includes("gamedev"));
});

test("scoreItem_animeTitleMatchesAliasAndIsCaseInsensitive", () => {
  const byRomaji = scoreItem(item({ title: "Attack on Titan final season gets a new trailer" }), newsSource(1, ["anime"]), NOW);
  const byOriginal = scoreItem(item({ title: "shingeki no kyojin movie announced" }), newsSource(1, ["anime"]), NOW);
  assert.ok(byRomaji.boosts.includes("anime"));
  assert.ok(byOriginal.boosts.includes("anime"));
});

test("scoreItem_animeDoesNotFireOnUnrelatedWords", () => {
  const result = scoreItem(item({ title: "Animated series about a dog" }), newsSource(1, ["anime"]), NOW);
  assert.ok(!result.boosts.includes("anime"));
});

test("scoreItem_politicsPenaltyBuriesButKeeps", () => {
  const result = scoreItem(
    item({ title: "Senate hearing on game industry", summary: "The election is next week." }),
    newsSource(3),
    NOW,
  );
  assert.ok(result.penalties.includes("politics"));
  assert.equal(result.drop, null);
  assert.ok(result.score < 20, `score should be low, got ${result.score}`);
});

test("scoreItem_dealsAreBuried", () => {
  const result = scoreItem(item({ title: "Best deals: 40% off this gaming PC" }), newsSource(2), NOW);
  assert.ok(result.penalties.includes("deals"));
});

test("scoreItem_dropsCasinoAndAdultContent", () => {
  assert.equal(scoreItem(item({ title: "Best casino bonus codes" }), newsSource(2), NOW).drop, "casino");
  assert.equal(scoreItem(item({ title: "NSFW fan art roundup" }), newsSource(2), NOW).drop, "porn");
  assert.equal(isStorable(scoreItem(item({ title: "Casino betting odds today" }), newsSource(2), NOW)), false);
});

test("scoreItem_creatorBoostOnlyForVideoSources", () => {
  const onVideo = scoreItem(item(), videoSource(3), NOW);
  const onNews = scoreItem(item(), newsSource(3), NOW);
  assert.ok(onVideo.boosts.includes("creator"));
  assert.ok(!onNews.boosts.includes("creator"));
});

test("scoreItem_scoreIsClampedTo100", () => {
  const result = scoreItem(
    item({
      title: "Warframe Hytale Helldivers Palworld No Man's Sky mega update",
      summary: "Godot and Unreal Engine notes for this indie roguelite, plus agentic AI tooling.",
      publishedAt: "2026-11-08T11:55:00Z",
    }),
    { ...videoSource(3), lanes: ["creator", "games"] },
    NOW,
  );
  assert.equal(result.score, 100);
});

test("scoreItem_neverDropsForAnUnpopularGenre", () => {
  const soulslike = scoreItem(item({ title: "Elden Ring hits a new player record" }), newsSource(2), NOW);
  assert.equal(soulslike.drop, null);
  assert.ok(soulslike.score > 0);
});

test("scoreItem_lanesGainTheBoostLane", () => {
  // A gaming feed breaking anime news does belong in the anime filter — that is
  // the point of lanes. But it keeps its own lane too, so it is not lost there.
  const result = scoreItem(item({ title: "Demon Slayer game announced" }), newsSource(2, ["gaming"]), NOW);
  assert.deepEqual(result.lanes, ["gaming", "anime"]);
});

test("scoreItem_lanesHaveNoDuplicates", () => {
  const result = scoreItem(item({ title: "Warframe update" }), newsSource(2, ["games", "gaming"]), NOW);
  assert.equal(new Set(result.lanes).size, result.lanes.length);
  assert.deepEqual(result.lanes, ["games", "gaming"]);
});

test("cardSummary_dropsASummaryThatRepeatsTheHeadline", () => {
  const summary = cardSummary({
    title: "Warframe gets a new update",
    summary: "Warframe gets a new update",
  });
  assert.equal(summary, "");
});

test("cardSummary_keepsTwoSentencesMax", () => {
  const summary = cardSummary({
    title: "Different headline",
    summary: "First sentence here. Second sentence here. Third sentence here.",
  });
  assert.equal(summary, "First sentence here. Second sentence here.");
});

test("cardSummary_stripsMetadataOnlySummaries", () => {
  // Hacker News puts a bare URL in the description. A card reading
  // "Article URL: https://…" is worse than no summary at all.
  assert.equal(cardSummary({ title: "Goodbye Claude, Hello Pi", summary: "Article URL: https://caleb.software/posts/claude-to-pi" }), "");
  assert.equal(cardSummary({ title: "Something", summary: "Comments URL: https://news.ycombinator.com/item?id=1 Points: 200" }), "");
  // A real sentence with a link in it keeps the sentence.
  const kept = cardSummary({
    title: "A studio closed",
    summary: "The studio posted a statement at https://example.com/statement explaining the closure today.",
  });
  assert.ok(kept.startsWith("The studio posted a statement"), kept);
  assert.ok(!kept.includes("http"), kept);
});

test("config_everySourceIsWellFormed", () => {
  const ids = new Set();
  for (const source of SOURCES) {
    assert.ok(source.id && typeof source.id === "string", "missing id");
    assert.ok(!ids.has(source.id), `duplicate id ${source.id}`);
    ids.add(source.id);
    assert.ok(/^https:\/\//.test(source.url), `bad url for ${source.id}`);
    assert.ok([1, 2, 3].includes(source.weight), `bad weight for ${source.id}`);
    assert.ok(source.kind === "news" || source.kind === "video", `bad kind for ${source.id}`);
    // A source either declares the lanes it covers, or opts in to being laned by
    // content. Empty lanes without that flag is an oversight, not a choice.
    const laned = Array.isArray(source.lanes) && source.lanes.length > 0;
    assert.ok(laned || source.lanedByContent === true, `no lanes for ${source.id}`);
  }
  assert.ok(SOURCES.length >= 40, `only ${SOURCES.length} sources`);
});

test("config_contentLanedSourceEarnsItsLane", () => {
  // Hacker News covers everything, so it declares no lanes. An item about a
  // benchmark is AI; a maths puzzle is not. This is what stopped "Making any
  // integer with four 2s" appearing in the AI lane.
  const hn = SOURCES.find((s) => s.id === "hn");
  assert.equal(hn.lanes.length, 0, "hn declares no lanes");
  assert.equal(hn.lanedByContent, true);

  const onTopic = scoreItem(
    item({ title: "An open-weight model beats the benchmark on a laptop", summary: "" }),
    hn,
    new Date("2026-11-08T12:00:00Z"),
  );
  assert.ok(onTopic.lanes.includes("ai"), `expected the ai lane, got ${onTopic.lanes}`);

  const offTopic = scoreItem(
    item({ title: "Making any integer with four 2s", summary: "" }),
    hn,
    new Date("2026-11-08T12:00:00Z"),
  );
  assert.equal(offTopic.lanes.length, 0, "an off-topic link must not claim a lane");
});

test("config_isEnglishOnly", () => {
  // The board is English only. These are the feeds that were removed for it —
  // if one comes back, this fails rather than silently re-polluting the board.
  const banned = [
    "4gamer", "animeanime", "denfaminico", "gamespark", "gigazine", "insidegames",
    "gamewatch", "automaton-jp", "gamekult", "gryonline", "gcores", "jeuxvideo",
    "everyeye", "multiplayerit", "3djuegos", "eurogamer-de", "eurogamer-pl",
    "eurogamer-es", "eurogamer-pt", "ign-brasil", "invenglobal", "gamepres",
    "dengekihobby", "mogulive", "panora", "actugaming", "gameblog",
    "gamereactor-dk", "gamereactor-no", "gamereactor-se", "grampl", "ign-benelux",
  ];
  const present = SOURCES.filter((source) => banned.includes(source.id)).map((s) => s.id);
  assert.deepEqual(present, [], `non-English sources are back: ${present.join(", ")}`);

  // The English editions of the same brands must survive the purge.
  const ids = new Set(SOURCES.map((source) => source.id));
  for (const kept of ["automaton", "eurogamer", "gamereactor", "ign"]) {
    assert.ok(ids.has(kept), `${kept} (English edition) was removed by mistake`);
  }
});

test("isEnglishText_dropsNonLatinScript", () => {
  assert.equal(isEnglishText("『ポケモンGO』“激レア”な色違いが出現"), false);
  assert.equal(isEnglishText("[취재] 치열한 이전 신경전"), false);
  assert.equal(isEnglishText("放下枷锁，《火焰纹章》就是现在最好的日式RPG"), false);
});

test("isEnglishText_dropsLatinLanguagesItCanProve", () => {
  // Polish
  assert.equal(isEnglishText("Forza Horizon 6 doczekała się paru pożądanych zmian i aut"), false);
  assert.equal(isEnglishText("Tego nikt się nie spodziewał. Symulator wojskowy oferuje teraz"), false);
  // French
  assert.equal(isEnglishText("Pour la sortie de Zelda, Google revient en 1998"), false);
  // German
  assert.equal(isEnglishText("Mass-Effect-Modder schlägt Alarm: KI und Vibe Coding"), false);
  // Portuguese / Spanish
  assert.equal(isEnglishText("Criar um novo Mass Effect pode custar mais de 200 milhões"), false);
  assert.equal(isEnglishText("Unity ha mantenido conversaciones para ser adquirida"), false);
});

test("isEnglishText_keepsEveryKindOfEnglishHeadline", () => {
  const keep = [
    "WoW: Forever is the biggest launch in World of Warcraft history, says Blizzard",
    // Title case with no lowercase function words at all
    "AI finally sleeps, Gemini 4 Carbon, ETH cracked, energy-based models",
    "Mega Drive Fan – 1992-05-15 – Appendix – Mega-CD Fan Volume 2",
    "Preview: 'Marvel Midnight' Titles Issue #3 Variant Covers",
    "Blizzard SHUT US DOWN??",
    "Star Wars Galactic Racer",
    // Short, name-like
    "Impostor Month Begins!",
    "Defold Newsletter October 2026",
    // Accented English and borrowed names must survive
    "Pokémon Legends Z-A sells 4 million in its first week",
    "Naoki Yoshida on why Final Fantasy XIV keeps growing",
  ];
  for (const title of keep) {
    assert.equal(isEnglishText(title), true, `dropped English: ${title}`);
  }
});

test("scoreItem_dropsAForeignItemEvenFromAnEnglishFeed", () => {
  // The safety net: config no longer carries non-English feeds, but one can still
  // syndicate a foreign item. That must not reach the board.
  const result = scoreItem(
    item({ title: "『ドラクエ』カセット風カードケースのデザインが良すぎる", summary: "" }),
    newsSource(2),
    NOW,
  );
  assert.equal(result.drop, "not-english");
  assert.equal(isStorable(result), false);
});

test("scoreItem_dropsWikiHousekeeping", () => {
  // Hidden Palace's recent-changes feed lists every file upload as an item, and
  // the board filled up with "File:SRR2FinalDebugSep122003Title.png" entries
  // whose body was upload metadata. The feed now asks for namespace 0 only, but
  // the gate has to hold regardless of what a wiki decides to syndicate.
  const junk = [
    "File:SRR2FinalDebugSep122003Title.png",
    "File:SRR2FinalDebugSep122003TheWatcher.png",
    "Category:Escape From Playtime prototypes",
    "User:CartridgeCulture",
    "Template:Infobox game",
  ];
  for (const title of junk) {
    const result = scoreItem(item({ title, summary: "" }), newsSource(2), NOW);
    assert.equal(isStorable(result), false, `kept wiki page: ${title}`);
  }

  // The actual preservation work must still get through.
  const real = item({
    title: "The Simpsons: Hit & Run (Sep 12, 2003 prototype)",
    summary: "A work-in-progress build of the game, recovered and documented.",
  });
  assert.equal(isStorable(scoreItem(real, newsSource(2), NOW)), true);
});

test("config_sourceWeightsAreSane", () => {
  const byId = Object.fromEntries(SOURCES.map((source) => [source.id, source]));
  assert.equal(byId["godot"].weight, 3);
  assert.equal(byId["steam-warframe"].weight, 3);
  assert.ok(byId["steam-warframe"].lanes.includes("games"));
  assert.ok(byId["yt-asmongold"].kind === "video");
});

test("scoreItem_buriesIndieSelfPromo", () => {
  const post = scoreItem(
    item({
      title: "Pogo Riot - AzDimension - A chaotic first-person multiplayer game",
      summary: "Hi everyone! I'm one of the developers at AzDimension, and I'd like to introduce our new game.",
    }),
    { ...newsSource(1, ["gaming"]), id: "reddit-games" },
    NOW,
  );
  assert.ok(post.penalties.includes("selfpromo"), "self-promo should be penalised");
  // A real story from the same source must outrank it comfortably.
  const news = scoreItem(
    item({ title: "Rockstar confirms a delay to its next game", summary: "The studio posted a statement today." }),
    { ...newsSource(1, ["gaming"]), id: "reddit-games" },
    NOW,
  );
  assert.ok(news.score >= post.score + 25, `news ${news.score} should beat promo ${post.score}`);
  assert.ok(post.score < 15, `promo should sink, got ${post.score}`);
});

test("timeBucket_sixHourBlocks", () => {
  assert.equal(timeBucket("2026-11-08T00:12:00.000Z"), "2026-11-08T00");
  assert.equal(timeBucket("2026-11-08T05:59:00.000Z"), "2026-11-08T00");
  assert.equal(timeBucket("2026-11-08T06:00:00.000Z"), "2026-11-08T06");
  assert.equal(timeBucket("2026-11-08T11:30:00.000Z"), "2026-11-08T06");
  assert.equal(timeBucket("2026-11-08T18:00:00.000Z"), "2026-11-08T18");
  assert.equal(timeBucket("2026-11-08T23:59:59.000Z"), "2026-11-08T18");
  // Blocks must sort as strings, which is the only reason this shape was chosen.
  assert.ok(timeBucket("2026-11-08T12:00:00.000Z") > timeBucket("2026-11-08T11:00:00.000Z"));
  assert.ok(timeBucket("2026-11-09T00:00:00.000Z") > timeBucket("2026-11-08T23:00:00.000Z"));
});
