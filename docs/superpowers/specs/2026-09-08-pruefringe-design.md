# Drei Prüfringe: was wo geprüft wird

**Stand:** 2026-09-08 · **Gilt für:** Entwicklung, CI, Betrieb

## Warum

Vier Fehlschläge am 7. September traten erst im Testcontainer auf dem NAS auf,
nachdem die CI zwölf Minuten grün gemeldet hatte. Drei davon waren im
Entwicklungsmodus **grundsätzlich** unsichtbar: Sie hingen an der Verpackung —
gebündelter Code, ein `/data`-Volume, eine Modulauflösung über Symlinks — und
nicht an der Anwendung. Ein Test gegen `next dev` kann sie nicht finden, egal
wie gründlich er ist.

Daraus folgt die Aufteilung: Jede Schicht bekommt ihren eigenen Ring, und jeder
Ring läuft dort, wo er etwas findet, das die anderen nicht finden können.

## Die drei Ringe

| Ring | Befehl | Läuft gegen | Findet |
|---|---|---|---|
| Logik | `pnpm test` | Quellcode | Services, Schemata, Rechte, Migrationen |
| Abläufe | `pnpm --filter @kompass/app e2e` | `next dev` | Oberfläche, Formulare, Berechtigungen im Browser |
| Verpackung | `pnpm e2e:image` | dem gebauten Image im Container | alles, was erst im Container existiert |

`pnpm verify` fährt alle drei plus den Image-Build. Rund zwei Minuten,
Voraussetzung ist Docker. **Vor jedem Push.**

Der dritte Ring fährt **dieselbe Suite** wie der zweite, nur gegen
`http://localhost:3200` statt gegen den Dev-Server
(`apps/kompass/playwright.container.config.ts`). Das ist Absicht: Eine
handverlesene Teilmenge hätte den ersten Fund verfehlt — die kaputte Abmeldung
fiel in Tests auf, die mit dem Publizieren nichts zu tun haben.

## Was der dritte Ring gefunden hat

Alle vier innerhalb der ersten drei Läufe, keiner davon im Entwicklungsmodus
sichtbar:

1. **Abmelden führte ins Leere.** `new URL('/login', request.url)` ergibt im
   Container `http://0.0.0.0:3000/login` — die Adresse, an die der Server
   bindet, nicht die, unter der ihn jemand erreicht. Hinter der
   Portweiterleitung des NAS galt dasselbe. Weiterleitungen sind jetzt relativ.
2. **Der Entrypoint durfte nicht ins eingehängte `/data` schreiben.** Ein
   Bind-Mount behält unter Linux den Besitzer des Wirts; der Container läuft als
   `node`. macOS bildet die Rechte ab und verdeckt das.
3. **`rsync -a` vergriff sich am Zielverzeichnis.** `-a` enthält `-ogpt` und
   versucht Besitzer, Gruppe, Rechte und Zeiten am Ziel **selbst** zu setzen.
   Gehört es jemand anderem — auf einem Webspace der Regelfall —, bricht der
   Publish ab, obwohl jede Datei übertragen wurde.
4. **Der doppelte Seitenbau.** Vorschau und Publish bauten nacheinander
   dasselbe. Kein Fehler, aber drei Minuten je CI-Lauf und Wartezeit für
   Menschen auf dem NAS.

## Grenzen

**Was lokal grundsätzlich nicht geht:**

- **Die Zielarchitektur.** Ein Apple-Silicon-Rechner baut arm64, das NAS läuft
  amd64. `better-sqlite3`, `sharp` und Typst sind je Architektur andere
  Dateien. Deshalb fährt die CI den dritten Ring gegen das amd64-Bild, bevor sie
  es hochlädt — das ist die einzige Stelle, an der die ausgelieferte Fassung je
  ausgeführt wird.
- **Der echte Publish-Zielserver.** Die rsync-Mechanik ist lokal abgedeckt, der
  fremde Host nicht.
- **Die Umgebung des NAS:** `.env`-Dateien, Volume-Rechte, Portweiterleitung.

**Was der dritte Ring nicht ersetzt:** den Entwicklungsablauf. In `next dev`
ist eine Änderung sofort sichtbar; über den Container kostet dieselbe Runde
einen Neubau plus Neustart. Die Fehler, die nur im Container auftreten,
entstehen beim Anfassen von Pfaden, Umgebung, Weiterleitungen, Dockerfile,
Entrypoint und nativen Bausteinen — nicht beim Bauen einer Oberfläche. Für ein
Ausprobieren von Hand gibt es `pnpm dev:image`: eine stehende Installation auf
Port 3300 mit Daten, die Neustarts überleben.

## Die Zusage der CI

Der `image`-Job lädt das gebaute Bild erst in den lokalen Daemon, fährt den
dritten Ring dagegen und vergibt danach die Namen an **genau dieses** Bild —
kein zweiter Bau, der sich vom geprüften unterscheiden könnte. `needs: test`
bleibt. Damit gilt:

> Liegt ein Bild unter `ghcr.io/…:dev` oder `:latest`, sind seine Tests grün
> gelaufen und es hat auf seiner Zielarchitektur alle Browserfälle bestanden.

Das ist die Eigenschaft, die den sequentiellen Ablauf rechtfertigt: `dev` ist
das Bild, das der Testcontainer zieht, `latest` das für Prod.

## Laufzeiten (gemessen am 2026-09-08)

| | |
|---|---|
| `pnpm verify` lokal, arm64 | 2:08 |
| CI, normaler Push | ~9 min |
| CI, Push mit geänderten Abhängigkeiten | ~17 min |

Der Unterschied sind sieben Minuten `pnpm install --frozen-lockfile` in der
Deps-Schicht des Images: Sie hängt an den `package.json`-Dateien und der
Lockfile, und `better-sqlite3` und `sharp` werden dabei auf zwei amd64-Kernen
neu übersetzt.

## Eine Lehre zum Vorgehen

Die rsync-Flaggen haben drei CI-Runden gekostet, weil zweimal eine Flagge
geraten und auf das Ergebnis gewartet wurde. Der dritte Anlauf baute die
Bedingung in fünf Sekunden lokal nach — ein Zielverzeichnis, das dem Container
nicht gehört — und zeigte sofort, dass der Fehler nur auftritt, wenn das Ziel
der **Einhängepunkt selbst** ist. Wer eine Umgebungsbedingung vermutet, baut sie
nach, statt sie über die CI zu erraten.
