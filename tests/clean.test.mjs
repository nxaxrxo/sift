import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeEntities, normaliseUrl, titleKey, toPlainText, trimSummary, limitSentences, countSentences } from "../functions/_lib/clean.mjs";

test("decodeEntities_handlesNamedAndNumeric", () => {
  assert.equal(decodeEntities("Rock &amp; Roll"), "Rock & Roll");
  assert.equal(decodeEntities("It&#8217;s here"), "It’s here");
  assert.equal(decodeEntities("em&#x2014;dash"), "em—dash");
  assert.equal(decodeEntities("&nbsp;x&nbsp;"), " x ");
  assert.equal(decodeEntities("&notarealentity;"), "&notarealentity;");
});

test("toPlainText_stripsMarkupAndCollapsesSpace", () => {
  const dirty = "<![CDATA[<p>Hello <b>there</b></p><script>bad()</script>  world]]>";
  assert.equal(toPlainText(dirty), "Hello there world");
});

test("toPlainText_keepsApostrophesAndQuotes", () => {
  assert.equal(toPlainText("<p>It&#8217;s &#8220;fine&#8221;</p>"), "It’s “fine”");
});

test("normaliseUrl_stripsTrackingAndFragment", () => {
  const input = "https://WWW.Eurogamer.net/path/story?utm_source=rss&utm_medium=feed&id=42#comments";
  assert.equal(normaliseUrl(input), "https://eurogamer.net/path/story?id=42");
});

test("normaliseUrl_trailingSlashAndRejectsJunk", () => {
  assert.equal(normaliseUrl("https://a.example/news/"), "https://a.example/news");
  assert.equal(normaliseUrl("javascript:alert(1)"), "");
  assert.equal(normaliseUrl("not a url"), "");
});

test("titleKey_longTitlesAreGloballyUnique", () => {
  const a = titleKey("Eurogamer confirms the next big patch is live right now", "https://a.example/1");
  const b = titleKey("Eurogamer confirms the next big patch is live right now", "https://b.example/2");
  assert.equal(a, b);
});

test("titleKey_shortGenericTitlesKeepTheirHost", () => {
  const a = titleKey("Patch 1.15", "https://a.example/x");
  const b = titleKey("Patch 1.15", "https://b.example/x");
  assert.notEqual(a, b);
});

test("trimSummary_cutsOnWordBoundaryAndStripsTail", () => {
  const long = `${"word ".repeat(80)}Read more`;
  const out = trimSummary(long, 120);
  assert.ok(out.length <= 121, `too long: ${out.length}`);
  assert.ok(out.endsWith("…"));
  assert.ok(!/read more/i.test(out));
  assert.ok(!out.includes("wor…"));
});

test("trimSummary_leavesShortTextAlone", () => {
  assert.equal(trimSummary("<p>A short line.</p>"), "A short line.");
});

test("sentenceHelpers_countAndLimit", () => {
  const text = "One thing. Two thing. Three thing.";
  assert.equal(countSentences(text), 3);
  assert.equal(limitSentences(text, 2), "One thing. Two thing.");
});
