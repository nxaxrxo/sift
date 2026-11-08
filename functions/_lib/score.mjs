/**
 * score.mjs — the taste engine. Rules, no model.
 *
 * The one deal this file makes with the rest of the system: given the same item
 * and the same clock, it returns the same number. No randomness, no network, no
 * Date.now() hiding inside — `now` is always passed in. That is what makes the
 * whole board testable and what makes "why is this card here?" an answerable
 * question instead of a vibe.
 */

import { TASTE, MIN_SCORE } from "./config.mjs";
import { countSentences, limitSentences, toPlainText } from "./clean.mjs";

/* --------------------------------------------------------------- text match */

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Word-ish containment: "godot" hits "Godot 4.4 is out" but not "godotless", and
 * "anime" never hits "animated". Multi-word terms need whitespace-flexible
 * matching because feeds wrap titles across newlines.
 */
function containsTerm(haystack, term) {
  const needle = term.toLowerCase();
  let from = 0;

  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    from = at + 1;

    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] ?? "";
    const startOk = !before || !WORD_CHAR.test(before) || !WORD_CHAR.test(needle[0]);
    const endOk = !after || !WORD_CHAR.test(after) || !WORD_CHAR.test(needle[needle.length - 1]);
    if (startOk && endOk) return true;
  }
}

/* ------------------------------------------------------------- anime titles */

/**
 * Titles are injected at ingest from data/anime-titles.json — the owner's own
 * MAL list. Kept as a module-level cache so scoring stays synchronous while the
 * file is loaded once per isolate.
 */
let animeTerms = [];

export function setAnimeTerms(terms) {
  animeTerms = Array.isArray(terms) ? terms.filter((t) => typeof t === "string" && t.length >= 3) : [];
}

export function getAnimeTerms() {
  return animeTerms;
}

/* ------------------------------------------------------------------ scoring */

function freshnessPoints(publishedAt, now) {
  if (!publishedAt) return 0;
  const ageMs = new Date(now).getTime() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ageMs)) return 0;
  const hours = ageMs / 3_600_000;
  for (const [limitHours, points] of TASTE.freshness) {
    if (hours < limitHours) return points;
  }
  return 0;
}

/** Everyone gets one boost per key, no matter how many of its terms appear. */
function matchesForKey(key, haystack) {
  if (key === "anime") return animeTerms.some((term) => containsTerm(haystack, term));
  if (key === "creator") return false; // handled separately: it depends on the source, not the words
  const entry = TASTE.boost.find((b) => b.key === key);
  if (!entry) return false;
  return entry.terms.some((term) => containsTerm(haystack, term));
}

function penaltyPoints(haystack) {
  let total = 0;
  const fired = [];
  for (const rule of TASTE.penalty) {
    if (rule.terms.some((term) => containsTerm(haystack, term))) {
      total += rule.pts;
      fired.push(rule.key);
    }
  }
  return { total, fired };
}

function dropReason(haystack) {
  for (const group of TASTE.drop) {
    if (group.some((term) => containsTerm(haystack, term))) return group[0];
  }
  return null;
}

/**
 * Score one item.
 *
 * @param {object} item        parsed item (title, summary, publishedAt, …)
 * @param {object} source      entry from config SOURCES
 * @param {Date|number} now    current time, injected
 * @returns {{score:number, lanes:string[], drop:string|null, boosts:string[], penalties:string[]}}
 */
export function scoreItem(item, source, now) {
  const title = item?.title ?? "";
  const summary = item?.summary ?? "";
  const haystack = `${title} ${summary}`.toLowerCase();

  const dropped = dropReason(haystack);
  if (dropped) {
    return { score: 0, lanes: source?.lanes ?? [], drop: dropped, boosts: [], penalties: [] };
  }

  let score = (Number(source?.weight) || 1) * 10;
  score += freshnessPoints(item?.publishedAt, now);

  const boosts = [];
  for (const rule of TASTE.boost) {
    const isCreatorRule = rule.key === "creator";
    const hit = isCreatorRule
      ? source?.kind === "video" && Number(source?.weight) >= 2
      : matchesForKey(rule.key, haystack);
    if (hit) {
      score += rule.pts;
      boosts.push(rule.key);
    }
  }

  const { total: penaltyTotal, fired: penalties } = penaltyPoints(haystack);
  score += penaltyTotal;

  return {
    score: clamp(Math.round(score), 0, 100),
    lanes: laneList(source, boosts),
    drop: null,
    boosts,
    penalties,
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Lane order is the source's own lanes first, then any lane a boost unlocked, so
 * the card's edge mark stays stable across renders. Boost lanes are added even
 * when the source did not declare them: a Eurogamer story about Warframe really
 * does belong in "My games", and a gaming feed breaking Demon Slayer news really
 * does belong in "Anime". That is the whole point of the lane filter.
 */
function laneList(source, boosts) {
  const own = Array.isArray(source?.lanes) ? [...source.lanes] : [];
  const seen = new Set(own);

  for (const key of boosts) {
    const lane = BOOST_LANE[key];
    if (!lane || seen.has(lane)) continue;
    own.push(lane);
    seen.add(lane);
  }
  return own;
}

const BOOST_LANE = {
  mygames: "games",
  godot: "gamedev",
  anime: "anime",
  indiehit: "indie",
  gamedev: "gamedev",
  aidev: "ai",
  creator: "creator",
};

/* ------------------------------------------------------------- presentation */

/**
 * The card's one or two lines of copy. Never generated — only ever the feed's own
 * words, cut down. Returns "" when the publisher gave us nothing usable, which
 * the UI renders as a headline-only card.
 */
export function cardSummary(item) {
  const text = toPlainText(item?.summary ?? "");
  if (!text) return "";

  // A summary that just repeats the headline is noise on a moodboard.
  const titlePlain = toPlainText(item?.title ?? "").toLowerCase();
  if (text.toLowerCase().startsWith(titlePlain) && text.length < titlePlain.length + 40) return "";

  // Several feeds (Hacker News in particular) put a bare "Article URL: https://…"
  // in the description. That is metadata, not a summary, and it looked absurd on a
  // card. Strip the label and any leading URL; if nothing readable is left, the
  // card becomes headline-only, which is the honest rendering.
  const withoutUrls = text
    .replace(/\barticle\s+url\s*:\s*\S+/gi, " ")
    .replace(/\b(https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\bcomments?\s+url\s*:\s*\S+/gi, " ")
    .replace(/\bpoints?\s*:\s*\d+/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!withoutUrls || withoutUrls.length < 25) return "";

  return limitSentences(withoutUrls, 2).slice(0, 260);
}

/** Is this worth storing at all? */
export function isStorable(result) {
  return !result.drop && result.score >= MIN_SCORE;
}
