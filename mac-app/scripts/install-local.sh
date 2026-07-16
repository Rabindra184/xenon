#!/usr/bin/env bash
# Build Xenon Control and install it into /Applications for local use.
#
#   ./scripts/install-local.sh
#
# This is the INTERNAL/local path: the app is not notarized, so macOS quarantines
# it if it ever travels through a browser, AirDrop or a zip. We remove that flag
# on the copy we just built ourselves. See README "Install" for why that is safe
# here and why notarization is the right answer for real distribution.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="Xenon Control.app"
DEST="/Applications/${APP_NAME}"

echo "==> Building"
npx electron-builder --mac --dir

SRC="$(find dist -maxdepth 2 -name "${APP_NAME}" -type d | head -1)"
if [[ -z "${SRC}" ]]; then
  echo "error: build produced no ${APP_NAME}" >&2
  exit 1
fi

if pgrep -f "${APP_NAME}/Contents/MacOS" >/dev/null 2>&1; then
  echo "==> Quitting the running copy"
  pkill -f "${APP_NAME}/Contents/MacOS" || true
  sleep 2
fi

echo "==> Installing to ${DEST}"
rm -rf "${DEST}"
cp -R "${SRC}" "${DEST}"

# Only meaningful if the bundle picked up a quarantine flag; harmless otherwise.
echo "==> Clearing the quarantine flag"
xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true

echo "==> Done. Open it from /Applications or: open -a 'Xenon Control'"
