#!/bin/sh
# Eine stehende Testumgebung auf dem eigenen Rechner.
#
# Baut das Image und startet es unter http://localhost:3300 — mit benannten
# Volumes, die einen Neustart überleben. Gedacht zum Anklicken und Ausprobieren
# in der Verpackung, die auch auf dem NAS läuft: gebündelter Code, `/data`,
# der Entrypoint mit seinem Basis-Template, Migrationen beim Start.
#
# Nicht der Arbeitsplatz für den Alltag — dafür bleibt `pnpm dev` mit seiner
# Sekundenschleife richtig. Diese Umgebung beantwortet die andere Frage:
# „Verhält es sich als Container auch so?"
#
# Der Ring, der dasselbe automatisch prüft, ist `pnpm e2e:image`; er nimmt sich
# einen eigenen Container und lässt diesen hier in Ruhe.
set -eu

name="${KOMPASS_DEV_CONTAINER:-kompass-dev}"
# Nicht 3200: Dort nimmt sich `pnpm e2e:image` seinen Wegwerf-Container. Die
# stehende Umgebung soll davon nicht verdraengt werden und umgekehrt.
port="${KOMPASS_DEV_PORT:-3300}"
image="${KOMPASS_DEV_IMAGE:-kompass-local}"
root="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"

case "${1:-up}" in
  up)
    echo "Image bauen (native Architektur) …"
    docker build -t "$image" "$root"
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "Container starten …"
    # Benannte Volumes statt eines Wirtsverzeichnisses: Unter Linux behielte ein
    # eingehängtes Verzeichnis seinen Besitzer, und der Container läuft als
    # `node`. Docker legt benannte Volumes mit den Rechten aus dem Image an.
    docker run -d --name "$name" -p "$port:3000" \
      -e APP_ENV=test \
      -e SESSION_SECRET="${KOMPASS_DEV_SECRET:-lokale-testumgebung-kein-echtes-geheimnis-01}" \
      -e SITE_PUBLIC_URL="http://localhost:$port" \
      -e SITE_STAGING=1 \
      -v "${name}-data:/data" \
      -v "${name}-media:/media" \
      "$image" >/dev/null
    printf 'Warte auf die Gesundheitsprüfung'
    i=0
    while [ "$i" -lt 60 ]; do
      state="$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null || echo none)"
      [ "$state" = healthy ] && break
      [ "$state" = none ] && break
      printf '.'
      sleep 1
      i=$((i + 1))
    done
    echo
    if [ "$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null)" != healthy ]; then
      echo "Der Container ist nicht gesund geworden. Protokoll:" >&2
      docker logs "$name" 2>&1 | tail -20 >&2
      exit 1
    fi
    echo "Läuft: http://localhost:$port  (Protokoll: docker logs -f $name)"
    echo "Beenden: pnpm dev:image down   ·   Daten verwerfen: pnpm dev:image reset"
    ;;
  down)
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "Container entfernt; die Daten bleiben in den Volumes ${name}-data und ${name}-media."
    ;;
  reset)
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm "${name}-data" "${name}-media" >/dev/null 2>&1 || true
    echo 'Container und Daten verworfen. Der naechste Start beginnt wieder bei der Erstinbetriebnahme.'
    ;;
  *)
    echo "Aufruf: pnpm dev:image [up|down|reset]" >&2
    exit 1
    ;;
esac
