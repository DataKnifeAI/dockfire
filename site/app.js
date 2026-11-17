const ICON_VER = "31";
const THEME_KEY = "dockfire-theme";
const THEME_ORDER = ["system", "dark", "light"];
const THEME_LABELS = { system: "Theme: System", dark: "Theme: Dark", light: "Theme: Light" };
const VIEW_KEY = "dockfire-view";
const HISTORY_KEY = "dockfire-mode-history";
const VIEWS = ["home", "energy", "ranch", "automation", "infra", "guide"];

const HOME_SERVICE_GROUPS = [
  { id: "media", label: "Media", names: ["Plex (app)"] },
  { id: "shares", label: "Shares", names: ["Movies", "Shows", "Photos", "Anime"] },
  { id: "games", label: "Games", names: ["Palworld", "Windrose", "Satisfactory", "Dragonwilds"] },
  { id: "comms", label: "Comms", names: ["Stoat"] },
  { id: "print", label: "Print", names: ["Brother printer"] },
];
const HOME_SERVICE_NAMES = HOME_SERVICE_GROUPS.flatMap((g) => g.names);
const HOME_CONNECT_CATEGORIES = new Set(["Shares", "Game server", "Print", "Chat"]);
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
  automationGrid: document.getElementById("automation-grid"),
  localGrid: document.getElementById("local-grid"),
  homeServicesGrid: document.getElementById("home-services-grid"),
  homeServiceDetail: document.getElementById("home-service-detail"),
  heroWelcome: document.getElementById("hero-welcome"),
  pulseSummary: document.getElementById("pulse-summary"),
  pulseIssues: document.getElementById("pulse-issues"),
  pulseIssuesBody: document.getElementById("pulse-issues-body"),
  providersGrid: document.getElementById("providers-grid"),
  emergencyGrid: document.getElementById("emergency-grid"),
  emergencyLead: document.getElementById("emergency-lead"),
  modeHealth: document.getElementById("mode-health"),
  modeHealthValue: document.getElementById("mode-health-value"),
  modeHealthDetail: document.getElementById("mode-health-detail"),
  modeProduction: document.getElementById("mode-production"),
  modeProductionValue: document.getElementById("mode-production-value"),
  modeProductionDetail: document.getElementById("mode-production-detail"),
  modeBattery: document.getElementById("mode-battery"),
  modeBatteryValue: document.getElementById("mode-battery-value"),
  modeBatteryDetail: document.getElementById("mode-battery-detail"),
  modeIsp: document.getElementById("mode-isp"),
  modeIspValue: document.getElementById("mode-isp-value"),
  modeIspDetail: document.getElementById("mode-isp-detail"),
  historyChart: document.getElementById("history-chart"),
  energySummary: document.getElementById("energy-summary"),
  energySumProduction: document.getElementById("energy-sum-production"),
  energySumProductionValue: document.getElementById("energy-sum-production-value"),
  energySumProductionDetail: document.getElementById("energy-sum-production-detail"),
  energySumBattery: document.getElementById("energy-sum-battery"),
  energySumBatteryValue: document.getElementById("energy-sum-battery-value"),
  energySumBatteryDetail: document.getElementById("energy-sum-battery-detail"),
  energySumGrid: document.getElementById("energy-sum-grid"),
  energySumGridValue: document.getElementById("energy-sum-grid-value"),
  energySumGridDetail: document.getElementById("energy-sum-grid-detail"),
  energySystems: document.getElementById("energy-systems"),
  energyNote: document.getElementById("energy-note"),
  chartDonut: document.getElementById("chart-donut"),
  chartLegend: document.getElementById("chart-legend"),
  chartBars: document.getElementById("chart-bars"),
  ranchWelcome: document.getElementById("ranch-welcome"),
  ranchPulseSummary: document.getElementById("ranch-pulse-summary"),
  ranchPulseBoard: document.getElementById("ranch-pulse-board"),
  ranchPulseIssues: document.getElementById("ranch-pulse-issues"),
  ranchPulseIssuesBody: document.getElementById("ranch-pulse-issues-body"),
  ranchEmptyHint: document.getElementById("ranch-empty-hint"),
  grid: document.getElementById("grid"),
  kindFilters: document.getElementById("kind-filters"),
  online: document.getElementById("stat-online"),
  down: document.getElementById("stat-down"),
  latency: document.getElementById("stat-latency"),
  kinds: document.getElementById("stat-kinds"),
  checked: document.getElementById("stat-checked"),
  installApp: document.getElementById("install-app"),
  offlineBanner: document.getElementById("offline-banner"),
  weatherTemp: document.getElementById("weather-temp"),
  weatherForecast: document.getElementById("weather-forecast"),
  weatherMeta: document.getElementById("weather-meta"),
  quakeList: document.getElementById("quake-list"),
  weatherLead: document.getElementById("weather-lead"),
  hazardsGrid: document.getElementById("hazards-grid"),
  homeRanchWeatherCard: document.getElementById("ranch-weather-card"),
  homeRanchWeatherTemp: document.getElementById("home-ranch-weather-temp"),
  homeRanchWeatherDetail: document.getElementById("home-ranch-weather-detail"),
  homeRanchWeatherMeta: document.getElementById("home-ranch-weather-meta"),
  ranchWxTemp: document.getElementById("ranch-wx-temp"),
  ranchWxTempValue: document.getElementById("ranch-wx-temp-value"),
  ranchWxTempDetail: document.getElementById("ranch-wx-temp-detail"),
  ranchWxHumidity: document.getElementById("ranch-wx-humidity"),
  ranchWxHumidityValue: document.getElementById("ranch-wx-humidity-value"),
  ranchWxHumidityDetail: document.getElementById("ranch-wx-humidity-detail"),
  ranchWxWind: document.getElementById("ranch-wx-wind"),
  ranchWxWindValue: document.getElementById("ranch-wx-wind-value"),
  ranchWxWindDetail: document.getElementById("ranch-wx-wind-detail"),
  ranchWeatherStats: document.getElementById("ranch-weather-stats"),
  ranchWeatherNote: document.getElementById("ranch-weather-note"),
};

let deferredInstall = null;
let usingMock = false;

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

async function fetchApiOrMock(apiPath, mockPath) {
  try {
    const data = await fetchJson(apiPath);
    return { data, mock: false };
  } catch (err) {
    console.warn(`${apiPath} unavailable, using mock`, err);
    const data = await fetchJson(mockPath);
    return { data, mock: true };
  }
}

function setOfflineBanner(on) {
  usingMock = on;
  if (els.offlineBanner) els.offlineBanner.hidden = !on;
}

function renderRanchWeather(home) {
  const wx = home?.ranch_weather || {};
  const ok = !!wx.ok;
  const status = ok ? "ok" : wx.note ? "warn" : "unknown";
  const unit = wx.unit || "F";
  const tempText = wx.temp != null ? `${wx.temp}°${unit}` : "—";
  const humidity = wx.humidity || "—";
  const windBits = [wx.wind, wx.gust ? `gust ${wx.gust}` : null, wx.wind_dir].filter(Boolean);
  const windText = windBits.length ? windBits[0] : "—";
  const windDetail = [wx.gust ? `Gust ${wx.gust}` : null, wx.wind_dir].filter(Boolean).join(" · ") || "Gust / dir";

  if (els.homeRanchWeatherCard) els.homeRanchWeatherCard.dataset.status = status;
  if (els.homeRanchWeatherTemp) els.homeRanchWeatherTemp.textContent = tempText;
  if (els.homeRanchWeatherDetail) {
    const bits = [];
    if (wx.humidity) bits.push(`${wx.humidity} RH`);
    if (wx.wind) bits.push(`Wind ${wx.wind}`);
    els.homeRanchWeatherDetail.textContent = bits.join(" · ") || wx.note || "Ambient Weather over SD-WAN";
  }
  if (els.homeRanchWeatherMeta) {
    const bits = [];
    if (wx.rain_day) bits.push(`Rain ${wx.rain_day}`);
    if (wx.provider) bits.push(wx.provider);
    els.homeRanchWeatherMeta.textContent = bits.join(" · ");
  }

  if (els.ranchWxTemp) els.ranchWxTemp.dataset.status = status;
  if (els.ranchWxTempValue) els.ranchWxTempValue.textContent = tempText;
  if (els.ranchWxTempDetail) {
    els.ranchWxTempDetail.textContent = wx.dew_point ? `Dew ${wx.dew_point}` : wx.provider || "Station";
  }
  if (els.ranchWxHumidity) els.ranchWxHumidity.dataset.status = status;
  if (els.ranchWxHumidityValue) els.ranchWxHumidityValue.textContent = humidity;
  if (els.ranchWxHumidityDetail) {
    els.ranchWxHumidityDetail.textContent = wx.rain_rate ? `Rate ${wx.rain_rate}` : "Outdoor";
  }
  if (els.ranchWxWind) els.ranchWxWind.dataset.status = status;
  if (els.ranchWxWindValue) els.ranchWxWindValue.textContent = windText;
  if (els.ranchWxWindDetail) els.ranchWxWindDetail.textContent = windDetail;

  if (els.ranchWeatherStats) {
    els.ranchWeatherStats.replaceChildren();
    const stats = wx.stats || [];
    if (!stats.length) {
      const empty = document.createElement("p");
      empty.className = "empty-hint";
      empty.textContent = ok ? "No station fields yet." : "Ranch weather station unreachable.";
      els.ranchWeatherStats.appendChild(empty);
    } else {
      const dl = document.createElement("dl");
      dl.className = "energy-system-stats";
      for (const row of stats) {
        const dt = document.createElement("dt");
        dt.textContent = row.label || "";
        const dd = document.createElement("dd");
        dd.textContent = row.value ?? "—";
        dl.append(dt, dd);
      }
      els.ranchWeatherStats.appendChild(dl);
    }
  }

  if (els.ranchWeatherNote) {
    const note = wx.note || "";
    els.ranchWeatherNote.textContent = note;
    els.ranchWeatherNote.hidden = !note;
  }
}

function renderWeather(home) {
  const weather = home?.weather;
  if (els.weatherTemp) {
    els.weatherTemp.textContent =
      weather && weather.temp != null ? `${weather.temp}°${weather.unit || "F"}` : "—";
  }
  if (els.weatherForecast) {
    els.weatherForecast.textContent = weather?.forecast || home?.weather_note || "Forecast unavailable";
  }
  if (els.weatherMeta) {
    const bits = [];
    if (weather?.name) bits.push(weather.name);
    if (weather?.wind) bits.push(`Wind ${weather.wind}`);
    els.weatherMeta.textContent = bits.join(" · ");
  }
  if (els.quakeList) {
    els.quakeList.replaceChildren();
    const quakes = home?.quakes || [];
    if (!quakes.length) {
      const li = document.createElement("li");
      li.textContent = "No nearby quakes (mag 2.5+) in the last day.";
      els.quakeList.appendChild(li);
    } else {
      for (const q of quakes) {
        const li = document.createElement("li");
        const mag = q.mag != null ? `M${Number(q.mag).toFixed(1)}` : "M?";
        if (q.url) {
          const a = document.createElement("a");
          a.href = q.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = `${mag} · ${q.place || "nearby"}`;
          li.appendChild(a);
        } else {
          li.textContent = `${mag} · ${q.place || "nearby"}`;
        }
        els.quakeList.appendChild(li);
      }
    }
  }
  renderRanchWeather(home);
}

function renderHazards(data) {
  if (!els.hazardsGrid) return;
  if (els.weatherLead && data.lead) els.weatherLead.textContent = data.lead;
  els.hazardsGrid.replaceChildren();
  for (const action of data.actions || []) {
    const card = document.createElement("article");
    card.className = "hazard-card";
    card.setAttribute("role", "listitem");
    const title = document.createElement("h3");
    title.textContent = action.title || "";
    card.appendChild(title);
    const list = document.createElement("ul");
    for (const step of action.do || []) {
      const li = document.createElement("li");
      li.textContent = step;
      list.appendChild(li);
    }
    card.appendChild(list);
    if (action.links?.length) {
      const links = document.createElement("div");
      links.className = "hazard-links";
      for (const link of action.links) {
        const a = document.createElement("a");
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = link.label || link.url;
        links.appendChild(a);
      }
      card.appendChild(links);
    }
    els.hazardsGrid.appendChild(card);
  }
}

function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveLocalHistory(samples) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(samples.slice(-48)));
  } catch (_) {
    /* ignore */
  }
}

function mergeHistory(serverSamples = []) {
  const local = loadLocalHistory();
  const byT = new Map();
  for (const s of [...local, ...serverSamples]) {
    if (!s || typeof s.t !== "number") continue;
    byT.set(s.t, s);
  }
  const merged = [...byT.values()].sort((a, b) => a.t - b.t).slice(-48);
  saveLocalHistory(merged);
  return merged;
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
  history.replaceState(null, "", `#view-${view}`);
}

function itemMatches(item) {
  if (!searchQuery) return true;
  const hay = [item.name, item.blurb, item.help, item.category, item.audience, item.join]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(searchQuery);
}

function isHomeConnectItem(item) {
  return HOME_CONNECT_CATEGORIES.has(item.category) || Boolean(item.connect || item.join);
}

function renderLaunchCard(item, opts = {}) {
  const homeConnect = Boolean(opts.homeConnect);
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
  // On Home, show how-to-connect only (join / OS mounts). Admin pages live under Infra.
  const detailFields = homeConnect
    ? {
        join: item.join,
        linux: item.connect?.linux,
        windows: item.connect?.windows,
      }
    : {
        join: item.join,
        admin: item.adminDetail,
        linux: item.connect?.linux,
        windows: item.connect?.windows,
      };
  let hasDetails = false;
  for (const [key, value] of Object.entries(detailFields)) {
    const row = connectBox.querySelector(`[data-row="${key}"]`);
    const cmd = connectBox.querySelector(`[data-field="${key}"]`);
    if (!row || !cmd) continue;
    if (value) {
      row.hidden = false;
      cmd.textContent = value;
      hasDetails = true;
    } else {
      row.hidden = true;
    }
  }
  // Hide unused admin row when in home-connect mode
  const adminRow = connectBox.querySelector(`[data-row="admin"]`);
  if (homeConnect && adminRow) adminRow.hidden = true;
  connectBox.hidden = !hasDetails;

  setTextOrHide(node.querySelector(".launch-category"), item.category || "");
  setTextOrHide(node.querySelector(".launch-audience"), AUDIENCE_LABELS[item.audience] || item.audience || "");

  const link = node.querySelector(".launch-link");
  if (homeConnect && isHomeConnectItem(item)) {
    link.hidden = false;
    link.href = "#view-infra";
    link.textContent = "Infra";
    link.removeAttribute("target");
    link.removeAttribute("rel");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showView("infra");
    });
  } else if (item.url) {
    link.hidden = false;
    link.href = item.url;
    link.textContent = item.linkLabel || "Open";
    if (item.url.startsWith("#view-")) {
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const view = item.url.replace("#view-", "");
        if (VIEWS.includes(view)) showView(view);
      });
    }
  } else {
    link.hidden = true;
  }
  return node;
}

function fillLaunchGrid(container, items, opts = {}) {
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
  for (const item of visible) container.appendChild(renderLaunchCard(item, opts));
}

function sectionById(id) {
  return (catalog?.sections || []).find((s) => s.id === id);
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
  fillLaunchGrid(els.automationGrid, collectAutomation());
  if (local) fillLaunchGrid(els.localGrid, local.items || []);
}

function renderCatalog(data) {
  catalog = data;
  if (data.welcome && els.heroWelcome) {
    // Keep home copy plain; catalog welcome can stay for search contexts.
  }
  renderCatalogSections();
  renderHomeServices();
}

function primaryStat(domain) {
  if (domain.mode === "grid" || domain.mode === "primary") return domain.stats?.[0]?.value || "Grid";
  if (domain.mode === "battery" || domain.mode === "backup") return domain.stats?.[0]?.value || "Backup";
  const first = (domain.stats || [])[0];
  if (first?.value) return String(first.value);
  if (domain.status === "ok") return "ok";
  if (domain.status === "bad") return "down";
  if (domain.status === "warn") return "check";
  return "—";
}

function historyClass(kind, value) {
  if (kind === "power") {
    if (value === "grid") return "is-grid";
    if (value === "battery") return "is-battery";
    return "is-down";
  }
  if (value === "primary") return "is-grid";
  if (value === "backup") return "is-battery";
  return "is-down";
}

function fmtKw(watts) {
  if (watts == null || Number.isNaN(Number(watts))) return "—";
  return `${(Number(watts) / 1000).toFixed(2)} kW`;
}

function fmtSoc(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return "—";
  return `${Math.round(Number(pct))}%`;
}

function renderModes(home = {}) {
  const modes = home.modes || {};
  const energy = home.energy || {};
  const power = modes.power || {};
  const isp = modes.isp || {};
  const summary = siteBundle(home, "home").summary || home.summary || {};
  const bad = summary.bad || 0;
  const warn = summary.warn || 0;
  const ok = summary.ok || 0;
  const healthStatus = bad > 0 ? "bad" : warn > 0 ? "warn" : ok > 0 ? "ok" : "unknown";
  const healthValue = bad > 0 ? `${bad} issue${bad === 1 ? "" : "s"}` : warn > 0 ? `${warn} check` : "OK";
  const healthDetail =
    bad > 0 ? "Needs attention" : warn > 0 ? "Something to review" : `${ok} area${ok === 1 ? "" : "s"} healthy`;

  const productionW = energy.production_w ?? energy.productionW;
  const productionStatus = energy.production_status || (productionW != null ? "ok" : "unknown");
  const productionDetail = energy.production_detail || "Solar right now";

  const soc = energy.soc_pct ?? power.soc_pct;
  const batteryStatus =
    energy.battery_status || power.status || (soc != null ? "ok" : "unknown");
  const batteryDetail =
    energy.battery_detail || power.detail || (soc != null ? "State of charge" : "Powerwall SoC");

  if (els.modeHealthValue) els.modeHealthValue.textContent = healthValue;
  if (els.modeHealthDetail) els.modeHealthDetail.textContent = healthDetail;
  if (els.modeHealth) els.modeHealth.dataset.status = healthStatus;

  if (els.modeProductionValue) els.modeProductionValue.textContent = fmtKw(productionW);
  if (els.modeProductionDetail) els.modeProductionDetail.textContent = productionDetail;
  if (els.modeProduction) els.modeProduction.dataset.status = productionStatus;

  if (els.modeBatteryValue) els.modeBatteryValue.textContent = fmtSoc(soc);
  if (els.modeBatteryDetail) els.modeBatteryDetail.textContent = batteryDetail;
  if (els.modeBattery) els.modeBattery.dataset.status = batteryStatus;

  if (els.modeIspValue) els.modeIspValue.textContent = isp.label || "—";
  if (els.modeIspDetail) els.modeIspDetail.textContent = isp.detail || "Fiber or backup";
  if (els.modeIsp) els.modeIsp.dataset.status = isp.status || "unknown";
}

function renderEnergy(home = {}) {
  const energy = home.energy || {};
  const modes = home.modes || {};
  const power = modes.power || {};
  const productionW = energy.production_w;
  const soc = energy.soc_pct ?? power.soc_pct;

  if (els.energySumProductionValue) els.energySumProductionValue.textContent = fmtKw(productionW);
  if (els.energySumProductionDetail) {
    els.energySumProductionDetail.textContent = energy.production_detail || "All arrays";
  }
  if (els.energySumProduction) {
    els.energySumProduction.dataset.status = energy.production_status || (productionW != null ? "ok" : "unknown");
  }

  if (els.energySumBatteryValue) els.energySumBatteryValue.textContent = fmtSoc(soc);
  if (els.energySumBatteryDetail) {
    els.energySumBatteryDetail.textContent = energy.battery_detail || power.detail || "State of charge";
  }
  if (els.energySumBattery) {
    els.energySumBattery.dataset.status = energy.battery_status || power.status || (soc != null ? "ok" : "unknown");
  }

  if (els.energySumGridValue) els.energySumGridValue.textContent = power.label || "—";
  if (els.energySumGridDetail) els.energySumGridDetail.textContent = power.detail || "Grid or battery";
  if (els.energySumGrid) els.energySumGrid.dataset.status = power.status || "unknown";

  if (els.energyNote) {
    const note = energy.note || home.energy_note || "";
    els.energyNote.textContent = note;
    els.energyNote.hidden = !note;
  }

  if (!els.energySystems) return;
  els.energySystems.replaceChildren();
  const systems = energy.systems || [];
  if (!systems.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "No energy systems in this snapshot yet.";
    els.energySystems.appendChild(empty);
    return;
  }

  for (const sys of systems) {
    const card = document.createElement("article");
    card.className = "energy-system";
    card.dataset.status = sys.status || "unknown";
    card.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "energy-system-top";
    const titleWrap = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "energy-system-name";
    name.textContent = sys.name || "System";
    const kind = document.createElement("p");
    kind.className = "energy-system-kind";
    kind.textContent = sys.kind || sys.role || "energy";
    titleWrap.append(name, kind);

    const badge = document.createElement("span");
    const source = (sys.source || "unknown").toLowerCase();
    badge.className = `energy-system-badge is-${source}`;
    badge.textContent = sys.source_label || sys.source || "—";
    top.append(titleWrap, badge);

    const dl = document.createElement("dl");
    dl.className = "energy-system-stats";
    for (const row of sys.stats || []) {
      const dt = document.createElement("dt");
      dt.textContent = row.label || "";
      const dd = document.createElement("dd");
      dd.textContent = row.value ?? "—";
      dl.append(dt, dd);
    }

    const note = document.createElement("p");
    note.className = "energy-system-note";
    if (sys.note) note.textContent = sys.note;
    else note.hidden = true;

    const actions = document.createElement("div");
    actions.className = "energy-system-actions";
    if (sys.href) {
      const a = document.createElement("a");
      a.href = sys.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = sys.link_label || "Open device";
      actions.appendChild(a);
    }

    card.append(top, dl, note, actions);
    els.energySystems.appendChild(card);
  }
}

function renderHistoryChart(samples = []) {
  if (!els.historyChart) return;
  els.historyChart.replaceChildren();
  if (!samples.length) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "History builds as DockFire checks the house.";
    els.historyChart.appendChild(empty);
    return;
  }
  for (const kind of ["power", "isp"]) {
    const row = document.createElement("div");
    row.className = "history-row";
    const label = document.createElement("span");
    label.className = "history-row-label";
    label.textContent = kind === "power" ? "Power" : "Internet";
    const track = document.createElement("div");
    track.className = "history-track";
    for (const sample of samples) {
      const seg = document.createElement("span");
      seg.className = `history-seg ${historyClass(kind, sample[kind])}`;
      const when = new Date(sample.t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      seg.title = `${when}: ${sample[kind] || "unknown"}`;
      track.appendChild(seg);
    }
    row.append(label, track);
    els.historyChart.appendChild(row);
  }
}

function renderEmergency(data) {
  if (!els.emergencyGrid) return;
  if (els.emergencyLead && data.lead) els.emergencyLead.textContent = data.lead;
  els.emergencyGrid.replaceChildren();
  for (const step of data.steps || []) {
    const card = document.createElement("article");
    card.className = "emergency-card";
    card.setAttribute("role", "listitem");
    const title = document.createElement("h3");
    title.textContent = step.title || "";
    const action = document.createElement("p");
    action.className = "emergency-action";
    if (step.phone) {
      const a = document.createElement("a");
      a.href = `tel:${String(step.phone).replace(/[^\d+]/g, "")}`;
      a.textContent = step.action || step.phone;
      action.appendChild(a);
    } else {
      action.textContent = step.action || "";
    }
    const detail = document.createElement("p");
    detail.className = "emergency-detail";
    detail.textContent = step.detail || "";
    card.append(title, action, detail);
    if (step.url) {
      const link = document.createElement("a");
      link.className = "emergency-link";
      link.href = step.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open guide";
      card.appendChild(link);
    }
    els.emergencyGrid.appendChild(card);
  }
}

function collectHomeServices() {
  const byName = new Map();
  for (const section of catalog?.sections || []) {
    for (const item of section.items || []) {
      if (HOME_SERVICE_NAMES.includes(item.name)) byName.set(item.name, item);
    }
  }
  return HOME_SERVICE_NAMES.map((n) => byName.get(n)).filter(Boolean);
}

function showHomeServiceDetail(item) {
  const panel = els.homeServiceDetail;
  if (!panel) return;
  panel.hidden = false;
  panel.replaceChildren();

  const head = document.createElement("div");
  head.className = "service-detail-head";
  const title = document.createElement("h3");
  title.className = "service-detail-title";
  title.textContent = item.name;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "service-detail-close";
  close.textContent = "Close";
  close.addEventListener("click", () => {
    panel.hidden = true;
    panel.replaceChildren();
    els.homeServicesGrid?.querySelectorAll(".service-chip.is-active").forEach((el) => {
      el.classList.remove("is-active");
      el.setAttribute("aria-expanded", "false");
    });
  });
  head.append(title, close);

  if (item.blurb) {
    const blurb = document.createElement("p");
    blurb.className = "service-detail-blurb";
    blurb.textContent = item.blurb;
    panel.append(head, blurb);
  } else {
    panel.appendChild(head);
  }

  if (item.help) {
    const help = document.createElement("p");
    help.className = "service-detail-help";
    help.textContent = item.help;
    panel.appendChild(help);
  }

  const rows = [];
  if (item.join) rows.push(["Join", item.join]);
  if (item.connect?.linux) rows.push(["Linux", item.connect.linux]);
  if (item.connect?.windows) rows.push(["Windows", item.connect.windows]);
  if (rows.length) {
    const box = document.createElement("div");
    box.className = "launch-connect";
    for (const [label, value] of rows) {
      const row = document.createElement("p");
      row.className = "connect-row";
      const os = document.createElement("span");
      os.className = "connect-os";
      os.textContent = label;
      const cmd = document.createElement("code");
      cmd.className = "connect-cmd";
      cmd.textContent = value;
      row.append(os, cmd);
      box.appendChild(row);
    }
    panel.appendChild(box);
  }

  const actions = document.createElement("div");
  actions.className = "service-detail-actions";
  if (isHomeConnectItem(item)) {
    const infra = document.createElement("button");
    infra.type = "button";
    infra.className = "refresh";
    infra.textContent = "Infra";
    infra.addEventListener("click", () => showView("infra"));
    actions.appendChild(infra);
  } else if (item.url) {
    const open = document.createElement("a");
    open.className = "refresh";
    open.href = item.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = item.linkLabel || "Open";
    actions.appendChild(open);
  }
  if (actions.childNodes.length) panel.appendChild(actions);
}

function makeHomeServiceChip(item) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "service-chip";
  btn.setAttribute("role", "listitem");
  btn.setAttribute("aria-expanded", "false");
  const status = item.statusName ? statusByName.get(item.statusName) : null;
  const dot = document.createElement("span");
  dot.className = `pulse-card-dot is-${status?.status || "external"}`;
  const img = document.createElement("img");
  img.alt = "";
  img.width = 22;
  img.height = 22;
  setIcon(img, item.favicon || item.vendor, "");
  const name = document.createElement("span");
  name.className = "service-chip-name";
  name.textContent = item.name.replace(/\s*\(lab\)|\s*\(app\)/gi, "").trim();
  btn.append(dot, img, name);
  btn.addEventListener("click", () => {
    const wasActive = btn.classList.contains("is-active");
    els.homeServicesGrid.querySelectorAll(".service-chip.is-active").forEach((el) => {
      el.classList.remove("is-active");
      el.setAttribute("aria-expanded", "false");
    });
    if (wasActive) {
      if (els.homeServiceDetail) {
        els.homeServiceDetail.hidden = true;
        els.homeServiceDetail.replaceChildren();
      }
      return;
    }
    btn.classList.add("is-active");
    btn.setAttribute("aria-expanded", "true");
    showHomeServiceDetail(item);
  });
  return btn;
}

function renderHomeServices() {
  if (!els.homeServicesGrid) return;
  els.homeServicesGrid.replaceChildren();
  if (els.homeServiceDetail) {
    els.homeServiceDetail.hidden = true;
    els.homeServiceDetail.replaceChildren();
  }
  const byName = new Map(collectHomeServices().map((item) => [item.name, item]));
  let shown = 0;
  for (const group of HOME_SERVICE_GROUPS) {
    const items = group.names.map((n) => byName.get(n)).filter(Boolean);
    if (!items.length) continue;
    shown += items.length;
    const section = document.createElement("div");
    section.className = "services-group";
    section.dataset.group = group.id;
    const label = document.createElement("p");
    label.className = "services-group-label";
    label.textContent = group.label;
    const strip = document.createElement("div");
    strip.className = "services-strip";
    strip.setAttribute("role", "list");
    strip.setAttribute("aria-label", group.label);
    for (const item of items) strip.appendChild(makeHomeServiceChip(item));
    section.append(label, strip);
    els.homeServicesGrid.appendChild(section);
  }
  if (!shown) {
    const empty = document.createElement("p");
    empty.className = "empty-hint";
    empty.textContent = "Services load with the catalog.";
    els.homeServicesGrid.appendChild(empty);
  }
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
    else if (id.includes("pool")) status = byId.pool?.status || "unknown";
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
  if (els.pulseSummary) {
    const bad = summary.bad || 0;
    els.pulseSummary.textContent = bad
      ? `${bad} thing${bad === 1 ? "" : "s"} need attention`
      : "House looks okay";
  }

  updateScene(domains, document.getElementById("view-home") || document);
  renderModes(home);
  renderEnergy(home);
  renderHistoryChart(mergeHistory(home.history || []));
  renderWeather(home);
  fillIssues(els.pulseIssues, els.pulseIssuesBody, bundle.issues || []);
  renderProviders(home, "home");
  renderHomeServices();
  renderRanchPulse(home);

  // Detailed charts live on Infra.
  renderDonut(summary, els.chartDonut, els.chartLegend);
  renderBars(domains);
}

function renderRanchPulse(home) {
  const bundle = siteBundle(home, "ranch");
  const domains = bundle.domains || [];
  const summary = bundle.summary || {};
  if (els.ranchWelcome) {
    els.ranchWelcome.textContent =
      bundle.blurb ||
      "Ranch over SD-WAN — gateway, Protect, and Ambient Weather station.";
  }
  if (els.ranchPulseSummary) {
    els.ranchPulseSummary.textContent = domains.length
      ? pulseLine(summary, domains)
      : "Ranch link not configured yet";
  }
  updateScene(domains, document.getElementById("view-ranch") || document);
  fillPulseBoard(els.ranchPulseBoard, domains);
  fillIssues(els.ranchPulseIssues, els.ranchPulseIssuesBody, bundle.issues || []);
  if (els.ranchEmptyHint) {
    const gw = domains.find((d) => d.id === "ranch-gateway");
    els.ranchEmptyHint.hidden = !(gw && gw.status === "ok");
  }
  renderRanchWeather(home);
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
  els.summary.textContent = "checking…";
  if (els.pulseSummary) els.pulseSummary.textContent = "checking…";
  els.refresh.disabled = true;
  try {
    const [statusRes, homeRes] = await Promise.all([
      fetchApiOrMock("/api/status", "/mock/status.json"),
      fetchApiOrMock("/api/home", "/mock/home.json"),
    ]);
    const data = statusRes.data;
    const home = homeRes.data;
    setOfflineBanner(statusRes.mock || homeRes.mock);
    lastPayload = data;
    statusByName = new Map((data.services || []).map((s) => [s.name, s]));
    renderStats(data);
    renderGrid(data);
    renderCatalogSections();
    renderHomeServices();
    if (home) renderHomePulse(home);
    else if (providers.length) renderProviders(null);
    els.summary.textContent = (statusRes.mock ? "local · " : "") + summarize(data.counts);
  } catch (err) {
    setOfflineBanner(true);
    els.summary.textContent = `check failed: ${err.message}`;
    if (els.pulseSummary) els.pulseSummary.textContent = "check failed";
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

document.querySelectorAll("a.mode-card[href^='#view-']").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const view = el.getAttribute("href").replace("#view-", "");
    if (VIEWS.includes(view)) showView(view);
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
const initial = VIEWS.includes(hashView)
  ? hashView
  : VIEWS.includes(savedView)
    ? savedView
    : "home";
showView(initial === "favorites" ? "home" : initial);

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

fetchJson("/emergency.json")
  .then(renderEmergency)
  .catch(() => {
    if (els.emergencyLead) els.emergencyLead.textContent = "Emergency contacts failed to load.";
  });

fetchJson("/hazards.json")
  .then(renderHazards)
  .catch(() => {
    if (els.weatherLead) els.weatherLead.textContent = "Weather guidance failed to load.";
  });

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (els.installApp) els.installApp.hidden = false;
});

els.installApp?.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try {
    await deferredInstall.userChoice;
  } catch (_) {
    /* ignore */
  }
  deferredInstall = null;
  if (els.installApp) els.installApp.hidden = true;
});

window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  if (els.installApp) els.installApp.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((err) => {
    console.warn("service worker registration failed", err);
  });
}

refresh();
setInterval(refresh, 60_000);
