const ICON_VER = "20";
const THEME_KEY = "dockfire-theme";
const THEME_ORDER = ["system", "dark", "light"];
const THEME_LABELS = { system: "Theme: System", dark: "Theme: Dark", light: "Theme: Light" };
const VIEW_KEY = "dockfire-view";
const VIEWS = ["home", "ranch", "favorites", "automation", "infra", "guide"];

const FAVORITE_SECTIONS = new Set(["shares", "games", "external"]);
const FAVORITE_FROM_HOME = new Set(["Plex (lab)", "Plex (app)", "Brother printer", "Sign in"]);
const AUTOMATION_NAMES = new Set([
  "Lutron",
  "SmartThings",
  "Pool · WaterGuru / Hayward",
  "Pool · WaterGuru",
]);

const els = {
  summary: document.getElementById("summary"),
  refresh: document.getElementById("refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  search: document.getElementById("search"),
  audienceFilters: document.getElementById("audience-filters"),
  favoritesGrid: document.getElementById("favorites-grid"),
  automationGrid: document.getElementById("automation-grid"),
  localGrid: document.getElementById("local-grid"),
  heroWelcome: document.getElementById("hero-welcome"),
  pulseSummary: document.getElementById("pulse-summary"),
  pulseBoard: document.getElementById("pulse-board"),
  pulseIssues: document.getElementById("pulse-issues"),
  pulseIssuesBody: document.getElementById("pulse-issues-body"),
  providersGrid: document.getElementById("providers-grid"),
  chartDonut: document.getElementById("chart-donut"),
  chartLegend: document.getElementById("chart-legend"),
  chartBars: document.getElementById("chart-bars"),
  ranchWelcome: document.getElementById("ranch-welcome"),
  ranchPulseSummary: document.getElementById("ranch-pulse-summary"),
  ranchPulseBoard: document.getElementById("ranch-pulse-board"),
  ranchPulseIssues: document.getElementById("ranch-pulse-issues"),
  ranchPulseIssuesBody: document.getElementById("ranch-pulse-issues-body"),
  ranchChartDonut: document.getElementById("ranch-chart-donut"),
  ranchChartLegend: document.getElementById("ranch-chart-legend"),
  grid: document.getElementById("grid"),
  kindFilters: document.getElementById("kind-filters"),
  online: document.getElementById("stat-online"),
  down: document.getElementById("stat-down"),
  latency: document.getElementById("stat-latency"),
  kinds: document.getElementById("stat-kinds"),
  checked: document.getElementById("stat-checked"),
};

const templates = {
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
let providers = [];
let lastPayload = null;
let lastHome = null;
let activeAudience = "all";
let activeKind = "all";
let searchQuery = "";
let statusByName = new Map();
let currentView = "home";

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

function svgEl(name, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function showView(view) {
  currentView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (_) {
    /* ignore */
  }
  document.querySelectorAll(".view").forEach((panel) => {
    const active = panel.dataset.view === view;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  document.querySelectorAll("[data-nav]").forEach((tab) => {
    const active = tab.dataset.nav === view;
    tab.classList.toggle("active", active);
    if (tab.getAttribute("role") === "tab") tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (view === "favorites") renderCatalogSections();
  history.replaceState(null, "", `#view-${view}`);
}

function itemMatches(item) {
  if (activeAudience !== "all" && item.audience && item.audience !== activeAudience) return false;
  if (!searchQuery) return true;
  const hay = [item.name, item.blurb, item.help, item.category, item.audience, item.join]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(searchQuery);
}

function renderAudienceFilters() {
  if (!els.audienceFilters) return;
  els.audienceFilters.replaceChildren();
  for (const key of ["all", "everyone", "support", "admin"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "audience-chip" + (key === activeAudience ? " active" : "");
    btn.textContent = AUDIENCE_LABELS[key];
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
  const vendorOk = setIcon(node.querySelector(".launch-vendor"), item.vendor, `${item.name} vendor`, {
    onOk: () => node.classList.remove("no-vendor"),
    onFail: () => node.classList.add("no-vendor"),
  });
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
  setTextOrHide(node.querySelector(".launch-audience"), AUDIENCE_LABELS[item.audience] || item.audience || "");

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
  if (!container) return;
  container.replaceChildren();
  const visible = items.filter(itemMatches);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "Nothing matches that search or filter.";
    container.appendChild(empty);
    return;
  }
  for (const item of visible) container.appendChild(renderLaunchCard(item));
}

function sectionById(id) {
  return (catalog?.sections || []).find((s) => s.id === id);
}

function collectFavorites() {
  const items = [];
  for (const section of catalog?.sections || []) {
    if (FAVORITE_SECTIONS.has(section.id)) items.push(...(section.items || []));
    if (section.id === "home") {
      for (const item of section.items || []) {
        if (FAVORITE_FROM_HOME.has(item.name)) items.push(item);
      }
    }
  }
  return items;
}

function collectAutomation() {
  const items = [];
  for (const section of catalog?.sections || []) {
    for (const item of section.items || []) {
      if (
        AUTOMATION_NAMES.has(item.name) ||
        (item.category === "Home" && /lutron|smartthings|pool/i.test(item.name))
      ) {
        items.push(item);
      }
    }
  }
  // de-dupe by name
  const seen = new Set();
  return items.filter((i) => (seen.has(i.name) ? false : (seen.add(i.name), true)));
}

function renderCatalogSections() {
  const local = sectionById("local");
  fillLaunchGrid(els.favoritesGrid, collectFavorites());
  fillLaunchGrid(els.automationGrid, collectAutomation());
  if (local) fillLaunchGrid(els.localGrid, local.items || []);
}

function renderCatalog(data) {
  catalog = data;
  if (data.welcome && els.heroWelcome) els.heroWelcome.textContent = data.welcome;
  renderAudienceFilters();
  renderCatalogSections();
}

function primaryStat(domain) {
  const first = (domain.stats || [])[0];
  if (first?.value) return String(first.value);
  if (domain.status === "ok") return "ok";
  if (domain.status === "bad") return "down";
  if (domain.status === "warn") return "warn";
  return "—";
}

function siteBundle(home, siteId) {
  if (home?.by_site?.[siteId]) return home.by_site[siteId];
  const domains = (home?.domains || []).filter((d) => (d.site || "home") === siteId);
  const issues = (home?.issues || []).filter((i) => (i.site || "home") === siteId);
  return {
    id: siteId,
    summary: home?.summary || {},
    domains,
    issues,
  };
}

function updateScene(domains, root = document) {
  const byId = Object.fromEntries((domains || []).map((d) => [d.id, d]));
  root.querySelectorAll(".scene-node").forEach((node) => {
    const domain = byId[node.dataset.domain];
    const status = domain?.status || "unknown";
    node.dataset.status = status;
    if (domain?.href) node.dataset.href = domain.href;
    const statusDot = node.querySelector(".scene-status");
    if (statusDot) statusDot.setAttribute("data-status", status);
    const stat = node.querySelector("[data-stat]");
    if (stat) stat.textContent = domain ? primaryStat(domain) : "—";
  });
  root.querySelectorAll(".scene-flow").forEach((flow) => {
    flow.classList.remove("is-ok", "is-bad", "is-warn", "is-unknown");
    const id = flow.id || "";
    let status = "unknown";
    if (id.includes("solar")) status = byId.solar?.status || "unknown";
    else if (id.includes("grid")) status = byId.internet?.status || "unknown";
    else if (id.includes("power")) status = byId.power?.status || "unknown";
    else if (id.includes("lab")) status = byId.lab?.status || "unknown";
    else if (id.includes("ranch")) status = byId["ranch-gateway"]?.status || byId["ranch-link"]?.status || "unknown";
    flow.classList.add(`is-${status}`);
  });
}

function renderDonut(summary = {}, donutEl = els.chartDonut, legendEl = els.chartLegend) {
  if (!donutEl) return;
  const parts = [
    { key: "ok", value: summary.ok || 0, color: "var(--ok)" },
    { key: "warn", value: summary.warn || 0, color: "var(--warn)" },
    { key: "bad", value: summary.bad || 0, color: "var(--bad)" },
    { key: "unknown", value: summary.unknown || 0, color: "var(--unknown)" },
  ];
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  donutEl.replaceChildren();
  donutEl.appendChild(
    svgEl("circle", {
      cx: "60",
      cy: "60",
      r: String(r),
      fill: "none",
      stroke: "var(--line)",
      "stroke-width": "14",
    })
  );
  let offset = 0;
  for (const part of parts) {
    if (!part.value) continue;
    const len = (part.value / total) * c;
    const circle = svgEl("circle", {
      cx: "60",
      cy: "60",
      r: String(r),
      fill: "none",
      stroke: part.color,
      "stroke-width": "14",
      "stroke-dasharray": `${len} ${c - len}`,
      "stroke-dashoffset": String(-offset),
      transform: "rotate(-90 60 60)",
    });
    donutEl.appendChild(circle);
    offset += len;
  }
  const label = svgEl("text", {
    x: "60",
    y: "64",
    "text-anchor": "middle",
    class: "donut-center",
  });
  label.textContent = `${summary.ok || 0}/${total}`;
  donutEl.appendChild(label);

  if (legendEl) {
    legendEl.replaceChildren();
    for (const part of parts) {
      if (!part.value) continue;
      const li = document.createElement("li");
      li.innerHTML = `<span class="swatch is-${part.key}"></span>${part.key} ${part.value}`;
      legendEl.appendChild(li);
    }
  }
}

function renderBars(domains = []) {
  if (!els.chartBars) return;
  els.chartBars.replaceChildren();
  const rows = domains
    .map((d) => ({
      label: d.label,
      ms: typeof d.latency_ms === "number" ? d.latency_ms : null,
      status: d.status,
    }))
    .filter((d) => d.ms != null);
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "No latency samples yet.";
    els.chartBars.appendChild(empty);
    return;
  }
  const max = Math.max(...rows.map((r) => r.ms), 1);
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "bar-row";
    const name = document.createElement("span");
    name.className = "bar-label";
    name.textContent = row.label;
    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = `bar-fill is-${row.status || "unknown"}`;
    fill.style.width = `${Math.max(8, (row.ms / max) * 100)}%`;
    track.appendChild(fill);
    const val = document.createElement("span");
    val.className = "bar-value";
    val.textContent = fmtMs(row.ms);
    line.append(name, track, val);
    els.chartBars.appendChild(line);
  }
}

function pulseLine(summary, domains) {
  const bad = summary.bad || 0;
  const warn = summary.warn || 0;
  const ok = summary.ok || 0;
  if (bad === 1) return "1 area needs attention";
  if (bad > 1) return `${bad} areas need attention`;
  if (warn) return `${warn} warning · ${ok} healthy`;
  return `${ok}/${domains.length} areas healthy`;
}

function fillPulseBoard(board, domains) {
  if (!board) return;
  board.replaceChildren();
  for (const domain of domains) {
    const card = document.createElement(domain.href ? "a" : "div");
    card.className = "pulse-card";
    if (domain.href) card.href = domain.href;
    card.setAttribute("role", "listitem");
    if (domain.href?.startsWith("#view-")) {
      card.addEventListener("click", (e) => {
        e.preventDefault();
        showView(domain.href.replace("#view-", ""));
      });
    }
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
    board.appendChild(card);
  }
}

function fillIssues(tableEl, bodyEl, issues) {
  if (!tableEl || !bodyEl) return;
  bodyEl.replaceChildren();
  tableEl.hidden = !issues.length;
  for (const issue of issues) {
    const tr = document.createElement("tr");
    const area = document.createElement("td");
    const link = document.createElement("a");
    link.href = issue.href || "#view-infra";
    link.textContent = issue.label || issue.domain || "—";
    link.addEventListener("click", (e) => {
      if ((link.getAttribute("href") || "").includes("view-")) {
        e.preventDefault();
        showView(link.getAttribute("href").replace("#view-", ""));
      }
    });
    area.appendChild(link);
    const service = document.createElement("td");
    service.textContent = issue.service || "—";
    const detail = document.createElement("td");
    detail.textContent = issue.detail || "—";
    tr.append(area, service, detail);
    bodyEl.appendChild(tr);
  }
}

function renderHomePulse(home) {
  lastHome = home;
  const bundle = siteBundle(home, "home");
  const domains = bundle.domains || [];
  const summary = bundle.summary || {};
  if (els.pulseSummary) els.pulseSummary.textContent = pulseLine(summary, domains);

  updateScene(domains, document.getElementById("view-home") || document);
  renderDonut(summary, els.chartDonut, els.chartLegend);
  renderBars(domains);
  fillPulseBoard(els.pulseBoard, domains);
  fillIssues(els.pulseIssues, els.pulseIssuesBody, bundle.issues || []);
  renderProviders(home, "home");
  renderRanchPulse(home);
}

function renderRanchPulse(home) {
  const bundle = siteBundle(home, "ranch");
  const domains = bundle.domains || [];
  const summary = bundle.summary || {};
  if (els.ranchWelcome && bundle.blurb) els.ranchWelcome.textContent = bundle.blurb;
  if (els.ranchPulseSummary) {
    els.ranchPulseSummary.textContent = domains.length
      ? pulseLine(summary, domains)
      : "Ranch probe pending — add Ranch Gateway to LAN overlay";
  }
  updateScene(domains, document.getElementById("view-ranch") || document);
  renderDonut(summary, els.ranchChartDonut, els.ranchChartLegend);
  fillPulseBoard(els.ranchPulseBoard, domains);
  fillIssues(els.ranchPulseIssues, els.ranchPulseIssuesBody, bundle.issues || []);
}

function renderProviders(home, siteId = "home") {
  if (!els.providersGrid) return;
  const byDomain = Object.fromEntries((home?.domains || []).map((d) => [d.id, d]));
  els.providersGrid.replaceChildren();
  const list = providers.filter((p) => (p.site || "home") === siteId);
  for (const p of list) {
    let status = "unknown";
    if (p.statusName) status = statusByName.get(p.statusName)?.status || "unknown";
    else if (p.domain && byDomain[p.domain]) status = byDomain[p.domain].status || "unknown";
    else if (!p.domain && !p.statusName) status = "external";

    const card = document.createElement("article");
    card.className = "provider-card";
    card.setAttribute("role", "listitem");
    card.innerHTML = `
      <div class="provider-top">
        <span class="pulse-card-dot is-${status}"></span>
        <div>
          <h3 class="provider-name"></h3>
          <p class="provider-area"></p>
        </div>
      </div>
      <p class="provider-blurb"></p>
      <p class="provider-support"><span class="provider-support-label"></span> <a class="provider-phone"></a></p>
      <p class="provider-note" hidden></p>
      <div class="provider-actions"></div>
    `;
    card.querySelector(".provider-name").textContent = p.name;
    card.querySelector(".provider-area").textContent = p.area || p.kind || "";
    card.querySelector(".provider-blurb").textContent = p.blurb || "";
    card.querySelector(".provider-support-label").textContent = p.supportLabel || "Support";
    const phone = card.querySelector(".provider-phone");
    phone.href = `tel:${String(p.support || "").replace(/[^\d+]/g, "")}`;
    phone.textContent = p.support || "—";
    if (p.supportHint) phone.title = p.supportHint;
    const note = card.querySelector(".provider-note");
    if (p.note) {
      note.hidden = false;
      note.textContent = p.note;
    }
    const actions = card.querySelector(".provider-actions");
    if (p.url) {
      const a = document.createElement("a");
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Provider site";
      actions.appendChild(a);
    }
    if (p.localUrl) {
      const a = document.createElement("a");
      a.href = p.localUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Local UI";
      actions.appendChild(a);
    }
    if (p.outage) {
      const a = document.createElement("a");
      a.href = p.outage;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = p.kind === "waste" ? "Sac311" : "Outages";
      actions.appendChild(a);
    }
    if (p.emergency) {
      const a = document.createElement("a");
      a.href = `tel:${p.emergency.replace(/[^\d+]/g, "")}`;
      a.textContent = `Emergency ${p.emergency}`;
      actions.appendChild(a);
    }
    els.providersGrid.appendChild(card);
  }
}

function renderStats(data) {
  const counts = data.counts || {};
  const services = data.services || [];
  const latencies = services.map((s) => s.latency_ms).filter((n) => typeof n === "number");
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const kinds = new Set(services.map((s) => s.kind).filter(Boolean));

  if (els.online) els.online.textContent = String(counts.ok || 0);
  if (els.down) els.down.textContent = String((counts.bad || 0) + (counts.warn || 0));
  if (els.latency) els.latency.textContent = avg == null ? "—" : fmtMs(avg);
  if (els.kinds) els.kinds.textContent = String(kinds.size);
  if (els.checked) els.checked.textContent = fmtTime(data.as_of);

  if (!els.kindFilters) return;
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
      renderStats(data);
      renderGrid(data);
    });
    els.kindFilters.appendChild(btn);
  }
}

function renderTile(service) {
  const node = templates.tile.content.firstElementChild.cloneNode(true);
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = service.status || "unknown";
  node.classList.add("no-vendor");
  const vendorOk = setIcon(node.querySelector(".tile-vendor"), service.vendor, `${service.name} vendor`, {
    onOk: () => node.classList.remove("no-vendor"),
    onFail: () => node.classList.add("no-vendor"),
  });
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
  if (!els.grid) return;
  els.grid.replaceChildren();
  let services = data.services || [];
  if (activeKind !== "all") services = services.filter((s) => s.kind === activeKind);
  if (searchQuery && currentView === "infra") {
    services = services.filter((s) =>
      [s.name, s.description, s.kind, s.detail].filter(Boolean).join(" ").toLowerCase().includes(searchQuery)
    );
  }
  for (const service of services) els.grid.appendChild(renderTile(service));
}

function renderWiki(wiki) {
  const title = document.getElementById("wiki-title");
  const intro = document.getElementById("wiki-intro");
  if (title) title.textContent = wiki.title || "Guide";
  if (intro) intro.textContent = wiki.intro || "";
  const body = document.getElementById("wiki-body");
  if (!body) return;
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
  if (!notes) return;
  notes.replaceChildren();
  for (const note of wiki.notes || []) {
    const li = document.createElement("li");
    li.textContent = note;
    notes.appendChild(li);
  }
}

function summarize(counts = {}) {
  const ok = counts.ok || 0;
  const bad = counts.bad || 0;
  const warn = counts.warn || 0;
  if (bad + warn === 0) return `${ok} online`;
  return `${bad + warn} down · ${ok} online`;
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
    else if (providers.length) renderProviders(null);
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

els.search?.addEventListener("input", () => {
  searchQuery = els.search.value.trim().toLowerCase();
  renderCatalogSections();
  if (lastPayload && currentView === "infra") renderGrid(lastPayload);
});

els.refresh?.addEventListener("click", refresh);

document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", (e) => {
    const view = el.dataset.nav;
    if (!view) return;
    if (el.tagName === "A") e.preventDefault();
    showView(view);
  });
});

document.querySelectorAll(".scene-node").forEach((node) => {
  node.addEventListener("click", () => {
    const href = node.dataset.href || "";
    if (href.startsWith("#view-")) showView(href.replace("#view-", ""));
  });
});

const hashView = (location.hash || "").replace(/^#view-/, "").replace(/^#/, "");
const savedView = (() => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch (_) {
    return null;
  }
})();
const initial = VIEWS.includes(hashView) ? hashView : VIEWS.includes(savedView) ? savedView : "home";
showView(initial);

fetchJson("/catalog.json")
  .then(renderCatalog)
  .catch((err) => {
    if (els.heroWelcome) els.heroWelcome.textContent = `Catalog failed to load: ${err.message}`;
  });

fetchJson("/providers.json")
  .then((data) => {
    providers = data.providers || [];
    if (lastHome) renderProviders(lastHome);
    else renderProviders(null);
  })
  .catch(() => {
    providers = [];
  });

fetchJson("/wiki.json")
  .then(renderWiki)
  .catch((err) => {
    const intro = document.getElementById("wiki-intro");
    if (intro) intro.textContent = `Guide failed to load: ${err.message}`;
  });

refresh();
setInterval(refresh, 60_000);
