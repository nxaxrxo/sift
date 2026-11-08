/**
 * clean.mjs — turning hostile markup into plain text.
 *
 * Feeds are the wild west: CDATA, double-escaped entities, five flavours of
 * "Read more" wrapper, tracking parameters glued to every link. Everything here
 * is pure text manipulation so it can be unit-tested without a network.
 */

/** Named entities that actually show up in feeds. Numeric ones are handled generically. */
const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•",
  middot: "·", deg: "°", eacute: "é", egrave: "è", agrave: "à",
  uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", ccedil: "ç",
  trade: "™", copy: "©", reg: "®", euro: "€", pound: "£", yen: "¥",
  frac12: "½", times: "×", divide: "÷", plusmn: "±", prime: "′",
  rarr: "→", larr: "←", harr: "↔", check: "✓", hearts: "♥", star: "★",
};

const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,10});/g;
const SCRIPT_STYLE_RE = /<(script|style|noscript|iframe)\b[\s\S]*?<\/\1>/gi;
const BLOCK_TAG_RE = /<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|blockquote|section|article|figure|figcaption)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;
const WS_RE = /[\s\u00a0\u200b\ufeff]+/g;

/** A tagline every publisher appends in one shape or another. */
const TAIL_RES = [
  /\s*(read more|continue reading|read the full|view full|the post .*? appeared first on .*)$/i,
  /\s*(click here to (read|see) more\.?)$/i,
  /\s*(source:\s*\S+)$/i,
];

/** Query parameters that identify a campaign, never a document. */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "yclid", "gbraid", "wbraid", "_ga", "_gl",
  "ref", "referrer", "referer", "source", "src", "cmpid", "campid", "smid", "smtyp",
  "mc_cid", "mc_eid", "igshid", "xtor", "trk", "trkcampaign", "si", "feature",
  "share", "share_id", "__twitter_impression", "at_medium", "at_campaign",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "oly_anon_id", "oly_enc_id", "spm", "ncid", "ito", "s", "t", "amp",
]);

/** Unwrap `<![CDATA[ … ]]>` so the same field regexes work on both flavours. */
export function unwrapCdata(value) {
  return String(value ?? "").replace(CDATA_RE, "$1");
}

/** Decode `&amp;` `&#8217;` `&#x2014;` in one pass. Unknown entities are left alone. */
export function decodeEntities(value) {
  return String(value ?? "").replace(ENTITY_RE, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** Full normalisation of a raw feed field: CDATA → entities → tags → whitespace. */
export function toPlainText(raw) {
  const cdata = unwrapCdata(raw);
  const decoded = decodeEntities(cdata);
  const deTagged = decoded
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(BLOCK_TAG_RE, " ")
    .replace(TAG_RE, " ");
  return decodeEntities(deTagged).replace(WS_RE, " ").trim();
}

/** Publisher boilerplate stripped off the end of a summary. */
function stripTail(text) {
  let out = text;
  for (const re of TAIL_RES) out = out.replace(re, "");
  return out.trim();
}

/**
 * Cut to a maximum length on a word boundary, then strip publisher tails.
 * Never leaves a dangling half-word or a stranded comma.
 */
export function trimSummary(text, max = 240) {
  const cleaned = stripTail(toPlainText(text));
  if (cleaned.length <= max) return cleaned;

  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–—(\s]+$/, "");
  return `${body}…`;
}

/** First image URL found anywhere in a raw HTML blob. */
export function firstImageUrl(raw) {
  const html = unwrapCdata(raw);
  const direct = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (direct) return decodeEntities(direct[1]).trim();
  const lazy = html.match(/<img\b[^>]*\bdata-src\s*=\s*["']([^"']+)["']/i);
  if (lazy) return decodeEntities(lazy[1]).trim();
  return null;
}

/** Reject obvious non-images that some feeds put in `enclosure`. */
export function looksLikeImage(url) {
  if (!url) return false;
  return /\.(?:jpe?g|png|webp|avif|gif)(?:$|[?#])/i.test(url) || /\/(?:image|img|thumb)/i.test(url);
}

/**
 * Canonical URL: lowercase host, drop the fragment, strip campaign params,
 * unify a trailing slash. Keeps meaningful query params (`?p=123`, `?id=`).
 */
export function normaliseUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";

  let url;
  try {
    url = new URL(input);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";

  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  const keep = [];
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAMS.has(key.toLowerCase())) keep.push([key, value]);
  }
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of keep) url.searchParams.append(key, value);

  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  url.pathname = path;

  return url.toString();
}

/** Host without `www.`, used to tell same-outlet reposts from cross-posts. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const NON_ALNUM_RE = /[^a-z0-9]+/g;

/**
 * Dedupe key for a headline.
 *
 * Short generic titles ("Patch 1.15", "Devstream overview") are common to several
 * games, so those keep the outlet in the key. A long headline is unique enough on
 * its own, which is what catches the same story posted by three outlets.
 */
export function titleKey(title, url = "") {
  const slug = toPlainText(title)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(NON_ALNUM_RE, " ")
    .trim()
    .replace(/\s+/g, "-");
  if (!slug) return "";
  return slug.length >= 40 ? slug : `${slug}@${hostOf(url)}`;
}

/** Rough sentence count, used to keep summaries to one or two sentences. */
export function countSentences(text) {
  const matches = String(text ?? "").match(/[.!?](\s|$)/g);
  return matches ? matches.length : text ? 1 : 0;
}

/** Keep at most `max` sentences of an already-clean string. */
export function limitSentences(text, max = 2) {
  if (!text) return "";
  const parts = String(text).match(/[^.!?]+[.!?]*\s*/g);
  if (!parts || parts.length <= max) return String(text).trim();
  return parts.slice(0, max).join("").trim();
}
