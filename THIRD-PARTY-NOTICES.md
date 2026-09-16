# Hinweise zu Software Dritter

Aluna Kompass steht unter Apache-2.0 (siehe `LICENSE` und `NOTICE`). Das
ausgelieferte Container-Image enthält darüber hinaus Software Dritter unter
eigenen Bedingungen. Diese Datei gibt den Überblick; die vollständige Liste
steht im Image selbst.

## Die vollständige Liste

Jedes Image trägt seine Aufstellung unter **`/app/THIRD-PARTY-NOTICES.md`**:
alle Debian-Pakete und alle npm-Pakete mit genauer Version und Lizenz. Sie
entsteht beim Bau aus genau dem, was im Image liegt, und stimmt deshalb für
jede ausgelieferte Fassung.

```
docker run --rm --entrypoint cat ghcr.io/digijoe79/aluna-kompass:latest /app/THIRD-PARTY-NOTICES.md
```

Hier im Repo steht sie bewusst nicht: Jede Aktualisierung einer Abhängigkeit
ändert Versionen, und eine Liste mit Versionen wäre nach dem nächsten Update
falsch.

## Quellcode

Ein Teil der enthaltenen Software steht unter GPL oder LGPL. Deren Quellcode
ist auf zwei Wegen zu haben:

**Systempakete (Debian).** Alle Debian-Pakete sind unverändert übernommen. Der
zugehörige Quellcode liegt dauerhaft unter <https://snapshot.debian.org/> — das
Archiv hält jede Paketfassung mit ihrer Versionsnummer vor, anders als die
rollende Distribution. Die Versionen stehen in der Liste im Image.

**libvips und Abhängigkeiten.** Quellen und Bauanleitung:
<https://github.com/lovell/sharp-libvips>. Die Bibliothek ist als eigene
Datei eingebunden und wird dynamisch geladen (`libvips-cpp.so`); sie lässt
sich gegen eine selbst übersetzte Fassung austauschen.

**Schriftliches Angebot.** Unabhängig davon: Wer eine Kopie des Quellcodes der
im Image enthaltenen GPL- und LGPL-Bestandteile wünscht, erhält sie auf
Anfrage, für **drei Jahre** ab Auslieferung der jeweiligen Fassung, zu den
Selbstkosten des Datenträgers. Den Weg dorthin nennt das README des Projekts im
Abschnitt „Fragen, Fehler und Sicherheit"; eine solche Anfrage ist nicht
vertraulich und gehört in ein gewöhnliches Issue.

## Systempakete, die das Image selbst installiert

Zur Debian-Basis (`node:26-bookworm-slim`) kommen diese Pakete hinzu. GPL-Programme
werden als eigene Prozesse aufgerufen, nicht eingebunden.

| Paket | Lizenzangaben laut `copyright` |
|---|---|
| `ca-certificates` | GPL-2+, MPL-2.0 |
| `rsync` | GPL-3 |
| `openssh-client` | BSD-2-clause, BSD-3-clause, OpenSSH und BSD-artige |
| `sshpass` | GPL-2+ |
| `tesseract-ocr` | Apache-2.0 |
| `tesseract-ocr-deu` | Apache-2.0 |
| `tesseract-ocr-eng` | Apache-2.0 |
| `poppler-utils` | Apache-2.0, GPL-2, GPL-3 |

## libvips (über sharp)

Die Bildverarbeitung nutzt libvips. Das Paket `@img/sharp-libvips-*` bündelt
libvips mit seinen Abhängigkeiten; die folgenden stehen unter LGPLv3 (laut
Angabe des Paketautors, über die „any later version"-Klausel von LGPLv2/2.1):

| Bibliothek | Lizenz |
|---|---|
| libvips | LGPLv3 |
| glib | LGPLv3 |
| pango | LGPLv3 |
| librsvg | LGPLv3 |
| libheif | LGPLv3 |
| libexif | LGPLv3 |
| fribidi | LGPLv3 |
| proxy-libintl | LGPLv3 |
| cairo | MPL-2.0 |

Die übrigen gebündelten Bibliotheken (aom, cgif, expat, fontconfig, freetype,
harfbuzz, highway, lcms, libarchive, libffi, libimagequant, libnsgif, libpng,
libtiff, libultrahdr, libwebp, libxml2, mozjpeg, pixman, zlib-ng) stehen unter
BSD-, MIT- oder vergleichbaren Bedingungen. Die vollständige Aufstellung des
Paketautors liegt dem Paket bei und steht unter
<https://github.com/lovell/sharp-libvips>.

## Weitere mitgelieferte Bestandteile

| Bestandteil | Lizenz | Quelle |
|---|---|---|
| Typst | Apache-2.0 | <https://github.com/typst/typst> |
| Tesseract OCR | Apache-2.0 | Debian-Paket `tesseract-ocr` |
| Source Sans 3 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-sans.md` |
| Source Serif 4 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-serif.md` |
| IBM Plex Mono | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-ibm-plex-mono.txt` |

## npm-Abhängigkeiten

Rund 400 Pakete, fast alle unter MIT. Ein npm-Paket im Image darf nur eine
dieser Lizenzen tragen: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD,
BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Python-2.0, OFL-1.1, MPL-2.0, Unlicense —
dazu LGPL-3.0-or-later allein für `@img/sharp-libvips-*` (siehe oben). Jede
andere Lizenz, auch eine fehlende Angabe, hält die CI an, bevor das Image
verteilt wird (`scripts/third-party-notices.sh --pruefen`).
