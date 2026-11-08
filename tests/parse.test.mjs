import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFeed, parseDate, applyFallbackDate } from "../functions/_lib/parse.mjs";

const RSS2 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Eurogamer</title>
  <item>
    <title><![CDATA[Star Wars studio lays off staff]]></title>
    <link>https://www.eurogamer.net/star-wars-studio-layoffs</link>
    <dc:creator>Vikki Blake</dc:creator>
    <pubDate>Sat, 07 Nov 2026 20:06:10 +0000</pubDate>
    <category>Layoffs</category>
    <media:content medium="image" url="https://assets.example/screen.jpg?width=690&amp;quality=85"/>
    <description><![CDATA[<img src="https://assets.example/screen.jpg" /> <p>Bit Reactor has laid off staff.</p> <p><a href="https://www.eurogamer.net/x">Read more</a></p>]]></description>
  </item>
  <item>
    <title>No image, no date</title>
    <link>https://www.eurogamer.net/second</link>
    <description>Just words.</description>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Verge</title>
  <entry>
    <author><name>Jennifer Tuohy</name></author>
    <title type="html"><![CDATA[NYT Cooking's AI assistant]]></title>
    <link rel="alternate" type="text/html" href="https://www.theverge.com/tech/1029489/review" />
    <id>https://www.theverge.com/1029489/x</id>
    <published>2026-11-07T10:50:00-05:00</published>
    <summary type="html"><![CDATA[Around 7PM each weeknight, I stand in front of the fridge.]]></summary>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <item rdf:about="https://store.steampowered.com/news/290724/">
    <title><![CDATA[Now Available on Steam - Domino VR]]></title>
    <link>https://store.steampowered.com/news/290724/</link>
    <dc:date>2026-11-05T02:39:19+0900</dc:date>
    <description><![CDATA[Build domino chains.<br><img src="https://cdn.example/header.jpg">]]></description>
  </item>
</rdf:RDF>`;

const YOUTUBE = `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <id>yt:video:XbH0GJQvlTY</id>
    <yt:videoId>XbH0GJQvlTY</yt:videoId>
    <title>Blizzard is doing EVERYTHING to stop us..</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=XbH0GJQvlTY"/>
    <published>2026-11-08T01:00:15+00:00</published>
    <media:group>
      <media:title>Blizzard is doing EVERYTHING to stop us..</media:title>
      <media:description>some description here</media:description>
      <media:content url="https://www.youtube.com/v/XbH0GJQvlTY?version=3" type="application/x-shockwave-flash" width="640" height="390"/>
    </media:group>
  </entry>
</feed>`;

const source = { id: "test", name: "Test", kind: "news", weight: 2, lanes: ["gaming"] };

test("parseFeed_readsRss2WithMediaImage", () => {
  const items = parseFeed(RSS2, { source });
  assert.equal(items.length, 2);

  const first = items[0];
  assert.equal(first.title, "Star Wars studio lays off staff");
  assert.equal(first.url, "https://eurogamer.net/star-wars-studio-layoffs");
  assert.equal(first.publishedAt, "2026-11-07T20:06:10.000Z");
  assert.equal(first.image, "https://assets.example/screen.jpg?width=690&quality=85");
  assert.ok(first.summary.startsWith("Bit Reactor has laid off staff."));
  assert.ok(!/read more/i.test(first.summary));
});

test("parseFeed_keepsUndatedItemsButFlagsThem", () => {
  const items = parseFeed(RSS2, { source });
  assert.equal(items[1].publishedAt, null);

  const stamped = applyFallbackDate(items, new Date("2026-11-08T09:00:00Z"));
  assert.equal(stamped[1].publishedAt, "2026-11-08T09:00:00.000Z");
  assert.equal(stamped[1].undated, true);
  assert.equal(stamped[0].publishedAt, "2026-11-07T20:06:10.000Z");
});

test("parseFeed_readsAtomWithAlternateLink", () => {
  const items = parseFeed(ATOM, { source });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://theverge.com/tech/1029489/review");
  assert.equal(items[0].publishedAt, "2026-11-07T15:50:00.000Z");
  assert.match(items[0].summary, /^Around 7PM/);
});

test("parseFeed_readsRdfAndPicksImageFromDescription", () => {
  const items = parseFeed(RDF, { source });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Now Available on Steam - Domino VR");
  assert.equal(items[0].image, "https://cdn.example/header.jpg");
  assert.equal(items[0].publishedAt, "2026-11-04T17:39:19.000Z");
});

test("parseFeed_fallsBackToYoutubeThumbnail", () => {
  const items = parseFeed(YOUTUBE, { source: { ...source, kind: "video" } });
  assert.equal(items.length, 1);
  assert.equal(items[0].image, "https://i.ytimg.com/vi/XbH0GJQvlTY/hqdefault.jpg");
  assert.equal(items[0].url, "https://youtube.com/watch?v=XbH0GJQvlTY");
});

test("parseFeed_survivesMalformedMarkup", () => {
  const broken = `<rss><channel>
    <item><title>Good one</title><link>https://a.example/1</link></item>
    <item><title></title><link>https://a.example/2</link></item>
    <item><title>No link at all</title></item>
  </channel></rss>`;
  const items = parseFeed(broken, { source });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Good one");
});

test("parseFeed_returnsEmptyForGarbage", () => {
  assert.deepEqual(parseFeed("", { source }), []);
  assert.deepEqual(parseFeed("<html><body>404</body></html>", { source }), []);
});

test("parseDate_acceptsRfc2822IsoAndLooseLocal", () => {
  assert.equal(parseDate("Sun, 08 Nov 2026 01:00:00 -0500"), "2026-11-08T06:00:00.000Z");
  assert.equal(parseDate("2026-11-08T01:00:00+00:00"), "2026-11-08T01:00:00.000Z");
  assert.equal(parseDate("2026-11-08 01:00:00"), "2026-11-08T01:00:00.000Z");
  assert.equal(parseDate("last tuesday"), null);
  assert.equal(parseDate(null), null);
});
