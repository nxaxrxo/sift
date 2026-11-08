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

/* ------------------------------------------------------------- language gate */

/**
 * The board is English only (owner's instruction). Removing the non-English
 * editions from config handles the bulk, but a feed can still syndicate the
 * occasional foreign item — an imported review, a translated press release — and
 * one Japanese headline on an English board is the same bug as a whole Japanese
 * feed.
 *
 * This errs hard towards keeping. A wrongly dropped story is invisible; a wrongly
 * kept one is obvious and gets fixed. So it only fires on evidence a piece of
 * English text could not plausibly produce.
 *
 *   1. Any character outside the Latin script — kana, hanzi, hangul, cyrillic,
 *      greek, thai, arabic, hebrew. One word is conclusive: English has none.
 *   2. Accented letters that English does not use — ą ł ż ś ę (Polish), ã õ (the
 *      Portuguese nasal vowels), å ø æ (Nordic), ğ ş ı (Turkish), ß (German),
 *      ő ű (Hungarian). Two of those in one headline is not a typo.
 *   3. A cluster of that language's own function words — "na", "się", "nie",
 *      "jest", "der", "und", "avec", "pour", "não", "para", "gli", "della".
 *      Three hits, or two of the very common ones, and it is not English.
 *
 * A short title, a product name and a code-heavy headline all pass untouched,
 * which is why "AI listed as: Claude 5, GPT 6.1" and "Mega Drive Fan – 1992-05-15"
 * survive while "Forza Horizon 6 doczekała się paru pożądanych zmian" does not.
 */
const NON_LATIN = /[\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0e00-\u0e7f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

const FOREIGN_ACCENTS = /[ąłżśęćńóźćĄŁŻŚĘĆŃÓŹßåøæÅØÆğşıĞŞİőűŐŰãõÃÕüöäÜÖÄřěůžýŘĚŮŽÝďťňĎŤŇ]/;

const FOREIGN_WORDS = new Set([
  // Polish
  "nie", "jest", "się", "oraz", "przez", "dla", "tego", "który", "będzie",
  "także", "może", "tylko", "bardzo", "właśnie", "którego", "której", "takiego",
  "lat", "roku", "nowa", "nowy", "nowe", "już", "gra", "gry", "gier", "tym",
  // German
  "der", "die", "das", "und", "mit", "für", "nicht", "eine", "einen", "wird",
  "werden", "auch", "sich", "nach", "beim", "durch", "gegen", "wurde", "dieser",
  "auf", "ist", "von", "bei", "aus", "ein", "den", "dem", "neue", "neuer", "neuen",
  "zeigt", "über", "jetzt", "mehr", "sind", "haben", "lässt", "macht", "steht",
  "kommt", "ohne", "gibt", "soll", "kann", "ihre", "seine", "diese", "diesem",
  // French
  "les", "des", "une", "est", "dans", "pour", "avec", "sur", "pas", "qui",
  "que", "plus", "sont", "cette", "aux", "par", "mais", "nous", "vous", "être",
  "comme", "toujours", "depuis", "encore", "selon", "au", "du", "et", "en",
  "la", "le", "de", "se", "ce", "il", "elle", "ses", "son",
  // Spanish / Portuguese
  "los", "las", "una", "por", "para", "con", "como", "pero", "más", "del",
  "não", "dos", "das", "seu", "sua", "está", "pelo", "pela", "mais", "também",
  "sobre", "entre", "quando", "onde", "muito", "todavía", "después", "ainda",
  "agora", "el", "es", "su", "al", "lo", "ser", "os", "em", "um", "é", "são",
  "sao", "já", "da", "do", "na", "no", "todo", "toda", "nos", "nas",
  // Italian
  "gli", "della", "delle", "degli", "che", "non", "sono", "anche", "dal",
  "nel", "nella", "alla", "allo", "questo", "questa", "essere", "hanno",
  "senza", "dopo", "sulla", "dello", "dei", "con", "per", "una", "il",
  // Dutch / Nordic
  "het", "een", "van", "voor", "met", "niet", "zijn", "wordt", "worden",
  "och", "att", "inte", "som", "med", "till", "har", "kan", "eller", "ikke",
  "blir", "efter", "deze", "naar", "maar", "ook", "nog",
]);

/**
 * English function words. Deliberately only the ones that really are function
 * words: "met" and "a" are left out because a Dutch or Portuguese headline uses
 * them too, and counting them on both sides would cancel the signal out.
 */
const ENGLISH_WORDS = new Set([
  "the", "an", "of", "to", "in", "for", "on", "with", "and", "or", "is", "are",
  "was", "were", "be", "been", "will", "would", "can", "could", "has", "have",
  "had", "not", "but", "at", "by", "as", "it", "its", "this", "that", "these",
  "those", "from", "into", "over", "after", "before", "about", "how", "why",
  "what", "when", "where", "who", "new", "now", "more", "most", "you", "your",
  "we", "our", "they", "their", "his", "her", "my", "out", "up", "all", "one",
  "so", "do", "does", "did", "says", "said", "first", "best", "top", "game",
  "games", "play", "players", "gets", "get", "just", "still", "only", "than",
]);

export function isEnglishText(text) {
  const value = String(text ?? "");
  if (!value) return true;
  if (NON_LATIN.test(value)) return false;

  // Two distinct accented letters, or one that repeats — enough to be a language
  // rather than a stray character. A single "ø" in a product name is not.
  const accented = [...new Set(value.match(new RegExp(FOREIGN_ACCENTS, "g")) || [])];
  if (accented.length >= 2) return false;
  if (accented.length === 1) {
    const repeats = (value.match(new RegExp(FOREIGN_ACCENTS, "g")) || []).length;
    if (repeats >= 3) return false;
  }

  const words = value.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 3) return true; // too short to judge; never condemn it

  const foreign = words.filter((word) => FOREIGN_WORDS.has(word)).length;
  const english = words.filter((word) => ENGLISH_WORDS.has(word)).length;

  // Three foreign function words and English is out of the question.
  if (foreign >= 3) return false;
  // Two, with more of them than English ones, and it is a foreign sentence.
  if (foreign >= 2 && foreign > english) return false;
  // One foreign word is only evidence when it is a fair slice of a short
  // headline AND nothing English appears at all — that is "Lista de Troféus de
  // GTA 6", not "Marty O'Donnell loses his race".
  if (foreign >= 1 && english === 0 && foreign / words.length >= 0.2) return false;
  // One foreign function word, not a single English one, and the text carries a
  // letter English does not use ("schlägt", "über", "años"). That combination is
  // never an English headline: "Mass-Effect-Modder schlägt Alarm" has the shape
  // of English and none of the substance.
  if (foreign >= 1 && english === 0 && accented.length >= 1) return false;

  return true;
}

function dropReason(haystack) {
  if (!isEnglishText(haystack)) return "not-english";
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
