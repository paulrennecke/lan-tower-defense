#!/usr/bin/env bash
# Rolling (blue/green) deployment on Uberspace – runs on the server, called by .github/workflows/deploy.yml.
#
# Layout (per environment):
#   ~/$REMOTE_ROOT/releases/$RELEASE/   code of each release (uploaded by the workflow, incl. node_modules)
#   ~/$DATA_DIR/router.json             {"current": <port>, "ports": [...]} read by the router
#   supervisord: $SERVICE-router        public port $PORT, forwards to the instances (server/router.ts)
#                $SERVICE-s0..s3        game server instances on ports $PORT+1..$PORT+4, one release each
#
# The new release starts on a free slot and becomes "current" for new visitors and new rooms. Instances that still
# host rooms keep running (and keep serving exactly those rooms) until they are empty; the next deploy stops them.
#
# Required env: REMOTE_ROOT SERVICE PORT DOMAIN DATA_DIR RELEASE VERSION
set -euo pipefail

SLOTS=4
ROOT="$HOME/$REMOTE_ROOT"
DATA="$HOME/$DATA_DIR"
REL="$ROOT/releases/$RELEASE"
SVC_DIR="$HOME/etc/services.d"
mkdir -p "$SVC_DIR" "$DATA" "$ROOT/releases"
[ -d "$REL" ] || { echo "Release $REL fehlt"; exit 1; }

slot_port() { echo $((PORT + 1 + $1)); }
slot_ini() { echo "$SVC_DIR/$SERVICE-s$1.ini"; }
# Number of rooms on a port, "-" if nothing answers.
rooms_on() { curl -fsS --max-time 3 "http://127.0.0.1:$1/api/status" 2>/dev/null | sed -n 's/.*"rooms":\([0-9]*\).*/\1/p' | grep . || echo "-"; }

# --- one-time migration from the single-process setup (service "$SERVICE" listening on $PORT) -------------------
if [ -f "$SVC_DIR/$SERVICE.ini" ]; then
  echo "Migration: entferne alten Einzel-Dienst (einmalige Unterbrechung)"
  rm -f "$SVC_DIR/$SERVICE.ini"
  supervisorctl reread >/dev/null; supervisorctl update >/dev/null
  rm -rf "$ROOT/dist" "$ROOT/server" "$ROOT/shared" "$ROOT/node_modules"
fi

# --- pick a slot: not current, and without rooms ---------------------------------------------------------------
CURRENT=""
[ -f "$DATA/router.json" ] && CURRENT=$(sed -n 's/.*"current": *\([0-9]*\).*/\1/p' "$DATA/router.json")
NEW=""
for i in $(seq 0 $((SLOTS - 1))); do
  p=$(slot_port $i)
  [ "$p" = "$CURRENT" ] && continue
  r=$(rooms_on "$p")
  if [ "$r" = "-" ] || [ "$r" = "0" ]; then NEW=$i; break; fi
done
[ -n "$NEW" ] || { echo "Alle freien Slots hosten noch laufende Räume – später erneut deployen."; exit 1; }
NEW_PORT=$(slot_port "$NEW")
echo "Release $RELEASE ($VERSION) -> Slot $NEW (Port $NEW_PORT), aktuell: ${CURRENT:-keiner}"

# --- start the new instance ------------------------------------------------------------------------------------
cat > "$(slot_ini "$NEW")" <<EOF
[program:$SERVICE-s$NEW]
directory=$REL
command=node --import tsx server/index.ts
environment=NODE_ENV="production",TD_MODE="online",PORT="$NEW_PORT",DATA_DIR="$DATA",TD_ORIGIN="https://$DOMAIN"
autostart=yes
autorestart=yes
startsecs=10
EOF
supervisorctl reread >/dev/null
supervisorctl update >/dev/null
supervisorctl restart "$SERVICE-s$NEW" >/dev/null 2>&1 || supervisorctl start "$SERVICE-s$NEW" >/dev/null 2>&1 || true

ok=""
for _ in $(seq 1 40); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$NEW_PORT/api/config" 2>/dev/null | grep -q "\"version\":\"$VERSION\""; then ok=1; break; fi
  sleep 1.5
done
[ -n "$ok" ] || { echo "Neue Instanz wurde nicht gesund:"; supervisorctl status "$SERVICE-s$NEW" || true; exit 1; }

# --- switch: router state (atomic) + router service ------------------------------------------------------------
PORTS=$(for i in $(seq 0 $((SLOTS - 1))); do slot_port "$i"; done | paste -sd, -)
echo "{\"current\": $NEW_PORT, \"ports\": [$PORTS]}" > "$DATA/router.json.tmp"
mv "$DATA/router.json.tmp" "$DATA/router.json"

ROUTER_INI="$SVC_DIR/$SERVICE-router.ini"
ROUTER_DIR=$([ -f "$ROUTER_INI" ] && sed -n 's/^directory=//p' "$ROUTER_INI" || true)
# Restarting the router would drop all open connections, so it stays on its release unless router.ts itself changed.
if [ -z "$ROUTER_DIR" ] || ! cmp -s "$ROUTER_DIR/server/router.ts" "$REL/server/router.ts"; then
  cat > "$ROUTER_INI" <<EOF
[program:$SERVICE-router]
directory=$REL
command=node --import tsx server/router.ts
environment=NODE_ENV="production",PORT="$PORT",ROUTER_STATE="$DATA/router.json"
autostart=yes
autorestart=yes
startsecs=5
EOF
fi
supervisorctl reread >/dev/null
supervisorctl update >/dev/null

# --- clean up: stop empty old instances, keep those that still host rooms --------------------------------------
KEEP="$REL"
for i in $(seq 0 $((SLOTS - 1))); do
  [ "$i" = "$NEW" ] && continue
  ini=$(slot_ini "$i")
  [ -f "$ini" ] || continue
  r=$(rooms_on "$(slot_port "$i")")
  if [ "$r" = "-" ] || [ "$r" = "0" ]; then
    rm -f "$ini"
  else
    echo "Slot $i hostet noch $r Raum/Räume – läuft weiter, bis er leer ist."
    KEEP="$KEEP $(sed -n 's/^directory=//p' "$ini")"
  fi
done
KEEP="$KEEP $(sed -n 's/^directory=//p' "$ROUTER_INI")"
supervisorctl reread >/dev/null
supervisorctl update >/dev/null

for d in "$ROOT"/releases/*/; do
  d=${d%/}
  case " $KEEP " in *" $d "*) ;; *) rm -rf "$d" ;; esac
done

sleep 2
supervisorctl status | grep "$SERVICE" || true
echo "Fertig: $VERSION läuft auf Port $NEW_PORT, Router auf $PORT"
