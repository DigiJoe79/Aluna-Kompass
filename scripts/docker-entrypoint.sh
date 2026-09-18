#!/bin/sh
set -eu
: "${SESSION_SECRET:?SESSION_SECRET muss gesetzt sein (mindestens 32 Zeichen)}"
mkdir -p "$DATA_PATH/core/db" "$DATA_PATH/core/media"
seed-site-template.sh
seed-document-templates.sh
echo "Aluna Kompass · APP_ENV=$APP_ENV · DATA=$DATA_PATH · typst $(typst --version)"
exec "$@"
