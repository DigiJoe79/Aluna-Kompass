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

## 3. Löschen für redaktionelle Inhalte

**Was:** Löschfunktionen für Artikel, Team-Mitglieder, FAQ-Einträge, Downloads,
Seiten-Bausteine und Medien — in der Oberfläche, im MCP und mit Eintrag im
Änderungsprotokoll.

**Warum:** Es gibt heute im ganzen Repo genau eine Löschfunktion, `deleteTheme`.
Ein ausgeschiedenes Team-Mitglied, ein versehentlich angelegter Artikel, ein FAQ
zu einem Thema, das es nicht mehr gibt: alles lässt sich nur unveröffentlichen.
Die Datenbank sammelt, und die Listen in der Oberfläche werden mit jedem Jahr
länger. Grund war eine zu weite Auslegung von Prinzip 3 — die Regel zählt
Webseiteninhalte gar nicht auf, sie standen nur unter derselben Überschrift.
Am 2026-09-07 in `AGENTS.md` klargestellt: Rechenschaft meint Finanzamt und
Transparenzregister, nicht die Redaktion.

**Zuschnitt:** Projekte und Tierprofile bleiben vorerst außen vor. Sie tragen ab
Stufe 3 Finanzfelder beziehungsweise ab Stufe 4 Bestandsbuch und
§ 11-Nachweise; ob und wie sie löschbar werden, entscheidet sich dort.

## 4. Platzhalterbilder als WebP

**Was:** Die Platzhalter in `templates/verein-basis/public/images/` als WebP
ausliefern.

**Warum:** Sie machen den grössten Teil des Seitengewichts aus. Die
Inhaltsbilder wandelt die Pipeline bereits um, an den statischen Dateien geht
sie vorbei.

**Einordnung:** Erledigt sich für einen Verein von selbst, sobald echte Fotos
die Platzhalter verdrängen — für das mitgelieferte Template aber nicht.

## 5. Browsertest bei Handybreite

**Was:** Ein Playwright-Lauf gegen die gebaute Site bei 390 px.

**Warum:** Dass unterhalb von 1023 px der Sprachumschalter fehlte, fiel beim
Lesen des Stylesheets auf, nicht durch einen Test. `templates/verein-basis/tests/`
enthält keine Viewport-Prüfung, und die Kompass-E2E deckt die gebaute Site
nicht ab.

## 6. Betterplace steckt im Kern

**Was:** `projects.betterplaceProjectId` ist eine Spalte der Kerntabelle
`projects`, mit eigenem Feld in der Oberfläche und im veröffentlichten Blick.

**Warum:** Eine bestimmte Spendenplattform gehört nicht in den generischen
Kern (Prinzip 1). Ein Modellbauverein bekommt ein Pflichtfeld für etwas, das
er nicht benutzt. Gefunden beim Cutover am 2026-09-08, als der Test gegen
vereinsspezifische Inhalte gebaut wurde; `betterplace` musste dort von der
Liste genommen werden, weil der Kern es selbst führt.

**Zuschnitt:** Entweder eine allgemeine Liste externer Verweise je Projekt
(Label plus URL) oder ein Feld, das das Template deklariert. Beides braucht
eine Migration und berührt den veröffentlichten Blick.

**Wann:** Wenn Projekte ihr eigenes Kernmodul bekommen — die Entscheidung vom
2026-09-07 sieht das ohnehin vor.
