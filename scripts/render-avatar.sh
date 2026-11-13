#!/usr/bin/env bash
# Renders assets/mnemo.svg to assets/mnemo.png (256x256, transparent corners)
# with headless Chrome or Chromium, then rebuilds the manifest.
#   scripts/render-avatar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "Chrome or Chromium not found; set CHROME=/path/to/chrome" >&2; exit 1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf '<!doctype html><html><body style="margin:0;background:transparent">%s</body></html>' "$(cat assets/mnemo.svg)" > "$tmp/avatar.html"
"$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=256,256 --screenshot="$PWD/assets/mnemo.png" "file://$tmp/avatar.html"
npm run --silent manifest
