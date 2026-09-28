#!/bin/sh
# Ein Playwright-Lauf zur Zeit — auch wenn mehrere Agenten im selben Rechner arbeiten.
#
#   scripts/e2e-lock.sh <befehl …>     z. B. scripts/e2e-lock.sh pnpm verify:modul finance
#
# Wartet, bis die Sperre frei ist (`mkdir` ist atomar), schreibt PID und Befehl
# hinein, führt den Befehl aus und gibt dessen Exit-Code weiter. Aufgeräumt wird
# per `trap` — und nur, wenn die Sperre noch diesem Lauf gehört. Eine fremde
# Sperre wird nie entfernt, auch nicht nach einem gescheiterten `mkdir`
# (so ging am 28.09. die Sperre eines laufenden Agenten verloren).
#
# Einen eigenen Lauf beendet man über seine PID (steht in der Sperre), nie mit
# `pkill -f "playwright test"` — das trifft die Läufe der anderen.
set -u

# Vorgabe wie bisher von Hand genutzt: /tmp/claude-<uid>/kompass-e2e.lock (macOS: /private/tmp/…).
lock="${E2E_LOCK:-/tmp/claude-$(id -u)/kompass-e2e.lock}"
mkdir -p "$(dirname -- "$lock")"
wait_seconds="${E2E_LOCK_WAIT:-15}"
[ "$#" -gt 0 ] || { echo "Aufruf: $0 <befehl …>" >&2; exit 64; }

announced=''
until mkdir "$lock" 2>/dev/null; do
  if [ -z "$announced" ]; then
    echo "E2E-Sperre belegt ($(tr '\n' ' ' < "$lock/owner" 2>/dev/null)) — warte …" >&2
    announced=1
  fi
  sleep "$wait_seconds"
done
printf 'pid=%s\ncommand=%s\nsince=%s\n' "$$" "$*" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$lock/owner"

release() {
  if [ "$(sed -n 's/^pid=//p' "$lock/owner" 2>/dev/null)" = "$$" ]; then
    rm -f "$lock/owner"
    rmdir "$lock" 2>/dev/null
  fi
}
child=''
trap 'release' EXIT
trap '[ -n "$child" ] && kill -TERM "$child" 2>/dev/null' INT TERM

"$@" &
child=$!
# `wait` kehrt bei einem Signal vorzeitig zurück — so lange warten, bis der Befehl wirklich fertig ist.
while :; do
  wait "$child"
  status=$?
  kill -0 "$child" 2>/dev/null || break
done
exit "$status"
