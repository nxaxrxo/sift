/**
 * parse.mjs — a small, dependency-free feed reader.
 *
 * Handles the three formats that cover every source on the board:
 *   RSS 2.0   <rss><channel><item>…</item></channel></rss>
 *   Atom 1.0  <feed><entry>…</entry></feed>
 *   RSS 1.0   <rdf:RDF><item rdf:about="…">…</item></rdf:RDF>
 *
 * Deliberately not a general XML parser: we split on the item boundary and pull
 * flat fields out. That is exactly as robust as needed (every real-world feed
 * keeps item metadata flat) and it never chokes on the malformed markup that
 * full parsers reject. A malformed *item* is skipped; the feed still yields the
 * rest.
 */

import { decodeEntities, firstImageUrl, looksLikeImage, normaliseUrl, titleKey, trimSummary, unwrapCdata } from "./clean.mjs";

const ITEM_RE = /<(item|entry)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

/** Reads `<tag>…</tag>` where the tag may carry attributes and a namespace prefix. */
function field(block, names) {
  for (const name of names) {
    const re = new RegExp(
      `<${name}\\b[^>]*?(?:\\s(?:href|url)\\s*=\\s*["']([^"']+)["'])?[^>]*>([\\s\\S]*?)</${name}>`,
      "i",
    );
    const match = block.match(re);
    if (match) {
      const value = unwrapCdata(match[2]).trim();
      if (value) return { value, href: match[1] || null };
    }
  }
  return null;
}

/** Self-closing / attribute-only elements: `<media:content url="…"/>`, `<link href="…"/>`. */
function attrField(block, names, attrNames) {
  for (const name of names) {
    for (const attr of attrNames) {
      const re = new RegExp(`<${name}\\b[^>]*?\\s${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i");
      const match = block.match(re);
      if (match) return decodeEntities(match[1]).trim();
    }
  }
  return null;
}

const TITLE_NAMES = ["title"];
const LINK_NAMES = ["link"];
const DATE_NAMES = ["pubDate", "dc:date", "published", "updated", "issued"];
const SUMMARY_NAMES = ["description", "summary", "content:encoded", "content", "dc:description"];
const AUTHOR_NAMES = ["dc:creator", "author", "name"];

/**
 * Feed dates arrive as RFC 2822 ("Sat, 07 Nov 2026 20:06:10 +0000") or ISO 8601.
 * Anything unparseable becomes null rather than Date.now(), because a fake
 * "just now" would park junk at the top of the board forever.
 */
export function parseDate(value) {
  if (!value) return null;
  const raw = String(value).trim();

  // A date with no zone must be read as UTC, not as this machine's local time:
  // Node would otherwise shift it by the host's offset, which silently reorders
  // the board depending on where the worker happens to run.
  const loose = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/);
  if (loose) {
    const guess = Date.parse(`${loose[1]}T${loose[2]}Z`);
    return Number.isFinite(guess) ? new Date(guess).toISOString() : null;
  }

  const time = Date.parse(raw);
  if (Number.isFinite(time)) return new Date(time).toISOString();
  return null;
}

/** YouTube ids appear in `<yt:videoId>` and in the `watch?v=` link. */
function youtubeId(block, link) {
  const direct = block.match(/<yt:videoId>([\w-]{6,})<\/yt:videoId>/i);
  if (direct) return direct[1];
  const fromLink = String(link || "").match(/[?&]v=([\w-]{6,})/);
  return fromLink ? fromLink[1] : null;
}

/** Tries every sanctioned image location, in order of reliability. */
function findImage(block, link, rssImage) {
  const media = attrField(block, ["media:content", "media:thumbnail", "itunes:image"], ["url", "href"]);
  if (media && looksLikeImage(media)) return media;

  const enclosure = attrField(block, ["enclosure"], ["url"]);
  if (enclosure && looksLikeImage(enclosure)) return enclosure;

  const inBody = firstImageUrl(rssImage) || firstImageUrl(block);
  if (inBody) return inBody;

  const videoId = youtubeId(block, link);
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return null;
}

/**
 * Parse a feed body into a normalised item array.
 *
 * Shape: { title, url, urlKey, titleKey, summary, image, author, publishedAt }
 * Items missing a usable title or url are dropped here — they cannot be rendered
 * or deduped, and there is no point carrying them further.
 */
export function parseFeed(xml, { source } = {}) {
  const body = String(xml ?? "");
  if (!body.trim()) return [];

  const items = [];
  ITEM_RE.lastIndex = 0;

  for (const match of body.matchAll(ITEM_RE)) {
    const block = match[3];

    const titleField = field(block, TITLE_NAMES);
    const title = titleField ? decodeEntities(titleField.value).replace(/\s+/g, " ").trim() : "";
    if (!title) continue;

    const linkField = field(block, LINK_NAMES);
    const rawUrl =
      (linkField && (linkField.href || linkField.value)) ||
      attrField(block, ["link"], ["href"]) ||
      field(block, ["guid", "id"])?.value ||
      "";
    const url = normaliseUrl(rawUrl);
    if (!url) continue;

    const summaryField = field(block, SUMMARY_NAMES);
    const summary = summaryField ? trimSummary(summaryField.value) : "";

    const dateField = field(block, DATE_NAMES);
    const publishedAt = parseDate(dateField ? dateField.value : null);

    const authorField = field(block, AUTHOR_NAMES);

    items.push({
      title,
      url,
      urlKey: url,
      titleKey: titleKey(title, url),
      summary,
      image: findImage(block, url, summaryField ? summaryField.value : ""),
      author: authorField ? decodeEntities(authorField.value).replace(/\s+/g, " ").trim() : "",
      publishedAt,
      sourceId: source?.id ?? "unknown",
    });
  }

  return items;
}

/**
 * Undated items are real (some feeds simply omit the date). Rather than dropping
 * them, the caller stamps them with the ingest time so they still render — they
 * just sort below dated items through the score, not through a fake timestamp.
 */
export function applyFallbackDate(items, now = new Date()) {
  const iso = new Date(now).toISOString();
  return items.map((item) => (item.publishedAt ? item : { ...item, publishedAt: iso, undated: true }));
}

export const _internal = { field, attrField, findImage, youtubeId };
