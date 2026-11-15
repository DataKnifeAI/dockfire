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
SSL_CTX = ssl._create_unverified_context()  # noqa: S323 — LAN gear uses private certs


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


def http_get(url: str, timeout: float = HTTP_TIMEOUT) -> tuple[int | None, bytes, float]:
    start = time.perf_counter()
    req = urllib.request.Request(url, headers={"User-Agent": "dockfire-checker/1"})
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


def enrich_envoy() -> dict:
    code, body, ms = http_get("https://envoy.dataknife.net/info")
    if code != 200 or not body:
        return {"stats": [], "note": "Envoy /info unavailable", "latency_ms": round(ms, 1)}
    stats = []
    try:
        root = ET.fromstring(body)
        device = root.find("device")
        if device is not None:
            sn = (device.findtext("sn") or "").strip()
            sw = (device.findtext("software") or "").strip()
            if sn:
                stats.append({"label": "Serial", "value": sn[-6:]})
            if sw:
                stats.append({"label": "FW", "value": sw})
        stats.append({"label": "Info", "value": f"{ms:.0f}ms"})
    except ET.ParseError:
        stats.append({"label": "Info", "value": "up"})
    return {
        "stats": stats,
        "note": "Live production needs Enphase token",
        "latency_ms": round(ms, 1),
    }


def enrich_tesla() -> dict:
    code, body, ms = http_get("https://tesla.dataknife.net/api/status")
    if code != 200 or not body:
        return {"stats": [], "note": "Powerwall status API unavailable", "latency_ms": round(ms, 1)}
    try:
        data = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"stats": [], "note": "Powerwall status unreadable", "latency_ms": round(ms, 1)}
    uptime = str(data.get("up_time_seconds") or "")
    # "420h3m58.682..." → "420h"
    m = re.match(r"(\d+h(?:\d+m)?)", uptime)
    up_short = m.group(1) if m else (uptime.split(".")[0] if uptime else "—")
    version = str(data.get("version") or "").split()[0] or "—"
    return {
        "stats": [
            {"label": "Uptime", "value": up_short},
            {"label": "FW", "value": version},
            {"label": "API", "value": f"{ms:.0f}ms"},
        ],
        "note": "SoC / meters need Tesla login",
        "latency_ms": round(ms, 1),
        "din": data.get("din"),
    }


def enrich_internet(svc_map: dict[str, dict]) -> dict:
    isp = svc_map.get("Internet (ISP)") or {}
    ms = isp.get("latency_ms")
    stats = []
    if ms is not None:
        stats.append({"label": "Latency", "value": f"{ms:.0f}ms"})
    stats.append({"label": "Primary", "value": "Fidium"})
    stats.append({"label": "Backup", "value": "Starlink"})
    note = "Fiber primary · Starlink failover WAN2"
    if isp.get("status") == "bad":
        note = isp.get("detail") or "WAN path down"
    return {"stats": stats, "note": note, "latency_ms": ms}


def enrich_ranch(svc_map: dict[str, dict]) -> dict:
    gw = svc_map.get("Ranch Gateway") or {}
    ms = gw.get("latency_ms")
    stats = []
    if gw.get("status") == "ok":
        stats.append({"label": "UDM", "value": "up"})
        if ms is not None:
            stats.append({"label": "RTT", "value": f"{ms:.0f}ms"})
        note = "Reachable over SD-WAN mesh"
    elif gw.get("status") == "bad":
        stats.append({"label": "UDM", "value": "down"})
        note = gw.get("detail") or "Ranch gateway unreachable — check VPN"
    else:
        stats.append({"label": "UDM", "value": "—"})
        note = "Add Ranch Gateway to LAN overlay to probe"
    return {"stats": stats, "note": note, "latency_ms": ms}


def enrich_ranch_link(svc_map: dict[str, dict]) -> dict:
    gw = svc_map.get("Ranch Gateway") or {}
    unifi = svc_map.get("UniFi (LAN)") or {}
    stats = [
        {"label": "Tunnel", "value": "ok" if gw.get("status") == "ok" else (gw.get("status") or "—")},
        {"label": "Home GW", "value": unifi.get("status") or "—"},
    ]
    note = "UniFi SD-WAN · UDM - Ranch"
    if gw.get("status") == "bad":
        note = "Mesh tunnel path failing"
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
    "envoy": lambda _m, _d: enrich_envoy(),
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

    return {
        "as_of": payload.get("as_of", time.time()),
        "sites": list(by_site.values()),
        "summary": _summarize_domains(domains_out),
        "domains": domains_out,
        "issues": issues,
        "by_site": by_site,
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
