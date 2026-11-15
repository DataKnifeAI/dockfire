const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const refreshBtn = document.getElementById("refresh");
const template = document.getElementById("tile-template");

async function loadServices() {
  const res = await fetch("services.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`services.json ${res.status}`);
  return res.json();
}

async function probe(url, timeoutMs = 4000) {
  if (!url) return { status: "unknown", detail: "no probe" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.ok) return { status: "ok", detail: `${res.status}` };
    if (res.status >= 500) return { status: "bad", detail: `${res.status}` };
    return { status: "warn", detail: `${res.status}` };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "timeout" : "unreachable / cors";
    return { status: "unknown", detail: msg };
  } finally {
    clearTimeout(timer);
  }
}

function renderTile(service, probeResult) {
  const node = template.content.firstElementChild.cloneNode(true);
  const dot = node.querySelector("[data-status]");
  dot.dataset.status = probeResult.status;
  node.querySelector(".tile-name").textContent = service.name;
  node.querySelector(".tile-kind").textContent = service.kind || "service";
  node.querySelector(".tile-desc").textContent = service.description || "";
  node.querySelector(".tile-probe").textContent = probeResult.detail;
  const link = node.querySelector(".tile-link");
  link.href = service.admin;
  link.textContent = service.linkLabel || "Open admin";
  return node;
}

function summarize(results) {
  const counts = { ok: 0, warn: 0, bad: 0, unknown: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const parts = [];
  if (counts.bad) parts.push(`${counts.bad} bad`);
  if (counts.warn) parts.push(`${counts.warn} warn`);
  if (counts.ok) parts.push(`${counts.ok} ok`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return parts.join(" · ") || "no surfaces";
}

async function refresh() {
  summary.textContent = "probing…";
  refreshBtn.disabled = true;
  try {
    const data = await loadServices();
    const services = data.services || [];
    const probes = await Promise.all(
      services.map((s) => probe(s.health || s.admin))
    );
    grid.replaceChildren();
    services.forEach((service, i) => {
      grid.appendChild(renderTile(service, probes[i]));
    });
    summary.textContent = summarize(probes);
  } catch (err) {
    summary.textContent = `failed: ${err.message}`;
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", refresh);
refresh();
setInterval(refresh, 60_000);
