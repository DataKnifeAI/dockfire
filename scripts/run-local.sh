#!/usr/bin/env bash
# Run DockFire on this machine without Rancher/Kubernetes.
# Requires Docker. Opens on http://127.0.0.1:8080/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p deploy/private
if [[ ! -f deploy/private/services.local.json ]]; then
  cp deploy/private/services.local.example.json deploy/private/services.local.json
  echo "Created deploy/private/services.local.json from example — edit hosts for your LAN."
fi

echo "Building and starting DockFire locally…"
docker compose up --build -d
echo
echo "DockFire local: http://127.0.0.1:8080/"
echo "Install on phone/desktop via the browser (Install / Add to Home Screen)."
echo "Stop with: docker compose down"
