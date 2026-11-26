#!/usr/bin/env bash
# End-to-end tests on an Android emulator with Maestro, against the local
# Supabase (pnpm db:start). The pattern is Órdago's (ordago-apps, .maestro/ and
# scripts/mobile-e2e-entrypoint.sh): a release APK with the JS bundle inside,
# one emulator of our own, every Maestro run pinned to it.
#
#   bash scripts/e2e/android.sh avd       create (once) and boot the ghostaff-e2e emulator
#   bash scripts/e2e/android.sh build     build the dev APK pointing at the local Supabase
#   bash scripts/e2e/android.sh test [flows…]   install it, seed a company (seed.sh) and run the
#                                               flows (default .maestro/flows/ci, then seed.sh verify)
#   bash scripts/e2e/android.sh stop      shut the emulator down
#
# The emulator listens on its own port (5560), so it never collides with
# Órdago's (5554/5556) or Cultuvilla's, and the app reaches the host's Supabase
# through `adb reverse`, as http://127.0.0.1:54321.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOBILE="$ROOT/apps/mobile"
AVD=ghostaff-e2e
PORT=5560
# CI boots its own emulator (.github/workflows/ci.yml) and names it here.
SERIAL="${E2E_SERIAL:-emulator-$PORT}"
IMAGE="system-images;android-36;google_apis;x86_64"
APP_ID=ai.ghostaff.app.dev
APK="$MOBILE/android/app/build/outputs/apk/release/app-release.apk"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$SDK/platform-tools:$SDK/emulator:$SDK/cmdline-tools/latest/bin:$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1

supabase_env() {
  (cd "$ROOT" && npx supabase status -o env 2>/dev/null) | grep -E '^(ANON_KEY|MAILPIT_URL|SERVICE_ROLE_KEY)=' | tr -d '"'
}

booted() { adb -s "$SERIAL" get-state 2>/dev/null | grep -q device; }

cmd_avd() {
  if ! emulator -list-avds | grep -qx "$AVD"; then
    # google_apis carries Google Play services, which Google sign-in needs.
    echo "no" | avdmanager create avd -n "$AVD" -k "$IMAGE" -d pixel_6
  fi
  if booted; then echo "$AVD already up as $SERIAL"; return; fi
  # A window by default: the Google account is added by hand, once (see
  # .maestro/README.md). E2E_HEADLESS=1 for runs that need none.
  local opts=(-port "$PORT" -no-boot-anim -noaudio -camera-back none)
  [[ "${E2E_HEADLESS:-}" == 1 ]] && opts+=(-no-window -gpu swiftshader_indirect)
  nohup emulator -avd "$AVD" "${opts[@]}" >/dev/null 2>&1 &
  adb -s "$SERIAL" wait-for-device
  until [[ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; do sleep 2; done
  echo "$AVD up as $SERIAL"
}

cmd_build() {
  eval "$(supabase_env)"
  [[ -n "${ANON_KEY:-}" ]] || { echo "Local Supabase is not running: pnpm db:start" >&2; exit 1; }
  cd "$MOBILE"
  export E2E=1 APP_ENV=dev SUPABASE_URL_DEV=http://127.0.0.1:54321 SUPABASE_ANON_KEY_DEV="$ANON_KEY" NODE_ENV=production
  npx expo prebuild -p android --clean --no-install
  # The emulator is x86_64: building only that ABI takes a fraction of the time.
  (cd android && ./gradlew assembleRelease -q -PreactNativeArchitectures=x86_64)
  ls -la "$APK"
}

cmd_test() {
  booted || { echo "Emulator not up: bash scripts/e2e/android.sh avd" >&2; exit 1; }
  [[ -f "$APK" ]] || { echo "No APK: bash scripts/e2e/android.sh build" >&2; exit 1; }
  eval "$(supabase_env)"
  adb -s "$SERIAL" reverse tcp:54321 tcp:54321 >/dev/null
  adb -s "$SERIAL" install -r "$APK" >/dev/null
  # A company of this run's own, made from the fixture record by the real sync
  # (seed.sh): its decisions for answer-decision.yaml, its chat for team-chat.yaml.
  local seed SEED_SLUG='' SEED_COMPANY='' DECIDER_EMAIL='' CHAT_EMAIL=''
  seed=$(SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}" bash "$ROOT/scripts/e2e/seed.sh" seed)
  while IFS='=' read -r key value; do
    case $key in SEED_SLUG | SEED_COMPANY | DECIDER_EMAIL | CHAT_EMAIL) printf -v "$key" '%s' "$value" ;; esac
  done <<<"$seed"
  local flows=("$@") suite=0
  [[ ${#flows[@]} -gt 0 ]] || { flows=("$ROOT/.maestro/flows/ci"); suite=1; }
  maestro --device "$SERIAL" test -e APP_ID="$APP_ID" -e MAILPIT_URL="${MAILPIT_URL:-http://127.0.0.1:54324}" \
    -e SUPABASE_URL=http://127.0.0.1:54321 -e SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}" \
    -e SEED_COMPANY="$SEED_COMPANY" -e DECIDER_EMAIL="$DECIDER_EMAIL" -e CHAT_EMAIL="$CHAT_EMAIL" \
    ${GOOGLE_ACCOUNT:+-e GOOGLE_ACCOUNT="$GOOGLE_ACCOUNT"} "${flows[@]}"
  # The answers the whole suite gave reach the record (a flow run alone may not have answered them).
  if [[ $suite == 1 ]]; then
    SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}" bash "$ROOT/scripts/e2e/seed.sh" verify "$SEED_SLUG"
  else
    echo "Not the whole suite: the write-back check (seed.sh verify $SEED_SLUG) is skipped" >&2
  fi
}

cmd_stop() { adb -s "$SERIAL" emu kill 2>/dev/null || true; }

case "${1:-}" in
  avd) cmd_avd ;;
  build) cmd_build ;;
  test) shift; cmd_test "$@" ;;
  stop) cmd_stop ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
