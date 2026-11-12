#!/usr/bin/env bash
# Prints the port Metro should start on: $METRO_PORT when set, else the first port of
# <base>, <base>+10 … <base>+90 that nothing listens on. Exits 1 when all ten are taken.
# Why a series per app: ~/githubs/_workspace/docs/standard.md, "Dev ports".
set -euo pipefail

base="${1:-}"
if [[ ! "$base" =~ ^[0-9]+$ ]]; then
  echo "usage: metro-port.sh <base port>" >&2
  exit 2
fi

if [[ -n "${METRO_PORT:-}" ]]; then
  echo "$METRO_PORT"
  exit 0
fi

last=$((base + 90))
for ((port = base; port <= last; port += 10)); do
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "$port"
    exit 0
  fi
done

echo "metro-port: every port of $base, $((base + 10)) … $last is in use; stop a dev server or set METRO_PORT" >&2
exit 1
