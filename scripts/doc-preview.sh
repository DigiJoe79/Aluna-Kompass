#!/bin/bash
# Live-Vorschau einer Dokument-Basisvorlage.
#
#   scripts/doc-preview.sh [base-id] [document-templates-dir]
#
# Die Argumente sind reihenfolge-egal und beide optional:
#   - ein Verzeichnis            → als document-templates-Volume genutzt
#   - eine `<id>.typ` oder `<id>` → diese Basis rendern
# Ohne Verzeichnis, aber im aktuellen Ordner liegen `.typ`-Dateien, gilt der
# aktuelle Ordner als Volume. Sonst nur die mitgelieferten Basen.
#
# Baut eine Vorschau-Umgebung mit einem Beispiel-Brief, öffnet das PDF und lässt
# `typst watch` laufen: jede Änderung an der `.typ` rendert sofort neu,
# Preview.app aktualisiert das PDF von selbst.
#
# - Volume-`.typ` überlagern die mitgelieferten (gleiche ID); `assets/` und
#   `fonts/` des Volumes werden mitgenommen.
# - Ein optionales `preview.json` im Volume liefert Payload/Slots (Branding,
#   Vereinsstamm, Empfänger); sonst gilt ein generischer Musterverein.
set -euo pipefail

DIR=""
BASE=""
for arg in "$@"; do
  if [ -d "$arg" ]; then
    DIR="$arg"
  elif [ -f "$arg" ] && [ "${arg%.typ}" != "$arg" ]; then
    DIR="${DIR:-$(cd "$(dirname "$arg")" && pwd)}"
    BASE="$(basename "$arg" .typ)"
  else
    BASE="${arg%.typ}"
  fi
done
if [ -z "$DIR" ] && compgen -G "./*.typ" > /dev/null; then
  DIR="$(pwd)"
fi
BASE="${BASE:-a4-plain}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHIPPED="$ROOT/packages/documents/templates/bases"
FONTS="$ROOT/packages/documents/fonts"

if ! command -v typst > /dev/null 2>&1; then
  echo "typst nicht gefunden. Installieren: brew install typst" >&2
  exit 1
fi

HARNESS="$(mktemp -d)/preview"
mkdir -p "$HARNESS/bases"
trap 'rm -rf "$(dirname "$HARNESS")"' EXIT

# Basen als Symlink — `typst watch` folgt Änderungen an der echten Datei.
for f in "$SHIPPED"/*.typ; do ln -sf "$f" "$HARNESS/bases/$(basename "$f")"; done

FONT_ARGS=(--font-path "$FONTS")
if [ -n "$DIR" ]; then
  DIR="$(cd "$DIR" && pwd)"
  for f in "$DIR"/*.typ; do [ -e "$f" ] && ln -sf "$f" "$HARNESS/bases/$(basename "$f")"; done
  [ -d "$DIR/assets" ] && ln -s "$DIR/assets" "$HARNESS/assets"
  [ -d "$DIR/fonts" ] && FONT_ARGS+=(--font-path "$DIR/fonts")
fi

if [ ! -f "$HARNESS/bases/$BASE.typ" ]; then
  echo "Basis '$BASE' nicht gefunden. Vorhanden:" >&2
  for f in "$HARNESS/bases"/*.typ; do basename "$f" .typ; done >&2
  exit 1
fi

# Payload: preview.json aus dem Volume, sonst ein generischer Default.
if [ -n "$DIR" ] && [ -f "$DIR/preview.json" ]; then
  cp "$DIR/preview.json" "$HARNESS/data.json"
else
  cat > "$HARNESS/data.json" <<'JSON'
{
  "brand": {
    "primary": "#2F5D68", "primarySoft": "#E3EEF0", "accent": "#9C5637",
    "ink": "#191C1F", "muted": "#666D75", "line": "#E4E4E0",
    "fontBody": "Source Sans 3", "fontHeading": "Source Serif 4", "fontMono": "IBM Plex Mono"
  },
  "organization": {
    "organization.name": "Musterverein e.V.",
    "organization.street": "Musterweg 1",
    "organization.postalCode": "12345",
    "organization.city": "Musterstadt",
    "organization.iban": "DE00 0000 0000 0000 0000 00"
  },
  "number": "BRF-2026-001",
  "issuedDate": "09.09.2026",
  "logoFile": null,
  "slots": {
    "kind": "letter",
    "title": "Einladung zur Mitgliederversammlung",
    "subtitle": "",
    "subject": "Einladung zur ordentlichen Mitgliederversammlung 2026",
    "recipient": "Familie Mustermann\\\n Musterstraße 12\\\n 12345 Musterstadt"
  }
}
JSON
fi

cat > "$HARNESS/body.typ" <<'TYP'
#let content = [
= Einladung zur Mitgliederversammlung

Sehr geehrte Mitglieder,

hiermit laden wir Sie herzlich zur ordentlichen Mitgliederversammlung ein. Die
Versammlung findet in den Vereinsräumen statt; Anträge zur Tagesordnung bitte
bis eine Woche vorher schriftlich einreichen.

== Tagesordnung

+ Begrüßung und Feststellung der Beschlussfähigkeit
+ Bericht des Vorstands
+ Kassenbericht und Bericht der Kassenprüfung
+ Entlastung des Vorstands
+ Wahlen zum Vorstand
+ Verschiedenes

#quote(block: true)[Bitte bringen Sie diese Einladung als Zugangsnachweis mit.]

Ein *fetter* Hinweis und ein _kursiver_ Zusatz, dazu eine kleine Tabelle:

#table(
  columns: 2,
  table.header([*Uhrzeit*], [*Programm*]),
  [18:00], [Einlass],
  [18:30], [Beginn der Versammlung],
)

Mit freundlichen Grüßen \
Der Vorstand
]
TYP

cat > "$HARNESS/entry.typ" <<TYP
#import "bases/$BASE.typ": base
#import "body.typ": content
#let payload = json("/data.json")
#show: base.with(payload, payload.slots)
#content
TYP

OUT="$HARNESS/out.pdf"
typst compile --root "$HARNESS" "${FONT_ARGS[@]}" --ignore-system-fonts "$HARNESS/entry.typ" "$OUT"

echo "Basis:    $BASE"
[ -n "$DIR" ] && echo "Volume:   $DIR"
echo "PDF:      $OUT"
echo "Payload:  $HARNESS/data.json   (anpassen und speichern rendert neu)"
echo "Body:     $HARNESS/body.typ"
echo
echo "Speichern der .typ rendert neu. Beenden mit Strg-C."

command -v open > /dev/null 2>&1 && open "$OUT"
exec typst watch --root "$HARNESS" "${FONT_ARGS[@]}" --ignore-system-fonts "$HARNESS/entry.typ" "$OUT"
