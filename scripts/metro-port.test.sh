#!/usr/bin/env bash
# Tests scripts/metro-port.sh against ports this test holds open itself.
set -euo pipefail

script="$(dirname "$0")/metro-port.sh"
failures=0
listeners=()
err="$(mktemp)"

fail() { echo "FAIL: $1" >&2; failures=$((failures + 1)); }
cleanup() { for pid in "${listeners[@]}"; do kill "$pid" 2>/dev/null || true; done; rm -f "$err"; }
trap cleanup EXIT

in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

listen() {
  node -e "require('net').createServer().listen($1, '127.0.0.1')" &
  listeners+=($!)
  for _ in $(seq 50); do in_use "$1" && return; sleep 0.1; done
  echo "could not listen on $1" >&2; exit 1
}

# A base whose whole series is free, so the cases below start from a known state.
base=""
for _ in $(seq 20); do
  candidate=$((30000 + RANDOM % 20000))
  free=1
  for ((p = candidate; p <= candidate + 90; p += 10)); do in_use "$p" && free=0 && break; done
  if ((free)); then base=$candidate; break; fi
done
[[ -n "$base" ]] || { echo "no free series found to test with" >&2; exit 1; }

[[ "$(METRO_PORT=12345 bash "$script" "$base")" == 12345 ]] || fail "METRO_PORT is not honoured"
[[ "$(env -u METRO_PORT bash "$script" "$base")" == "$base" ]] || fail "a free base is not picked"

listen "$base"
[[ "$(env -u METRO_PORT bash "$script" "$base")" == $((base + 10)) ]] || fail "a taken base does not move to base+10"

for ((p = base + 10; p <= base + 90; p += 10)); do listen "$p"; done
if out="$(env -u METRO_PORT bash "$script" "$base" 2>"$err")"; then
  fail "a full series does not exit non-zero (printed '$out')"
else
  [[ -z "$out" ]] || fail "a full series prints a port"
  grep -q "$base" "$err" || fail "the error does not name the range"
fi

bash "$script" 2>/dev/null && fail "a missing base is accepted"

((failures == 0)) && echo "metro-port: all tests pass"
exit "$failures"
