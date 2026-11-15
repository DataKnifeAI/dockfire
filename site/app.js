const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const refreshBtn = document.getElementById("refresh");
const template = document.getElementById("tile-template");
const kindFilters = document.getElementById("kind-filters");

const els = {
  online: document.getElementById("stat-online"),
  down: document.getElementById("stat-down"),
  latency: document.getElementById("stat-latency"),
  kinds: document.getElementById("stat-kinds"),
  checked: document.getElementById("stat-checked"),
};

let activeKind = "all";
let lastPayload = null;

async function fetchStatus() {
  const res = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/status ${res.status}`);
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
  kindFilters.hidden = ordered.length <= 2;
  kindFilters.replaceChildren();
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
    kindFilters.appendChild(btn);
  }
}

function renderTile(service) {
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.kind = service.kind || "";
  node.dataset.status = service.status || "unknown";
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = service.status || "unknown";
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
  const services = (data?.services || []).filter(
    (s) => activeKind === "all" || s.kind === activeKind
  );
  grid.replaceChildren();
  for (const service of services) {
    grid.appendChild(renderTile(service));
  }
}

function summarize(counts = {}) {
  const parts = [];
  if (counts.bad) parts.push(`${counts.bad} bad`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.ok) parts.push(`${counts.ok} ok`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return parts.join(" · ") || "no surfaces";
}

async function refresh() {
  summary.textContent = "resolving + probing…";
  refreshBtn.disabled = true;
  try {
    const data = await fetchStatus();
    lastPayload = data;
    renderStats(data);
    renderGrid(data);
    summary.textContent = summarize(data.counts);
  } catch (err) {
    summary.textContent = `failed: ${err.message}`;
    console.error(err);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", refresh);
refresh();
setInterval(refresh, 60_000);
