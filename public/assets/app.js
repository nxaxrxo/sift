/**
 * app.js — the board.
 *
 * One page, one job: ask the API for cards, paint them, and never lose the
 * reader's place while it does. No framework, no build step, no dependencies.
 *
 * Structure:
 *   1  constants + state
 *   2  tiny DOM helpers
 *   3  formatting
 *   4  hidden cards (localStorage)
 *   5  card rendering
 *   6  feed loading + paging
 *   7  live updates
 *   8  filters, search, URL
 *   9  theme
 *  10  boot
 */

/* ------------------------------------------------------------------ 1. STATE */

const API = {
  feed: "/api/feed",
  sync: "/api/sync",
  stats: "/api/stats",
};

const PAGE_SIZE = 30;
const MAX_CARDS = 240;
const SYNC_EVERY_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;
const HIDDEN_KEY = "sift.hidden";
const THEME_KEY = "sift.theme";
const MAX_HIDDEN = 500;

const state = {
  lanes: [],
  query: "",
  cursor: null,
  loading: false,
  exhausted: false,
  topBucket: null, // hour of the newest card, for the "N new" pill
  topScore: 0,
  pending: 0,
  total: 0,
  oldest: null,
  lastSync: 0,
  stats: null,
};

const el = {
  cards: document.getElementById("cards"),
  status: document.getElementById("status"),
  sentinel: document.getElementById("sentinel"),
  empty: document.getElementById("empty"),
  emptyTitle: document.getElementById("empty-title"),
  emptyBody: document.getElementById("empty-body"),
  emptyAction: document.getElementById("empty-action"),
  pills: document.getElementById("pills"),
  searchForm: document.getElementById("search"),
  search: document.getElementById("q"),
  live: document.getElementById("live"),
  liveText: document.getElementById("live-text"),
  theme: document.getElementById("theme"),
  newbar: document.getElementById("newbar"),
  newbarCount: document.getElementById("newbar-count"),
  newbarBtn: document.getElementById("newbar-btn"),
  footerStats: document.getElementById("footer-stats"),
};

/* -------------------------------------------------------------- 2. DOM HELPERS */

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/* ---------------------------------------------------------------- 3. FORMATTING */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" but never "in 2 hours" — a feed date in the future is a clock bug. */
function relativeTime(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((then - Date.now()) / 1000);
  const future = seconds > 0;
  const abs = Math.abs(seconds);
  const value = future ? -abs : abs;

  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(value / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(value / 3600), "hour");
  if (abs < 7 * 86_400) return rtf.format(Math.round(value / 86_400), "day");
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortDate(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------- 4. HIDDEN CARDS */

function readHidden() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeHidden(list) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list.slice(-MAX_HIDDEN)));
  } catch {
    /* storage full or blocked; hiding then lasts only for this page view */
  }
}

const hidden = new Set(readHidden());

/* ------------------------------------------------------------- 5. CARD RENDERING */

function buildCard(item) {
  const card = node("a", "card");
  card.href = item.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.dataset.key = item.urlKey;
  card.dataset.lane = item.lanes[0] || "gaming";

  card.append(node("span", "card__mark"));

  // A card with no usable image does not get an empty 16:9 hole with a letter in
  // it — that reads as a broken tile and wastes half a column. It becomes a type
  // card instead: taller headline, longer excerpt, no media block at all.
  let media = null;

  if (item.image) {
    media = node("div", "card__media");

    const img = new Image();
    img.className = "card__img";
    // The first screen is loaded eagerly. Lazy-loading it means the opening view
    // shows empty frames until something scrolls, which is the exact opposite of
    // a moodboard.
    img.loading = el.cards.childElementCount < 12 ? "eager" : "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.alt = "";
    img.addEventListener("load", () => {
      img.classList.add("is-loaded");
    });
    img.addEventListener("error", () => {
      img.remove();
      media.remove();
      media = null;
      card.classList.add("card--type");
    });
    img.src = item.image;
    media.append(img);
  } else {
    card.classList.add("card--type");
  }

  if (item.kind === "video" && media) {
    const badge = node("span", "card__kind");
    badge.setAttribute("aria-hidden", "true");
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M9 6.5v11l9-5.5z"/></svg>';
    media.append(badge);
  }

  const body = node("div", "card__body");

  const meta = node("p", "card__meta");
  meta.append(node("span", "card__source", item.sourceName));
  meta.append(node("span", "card__dot", "·"));
  const when = node("span", "card__when", relativeTime(item.publishedAt));
  when.dataset.iso = item.publishedAt;
  meta.append(when);
  body.append(meta);

  const title = node("h2", "card__title", item.title);
  body.append(title);

  if (item.summary) {
    body.append(node("p", "card__sum", item.summary));
  }

  // `append(null)` would stringify into a literal "null" text node, so the type
  // card appends only its body.
  if (media) card.append(media);
  card.append(body);

  const hide = node("button", "card__hide", "×");
  hide.type = "button";
  hide.title = `Hide “${item.title}”`;
  hide.setAttribute("aria-label", `Hide “${item.title}”`);
  hide.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hidden.add(item.urlKey);
    writeHidden([...hidden]);
    card.remove();
    if (!el.cards.querySelector(".card")) showEmptyIfNeeded();
  });
  card.append(hide);

  return card;
}

function appendItems(items, { prepend = false } = {}) {
  const fresh = items.filter((item) => !hidden.has(item.urlKey));
  if (!fresh.length) return 0;

  const fragment = document.createDocumentFragment();
  for (const item of fresh) fragment.append(buildCard(item));

  if (prepend) {
    el.cards.prepend(fragment);
    trimOverflow();
  } else {
    el.cards.append(fragment);
  }
  el.cards.setAttribute("aria-busy", "false");
  return fresh.length;
}

/**
 * The board is a scroll that never ends, so the DOM must not grow forever.
 * Oldest cards fall off the bottom; scrolling back that far simply reloads them.
 */
function trimOverflow() {
  const cards = el.cards.querySelectorAll(".card");
  const overflow = cards.length - MAX_CARDS;
  if (overflow <= 0) return;
  for (let index = cards.length - 1; index >= cards.length - overflow; index -= 1) {
    cards[index].remove();
  }
}

function renderSkeletons(count = 8) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const skeleton = node("div", "skeleton");
    skeleton.append(node("div", "skeleton__media"));
    const body = node("div", "skeleton__body");
    body.append(
      node("div", "skeleton__line skeleton__line--meta"),
      node("div", "skeleton__line skeleton__line--title"),
      node("div", "skeleton__line skeleton__line--title2"),
      node("div", "skeleton__line skeleton__line--sum"),
    );
    skeleton.append(body);
    fragment.append(skeleton);
  }
  el.cards.classList.add("is-loading");
  el.cards.append(fragment);
}

function clearSkeletons() {
  el.cards.classList.remove("is-loading");
  for (const skeleton of el.cards.querySelectorAll(".skeleton")) skeleton.remove();
}

function clearBoard() {
  el.cards.replaceChildren();
  el.empty.hidden = true;
}

function setStatus(text) {
  el.status.textContent = text || "";
}

/* --------------------------------------------------------- 6. FEED + PAGING */

function feedUrl({ cursor = null } = {}) {
  const url = new URL(API.feed, location.origin);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);
  if (state.lanes.length) url.searchParams.set("lanes", state.lanes.join(","));
  if (state.query) url.searchParams.set("q", state.query);
  return url.toString();
}

async function request(url, options) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = detail?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json();
}

async function loadFirstPage() {
  state.loading = true;
  state.exhausted = false;
  state.cursor = null;
  state.pending = 0;
  hideNewBar();
  clearBoard();
  setStatus("");
  renderSkeletons();

  try {
    const data = await request(feedUrl());
    clearSkeletons();
    state.total = data.meta?.total ?? 0;
    state.oldest = data.meta?.oldest ?? null;
    state.lastSync = data.meta?.lastSync ?? 0;
    const top = data.items[0];
    state.topBucket = top ? top.bucket : null;
    state.topScore = top ? top.score : 0;
    state.cursor = data.nextCursor;

    const painted = appendItems(data.items);
    if (!painted) {
      showEmpty(data.items.length ? "Everything here is hidden." : "", data.items.length ? "hidden" : "none");
    } else {
      el.empty.hidden = true;
    }
    if (!data.nextCursor) state.exhausted = true;
    updateLive();
    updateStatus();
  } catch (error) {
    clearSkeletons();
    showError(error);
  } finally {
    state.loading = false;
    el.cards.setAttribute("aria-busy", "false");
  }
}

async function loadMore() {
  if (state.loading || state.exhausted) return;
  state.loading = true;
  setStatus("Loading…");

  try {
    const data = await request(feedUrl({ cursor: state.cursor }));
    state.cursor = data.nextCursor;
    if (!data.nextCursor) state.exhausted = true;

    const painted = appendItems(data.items);
    if (!painted && !data.nextCursor) state.exhausted = true;
    updateStatus();
  } catch (error) {
    setStatus(`Couldn't load more — ${error.message}. Scroll to retry.`);
    state.loading = false;
    return;
  } finally {
    state.loading = false;
  }
}

function updateStatus() {
  if (state.exhausted) {
    const since = state.oldest ? shortDate(state.oldest) : null;
    setStatus(
      since
        ? `That's everything back to ${since}. ${state.total.toLocaleString()} stories on the board.`
        : "That's everything.",
    );
    if (el.footerStats) {
      el.footerStats.textContent = state.total
        ? `${state.total.toLocaleString()} stories · readable back to ${since || "today"}`
        : "";
    }
    return;
  }
  setStatus("");
}

function showEmpty(overrideTitle, reason) {
  el.empty.hidden = false;
  if (reason === "hidden") {
    el.emptyTitle.textContent = "All hidden.";
    el.emptyBody.textContent = "You've hidden every card in this view. Bring them back or pick another lane.";
    el.emptyAction.textContent = "Show hidden";
    el.emptyAction.dataset.action = "unhide";
    return;
  }
  if (reason === "none") {
    el.emptyTitle.textContent = "Nothing here yet.";
    el.emptyBody.textContent = state.query || state.lanes.length
      ? "No story matches that filter. Clear it and the board comes back."
      : "The board is still filling up. It reads its sources every minute.";
    el.emptyAction.textContent = "Clear filters";
    el.emptyAction.dataset.action = "clear";
    return;
  }
  el.emptyTitle.textContent = overrideTitle || "Nothing here yet.";
  el.emptyBody.textContent = "Clear the filter and the board comes back.";
  el.emptyAction.textContent = "Clear filters";
  el.emptyAction.dataset.action = "clear";
}

function showEmptyIfNeeded() {
  if (!el.cards.querySelector(".card")) showEmpty("", "hidden");
}

function showError(error) {
  el.empty.hidden = false;
  el.emptyTitle.textContent = "The feed didn't answer.";
  el.emptyBody.textContent = `${error.message}. It might be the first run of the day — give it a moment.`;
  el.emptyAction.textContent = "Try again";
  el.emptyAction.dataset.action = "retry";
}

/* -------------------------------------------------------------- 7. LIVE UPDATES */

function updateLive() {
  const age = state.lastSync ? Date.now() - state.lastSync : Infinity;
  const minutes = Math.floor(age / 60_000);

  if (!state.lastSync) {
    el.liveText.textContent = "no sync yet";
    el.live.className = "live is-stale";
    return;
  }
  if (age < 90_000) el.live.className = "live";
  else if (age < 15 * 60_000) el.live.className = "live";
  else el.live.className = "live is-stale";

  el.liveText.textContent = minutes < 1 ? "live · just now" : `live · ${minutes}m ago`;
}

async function pingSync() {
  try {
    const data = await request(API.sync);
    if (data?.lastSync) state.lastSync = data.lastSync;
    updateLive();
  } catch {
    el.live.className = "live is-dead";
  }
}

/**
 * "New" means: sorts above the current top card in the board's own order. That is
 * a (bucket, score) comparison — a strong story from an earlier block never
 * counts as new just because we only saw it now. The bucket comes from the API so
 * the client never has to re-derive the same rule and drift out of step with it.
 */
function isAboveTop(item) {
  if (!state.topBucket) return true;
  if (item.bucket !== state.topBucket) return item.bucket > state.topBucket;
  return item.score > state.topScore;
}

async function checkForNew() {
  if (state.loading) return;

  const url = new URL(API.feed, location.origin);
  url.searchParams.set("limit", "20");
  if (state.lanes.length) url.searchParams.set("lanes", state.lanes.join(","));
  if (state.query) url.searchParams.set("q", state.query);

  try {
    const data = await request(url.toString());
    state.lastSync = data.meta?.lastSync ?? state.lastSync;
    state.total = data.meta?.total ?? state.total;
    updateLive();

    const fresh = (data.items || []).filter((item) => isAboveTop(item) && !hidden.has(item.urlKey));
    state.pending = fresh.length;
    if (!fresh.length) {
      hideNewBar();
      return;
    }
    el.newbarCount.textContent = String(fresh.length);
    el.newbar.hidden = false;
  } catch {
    /* a failed poll is not worth a message; the next one will tell */
  }
}

function hideNewBar() {
  el.newbar.hidden = true;
  state.pending = 0;
}

/** Merge the pending page in without re-sorting: the API order is already right. */
async function applyNewItems() {
  hideNewBar();
  window.scrollTo({ top: 0, behavior: "auto" });
  await loadFirstPage();
}

/* -------------------------------------------------- 8. FILTERS, SEARCH AND URL */

function buildPills() {
  const lanes = [
    { id: "", label: "All" },
    { id: "games", label: "My games" },
    { id: "gaming", label: "Gaming" },
    { id: "indie", label: "Indie" },
    { id: "anime", label: "Anime" },
    { id: "gamedev", label: "Gamedev" },
    { id: "ai", label: "AI" },
    { id: "tech", label: "Tech" },
    { id: "business", label: "Industry" },
    { id: "creator", label: "Creators" },
  ];

  for (const lane of lanes) {
    if (!lane.id) continue;
    const pill = node("button", "pill", lane.label);
    pill.type = "button";
    pill.dataset.lane = lane.id;
    el.pills.append(pill);
  }
}

function syncPills() {
  for (const pill of el.pills.querySelectorAll(".pill")) {
    pill.classList.toggle("is-on", pill.dataset.lane === (state.lanes[0] || ""));
  }
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.lanes = (params.get("lanes") || "")
    .split(",")
    .map((lane) => lane.trim())
    .filter(Boolean)
    .slice(0, 1); // one lane at a time keeps the board readable; the API supports more
  state.query = (params.get("q") || "").trim();
  el.search.value = state.query;
  syncPills();
}

function writeUrl({ replace = false } = {}) {
  const params = new URLSearchParams();
  if (state.lanes.length) params.set("lanes", state.lanes.join(","));
  if (state.query) params.set("q", state.query);
  const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
  if (replace) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
}

function onLaneChange(lane) {
  state.lanes = lane ? [lane] : [];
  syncPills();
  writeUrl();
  loadFirstPage();
}

let searchTimer = null;

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const value = el.search.value.trim();
    if (value === state.query) return;
    state.query = value;
    writeUrl({ replace: true });
    loadFirstPage();
  }, SEARCH_DEBOUNCE_MS);
}

/* ------------------------------------------------------------------- 9. THEME */

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f7f4ee" : "#0c0b0a");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode: the in-page toggle still works for this visit */
  }
}

/* -------------------------------------------------------------------- 10. BOOT */

function wireEvents() {
  el.pills.addEventListener("click", (event) => {
    const pill = event.target.closest(".pill");
    if (!pill) return;
    onLaneChange(pill.dataset.lane);
  });

  el.search.addEventListener("input", onSearchInput);
  el.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      el.search.value = "";
      el.search.blur();
      if (state.query) {
        state.query = "";
        writeUrl({ replace: true });
        loadFirstPage();
      }
    }
  });
  el.searchForm.addEventListener("submit", (event) => event.preventDefault());

  el.theme.addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
  });

  el.newbarBtn.addEventListener("click", applyNewItems);

  el.emptyAction.addEventListener("click", () => {
    const action = el.emptyAction.dataset.action;
    if (action === "unhide") {
      hidden.clear();
      writeHidden([]);
      loadFirstPage();
      return;
    }
    if (action === "retry") {
      loadFirstPage();
      return;
    }
    state.lanes = [];
    state.query = "";
    el.search.value = "";
    syncPills();
    writeUrl({ replace: true });
    loadFirstPage();
  });

  window.addEventListener("popstate", () => {
    readUrl();
    loadFirstPage();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe(el.sentinel);

  document.addEventListener("keydown", (event) => {
    const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || "");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      el.search.focus();
    }
    if (event.key === "Escape" && typing) el.search.blur();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      pingSync().then(checkForNew);
    }
  });

  setInterval(() => {
    updateLive();
    if (document.visibilityState === "visible") {
      pingSync().then(checkForNew);
    }
  }, SYNC_EVERY_MS);

  // Relative timestamps go stale on a tab left open all morning.
  setInterval(() => {
    for (const card of el.cards.querySelectorAll(".card")) {
      const when = card.querySelector(".card__when");
      if (when?.dataset.iso) when.textContent = relativeTime(when.dataset.iso);
    }
  }, 60_000);
}

async function loadFooterStats() {
  try {
    const stats = await request(API.stats);
    state.stats = stats;
    if (stats?.total) {
      el.footerStats.textContent =
        `${stats.total.toLocaleString()} stories · ${stats.perSource.length} sources feeding · ` +
        `last sync ${stats.lastSync ? relativeTime(new Date(stats.lastSync).toISOString()) : "never"}`;
    }
  } catch {
    /* the footer is decoration; a failure is not worth a red box */
  }
}

async function boot() {
  buildPills();
  readUrl();
  wireEvents();
  updateLive();

  // Paint whatever is already in the database before asking for new material.
  await loadFirstPage();
  loadFooterStats();

  // Then ask the edge to go and look, and poll for anything that landed.
  await pingSync();
  await checkForNew();
}

boot();
