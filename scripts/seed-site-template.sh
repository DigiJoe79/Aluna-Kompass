#!/bin/sh
# Erstinbetriebnahme des Site-Templates.
#
# Legt beim ersten Start das mitgelieferte Basis-Template ins Datenvolume und
# richtet die Modulauflösung ein, damit schon der erste Build läuft — auch ohne
# vorheriges Einlesen über die Oberfläche. Idempotent: ein vorhandenes Template
# bleibt unberührt, ein Update darf ein gepflegtes Template nie überschreiben.
# Ein Symlink, der auf node_modules ohne Astro zeigt, wird dagegen erneuert —
# sonst scheitert jeder Build.
#
# Vom Entrypoint aufgerufen; als eigenes Skript, damit sich die Logik ohne einen
# ganzen Containerlauf prüfen lässt (apps/kompass/tests/entrypoint.test.ts).
#
# Argumente (nur für Tests; im Container gelten die Vorgaben):
#   $1  Quellverzeichnis des Basis-Templates   (Vorgabe /app/templates/verein-basis)
#   $2  node_modules mit Astro und @kompass/*  (Vorgabe: die des Basis-Templates)
set -eu

template_dir="${SITE_TEMPLATE_DIR:-${DATA_PATH:-/data}/site/template}"
source_dir="${1:-/app/templates/verein-basis}"
# Nicht /app/node_modules: pnpm installiert nicht flach, astro liegt bei dem
# Paket, das es braucht. Die node_modules des Basis-Templates führen genau die
# Menge, die ein Template zum Bauen braucht.
node_modules="${2:-/app/templates/verein-basis/node_modules}"

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

# Ein vorhandener Symlink aus einer früheren Fassung kann auf die falsche
# node_modules zeigen; der Build bricht dann mit „astro not installed" ab.
# Deshalb prüfen und richten statt blind stehen lassen. Ein echtes Verzeichnis
# (eigene Installation im Template) bleibt unberührt.
if [ -L "$template_dir/node_modules" ] && [ ! -e "$template_dir/node_modules/astro" ]; then
  echo "Modulauflösung zeigt auf node_modules ohne Astro — Symlink erneuern"
  rm "$template_dir/node_modules"
fi

if [ ! -e "$template_dir/node_modules" ] && [ ! -L "$template_dir/node_modules" ]; then
  ln -s "$node_modules" "$template_dir/node_modules"
fi
