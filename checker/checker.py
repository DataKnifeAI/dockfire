#!/usr/bin/env python3
"""Dockfire reachability API: DNS resolve + TCP connect."""

from __future__ import annotations

import json
import os
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SERVICES_PATH = Path(os.environ.get("DOCKFIRE_SERVICES", "/usr/share/nginx/html/services.json"))
SERVICES_LOCAL_PATH = Path(
    os.environ.get("DOCKFIRE_SERVICES_LOCAL", "/usr/share/nginx/html/services.local.json")
)
LISTEN = ("0.0.0.0", int(os.environ.get("DOCKFIRE_CHECK_PORT", "8081")))
TIMEOUT = float(os.environ.get("DOCKFIRE_CHECK_TIMEOUT", "2.0"))


def _read_services(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    data = json.loads(path.read_text())
    return data.get("services", [])


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
    # preserve public order, then append new local-only names
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


def check_one(service: dict) -> dict:
    name = service.get("name", "?")
    check = service.get("check") or {}
    host = check.get("host")
    port = int(check.get("port") or 443)
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
