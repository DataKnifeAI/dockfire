#!/usr/bin/env python3
"""Dockfire reachability API: DNS resolve + TCP connect + home domain stats."""

from __future__ import annotations

import json
import os
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SERVICES_PATH = Path(os.environ.get("DOCKFIRE_SERVICES", "/usr/share/nginx/html/services.json"))
SERVICES_LOCAL_PATH = Path(
    os.environ.get("DOCKFIRE_SERVICES_LOCAL", "/usr/share/nginx/html/services.local.json")
)
HOME_PATH = Path(os.environ.get("DOCKFIRE_HOME", "/usr/share/nginx/html/home.json"))
LISTEN = ("0.0.0.0", int(os.environ.get("DOCKFIRE_CHECK_PORT", "8081")))
TIMEOUT = float(os.environ.get("DOCKFIRE_CHECK_TIMEOUT", "2.0"))
HTTP_TIMEOUT = float(os.environ.get("DOCKFIRE_HTTP_TIMEOUT", "2.5"))
HISTORY_MAX = int(os.environ.get("DOCKFIRE_HISTORY_MAX", "48"))
SSL_CTX = ssl._create_unverified_context()  # noqa: S323 — LAN gear uses private certs

# In-process ring buffer for family mode timeline (power + ISP).
_MODE_HISTORY: list[dict] = []


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text())


def _read_services(path: Path) -> list[dict]:
    return _read_json(path).get("services", [])


def load_services() -> list[dict]:
    """Public catalog plus optional LAN-only overlay (not in git)."""
    base = _read_services(SERVICES_PATH)
    local = _read_services(SERVICES_LOCAL_PATH)
    by_name = {s.get("name"): s for s in base if s.get("name")}
    for svc in local:
        name = svc.get("name")
        if not name:
            continue
        by_name[name] = svc
    ordered = []
    seen = set()
    for svc in base:
        name = svc.get("name")
        if name in by_name:
            ordered.append(by_name[name])
            seen.add(name)
    for svc in local:
        name = svc.get("name")
        if name and name not in seen:
            ordered.append(svc)
            seen.add(name)
    return ordered


def load_home_domains() -> list[dict]:
    return _read_json(HOME_PATH).get("domains", [])


def resolve_host(host: str) -> tuple[list[str], str | None]:
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        addrs = sorted({info[4][0] for info in infos})
        return addrs, None
    except socket.gaierror as err:
        return [], f"dns: {err.strerror or err}"
    except OSError as err:
        return [], f"dns: {err}"


def tcp_check(host: str, port: int, timeout: float) -> tuple[bool, str | None, float]:
    start = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            ms = (time.perf_counter() - start) * 1000
            return True, None, ms
    except OSError as err:
        ms = (time.perf_counter() - start) * 1000
        return False, str(err.strerror or err), ms


def http_get(
    url: str,
    timeout: float = HTTP_TIMEOUT,
    headers: dict | None = None,
) -> tuple[int | None, bytes, float]:
    start = time.perf_counter()
    hdrs = {"User-Agent": "dockfire-checker/1"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
            return resp.status, resp.read(65536), (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as err:
        body = b""
        try:
            body = err.read(4096)
        except Exception:  # noqa: BLE001
            pass
        return err.code, body, (time.perf_counter() - start) * 1000
    except Exception:  # noqa: BLE001
        return None, b"", (time.perf_counter() - start) * 1000


def check_one(service: dict) -> dict:
    name = service.get("name", "?")
    check = service.get("check") or {}
    host = check.get("host")
    port = int(check.get("port") or 443)
    mode = (check.get("mode") or "tcp").lower()
    admin = service.get("admin")

    if not host and admin:
        parsed = urlparse(admin)
        host = parsed.hostname
        if parsed.port:
            port = parsed.port
        elif parsed.scheme == "http":
            port = 80

    base = {
        "name": name,
        "admin": admin,
        "kind": service.get("kind"),
        "description": service.get("description"),
        "linkLabel": service.get("linkLabel") or "Open admin",
        "favicon": service.get("favicon"),
        "vendor": service.get("vendor"),
    }

    if not host:
        return {
            **base,
            "status": "unknown",
            "detail": "no check target",
            "resolved": [],
            "latency_ms": None,
        }

    resolved, dns_err = resolve_host(host)
    if dns_err:
        return {
            **base,
            "status": "bad",
            "detail": dns_err,
            "resolved": [],
            "latency_ms": None,
            "host": host,
            "port": port,
        }

    if mode == "dns":
        return {
            **base,
            "status": "ok",
            "detail": f"dns ok · {host}",
            "resolved": resolved[:6],
            "latency_ms": None,
            "host": host,
            "port": port,
        }

    ok, err, ms = tcp_check(host, port, TIMEOUT)
    if ok:
        status, detail = "ok", f"resolve+tcp :{port} {ms:.0f}ms"
    else:
        status, detail = "bad", f"tcp :{port} {err}"

    return {
        **base,
        "status": status,
        "detail": detail,
        "resolved": resolved[:6],
        "latency_ms": round(ms, 1),
        "host": host,
        "port": port,
    }


def check_all() -> dict:
    services = load_services()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(32, max(4, len(services) or 4))) as pool:
        futs = [pool.submit(check_one, svc) for svc in services]
        for fut in as_completed(futs):
            results.append(fut.result())
    order = {s.get("name"): i for i, s in enumerate(services)}
    results.sort(key=lambda r: order.get(r["name"], 999))
    counts = {"ok": 0, "warn": 0, "bad": 0, "unknown": 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {"as_of": time.time(), "counts": counts, "services": results}


def _rank(status: str) -> int:
    return {"ok": 0, "unknown": 1, "warn": 2, "bad": 3}.get(status, 1)


def _worst(statuses: list[str]) -> str:
    if not statuses:
        return "unknown"
    return max(statuses, key=_rank)


def enrich_solar(svc_map: dict[str, dict]) -> dict:
    """Two arrays: Enphase (LAN) + SolarEdge (not currently seen on LAN)."""
    envoy = svc_map.get("Enphase Envoy") or {}
    se = svc_map.get("SolarEdge") or {}
    code, _body, ms = http_get("https://envoy.dataknife.net/info")
    # production.json needs token — do not pretend we have watts.
    stats = []
    if code == 200 or envoy.get("status") == "ok":
        stats.append({"label": "Enphase", "value": "online"})
    elif envoy.get("status") == "bad" or (code and code >= 400):
        stats.append({"label": "Enphase", "value": "down"})
    else:
        stats.append({"label": "Enphase", "value": "—"})

    if se.get("status") == "ok":
        stats.append({"label": "SolarEdge", "value": "online"})
    elif se.get("status") == "bad":
        stats.append({"label": "SolarEdge", "value": "down"})
    else:
        stats.append({"label": "SolarEdge", "value": "not on LAN"})

    note = "Live kW / battery % need Enphase, SolarEdge, and Tesla login"
    return {"stats": stats, "note": note, "latency_ms": round(ms, 1) if ms else envoy.get("latency_ms")}


def fetch_weather_bundle() -> dict:
    """NWS forecast + nearby USGS quakes (public APIs, best-effort)."""
    out: dict = {
        "weather": None,
        "quakes": [],
        "note": "",
    }
    # Sacramento-ish point
    lat, lon = 38.5816, -121.4944
    try:
        code, body, _ = http_get(
            f"https://api.weather.gov/points/{lat},{lon}",
            headers={"User-Agent": "DockFire/1.0 (dataknife.ai; home hub)", "Accept": "application/geo+json"},
        )
        if code == 200 and body:
            points = json.loads(body.decode())
            forecast_url = (points.get("properties") or {}).get("forecast")
            if forecast_url:
                fcode, fbody, _ = http_get(
                    forecast_url,
                    headers={
                        "User-Agent": "DockFire/1.0 (dataknife.ai; home hub)",
                        "Accept": "application/geo+json",
                    },
                )
                if fcode == 200 and fbody:
                    periods = (json.loads(fbody.decode()).get("properties") or {}).get("periods") or []
                    if periods:
                        p0 = periods[0]
                        out["weather"] = {
                            "name": p0.get("name"),
                            "temp": p0.get("temperature"),
                            "unit": p0.get("temperatureUnit") or "F",
                            "wind": p0.get("windSpeed"),
                            "forecast": p0.get("shortForecast"),
                            "detail": (p0.get("detailedForecast") or "")[:220],
                        }
    except Exception as err:  # noqa: BLE001
        out["note"] = f"Weather unavailable: {err}"

    try:
        # Mag 2.5+ last day, then filter ~150 mi of Sacramento
        qcode, qbody, _ = http_get(
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"
        )
        if qcode == 200 and qbody:
            feats = json.loads(qbody.decode()).get("features") or []
            nearby = []
            for feat in feats:
                props = feat.get("properties") or {}
                coords = (feat.get("geometry") or {}).get("coordinates") or [None, None]
                lon_e, lat_e = coords[0], coords[1]
                if lat_e is None or lon_e is None:
                    continue
                # rough degrees box ~2.5° ≈ 150 mi
                if abs(lat_e - lat) > 2.5 or abs(lon_e - lon) > 2.5:
                    continue
                nearby.append(
                    {
                        "mag": props.get("mag"),
                        "place": props.get("place"),
                        "time": props.get("time"),
                        "url": props.get("url"),
                    }
                )
            nearby.sort(key=lambda q: q.get("mag") or 0, reverse=True)
            out["quakes"] = nearby[:5]
    except Exception as err:  # noqa: BLE001
        if out["note"]:
            out["note"] += f" · Quakes unavailable: {err}"
        else:
            out["note"] = f"Quakes unavailable: {err}"

    return out


def enrich_tesla() -> dict:
    code, body, ms = http_get("https://tesla.dataknife.net/api/status")
    if code != 200 or not body:
        return {"stats": [], "note": "Powerwall not answering", "latency_ms": round(ms, 1)}
    try:
        data = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"stats": [], "note": "Powerwall status unreadable", "latency_ms": round(ms, 1)}
    uptime = str(data.get("up_time_seconds") or "")
    # "420h3m58.682..." → "420h"
    m = re.match(r"(\d+h(?:\d+m)?)", uptime)
    up_short = m.group(1) if m else (uptime.split(".")[0] if uptime else "—")
    return {
        "stats": [
            {"label": "Battery", "value": "online"},
            {"label": "Up", "value": up_short},
        ],
        "note": "Grid vs battery detail needs Tesla login",
        "latency_ms": round(ms, 1),
        "din": data.get("din"),
    }


def enrich_internet(svc_map: dict[str, dict]) -> dict:
    isp = svc_map.get("Internet (ISP)") or {}
    ms = isp.get("latency_ms")
    if isp.get("status") == "ok":
        stats = [{"label": "Using", "value": "Fiber"}]
        if ms is not None:
            stats.append({"label": "Speed-check", "value": f"{ms:.0f}ms"})
        note = "Primary fiber · Starlink on standby"
    elif isp.get("status") == "bad":
        stats = [{"label": "Using", "value": "Backup?"}]
        note = "Fiber path down — Starlink may be active"
    else:
        stats = [{"label": "Using", "value": "—"}]
        note = "Internet path unknown"
    return {"stats": stats, "note": note, "latency_ms": ms}


def derive_modes(svc_map: dict[str, dict]) -> dict:
    """Family-facing power + ISP mode (not full telemetry)."""
    tesla = svc_map.get("Tesla Energy") or {}
    isp = svc_map.get("Internet (ISP)") or {}

    # Powerwall local API cannot report islanding without login.
    # Heuristic: fiber up + PW up → grid; fiber down + PW up → battery; else unknown.
    if tesla.get("status") == "ok" and isp.get("status") == "bad":
        power = {
            "value": "battery",
            "label": "Battery",
            "detail": "Fiber looks down — house may be on Powerwall",
            "status": "warn",
        }
    elif tesla.get("status") == "ok":
        power = {
            "value": "grid",
            "label": "Grid",
            "detail": "Powerwall online · likely on grid power",
            "status": "ok",
        }
    elif tesla.get("status") == "bad":
        power = {
            "value": "unknown",
            "label": "Unknown",
            "detail": "Powerwall not answering",
            "status": "bad",
        }
    else:
        power = {
            "value": "unknown",
            "label": "Unknown",
            "detail": "Power status not available",
            "status": "unknown",
        }

    if isp.get("status") == "ok":
        internet = {
            "value": "primary",
            "label": "Fiber",
            "detail": "Primary ISP (Fidium)",
            "status": "ok",
        }
    elif isp.get("status") == "bad":
        internet = {
            "value": "backup",
            "label": "Backup",
            "detail": "Fiber check failed — Starlink standby/failover",
            "status": "warn",
        }
    else:
        internet = {
            "value": "unknown",
            "label": "Unknown",
            "detail": "Internet status not available",
            "status": "unknown",
        }

    return {"power": power, "isp": internet}


def push_mode_history(modes: dict) -> list[dict]:
    sample = {
        "t": int(time.time()),
        "power": (modes.get("power") or {}).get("value") or "unknown",
        "isp": (modes.get("isp") or {}).get("value") or "unknown",
    }
    if _MODE_HISTORY and _MODE_HISTORY[-1].get("power") == sample["power"] and _MODE_HISTORY[-1].get(
        "isp"
    ) == sample["isp"]:
        # Refresh timestamp on unchanged state so the chart advances.
        _MODE_HISTORY[-1] = sample
    else:
        _MODE_HISTORY.append(sample)
    del _MODE_HISTORY[:-HISTORY_MAX]
    return list(_MODE_HISTORY)


def enrich_ranch(svc_map: dict[str, dict]) -> dict:
    gw = svc_map.get("Ranch Gateway") or {}
    ms = gw.get("latency_ms")
    stats = []
    if gw.get("status") == "ok":
        stats.append({"label": "Gateway", "value": "online"})
        note = "Ranch gateway answers · no other ranch devices seen from here"
    elif gw.get("status") == "bad":
        stats.append({"label": "Gateway", "value": "offline"})
        note = "Cannot reach the ranch gateway — VPN may be down"
    else:
        stats.append({"label": "Gateway", "value": "—"})
        note = "Ranch probe not configured"
    return {"stats": stats, "note": note, "latency_ms": ms}


def enrich_ranch_link(svc_map: dict[str, dict]) -> dict:
    gw = svc_map.get("Ranch Gateway") or {}
    unifi = svc_map.get("UniFi (LAN)") or {}
    stats = [
        {
            "label": "Link",
            "value": "up" if gw.get("status") == "ok" else (gw.get("status") or "—"),
        },
        {
            "label": "Home",
            "value": "up" if unifi.get("status") == "ok" else (unifi.get("status") or "—"),
        },
    ]
    note = "Private link from home to ranch"
    if gw.get("status") == "bad":
        note = "Link to ranch looks down"
    return {"stats": stats, "note": note, "latency_ms": gw.get("latency_ms")}


def enrich_pool(svc_map: dict[str, dict]) -> dict:
    omni = svc_map.get("OmniLogic") or {}
    if omni.get("status") == "ok":
        return {
            "stats": [{"label": "Controller", "value": "on LAN"}],
            "note": "Chemistry / pumps via HA · WaterGuru cloud",
        }
    if omni.get("status") == "bad":
        return {"stats": [], "note": omni.get("detail") or "OmniLogic unreachable"}
    return {"stats": [], "note": "OmniLogic not configured"}


def enrich_lab(svc_map: dict[str, dict], names: list[str]) -> dict:
    rows = [svc_map[n] for n in names if n in svc_map]
    ok = sum(1 for r in rows if r.get("status") == "ok")
    bad = sum(1 for r in rows if r.get("status") == "bad")
    latencies = [r["latency_ms"] for r in rows if isinstance(r.get("latency_ms"), (int, float))]
    avg = round(sum(latencies) / len(latencies), 1) if latencies else None
    stats = [{"label": "Online", "value": f"{ok}/{len(rows)}"}]
    if avg is not None:
        stats.append({"label": "Avg", "value": f"{avg:.0f}ms"})
    if bad:
        stats.append({"label": "Down", "value": str(bad)})
    note = "Rack + cluster surfaces"
    if bad:
        down = [r["name"] for r in rows if r.get("status") == "bad"]
        note = "Needs attention: " + ", ".join(down[:4])
    return {"stats": stats, "note": note, "latency_ms": avg}


def enrich_automation(svc_map: dict[str, dict]) -> dict:
    lutron = svc_map.get("Lutron") or {}
    st = svc_map.get("SmartThings Hub") or {}
    stats = []
    if lutron:
        stats.append({"label": "Lutron", "value": lutron.get("status", "?")})
    if st:
        stats.append({"label": "ST Hub", "value": st.get("status", "?")})
    bad = [n for n, s in (("Lutron", lutron), ("SmartThings", st)) if s.get("status") == "bad"]
    note = "Smart Bridge + SmartThings"
    if bad:
        note = "Down: " + ", ".join(bad)
    return {"stats": stats, "note": note}


ENRICHERS = {
    "envoy": lambda m, _d: enrich_solar(m),
    "solar": lambda m, _d: enrich_solar(m),
    "tesla": lambda _m, _d: enrich_tesla(),
    "internet": lambda m, _d: enrich_internet(m),
    "pool": lambda m, _d: enrich_pool(m),
    "lab": lambda m, d: enrich_lab(m, d.get("services") or []),
    "automation": lambda m, _d: enrich_automation(m),
    "ranch": lambda m, _d: enrich_ranch(m),
    "ranch_link": lambda m, _d: enrich_ranch_link(m),
}


def _summarize_domains(domains: list[dict]) -> dict:
    return {
        "ok": sum(1 for d in domains if d["status"] == "ok"),
        "warn": sum(1 for d in domains if d["status"] == "warn"),
        "bad": sum(1 for d in domains if d["status"] == "bad"),
        "unknown": sum(1 for d in domains if d["status"] == "unknown"),
    }


def build_home(status_payload: dict | None = None) -> dict:
    payload = status_payload or check_all()
    svc_map = {s["name"]: s for s in payload.get("services", [])}
    home_cfg = _read_json(HOME_PATH)
    sites_cfg = home_cfg.get("sites") or [
        {"id": "home", "label": "Home", "blurb": "Primary residence"},
    ]
    domains_out = []
    issues = []

    for domain in load_home_domains():
        names = domain.get("services") or []
        site_id = domain.get("site") or "home"
        members = []
        for name in names:
            svc = svc_map.get(name)
            if not svc:
                members.append({"name": name, "status": "unknown", "detail": "not in catalog"})
                continue
            members.append(
                {
                    "name": name,
                    "status": svc.get("status", "unknown"),
                    "detail": svc.get("detail"),
                    "latency_ms": svc.get("latency_ms"),
                    "admin": svc.get("admin"),
                }
            )
            if svc.get("status") == "bad":
                issues.append(
                    {
                        "domain": domain.get("id"),
                        "site": site_id,
                        "label": domain.get("label"),
                        "service": name,
                        "detail": svc.get("detail") or "unreachable",
                        "href": domain.get("href") or "#view-infra",
                    }
                )

        status = _worst([m["status"] for m in members]) if members else "unknown"
        enrich_key = domain.get("enrich")
        extra: dict = {"stats": [], "note": ""}
        if enrich_key in ENRICHERS:
            try:
                extra = ENRICHERS[enrich_key](svc_map, domain) or extra
            except Exception as err:  # noqa: BLE001
                extra = {"stats": [], "note": f"enrich failed: {err}"}

        domains_out.append(
            {
                "id": domain.get("id"),
                "site": site_id,
                "label": domain.get("label"),
                "href": domain.get("href"),
                "status": status,
                "members": members,
                "stats": extra.get("stats") or [],
                "note": extra.get("note") or "",
                "latency_ms": extra.get("latency_ms"),
            }
        )

    modes = derive_modes(svc_map)
    history = push_mode_history(modes)

    # Plain-language overlays for home power/internet cards.
    for domain in domains_out:
        if domain.get("id") == "power" and modes.get("power"):
            domain["stats"] = [
                {"label": "Source", "value": modes["power"]["label"]},
                *list(domain.get("stats") or [])[:1],
            ]
            domain["note"] = modes["power"].get("detail") or domain.get("note")
            domain["mode"] = modes["power"]["value"]
        if domain.get("id") == "internet" and modes.get("isp"):
            domain["stats"] = [
                {"label": "Using", "value": modes["isp"]["label"]},
            ]
            domain["note"] = modes["isp"].get("detail") or domain.get("note")
            domain["mode"] = modes["isp"]["value"]

    by_site: dict[str, dict] = {}
    for site in sites_cfg:
        sid = site.get("id") or "home"
        site_domains = [d for d in domains_out if d.get("site") == sid]
        site_issues = [i for i in issues if i.get("site") == sid]
        by_site[sid] = {
            "id": sid,
            "label": site.get("label") or sid,
            "blurb": site.get("blurb") or "",
            "summary": _summarize_domains(site_domains),
            "domains": site_domains,
            "issues": site_issues,
        }

    weather_bundle = fetch_weather_bundle()

    return {
        "as_of": payload.get("as_of", time.time()),
        "sites": list(by_site.values()),
        "summary": _summarize_domains(domains_out),
        "domains": domains_out,
        "issues": issues,
        "by_site": by_site,
        "modes": modes,
        "history": history,
        "weather": weather_bundle.get("weather"),
        "quakes": weather_bundle.get("quakes") or [],
        "weather_note": weather_bundle.get("note") or "",
        "energy_note": "Battery % and solar kW need Tesla / Enphase / SolarEdge login. SolarEdge is not visible on the home LAN right now.",
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        return

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ("/healthz", "/api/healthz"):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return

        if parsed.path == "/api/status":
            try:
                self._json(200, check_all())
            except Exception as err:  # noqa: BLE001
                self._json(500, {"error": str(err)})
            return

        if parsed.path == "/api/home":
            try:
                self._json(200, build_home())
            except Exception as err:  # noqa: BLE001
                self._json(500, {"error": str(err)})
            return

        if parsed.path == "/api/check":
            qs = parse_qs(parsed.query)
            host = (qs.get("host") or [None])[0]
            port = int((qs.get("port") or ["443"])[0])
            if not host:
                self._json(400, {"error": "host required"})
                return
            self._json(200, check_one({"name": host, "check": {"host": host, "port": port}}))
            return

        self.send_response(404)
        self.end_headers()


def main() -> None:
    server = ThreadingHTTPServer(LISTEN, Handler)
    print(f"dockfire checker on {LISTEN[0]}:{LISTEN[1]} services={SERVICES_PATH}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
