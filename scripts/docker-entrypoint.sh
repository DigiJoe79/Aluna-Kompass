#!/bin/sh
set -eu
: "${SESSION_SECRET:?SESSION_SECRET muss gesetzt sein (mindestens 32 Zeichen)}"
mkdir -p "$(dirname "$DATABASE_PATH")" "$MEDIA_PATH"
seed-site-template.sh
echo "Aluna Kompass · APP_ENV=$APP_ENV · DB=$DATABASE_PATH · MEDIA=$MEDIA_PATH · typst $(typst --version)"
exec "$@"
