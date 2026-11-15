const ICON_VER = "16";
const THEME_KEY = "dockfire-theme";
const THEME_ORDER = ["system", "dark", "light"];
const THEME_LABELS = { system: "Theme: System", dark: "Theme: Dark", light: "Theme: Light" };

const PULSE_LAYOUT = {
  solar: { x: 210, y: 36 },
  power: { x: 352, y: 88 },
  internet: { x: 352, y: 178 },
  pool: { x: 210, y: 224 },
  lab: { x: 68, y: 178 },
  automation: { x: 68, y: 88 },
};

const els = {
  summary: document.getElementById("summary"),
  refresh: document.getElementById("refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  search: document.getElementById("search"),
  audienceFilters: document.getElementById("audience-filters"),
  paths: document.getElementById("paths"),
  homeGrid: document.getElementById("home-grid"),
  localGrid: document.getElementById("local-grid"),
  sharesGrid: document.getElementById("shares-grid"),
  gamesGrid: document.getElementById("games-grid"),
  externalGrid: document.getElementById("external-grid"),
  homeSubtitle: document.getElementById("home-subtitle"),
  localSubtitle: document.getElementById("local-subtitle"),
  sharesSubtitle: document.getElementById("shares-subtitle"),
  gamesSubtitle: document.getElementById("games-subtitle"),
  externalSubtitle: document.getElementById("external-subtitle"),
  heroWelcome: document.getElementById("hero-welcome"),
  pulseSummary: document.getElementById("pulse-summary"),
  pulseLinks: document.getElementById("pulse-links"),
  pulseNodes: document.getElementById("pulse-nodes"),
  pulseBoard: document.getElementById("pulse-board"),
  pulseIssues: document.getElementById("pulse-issues"),
  pulseIssuesBody: document.getElementById("pulse-issues-body"),
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

function setThemeMode(mode) {
  if (!THEME_ORDER.includes(mode)) mode = "system";
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch (_) {
    /* ignore */
  }
  document.documentElement.setAttribute("data-theme", mode);
  if (els.themeToggle) els.themeToggle.textContent = THEME_LABELS[mode];
}

function currentThemeMode() {
  const mode = document.documentElement.getAttribute("data-theme") || "system";
  return THEME_ORDER.includes(mode) ? mode : "system";
}

function setIcon(img, src, label, { onFail, onOk } = {}) {
  if (!src) {
    img.hidden = true;
    img.removeAttribute("src");
    return false;
  }
  img.hidden = true;
  img.onload = () => {
    img.hidden = false;
    onOk?.();
  };
  img.onerror = () => {
    img.hidden = true;
    img.removeAttribute("src");
    onFail?.();
  };
  img.alt = label || "";
  img.src = `${src}?v=${ICON_VER}`;
  return true;
}

function setTextOrHide(el, text) {
  if (!el) return;
  const value = (text || "").trim();
  if (!value) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = value;
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
  if (item.statusName) {
    dot.hidden = false;
    dot.dataset.status = status?.status || "unknown";
  } else {
    dot.hidden = true;
    dot.dataset.status = "external";
  }

  node.classList.add("no-vendor");
  const vendorOk = setIcon(
    node.querySelector(".launch-vendor"),
    item.vendor,
    `${item.name} vendor`,
    {
      onOk: () => node.classList.remove("no-vendor"),
      onFail: () => node.classList.add("no-vendor"),
    }
  );
  if (!vendorOk) node.classList.add("no-vendor");
  setIcon(node.querySelector(".launch-favicon"), item.favicon, "");

  node.querySelector(".launch-name").textContent = item.name;
  setTextOrHide(node.querySelector(".launch-blurb"), item.blurb);
  setTextOrHide(node.querySelector(".launch-help"), item.help);

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

  setTextOrHide(node.querySelector(".launch-category"), item.category || "");
  setTextOrHide(
    node.querySelector(".launch-audience"),
    AUDIENCE_LABELS[item.audience] || item.audience || ""
  );

  const link = node.querySelector(".launch-link");
  if (item.url) {
    link.hidden = false;
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
  const home = sectionById("home");
  const local = sectionById("local");
  const shares = sectionById("shares");
  const games = sectionById("games");
  const external = sectionById("external");
  if (home) {
    if (home.subtitle) els.homeSubtitle.textContent = home.subtitle;
    fillLaunchGrid(els.homeGrid, home.items || []);
  }
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
  node.classList.add("no-vendor");
  const vendorOk = setIcon(
    node.querySelector(".tile-vendor"),
    service.vendor,
    `${service.name} vendor`,
    {
      onOk: () => node.classList.remove("no-vendor"),
      onFail: () => node.classList.add("no-vendor"),
    }
  );
  if (!vendorOk) node.classList.add("no-vendor");
  setIcon(node.querySelector(".tile-favicon"), service.favicon, "");
  node.querySelector(".tile-name").textContent = service.name;
  setTextOrHide(node.querySelector(".tile-kind"), service.kind || "");
  setTextOrHide(node.querySelector(".tile-desc"), service.description);

  const latencyEl = node.querySelector('[data-metric="latency"]');
  const resolvedEl = node.querySelector('[data-metric="resolved"]');
  const metrics = node.querySelector(".tile-metrics");
  const hasLatency = typeof service.latency_ms === "number";
  const hasResolved = Array.isArray(service.resolved) && service.resolved.length > 0;
  if (hasLatency || hasResolved) {
    metrics.hidden = false;
    latencyEl.textContent = hasLatency ? fmtMs(service.latency_ms) : "";
    latencyEl.hidden = !hasLatency;
    resolvedEl.textContent = hasResolved ? service.resolved.slice(0, 2).join(" · ") : "";
    resolvedEl.hidden = !hasResolved;
  } else {
    metrics.hidden = true;
  }

  setTextOrHide(node.querySelector(".tile-probe"), service.detail);
  const link = node.querySelector(".tile-link");
  if (service.admin) {
    link.hidden = false;
    link.href = service.admin;
    link.textContent = service.linkLabel || "Open admin";
  } else {
    link.hidden = true;
  }
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

function svgEl(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

function primaryStat(domain) {
  const first = (domain.stats || [])[0];
  if (first?.value) return String(first.value);
  if (domain.status === "ok") return "ok";
  if (domain.status === "bad") return "down";
  if (domain.status === "warn") return "warn";
  return "—";
}

function renderHomePulse(home) {
  if (!els.pulseBoard || !els.pulseNodes || !els.pulseLinks) return;
  const domains = home.domains || [];
  const summary = home.summary || {};
  const bad = summary.bad || 0;
  const warn = summary.warn || 0;
  const ok = summary.ok || 0;
  if (els.pulseSummary) {
    if (bad === 1) els.pulseSummary.textContent = "1 area needs attention";
    else if (bad > 1) els.pulseSummary.textContent = `${bad} areas need attention`;
    else if (warn) els.pulseSummary.textContent = `${warn} warning · ${ok} healthy`;
    else els.pulseSummary.textContent = `${ok}/${domains.length} healthy`;
  }

  els.pulseLinks.replaceChildren();
  els.pulseNodes.replaceChildren();
  for (const domain of domains) {
    const pos = PULSE_LAYOUT[domain.id];
    if (!pos) continue;
    const status = domain.status || "unknown";
    const link = svgEl("path", {
      class: `pulse-link is-${status}`,
      d: `M210 130 L${pos.x} ${pos.y}`,
    });
    els.pulseLinks.appendChild(link);

    const group = svgEl("g", { class: `pulse-node is-${status}` });
    group.append(
      svgEl("circle", { class: `pulse-node-ring is-${status}`, cx: pos.x, cy: pos.y, r: 16 }),
      svgEl("circle", { class: `pulse-node-dot is-${status}`, cx: pos.x, cy: pos.y, r: 4 })
    );
    const label = svgEl("text", {
      class: "pulse-node-label",
      x: pos.x,
      y: pos.y - 22,
    });
    label.textContent = domain.label || domain.id;
    const stat = svgEl("text", {
      class: "pulse-node-stat",
      x: pos.x,
      y: pos.y + 30,
    });
    stat.textContent = primaryStat(domain);
    group.append(label, stat);
    els.pulseNodes.appendChild(group);
  }

  els.pulseBoard.replaceChildren();
  for (const domain of domains) {
    const card = document.createElement("a");
    card.className = "pulse-card";
    card.href = domain.href || "#infra-health";
    card.setAttribute("role", "listitem");
    const top = document.createElement("div");
    top.className = "pulse-card-top";
    const dot = document.createElement("span");
    dot.className = `pulse-card-dot is-${domain.status || "unknown"}`;
    const name = document.createElement("p");
    name.className = "pulse-card-name";
    name.textContent = domain.label || domain.id;
    top.append(dot, name);
    const stats = document.createElement("p");
    stats.className = "pulse-card-stats";
    const bits = (domain.stats || []).map((s) => `${s.label} ${s.value}`);
    stats.textContent = bits.length ? bits.join(" · ") : domain.note || domain.status || "";
    card.append(top, stats);
    els.pulseBoard.appendChild(card);
  }

  const issues = home.issues || [];
  if (els.pulseIssues && els.pulseIssuesBody) {
    els.pulseIssuesBody.replaceChildren();
    if (!issues.length) {
      els.pulseIssues.hidden = true;
    } else {
      els.pulseIssues.hidden = false;
      for (const issue of issues) {
        const tr = document.createElement("tr");
        const area = document.createElement("td");
        const link = document.createElement("a");
        link.href = issue.href || "#infra-health";
        link.textContent = issue.label || issue.domain || "—";
        area.appendChild(link);
        const service = document.createElement("td");
        service.textContent = issue.service || "—";
        const detail = document.createElement("td");
        detail.textContent = issue.detail || "—";
        tr.append(area, service, detail);
        els.pulseIssuesBody.appendChild(tr);
      }
    }
  }
}

async function refresh() {
  els.summary.textContent = "checking home & lab…";
  if (els.pulseSummary) els.pulseSummary.textContent = "checking…";
  els.refresh.disabled = true;
  try {
    const [data, home] = await Promise.all([
      fetchJson("/api/status"),
      fetchJson("/api/home").catch(() => null),
    ]);
    lastPayload = data;
    statusByName = new Map((data.services || []).map((s) => [s.name, s]));
    renderStats(data);
    renderGrid(data);
    renderCatalogSections();
    if (home) renderHomePulse(home);
    els.summary.textContent = summarize(data.counts);
  } catch (err) {
    els.summary.textContent = `health check failed: ${err.message}`;
    if (els.pulseSummary) els.pulseSummary.textContent = "health check failed";
    console.error(err);
  } finally {
    els.refresh.disabled = false;
  }
}

setThemeMode(currentThemeMode());
els.themeToggle?.addEventListener("click", () => {
  const idx = THEME_ORDER.indexOf(currentThemeMode());
  setThemeMode(THEME_ORDER[(idx + 1) % THEME_ORDER.length]);
});

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
