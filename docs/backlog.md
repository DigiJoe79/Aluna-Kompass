# Backlog

Bewusst zurückgestellte Punkte mit Begründung. Kein Ticketsystem — was hier
steht, ist entschieden, aber nicht gebaut. Erledigtes wird gelöscht, nicht
abgehakt; die Historie steht im Git-Log.

## 1. E2E gegen die Produktionsfassung

**Was:** Die Playwright-Suite zusätzlich gegen `next build && next start`
laufen lassen, nicht nur gegen `next dev`.

**Warum:** Im Entwicklungsmodus gibt es kein Vorrendern. Dass `/login` und
`/setup` ihren Bauzeit-Zustand einbacken und eine eingerichtete Installation
dauerhaft auf die Einrichtungsseite schickt, konnte deshalb keiner der 47
Tests sehen — gefunden wurde es erst im Container. Dieselbe Klasse Lücke gilt
für jede künftige Vorrender-Entscheidung.

**Kosten:** Bauzeit im Test-Job der CI.

## 2. Backup-Upload über einen Route Handler

**Was:** Den Import-Upload wie den Export über einen Route Handler führen, der
den Datenstrom auf die Platte schreibt, statt über eine Server Action.

**Warum:** Server Actions puffern ihren Body; das Limit steht deshalb auf
512 MB und der Speicherbedarf wächst mit dem Archiv. Nebenbei wird die Datei
heute **zweimal** hochgeladen — einmal für die Vorschau im Bestätigungsdialog,
einmal für den Import.

**Wann:** Spätestens wenn Archive einige hundert Megabyte erreichen.

## 3. Platzhalterbilder als WebP

**Was:** Die fünf Platzhalter in `apps/site/public/images/` als WebP
ausliefern.

**Warum:** Sie machen 5,6 MB von 8,3 MB Seitengewicht aus,
`placeholder-hund.png` allein 2,3 MB und liegt auf fast jeder Seite. Die
Inhaltsbilder wandelt die Pipeline bereits um, an den statischen Dateien geht
sie vorbei.

**Einordnung:** Erledigt sich teilweise von selbst, sobald echte Fotos die
Platzhalter verdrängen.

## 4. Browsertest bei Handybreite

**Was:** Ein Playwright-Lauf gegen die gebaute Site bei 390 px.

**Warum:** Dass unterhalb von 1023 px der Sprachumschalter fehlte, fiel beim
Lesen des Stylesheets auf, nicht durch einen Test. `apps/site/tests/` enthält
keine Viewport-Prüfung, und die Kompass-E2E deckt die Site nicht ab.

## 5. Übersetzungen der Webseite

**Was:** Die englischen Felder füllen; der Import setzt sie leer.

**Warum:** Der `/en/`-Baum wird gebaut, indexiert und zeigt durchgehend
deutschen Text — `pick()` fällt zurück und markiert das mit `data-fallback`,
was kein Stylesheet auswertet, also für Besucher unsichtbar bleibt.

**Wann:** Nach der Abnahme der Seite, vor dem Go-live. Entscheidung vom
2026-09-06: erst wenn die Seite inhaltlich steht.
