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
from urllib.parse import parse_qs, quote, urlparse

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
_TESLA_COOKIE: str | None = None
_TESLA_COOKIE_AT: float = 0.0


def _load_env_file(path: Path) -> None:
    """Load KEY=VALUE into os.environ if not already set (does not override)."""
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


def load_energy_env() -> None:
    """Pull energy secrets from DOCKFIRE_ENV_FILE, energy.env, or .env."""
    candidates = []
    explicit = os.environ.get("DOCKFIRE_ENV_FILE")
    if explicit:
        candidates.append(Path(explicit))
    # Common local / container mounts
    candidates.extend(
        [
            Path("/run/secrets/dockfire-energy.env"),
            Path("deploy/private/energy.env"),
            Path("/usr/share/nginx/html/energy.env"),
            Path(".env"),
        ]
    )
    for path in candidates:
        try:
            if path.is_file():
                _load_env_file(path)
                break
        except OSError:
            continue


load_energy_env()


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


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


def http_request(
    url: str,
    *,
    method: str = "GET",
    timeout: float = HTTP_TIMEOUT,
    headers: dict | None = None,
    data: bytes | None = None,
) -> tuple[int | None, bytes, float, dict[str, str]]:
    start = time.perf_counter()
    hdrs = {"User-Agent": "dockfire-checker/1"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            return resp.status, resp.read(65536), (time.perf_counter() - start) * 1000, resp_headers
    except urllib.error.HTTPError as err:
        body = b""
        try:
            body = err.read(4096)
        except Exception:  # noqa: BLE001
            pass
        resp_headers = {k.lower(): v for k, v in (err.headers.items() if err.headers else [])}
        return err.code, body, (time.perf_counter() - start) * 1000, resp_headers
    except Exception:  # noqa: BLE001
        return None, b"", (time.perf_counter() - start) * 1000, {}


def http_get(
    url: str,
    timeout: float = HTTP_TIMEOUT,
    headers: dict | None = None,
) -> tuple[int | None, bytes, float]:
    code, body, ms, _ = http_request(url, timeout=timeout, headers=headers)
    return code, body, ms


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


def _fmt_kw(watts: float | int | None) -> str:
    if watts is None:
        return "—"
    return f"{float(watts) / 1000.0:.2f} kW"


def fetch_enphase_production() -> dict:
    host = _env("ENPHASE_HOST", "https://envoy.dataknife.net").rstrip("/")
    token = _env("ENPHASE_TOKEN")
    if not token:
        return {"ok": False, "note": "Set ENPHASE_TOKEN for live Enphase watts"}
    code, body, ms = http_get(
        f"{host}/production.json",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    if code != 200 or not body:
        return {"ok": False, "note": f"Enphase production HTTP {code}", "latency_ms": round(ms, 1)}
    try:
        data = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"ok": False, "note": "Enphase production unreadable", "latency_ms": round(ms, 1)}
    # Prefer production array (inverters / site)
    w_now = None
    for block in data.get("production") or []:
        if isinstance(block, dict) and block.get("type") in ("inverters", "eim", None):
            if "wNow" in block:
                w_now = block.get("wNow")
                if block.get("type") == "inverters":
                    break
    if w_now is None and isinstance(data.get("wattsNow"), (int, float)):
        w_now = data["wattsNow"]
    return {
        "ok": True,
        "w_now": w_now,
        "latency_ms": round(ms, 1),
        "note": "Enphase live",
    }


def fetch_solaredge_overview() -> dict:
    api_key = _env("SOLAREDGE_API_KEY")
    site_id = _env("SOLAREDGE_SITE_ID")
    if not api_key or not site_id:
        return {"ok": False, "note": "Set SOLAREDGE_API_KEY + SOLAREDGE_SITE_ID for SolarEdge watts"}
    url = (
        f"https://monitoringapi.solaredge.com/site/{site_id}/overview"
        f"?api_key={quote(api_key)}"
    )
    code, body, ms = http_get(url, headers={"Accept": "application/json"})
    if code != 200 or not body:
        return {"ok": False, "note": f"SolarEdge HTTP {code}", "latency_ms": round(ms, 1)}
    try:
        data = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"ok": False, "note": "SolarEdge overview unreadable", "latency_ms": round(ms, 1)}
    overview = (data.get("overview") or {})
    current = overview.get("currentPower") or {}
    power_w = current.get("power")
    # SolarEdge reports kW in some payloads — normalize
    if isinstance(power_w, (int, float)) and power_w < 100 and power_w != 0:
        # likely already kW when small; treat as kW → W
        power_w = power_w * 1000.0
    return {
        "ok": True,
        "w_now": power_w,
        "latency_ms": round(ms, 1),
        "note": "SolarEdge live",
    }


def enrich_solar(svc_map: dict[str, dict]) -> dict:
    """Enphase (LAN + token) and SolarEdge (cloud API key)."""
    envoy = svc_map.get("Enphase Envoy") or {}
    host = _env("ENPHASE_HOST", "https://envoy.dataknife.net").rstrip("/")
    code, _body, ms = http_get(f"{host}/info")
    stats: list[dict] = []
    notes: list[str] = []
    total_w = 0.0
    have_watts = False

    enphase = fetch_enphase_production()
    if enphase.get("ok") and enphase.get("w_now") is not None:
        stats.append({"label": "Enphase", "value": _fmt_kw(enphase["w_now"])})
        total_w += float(enphase["w_now"] or 0)
        have_watts = True
    elif code == 200 or envoy.get("status") == "ok":
        stats.append({"label": "Enphase", "value": "online"})
        if enphase.get("note"):
            notes.append(str(enphase["note"]))
    elif envoy.get("status") == "bad":
        stats.append({"label": "Enphase", "value": "down"})
    else:
        stats.append({"label": "Enphase", "value": "—"})

    se = fetch_solaredge_overview()
    if se.get("ok") and se.get("w_now") is not None:
        stats.append({"label": "SolarEdge", "value": _fmt_kw(se["w_now"])})
        total_w += float(se["w_now"] or 0)
        have_watts = True
    else:
        stats.append({"label": "SolarEdge", "value": "cloud?" if not _env("SOLAREDGE_API_KEY") else "err"})
        if se.get("note") and _env("SOLAREDGE_API_KEY"):
            notes.append(str(se["note"]))
        elif not _env("SOLAREDGE_API_KEY"):
            notes.append("SolarEdge needs API key + site id")

    if have_watts:
        stats.insert(0, {"label": "Total", "value": _fmt_kw(total_w)})
        note = "Live production"
    else:
        note = " · ".join(notes) if notes else "Live kW need ENPHASE_TOKEN / SolarEdge API key"

    return {
        "stats": stats,
        "note": note,
        "latency_ms": round(ms, 1) if ms else envoy.get("latency_ms"),
        "w_now": total_w if have_watts else None,
    }


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


def _tesla_base() -> str:
    return _env("TESLA_HOST", "https://tesla.dataknife.net").rstrip("/")


def _parse_auth_cookie(set_cookie: str) -> str | None:
    # AuthCookie=...; Path=/; ...
    for part in set_cookie.split(";"):
        part = part.strip()
        if part.lower().startswith("authcookie="):
            return part.split("=", 1)[1]
    return None


def tesla_auth_cookie() -> str | None:
    """Return Powerwall AuthCookie from env or BasicLogin (cached ~50m)."""
    global _TESLA_COOKIE, _TESLA_COOKIE_AT
    direct = _env("TESLA_AUTH_COOKIE")
    if direct:
        return direct
    if _TESLA_COOKIE and (time.time() - _TESLA_COOKIE_AT) < 3000:
        return _TESLA_COOKIE
    email = _env("TESLA_EMAIL")
    password = _env("TESLA_PASSWORD")
    if not email or not password:
        return None
    payload = json.dumps(
        {
            "username": "customer",
            "email": email,
            "password": password,
            "force_sm_off": False,
        }
    ).encode()
    code, body, _ms, headers = http_request(
        f"{_tesla_base()}/api/login/BasicLogin",
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        data=payload,
    )
    cookie = None
    set_cookie = headers.get("set-cookie") or ""
    if set_cookie:
        cookie = _parse_auth_cookie(set_cookie)
    if not cookie and code == 200 and body:
        try:
            data = json.loads(body.decode())
            cookie = data.get("token") or data.get("AuthCookie")
        except (json.JSONDecodeError, UnicodeDecodeError):
            cookie = None
    if cookie:
        _TESLA_COOKIE = cookie
        _TESLA_COOKIE_AT = time.time()
    return cookie


def enrich_tesla() -> dict:
    base = _tesla_base()
    code, body, ms = http_get(f"{base}/api/status")
    if code != 200 or not body:
        return {"stats": [], "note": "Powerwall not answering", "latency_ms": round(ms, 1)}
    try:
        data = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"stats": [], "note": "Powerwall status unreadable", "latency_ms": round(ms, 1)}
    uptime = str(data.get("up_time_seconds") or "")
    m = re.match(r"(\d+h(?:\d+m)?)", uptime)
    up_short = m.group(1) if m else (uptime.split(".")[0] if uptime else "—")
    stats = [{"label": "Battery", "value": "online"}, {"label": "Up", "value": up_short}]
    note = "Set TESLA_EMAIL/PASSWORD (or TESLA_AUTH_COOKIE) for SoC %"
    soc_pct = None
    grid_status = None

    cookie = tesla_auth_cookie()
    if cookie:
        hdrs = {"Cookie": f"AuthCookie={cookie}", "Accept": "application/json"}
        scode, sbody, sms = http_get(f"{base}/api/system_status/soe", headers=hdrs)
        if scode == 200 and sbody:
            try:
                soe = json.loads(sbody.decode())
                # percentage is 0..1 or 0..100 depending on firmware
                pct = soe.get("percentage")
                if isinstance(pct, (int, float)):
                    soc_pct = pct * 100.0 if pct <= 1.5 else float(pct)
                    stats = [{"label": "Charge", "value": f"{soc_pct:.0f}%"}, {"label": "Up", "value": up_short}]
                    note = "Powerwall live"
                    ms = sms
            except (json.JSONDecodeError, UnicodeDecodeError):
                note = "SoC response unreadable"
        else:
            note = f"SoC HTTP {scode} — check Tesla credentials"

        gcode, gbody, _ = http_get(f"{base}/api/system_status/grid_status", headers=hdrs)
        if gcode == 200 and gbody:
            try:
                grid = json.loads(gbody.decode())
                grid_status = grid.get("grid_status") or grid.get("grid_state")
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass

    return {
        "stats": stats,
        "note": note,
        "latency_ms": round(ms, 1),
        "din": data.get("din"),
        "soc_pct": soc_pct,
        "grid_status": grid_status,
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
    tesla_live = enrich_tesla() if tesla.get("status") == "ok" else {}
    soc = tesla_live.get("soc_pct")
    grid_status = (tesla_live.get("grid_status") or "").lower()

    # Prefer live grid_status when credentials work.
    if "island" in grid_status or grid_status in {"system_island_active", "islanded"}:
        power = {
            "value": "battery",
            "label": "Battery",
            "detail": f"On Powerwall{f' · {soc:.0f}%' if isinstance(soc, (int, float)) else ''}",
            "status": "warn",
            "soc_pct": soc,
        }
    elif grid_status in {"system_grid_connected", "grid_connected", "connected"} or (
        tesla.get("status") == "ok" and isp.get("status") != "bad"
    ):
        detail = "On grid power"
        if isinstance(soc, (int, float)):
            detail = f"Grid · battery {soc:.0f}%"
        power = {
            "value": "grid",
            "label": "Grid",
            "detail": detail,
            "status": "ok",
            "soc_pct": soc,
        }
    elif tesla.get("status") == "ok" and isp.get("status") == "bad":
        power = {
            "value": "battery",
            "label": "Battery",
            "detail": "Fiber looks down — house may be on Powerwall",
            "status": "warn",
            "soc_pct": soc,
        }
    elif tesla.get("status") == "ok":
        power = {
            "value": "grid",
            "label": "Grid",
            "detail": "Powerwall online · likely on grid power",
            "status": "ok",
            "soc_pct": soc,
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
        "energy_note": (
            "Fill deploy/private/energy.env (TESLA_*, ENPHASE_TOKEN, SOLAREDGE_*) "
            "then ./scripts/apply-energy-secret.sh for the cluster."
        ),
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
