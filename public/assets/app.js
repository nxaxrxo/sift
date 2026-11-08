/**
 * app.js — the board.
 *
 * One page, one job: read one static board file, paint cards, and never move
 * under the reader's finger. No framework, no build step, no dependencies.
 *
 * Structure:
 *   1  constants + state
 *   2  tiny DOM helpers
 *   3  formatting
 *   4  hidden cards (localStorage)
 *   5  card rendering
 *   6  feed loading + paging
 *   7  refresh
 *   8  filters, search, URL
 *   9  theme
 *  10  boot
 */

/* ------------------------------------------------------------------ 1. STATE */

const API = {
  board: "api/board.json",
  stats: "api/stats.json",
};

const PAGE_SIZE = 30;
const MAX_CARDS = 240;
const SEARCH_DEBOUNCE_MS = 300;
const HIDDEN_KEY = "sift.hidden";
const THEME_KEY = "sift.theme";
const MAX_HIDDEN = 500;

const state = {
  lanes: [],
  query: "",
  board: null, // the whole ordered board
  filtered: [], // the board after lane/search filtering
  offset: 0, // how far into `filtered` the reader has scrolled
  loading: false,
  refreshing: false,
  exhausted: false,
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
  refresh: document.getElementById("refresh"),
  theme: document.getElementById("theme"),
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

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/**
 * How long ago, in words — and never "in four days".
 *
 * A feed whose clock is wrong dates an item in the future, and a moodboard
 * reading "in 4 days" above "2 hours ago" looks broken. A future date is not
 * information, so it reads as just now and the date line carries the truth.
 */
function relativeTime(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = (then - now) / 1000;
  const abs = Math.abs(Math.round(seconds));

  if (seconds > 0) return "just now"; // future: a feed clock bug, not a fact
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(-Math.round(abs / 60), "minute");
  if (abs < 86_400) return rtf.format(-Math.round(abs / 3600), "hour");
  return rtf.format(-Math.round(abs / 86_400), "day");
}

/**
 * The calendar day, always — "8 Nov", or "20 Oct 2026" once the year differs
 * from today's. Shown beside the relative time so a card never leaves you
 * guessing when "yesterday" actually was.
 */
function dayMonth(iso, now = new Date()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "3 hours ago · 8 Nov" while recent, just "20 Oct 2026" once it is old news. */
function whenLabel(iso, now = Date.now()) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const days = (now - then) / 86_400_000;
  const date = dayMonth(iso, new Date(now));
  if (days >= 7) return date;
  const relative = relativeTime(iso, now);
  return relative ? `${relative} · ${date}` : date;
}

function fullStamp(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  return new Date(then).toLocaleString("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
  });
}

function shortDate(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  return new Date(then).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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

const LANE_LABEL = {
  games: "My games",
  gaming: "Gaming",
  indie: "Indie",
  anime: "Anime",
  gamedev: "Gamedev",
  ai: "AI",
  tech: "Tech",
  business: "Industry",
  creator: "Creators",
};

function buildCard(item) {
  const card = node("a", "card");
  card.href = item.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.dataset.key = item.urlKey;
  // No lane at all is a real state (an aggregator link nothing scored), and it
  // should read as plain rather than borrow the colour of some other lane.
  card.dataset.lane = item.lanes[0] || "";

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
  if (item.lanes.length) {
    meta.append(node("span", "card__lane", LANE_LABEL[item.lanes[0]] || item.lanes[0]));
  }
  meta.append(node("span", "card__source", item.sourceName));
  body.append(meta);

  const title = node("h2", "card__title", item.title);
  body.append(title);

  if (item.summary) {
    body.append(node("p", "card__sum", item.summary));
  }

  // The stamp sits at the foot of the card, where a dateline belongs — not
  // crammed into the source line. Date always, relative time while it is recent.
  const foot = node("p", "card__when");
  foot.textContent = whenLabel(item.publishedAt);
  foot.dataset.iso = item.publishedAt;
  const stamp = fullStamp(item.publishedAt);
  if (stamp) foot.title = stamp;
  body.append(foot);

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
      node("div", "skeleton__line skeleton__line--sum2"),
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

/**
 * The board is a static file, so there is exactly one fetch and then paging is
 * array slicing. `state.board` holds the full ordered array; `state.filtered`
 * holds the view after lane/search filtering; `state.offset` is how far the
 * reader has scrolled into it.
 */
function applyFilters(items) {
  const lanes = state.lanes;
  const query = state.query.toLowerCase();
  if (!lanes.length && !query) return items;
  return items.filter((item) => {
    if (lanes.length && !lanes.some((lane) => item.lanes.includes(lane))) return false;
    if (query) {
      const haystack = `${item.title} ${item.summary || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

async function request(url, options) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, ...options });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * `cacheBust` asks GitHub Pages for the file itself instead of whatever it
 * cached a minute ago. Only the refresh button uses it: a normal first load
 * should ride the CDN, a clicked refresh should tell the truth.
 */
async function loadBoard({ cacheBust = false } = {}) {
  if (state.board && !cacheBust) return state.board;
  const url = cacheBust ? `${API.board}?t=${Date.now()}` : API.board;
  const data = await request(url);
  state.board = data.items || [];
  state.total = data.meta?.total ?? state.board.length;
  state.oldest = data.meta?.oldest ?? null;
  state.lastSync = data.meta?.lastSync ?? 0;
  return state.board;
}

function pageItems() {
  return state.filtered.slice(state.offset, state.offset + PAGE_SIZE);
}

function hasMorePages() {
  return state.offset < state.filtered.length;
}

async function loadFirstPage({ cacheBust = false } = {}) {
  state.loading = true;
  state.exhausted = false;
  state.offset = 0;
  clearBoard();
  setStatus("");
  renderSkeletons();

  try {
    const board = await loadBoard({ cacheBust });
    clearSkeletons();

    state.filtered = applyFilters(board);

    const items = pageItems();
    state.offset += items.length;

    const painted = appendItems(items);
    if (!painted) {
      showEmpty(state.filtered.length ? "Everything here is hidden." : "", state.filtered.length ? "hidden" : "none");
    } else {
      el.empty.hidden = true;
    }
    if (!hasMorePages()) state.exhausted = true;
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
    const items = pageItems();
    state.offset += items.length;
    if (!hasMorePages()) state.exhausted = true;

    const painted = appendItems(items);
    if (!painted && !hasMorePages()) state.exhausted = true;
    updateStatus();
  } catch (error) {
    setStatus(`Couldn't load more — ${error.message}. Scroll to retry.`);
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
      : "The board is still filling up. Press Refresh to look again.";
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
  el.emptyBody.textContent = `${error.message}. Press Refresh to try again.`;
  el.emptyAction.textContent = "Try again";
  el.emptyAction.dataset.action = "retry";
}

/* ---------------------------------------------------------------- 7. REFRESH */

/**
 * Nothing polls. Not on a timer, not on tab focus. A board that reorders
 * underneath someone mid-scroll is worse than a board that is a few minutes
 * stale, so new material only arrives when the reader asks for it.
 */
function updateLive() {
  if (!state.lastSync) {
    el.liveText.textContent = "no update yet";
    el.live.classList.add("is-stale");
    return;
  }
  const minutes = Math.floor((Date.now() - state.lastSync) / 60_000);
  el.liveText.textContent = minutes < 1 ? "updated just now" : `updated ${minutes}m ago`;
  el.live.classList.toggle("is-stale", minutes >= 180);
}

function setRefreshState(busy) {
  el.refresh.classList.toggle("is-busy", busy);
  el.refresh.disabled = busy;
  el.refresh.setAttribute("aria-busy", String(busy));
  el.refresh.querySelector(".refresh__label").textContent = busy ? "Checking" : "Refresh";
}

async function refreshBoard() {
  if (state.refreshing || state.loading) return;
  state.refreshing = true;
  setRefreshState(true);
  const startedAt = Date.now();

  try {
    await loadFirstPage({ cacheBust: true });
    window.scrollTo({ top: 0, behavior: "auto" });
    loadFooterStats();
  } catch (error) {
    showError(error);
  } finally {
    // A refresh that returns in 40ms looks like nothing happened. Hold the
    // busy state briefly so the button visibly did something.
    const elapsed = Date.now() - startedAt;
    if (elapsed < 450) await new Promise((resolve) => setTimeout(resolve, 450 - elapsed));
    state.refreshing = false;
    setRefreshState(false);
    updateLive();
  }
}

/* -------------------------------------------------- 8. FILTERS, SEARCH AND URL */

function buildPills() {
  const lanes = [
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
    .slice(0, 1); // one lane at a time keeps the board readable
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
  if (meta) meta.setAttribute("content", theme === "light" ? "#f3efe8" : "#12100e");
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

  el.refresh.addEventListener("click", refreshBoard);
  el.theme.addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
  });

  el.emptyAction.addEventListener("click", () => {
    const action = el.emptyAction.dataset.action;
    if (action === "unhide") {
      hidden.clear();
      writeHidden([]);
      loadFirstPage();
      return;
    }
    if (action === "retry") {
      refreshBoard();
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
    // R refreshes, the way it does in every mail client. Not while typing.
    if (event.key === "r" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      refreshBoard();
    }
    if (event.key === "Escape" && typing) el.search.blur();
  });

  // Relative timestamps go stale on a tab left open all morning. Re-label the
  // text only; no network, nothing moves.
  setInterval(() => {
    for (const card of el.cards.querySelectorAll(".card")) {
      const foot = card.querySelector(".card__when");
      if (foot?.dataset.iso) foot.textContent = whenLabel(foot.dataset.iso);
    }
    updateLive();
  }, 60_000);
}

async function loadFooterStats() {
  try {
    const stats = await request(API.stats);
    state.stats = stats;
    if (stats?.total) {
      el.footerStats.textContent =
        `${stats.total.toLocaleString()} stories · ${stats.perSource.length} sources feeding · ` +
        `last update ${stats.lastSync ? relativeTime(new Date(stats.lastSync).toISOString()) : "never"}`;
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

  await loadFirstPage();
  loadFooterStats();
}

boot();
