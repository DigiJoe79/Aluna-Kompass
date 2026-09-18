#!/bin/sh
# Baut die beiden Beispiel-PDFs neu. Die Ergebnisse sind committet; dieses
# Skript läuft nur, wenn sich der Inhalt ändern soll.
#
# brief-digital.pdf — mit Textebene, der Schnellpfad muss ihn ohne OCR lesen.
# brief-scan.pdf    — dieselbe Seite als Bild, erzwingt den OCR-Rückfall.
set -eu
cd "$(dirname "$0")"

typst compile brief.typ brief-digital.pdf
pdftoppm -png -r 200 -singlefile brief-digital.pdf brief-page
typst compile scan.typ brief-scan.pdf
rm -f brief-page.png

# Gegenprobe: Der Scan darf keine Textebene haben.
if [ -n "$(pdftotext brief-scan.pdf - | tr -d '[:space:]')" ]; then
  echo "brief-scan.pdf traegt Text — dann prueft der OCR-Test nichts" >&2
  exit 1
fi
echo "ok"
