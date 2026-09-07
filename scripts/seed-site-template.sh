#!/bin/sh
# Erstinbetriebnahme des Site-Templates.
#
# Legt beim ersten Start das mitgelieferte Basis-Template ins Datenvolume und
# richtet die Modulauflösung ein, damit schon der erste Build läuft — auch ohne
# vorheriges Einlesen über die Oberfläche. Idempotent: ein vorhandenes Template
# bleibt unberührt, ein vorhandener Symlink ebenso. Ein Update darf ein
# gepflegtes Template nie überschreiben.
#
# Vom Entrypoint aufgerufen; als eigenes Skript, damit sich die Logik ohne einen
# ganzen Containerlauf prüfen lässt (apps/kompass/tests/entrypoint.test.ts).
#
# Argumente (nur für Tests; im Container gelten die Vorgaben):
#   $1  Quellverzeichnis des Basis-Templates   (Vorgabe /app/templates/verein-basis)
#   $2  node_modules für Astro und @kompass/*  (Vorgabe /app/node_modules)
set -eu

template_dir="${SITE_TEMPLATE_DIR:-$(dirname "${DATABASE_PATH:-/data/kompass.db}")/site-template}"
source_dir="${1:-/app/templates/verein-basis}"
node_modules="${2:-/app/node_modules}"

if [ ! -f "$template_dir/kompass.template.ts" ]; then
  echo "Erstinbetriebnahme: Basis-Template nach $template_dir kopieren"
  mkdir -p "$template_dir"
  # node_modules wird nicht mitkopiert — im Image liegt dort ein Verzeichnis aus
  # dem Build, dessen Verweise ins Leere zeigen würden. Die Auflösung stellt der
  # Symlink unten her.
  for entry in "$source_dir"/* "$source_dir"/.[!.]*; do
    [ -e "$entry" ] || continue
    if [ "$(basename "$entry")" = "node_modules" ]; then continue; fi
    cp -R "$entry" "$template_dir/"
  done
fi

if [ ! -e "$template_dir/node_modules" ]; then
  ln -s "$node_modules" "$template_dir/node_modules"
fi
