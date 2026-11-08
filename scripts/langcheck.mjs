/**
 * langcheck — which sources are actually publishing in English?
 *
 * The board carries ~3100 items from 181 feeds. Some of those feeds are a
 * Japanese desk, a Polish portal, a Spanish edition. They are all fine sources
 * and they were all deliberate additions, but they are not readable by someone
 * who asked for English only, so this measures them rather than guessing from
 * the feed URL: it looks at the headlines the feed actually published.
 *
 * A headline is counted as "non-English" if it contains a character outside the
 * Latin script (kana, kanji, hangul, cyrillic, greek), or if it is long enough
 * and carries none of the words English headlines are made of.
 */
import { readFileSync, existsSync } from "node:fs";

const path = process.argv[2] || "dist/api/board.json";
if (!existsSync(path)) {
  console.error(`no board at ${path} — run a build first`);
  process.exit(1);
}

const board = JSON.parse(readFileSync(path, "utf8"));
const NON_LATIN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0370-\u03ff]/;
const EN_WORDS =
  /\b(the|a|an|of|to|in|for|on|with|and|is|are|was|were|will|new|how|why|what|this|that|from|by|at|as|it|its|you|your|we|our|first|after|over|more|says|games?|update|release[ds]?|launch(es|ed)?|review|best|top)\b/i;

function isEnglish(title) {
  if (NON_LATIN.test(title)) return false;
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return true; // too short to judge; do not condemn a feed for it
  return EN_WORDS.test(title);
}

const bySource = new Map();
for (const item of board.items) {
  const name = item.sourceName || "?";
  if (!bySource.has(name)) bySource.set(name, { total: 0, nonEnglish: 0, sample: "" });
  const bucket = bySource.get(name);
  bucket.total += 1;
  if (!isEnglish(item.title || "")) {
    bucket.nonEnglish += 1;
    if (!bucket.sample) bucket.sample = item.title;
  }
}

const rows = [...bySource.entries()]
  .map(([name, s]) => ({ name, ...s, ratio: s.nonEnglish / s.total }))
  .filter((r) => r.ratio >= 0.25)
  .sort((a, b) => b.ratio - a.ratio || b.total - a.total);

console.log(`sources scanned : ${bySource.size}`);
console.log(`mostly non-English (>=25% of headlines): ${rows.length}\n`);
for (const r of rows) {
  console.log(
    `${(r.ratio * 100).toFixed(0).padStart(3)}%  ${String(r.total).padStart(3)} items  ${r.name.padEnd(28)} ${r.sample.slice(0, 46)}`,
  );
}
