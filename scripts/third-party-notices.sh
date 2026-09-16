#!/usr/bin/env bash
# Die Aufstellung der Software Dritter im Laufzeit-Image.
#
# Verteilt wird, was im Image liegt — Debian-Pakete der Basis, die
# Laufzeitabhaengigkeiten aus npm, die mitgelieferten Binaerdateien. Deshalb
# entsteht die vollstaendige Liste **beim Bau im Image** (`/app/THIRD-PARTY-
# NOTICES.md`) und stimmt so fuer jede ausgelieferte Fassung. Im Repo steht mit
# `THIRD-PARTY-NOTICES.md` nur eine Uebersicht ohne Versionen: Stand dort die
# volle Liste, machte jedes Dependabot-Update sie falsch (#5, 2026-09-16).
#
#   scripts/third-party-notices.sh --erzeugen          im Image: schreibt die Liste nach stdout (Dockerfile)
#   scripts/third-party-notices.sh [image] --pruefen   Liste vorhanden, jede npm-Lizenz erlaubt (CI, verify)
#   scripts/third-party-notices.sh [image]             gibt die Liste aus dem Image aus
#
# Vorgabe-Image: kompass-local (aus `pnpm image`).
set -euo pipefail

if [ "${1:-}" = "--erzeugen" ]; then
  MODUS=erzeugen
  IMAGE=""
else
  IMAGE="${1:-kompass-local}"
  MODUS="${2:-ausgeben}"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Image '$IMAGE' gibt es nicht. Erst 'pnpm image' bauen." >&2
    exit 1
  fi
fi

# Rohdaten sammeln: dpkg fuer Debian, node fuer npm — beides ist im Image
# ohnehin vorhanden, also braucht es kein jq und keine Fremdwerkzeuge.
#
# Das Programm steht in einem unquotierten Heredoc und wird als **ein** Argument
# uebergeben. Zwischenschritt mit doppelten Anfuehrungszeichen waere falsch: die
# sh im Container wuerde ${Package} selbst zu leer aufloesen, bevor dpkg-query
# das Format zu sehen bekommt.
CONTAINER_PROGRAMM=$(cat <<'IM_CONTAINER'
echo "@@DEBIAN_VERSION"
cat /etc/debian_version
echo "@@DEBIAN_PAKETE"
dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null | sort | while IFS='	' read -r p v; do
  [ -z "$p" ] && continue
  # `+bN` ist ein binaerer Rebuild derselben Quellversion, je Architektur
  # verschieden. Fuer den Lizenzhinweis zaehlt die Quelle, nicht der Rebuild —
  # und ohne das Abschneiden passte die Datei nur zu der Architektur, auf der
  # sie erzeugt wurde.
  v=$(printf '%s' "$v" | sed 's/+b[0-9][0-9]*$//')
  datei="/usr/share/doc/$p/copyright"
  lic=$(grep -h '^License:' "$datei" 2>/dev/null | sed 's/^License: //' | sort -u | paste -sd ',' -)
  # Ein Drittel der Pakete traegt die Lizenz noch als Fliesstext. Dort steht sie
  # als Verweis auf /usr/share/common-licenses — der alte Debian-Standard. Ohne
  # diesen Rueckfall bliebe ausgerechnet rsync (GPL-3) unbestimmt.
  if [ -z "$lic" ]; then
    lic=$(grep -ho 'common-licenses/[A-Za-z0-9.+-]*' "$datei" 2>/dev/null | sed 's|common-licenses/||' | sort -u | paste -sd ',' -)
  fi
  [ -z "$lic" ] && lic="siehe /usr/share/doc/$p/copyright"
  printf '%s\t%s\t%s\n' "$p" "$v" "$lic"
done
echo "@@NPM_PAKETE"
node -e '
  const fs = require("fs"), path = require("path");
  const gesehen = new Map();
  const lauf = (dir, tiefe) => {
    if (tiefe > 8) return;
    let eintraege;
    try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name === ".bin") continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith("@") || e.name === "node_modules" || e.name === ".pnpm") { lauf(p, tiefe + 1); continue; }
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
        // Eigene Pakete des Workspace (`@kompass/*`, `verein-basis`) sind privat
        // und keine Software Dritter; sie stehen unter der Projektlizenz.
        if (pkg.name && pkg.version && !pkg.private) {
          const lz = typeof pkg.license === "string" ? pkg.license
            : (pkg.license && pkg.license.type) ? pkg.license.type
            : Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type || l).join(" OR ")
            : "unbekannt";
          // Ein Plattformpaket liegt je Architektur unter anderem Namen
          // (…-linux-x64-gnu gegen …-linux-arm64-gnu), traegt aber dieselbe
          // Lizenz. Zusammengefasst, damit eine Datei fuer jeden Bau passt.
          const name = pkg.name.replace(/([-/])(linux|darwin|win32|freebsd|android)-(arm64|arm|x64|ia32|s390x|ppc64|riscv64)(-(gnu|musl|msvc|glibc|gnueabihf))?$/, "$1$2-<plattform>");
          gesehen.set(name + "\u0000" + pkg.version, lz);
        }
      } catch {}
      lauf(path.join(p, "node_modules"), tiefe + 1);
    }
  };
  lauf("/app/node_modules", 0);
  [...gesehen.entries()].sort().forEach(([schluessel, lz]) => {
    const [name, version] = schluessel.split("\u0000");
    console.log(name + "\t" + version + "\t" + lz);
  });
' 2>/dev/null
IM_CONTAINER
)

if [ "$MODUS" != "erzeugen" ]; then
  LISTE="$(docker run --rm --entrypoint cat "$IMAGE" /app/THIRD-PARTY-NOTICES.md 2>/dev/null || true)"
  if [ -z "$LISTE" ]; then
    echo "Das Image '$IMAGE' traegt keine /app/THIRD-PARTY-NOTICES.md." >&2
    exit 1
  fi
  if [ "$MODUS" = "ausgeben" ]; then
    printf '%s\n' "$LISTE"
    exit 0
  fi

  # Lizenzen, die ein npm-Paket im Image tragen darf. Freizuegige Lizenzen,
  # dazu MPL-2.0 (Datei-Copyleft, unveraendert mitgeliefert) und die
  # Schriftlizenz OFL. Alles andere — AGPL, GPL, eine fehlende Angabe — soll
  # jemand ansehen, bevor es verteilt wird. Die Pruefung vergleicht bewusst
  # nicht mit einer Datei: Ein Update aendert Versionen, keine Lizenzen.
  ERLAUBT='MIT ISC Apache-2.0 BSD-2-Clause BSD-3-Clause 0BSD BlueOak-1.0.0 CC0-1.0 CC-BY-4.0 Python-2.0 OFL-1.1 MPL-2.0 Unlicense'
  # Einzeln angesehen: libvips, dynamisch geladen und austauschbar (NOTICE).
  AUSNAHMEN='@img/sharp-libvips-*=LGPL-3.0-or-later'

  verstoesse=$(printf '%s\n' "$LISTE" | awk '/^## 5\./{f=1} f && /^\| `/' | awk -F' \\| ' -v erlaubt="$ERLAUBT" -v ausnahmen="$AUSNAHMEN" '
    BEGIN {
      n = split(erlaubt, e, " "); for (i = 1; i <= n; i++) ok[e[i]] = 1
      m = split(ausnahmen, a, " "); for (i = 1; i <= m; i++) { split(a[i], kv, "="); aus[kv[1]] = kv[2] }
    }
    {
      name = $1; sub(/^\| `/, "", name); sub(/`$/, "", name)
      lz = $3; sub(/ \|$/, "", lz); gsub(/[()]/, "", lz)
      for (muster in aus) {
        re = "^" muster; gsub(/\*/, ".*", re); gsub(/\//, "\\/", re)
        if (name ~ re && lz == aus[muster]) next
      }
      if (lz ~ / OR /) {
        k = split(lz, t, / OR /); gut = 0
        for (i = 1; i <= k; i++) if (t[i] in ok) gut = 1
      } else {
        k = split(lz, t, / AND /); gut = 1
        for (i = 1; i <= k; i++) if (!(t[i] in ok)) gut = 0
      }
      if (!gut) print "  " name ": " lz
    }')

  if [ -n "$verstoesse" ]; then
    echo "Im Image '$IMAGE' liegen npm-Pakete mit einer Lizenz, die niemand freigegeben hat:" >&2
    echo "$verstoesse" >&2
    echo >&2
    echo "Ansehen; passt sie, in ERLAUBT oder AUSNAHMEN in $0 aufnehmen." >&2
    exit 1
  fi
  echo "Lizenzliste im Image '$IMAGE' vorhanden, jede npm-Lizenz freigegeben."
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
sh -c "$CONTAINER_PROGRAMM" > "$TMP/roh.txt"

abschnitt() { awk -v s="@@$1" -v e="@@$2" '$0==s{an=1;next} $0==e{an=0} an' "$TMP/roh.txt"; }

DEBIAN_VERSION="$(abschnitt DEBIAN_VERSION DEBIAN_PAKETE | head -1)"
abschnitt DEBIAN_PAKETE NPM_PAKETE | grep -v '^$' > "$TMP/debian.tsv"
abschnitt NPM_PAKETE ENDE | grep -v '^$' > "$TMP/npm.tsv"

DEB_ANZAHL=$(wc -l < "$TMP/debian.tsv" | tr -d ' ')
NPM_ANZAHL=$(wc -l < "$TMP/npm.tsv" | tr -d ' ')
COPYLEFT=$(cut -f3 "$TMP/debian.tsv" | grep -ciE 'gpl' || true)

{
cat <<KOPF
# Hinweise zu Software Dritter

Aluna Kompass steht unter Apache-2.0 (siehe \`LICENSE\` und \`NOTICE\`). Das
ausgelieferte Container-Image enthält darüber hinaus Software Dritter unter
eigenen Bedingungen. Diese Datei führt sie auf.

**Diese Datei wird beim Bau des Images erzeugt, nicht gepflegt**
(\`scripts/third-party-notices.sh --erzeugen\`). Sie gilt für genau das Image,
in dem sie liegt.

Stand: Debian $DEBIAN_VERSION, $DEB_ANZAHL Systempakete, $NPM_ANZAHL npm-Pakete.


## 1. Quellcode

Ein Teil der enthaltenen Software steht unter GPL oder LGPL. Deren Quellcode
ist auf zwei Wegen zu haben:

**Systempakete (Debian).** Alle Debian-Pakete sind unverändert übernommen. Der
zugehörige Quellcode liegt dauerhaft unter <https://snapshot.debian.org/> — das
Archiv hält jede Paketfassung mit ihrer Versionsnummer vor, anders als die
rollende Distribution. Die Versionen stehen in Abschnitt 2.

**libvips und Abhängigkeiten.** Quellen und Bauanleitung:
<https://github.com/lovell/sharp-libvips>. Die Bibliothek ist als eigene
Datei eingebunden und wird dynamisch geladen (\`libvips-cpp.so\`); sie lässt
sich gegen eine selbst übersetzte Fassung austauschen.

**Schriftliches Angebot.** Unabhängig davon: Wer eine Kopie des Quellcodes der
hier aufgeführten GPL- und LGPL-Bestandteile wünscht, erhält sie auf Anfrage,
für **drei Jahre** ab Auslieferung der jeweiligen Fassung, zu den Selbstkosten
des Datenträgers. Den Weg dorthin nennt das README des Projekts im Abschnitt
„Fragen, Fehler und Sicherheit"; eine solche Anfrage ist nicht vertraulich und
gehört in ein gewöhnliches Issue.

## 2. Systempakete (Debian $DEBIAN_VERSION)

$DEB_ANZAHL Pakete, davon $COPYLEFT mit einer GPL-Lizenzangabe. Quellcode über
<https://snapshot.debian.org/> unter der jeweils genannten Version.

Wo statt einer Lizenz „siehe …/copyright" steht, trägt das Paket seine Angabe
weder im maschinenlesbaren Format noch als Verweis auf
\`/usr/share/common-licenses\`. Das betrifft ausschließlich X11- und
Schriftbibliotheken unter MIT-/X11-artigen Bedingungen; die Datei liegt im
Image unter dem genannten Pfad.

| Paket | Version | Lizenzangaben laut \`copyright\` |
|---|---|---|
KOPF

awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| `%s` | `%s` | %s |\n", $1, $2, $3}' "$TMP/debian.tsv"

cat <<'MITTE'

## 3. libvips (über sharp)

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

## 4. Weitere mitgelieferte Bestandteile

| Bestandteil | Lizenz | Quelle |
|---|---|---|
| Typst | Apache-2.0 | <https://github.com/typst/typst> |
| Tesseract OCR | Apache-2.0 | Debian-Paket `tesseract-ocr` |
| Source Sans 3 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-sans.md` |
| Source Serif 4 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-serif.md` |
| IBM Plex Mono | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-ibm-plex-mono.txt` |

## 5. npm-Abhängigkeiten

Die folgenden Pakete liegen im Image unter `/app/node_modules`.

| Paket | Version | Lizenz |
|---|---|---|
MITTE

awk -F'\t' '{gsub(/\|/,"\\|",$3); printf "| `%s` | `%s` | %s |\n", $1, $2, $3}' "$TMP/npm.tsv"
} 
