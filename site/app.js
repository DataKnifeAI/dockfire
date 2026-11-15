const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const refreshBtn = document.getElementById("refresh");
const template = document.getElementById("tile-template");

async function fetchStatus() {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/status ${res.status}`);
  return res.json();
}

function renderTile(service) {
  const node = template.content.firstElementChild.cloneNode(true);
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = service.status || "unknown";
  node.querySelector(".tile-name").textContent = service.name;
  node.querySelector(".tile-kind").textContent = service.kind || "service";
  node.querySelector(".tile-desc").textContent = service.description || "";

  const bits = [service.detail || ""];
  if (service.resolved?.length) bits.push(service.resolved.join(", "));
  node.querySelector(".tile-probe").textContent = bits.filter(Boolean).join(" · ");

  const link = node.querySelector(".tile-link");
  link.href = service.admin;
  link.textContent = service.linkLabel || "Open admin";
  return node;
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
    grid.replaceChildren();
    for (const service of data.services || []) {
      grid.appendChild(renderTile(service));
    }
    summary.textContent = summarize(data.counts);
  } catch (err) {
    summary.textContent = `failed: ${err.message}`;
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", refresh);
refresh();
setInterval(refresh, 60_000);
