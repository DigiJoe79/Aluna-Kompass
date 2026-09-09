#!/bin/sh
# Erstinbetriebnahme der Dokument-Basisvorlagen.
#
# Legt beim ersten Start /data/document-templates an — leer bis auf ein README
# und bases.reference/ als Kopiervorlage. Leer ist gültig: dann gelten alle
# mitgelieferten Basen (a4-plain, a4-mit-briefkopf, a4-ohne-briefkopf). Ein
# vorhandenes Verzeichnis bleibt unberührt.
#
# Vom Entrypoint aufgerufen; als eigenes Skript, damit sich die Logik ohne einen
# ganzen Containerlauf prüfen lässt (apps/kompass/tests/entrypoint.test.ts).
#
# Argumente (nur für Tests):
#   $1  Verzeichnis der mitgelieferten Basen (Vorgabe /app/packages/documents/templates/bases)
set -eu

dir="${KOMPASS_DOCUMENT_TEMPLATES_DIR:-$(dirname "${DATABASE_PATH:-/data/kompass.db}")/document-templates}"
ship="${1:-/app/packages/documents/templates/bases}"

if [ ! -d "$dir" ]; then
  echo "Erstinbetriebnahme: $dir anlegen (leer = alle mitgelieferten Basen)"
  mkdir -p "$dir/bases.reference"
  for f in "$ship"/*.typ "$ship"/bases.json; do
    [ -e "$f" ] && cp "$f" "$dir/bases.reference/"
  done
  cat > "$dir/README.md" <<'EOF'
# Dokument-Basisvorlagen

Lege hier `<id>.typ`-Dateien ab, um eine Basis-Vorlage zu ergänzen oder eine
mitgelieferte zu ersetzen (gleiche ID gewinnt). Jede exportiert die Funktion
`#let base(payload, slots, body)` mit dieser Signatur und setzt
`set document(date: none)` (Determinismus). Vorlagen zum Abkupfern liegen in
`bases.reference/`.

Dazu optional:

- `fonts/`  — eigene Schriftdateien (`.ttf` / `.otf` / `.ttc`). Werden als
  zusätzlicher Font-Pfad übergeben; eine Basis nutzt sie über den Familiennamen
  (`payload.brand.fontHeading` usw., gesetzt im Theme). `.woff2` geht nicht.
- `assets/` — alle Grafiken, die eine Basis einbindet — auch das Druck-Logo für
  den Briefkopf. Referenziert als `#image("/assets/<name>")` (mit führendem `/`).
  Eine eigene Basis sollte hierher greifen, damit die Renderpipeline in sich
  geschlossen ist.

`payload.logoFile` (das Logo aus den Einstellungen) gibt es weiterhin, aber nur
damit die **mitgelieferten** Basen ohne dieses Volume ein Logo zeigen. Wer eine
eigene Basis bringt, legt sein Druck-Logo in `assets/`.

Ein leeres Verzeichnis ist in Ordnung — dann gelten die mitgelieferten Basen.

Dieses Verzeichnis ist eine Vertrauensgrenze: Der Code läuft beim Rendern im
Container mit Zugriff auf `/data`. Wer hier schreiben darf, darf alles.
EOF
fi
