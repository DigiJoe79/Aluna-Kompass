#!/bin/sh
set -eu
: "${SESSION_SECRET:?SESSION_SECRET muss gesetzt sein (mindestens 32 Zeichen)}"
# N10 (Befundliste 0.2.0): `data/` selbst muss dem Container gehören (UID 1000) — sonst scheitert
# das `mkdir` einer Modul-Ablage erst beim ersten Upload, mit einem stillen 500 in der Oberfläche.
if ! mkdir -p "$DATA_PATH" 2>/dev/null || [ ! -w "$DATA_PATH" ]; then
  echo "Datenverzeichnis nicht beschreibbar: $DATA_PATH — gehört es UID 1000 (chown 1000:1000, ohne -R)?" >&2
  exit 1
fi
mkdir -p "$DATA_PATH/core/db" "$DATA_PATH/core/media"
seed-site-template.sh
seed-document-templates.sh
echo "Aluna Kompass · APP_ENV=$APP_ENV · DATA=$DATA_PATH · typst $(typst --version)"
exec "$@"
