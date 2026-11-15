const ICON_VER = "11";

const els = {
  summary: document.getElementById("summary"),
  refresh: document.getElementById("refresh"),
  search: document.getElementById("search"),
  audienceFilters: document.getElementById("audience-filters"),
  paths: document.getElementById("paths"),
  localGrid: document.getElementById("local-grid"),
  sharesGrid: document.getElementById("shares-grid"),
  gamesGrid: document.getElementById("games-grid"),
  externalGrid: document.getElementById("external-grid"),
  localSubtitle: document.getElementById("local-subtitle"),
  sharesSubtitle: document.getElementById("shares-subtitle"),
  gamesSubtitle: document.getElementById("games-subtitle"),
  externalSubtitle: document.getElementById("external-subtitle"),
  heroWelcome: document.getElementById("hero-welcome"),
  grid: document.getElementById("grid"),
  kindFilters: document.getElementById("kind-filters"),
  online: document.getElementById("stat-online"),
  down: document.getElementById("stat-down"),
  latency: document.getElementById("stat-latency"),
  kinds: document.getElementById("stat-kinds"),
  checked: document.getElementById("stat-checked"),
};

const templates = {
  path: document.getElementById("path-template"),
  launch: document.getElementById("launch-template"),
  tile: document.getElementById("tile-template"),
};

const AUDIENCE_LABELS = {
  all: "All",
  everyone: "Everyone",
  support: "Support",
  admin: "Admin",
};

let catalog = null;
let lastPayload = null;
let activeAudience = "all";
let activeKind = "all";
let searchQuery = "";
let statusByName = new Map();

async function fetchJson(path) {
  const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${Math.round(ms)}ms`;
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString();
}

function setIcon(img, src, label, { onFail } = {}) {
  if (!src) {
    img.hidden = true;
    img.removeAttribute("src");
    return false;
  }
  img.hidden = false;
  img.src = `${src}?v=${ICON_VER}`;
  img.alt = label || "";
  img.onerror = () => {
    img.hidden = true;
    onFail?.();
  };
  return true;
}

function matchesQuery(text) {
  if (!searchQuery) return true;
  return String(text || "").toLowerCase().includes(searchQuery);
}

function itemMatches(item) {
  if (activeAudience !== "all" && item.audience !== activeAudience) return false;
  const hay = [
    item.name,
    item.blurb,
    item.help,
    item.category,
    item.audience,
    item.join,
    item.adminDetail,
    item.connect?.linux,
    item.connect?.windows,
  ]
    .filter(Boolean)
    .join(" ");
  return matchesQuery(hay);
}

function serviceMatches(service) {
  if (activeKind !== "all" && service.kind !== activeKind) return false;
  const hay = [service.name, service.description, service.kind, service.detail]
    .filter(Boolean)
    .join(" ");
  return matchesQuery(hay);
}

function summarize(counts = {}) {
  const parts = [];
  if (counts.bad) parts.push(`${counts.bad} down`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.ok) parts.push(`${counts.ok} online`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return parts.join(" · ") || "no surfaces yet";
}

function renderPaths(paths = []) {
  els.paths.replaceChildren();
  for (const path of paths) {
    const node = templates.path.content.firstElementChild.cloneNode(true);
    node.href = path.target || "#";
    node.querySelector(".path-title").textContent = path.title;
    node.querySelector(".path-body").textContent = path.body;
    els.paths.appendChild(node);
  }
}

function renderAudienceFilters() {
  const options = ["all", "everyone", "support", "admin"];
  els.audienceFilters.replaceChildren();
  for (const key of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "audience-chip" + (key === activeAudience ? " active" : "");
    btn.textContent = AUDIENCE_LABELS[key] || key;
    btn.addEventListener("click", () => {
      activeAudience = key;
      renderAudienceFilters();
      renderCatalogSections();
    });
    els.audienceFilters.appendChild(btn);
  }
}

function renderLaunchCard(item) {
  const node = templates.launch.content.firstElementChild.cloneNode(true);
  const status = item.statusName ? statusByName.get(item.statusName) : null;
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = status?.status || (item.statusName ? "unknown" : "external");

  const vendorOk = setIcon(
    node.querySelector(".launch-vendor"),
    item.vendor,
    `${item.name} vendor`,
    { onFail: () => node.classList.add("no-vendor") }
  );
  if (!vendorOk) node.classList.add("no-vendor");
  setIcon(node.querySelector(".launch-favicon"), item.favicon, "");

  node.querySelector(".launch-name").textContent = item.name;
  node.querySelector(".launch-blurb").textContent = item.blurb || "";
  const help = node.querySelector(".launch-help");
  if (item.help) help.textContent = item.help;
  else help.hidden = true;

  const connectBox = node.querySelector(".launch-connect");
  const detailFields = {
    join: item.join,
    admin: item.adminDetail,
    linux: item.connect?.linux,
    windows: item.connect?.windows,
  };
  let hasDetails = false;
  for (const [key, value] of Object.entries(detailFields)) {
    const row = connectBox.querySelector(`[data-row="${key}"]`);
    const cmd = connectBox.querySelector(`[data-field="${key}"]`);
    if (value) {
      row.hidden = false;
      cmd.textContent = value;
      hasDetails = true;
    } else {
      row.hidden = true;
    }
  }
  connectBox.hidden = !hasDetails;

  node.querySelector(".launch-category").textContent = item.category || "Service";
  node.querySelector(".launch-audience").textContent =
    AUDIENCE_LABELS[item.audience] || item.audience || "";

  const link = node.querySelector(".launch-link");
  if (item.url) {
    link.href = item.url;
    link.textContent = item.linkLabel || "Open";
  } else {
    link.hidden = true;
  }
  return node;
}

function fillLaunchGrid(container, items) {
  container.replaceChildren();
  const visible = items.filter(itemMatches);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "Nothing matches that search or filter.";
    container.appendChild(empty);
    return;
  }
  for (const item of visible) {
    container.appendChild(renderLaunchCard(item));
  }
}

function sectionById(id) {
  return (catalog?.sections || []).find((s) => s.id === id);
}

function renderCatalogSections() {
  const local = sectionById("local");
  const shares = sectionById("shares");
  const games = sectionById("games");
  const external = sectionById("external");
  if (local) {
    if (local.subtitle) els.localSubtitle.textContent = local.subtitle;
    fillLaunchGrid(els.localGrid, local.items || []);
  }
  if (shares) {
    if (shares.subtitle) els.sharesSubtitle.textContent = shares.subtitle;
    fillLaunchGrid(els.sharesGrid, shares.items || []);
  }
  if (games) {
    if (games.subtitle) els.gamesSubtitle.textContent = games.subtitle;
    fillLaunchGrid(els.gamesGrid, games.items || []);
  }
  if (external) {
    if (external.subtitle) els.externalSubtitle.textContent = external.subtitle;
    fillLaunchGrid(els.externalGrid, external.items || []);
  }
}

function renderCatalog(data) {
  catalog = data;
  if (data.welcome) els.heroWelcome.textContent = data.welcome;
  renderPaths(data.paths || []);
  renderAudienceFilters();
  renderCatalogSections();
}

function renderStats(data) {
  const counts = data.counts || {};
  const services = data.services || [];
  const latencies = services
    .map((s) => s.latency_ms)
    .filter((n) => typeof n === "number");
  const avg = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : null;
  const kinds = new Set(services.map((s) => s.kind).filter(Boolean));

  els.online.textContent = String(counts.ok || 0);
  els.down.textContent = String((counts.bad || 0) + (counts.warn || 0));
  els.latency.textContent = avg == null ? "—" : fmtMs(avg);
  els.kinds.textContent = String(kinds.size);
  els.checked.textContent = fmtTime(data.as_of);

  const ordered = ["all", ...[...kinds].sort()];
  els.kindFilters.hidden = ordered.length <= 2;
  els.kindFilters.replaceChildren();
  for (const kind of ordered) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kind-chip" + (kind === activeKind ? " active" : "");
    btn.textContent = kind;
    btn.addEventListener("click", () => {
      activeKind = kind;
      renderGrid(lastPayload);
      renderStats(lastPayload);
    });
    els.kindFilters.appendChild(btn);
  }
}

function renderTile(service) {
  const node = templates.tile.content.firstElementChild.cloneNode(true);
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = service.status || "unknown";
  const vendorOk = setIcon(
    node.querySelector(".tile-vendor"),
    service.vendor,
    `${service.name} vendor`,
    { onFail: () => node.classList.add("no-vendor") }
  );
  if (!vendorOk) node.classList.add("no-vendor");
  setIcon(node.querySelector(".tile-favicon"), service.favicon, "");
  node.querySelector(".tile-name").textContent = service.name;
  node.querySelector(".tile-kind").textContent = service.kind || "service";
  node.querySelector(".tile-desc").textContent = service.description || "";
  node.querySelector('[data-metric="latency"]').textContent = fmtMs(service.latency_ms);
  node.querySelector('[data-metric="resolved"]').textContent = service.resolved?.length
    ? service.resolved.slice(0, 2).join(" · ")
    : "unresolved";
  node.querySelector(".tile-probe").textContent = service.detail || "";
  const link = node.querySelector(".tile-link");
  link.href = service.admin;
  link.textContent = service.linkLabel || "Open admin";
  return node;
}

function renderGrid(data) {
  const services = (data?.services || []).filter(serviceMatches);
  els.grid.replaceChildren();
  if (!services.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "No infrastructure tiles match that search.";
    els.grid.appendChild(empty);
    return;
  }
  for (const service of services) {
    els.grid.appendChild(renderTile(service));
  }
}

function renderWiki(wiki) {
  document.getElementById("wiki-title").textContent = wiki.title || "Guide";
  document.getElementById("wiki-intro").textContent = wiki.intro || "";
  const body = document.getElementById("wiki-body");
  body.replaceChildren();
  for (const section of wiki.sections || []) {
    const block = document.createElement("article");
    block.className = "wiki-section";
    const h = document.createElement("h3");
    h.textContent = section.title;
    block.appendChild(h);
    for (const entry of section.entries || []) {
      const item = document.createElement("div");
      item.className = "wiki-entry";
      const name = document.createElement("h4");
      name.textContent = entry.name;
      const summary = document.createElement("p");
      summary.className = "wiki-summary";
      summary.textContent = entry.summary || "";
      const list = document.createElement("ul");
      for (const bullet of entry.used_for || []) {
        const li = document.createElement("li");
        li.textContent = bullet;
        list.appendChild(li);
      }
      item.append(name, summary, list);
      block.appendChild(item);
    }
    body.appendChild(block);
  }
  const notes = document.getElementById("wiki-notes");
  notes.replaceChildren();
  for (const note of wiki.notes || []) {
    const li = document.createElement("li");
    li.textContent = note;
    notes.appendChild(li);
  }
}

async function refresh() {
  els.summary.textContent = "checking lab…";
  els.refresh.disabled = true;
  try {
    const data = await fetchJson("/api/status");
    lastPayload = data;
    statusByName = new Map((data.services || []).map((s) => [s.name, s]));
    renderStats(data);
    renderGrid(data);
    renderCatalogSections();
    els.summary.textContent = summarize(data.counts);
  } catch (err) {
    els.summary.textContent = `health check failed: ${err.message}`;
    console.error(err);
  } finally {
    els.refresh.disabled = false;
  }
}

els.search.addEventListener("input", () => {
  searchQuery = els.search.value.trim().toLowerCase();
  renderCatalogSections();
  if (lastPayload) renderGrid(lastPayload);
});

els.refresh.addEventListener("click", refresh);

fetchJson("/catalog.json")
  .then(renderCatalog)
  .catch((err) => {
    els.heroWelcome.textContent = `Catalog failed to load: ${err.message}`;
  });

fetchJson("/wiki.json")
  .then(renderWiki)
  .catch((err) => {
    document.getElementById("wiki-intro").textContent = `Guide failed to load: ${err.message}`;
  });

refresh();
setInterval(refresh, 60_000);
