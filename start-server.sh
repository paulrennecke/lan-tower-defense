#!/bin/sh
# Startet den LAN-TD-Server (Linux/macOS).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren."
  exit 1
fi
if [ -f PREBUILT ]; then
  [ -d node_modules ] || npm install --omit=dev || exit 1
  exec npm run server
fi
[ -d node_modules ] || npm install || exit 1
exec npm start
