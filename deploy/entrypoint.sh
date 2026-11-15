#!/bin/sh
set -eu
export DOCKFIRE_SERVICES="${DOCKFIRE_SERVICES:-/usr/share/nginx/html/services.json}"
export DOCKFIRE_CHECK_PORT="${DOCKFIRE_CHECK_PORT:-8081}"
python3 /opt/dockfire/checker.py &
exec nginx -g 'daemon off;'
