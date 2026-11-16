#!/usr/bin/env bash
# Create/update Kubernetes secret dockfire-energy from deploy/private/energy.env
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${DOCKFIRE_ENV_FILE:-$ROOT/deploy/private/energy.env}"
NS="${DOCKFIRE_NAMESPACE:-dockfire}"
SECRET_NAME="${DOCKFIRE_ENERGY_SECRET:-dockfire-energy}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  echo "Copy the example and fill in tokens:"
  echo "  cp deploy/private/energy.env.example deploy/private/energy.env"
  exit 1
fi

# Only pass non-empty KEY=value lines (skip comments / blanks)
ARGS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%%#*}"
  line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [[ -z "$line" ]] && continue
  [[ "$line" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  # strip optional surrounding quotes
  val="${val%\"}" ; val="${val#\"}"
  val="${val%\'}" ; val="${val#\'}"
  [[ -z "$val" ]] && continue
  ARGS+=(--from-literal="${key}=${val}")
done < "$ENV_FILE"

if [[ ${#ARGS[@]} -eq 0 ]]; then
  echo "No non-empty secrets in $ENV_FILE — nothing to apply."
  exit 1
fi

export PATH="${PATH:-/usr/bin}:/usr/local/bin:${HOME}/.local/bin"
kubectl -n "$NS" create secret generic "$SECRET_NAME" \
  "${ARGS[@]}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applied secret/$SECRET_NAME in namespace $NS"
echo "Restart DockFire to pick up env:"
echo "  kubectl -n $NS rollout restart deploy/dockfire"
