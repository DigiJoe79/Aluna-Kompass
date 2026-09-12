# Backlog

Bewusst zurückgestellte Punkte mit Begründung. Kein Ticketsystem — was hier
steht, ist entschieden, aber nicht gebaut. Erledigtes wird gelöscht, nicht
abgehakt; die Historie steht im Git-Log.

## 1. Backup-Upload über einen Route Handler

**Was:** Den Import-Upload wie den Export über einen Route Handler führen, der
den Datenstrom auf die Platte schreibt, statt über eine Server Action.

**Warum:** Server Actions puffern ihren Body; das Limit steht deshalb auf
512 MB und der Speicherbedarf wächst mit dem Archiv. Nebenbei wird die Datei
heute **zweimal** hochgeladen — einmal für die Vorschau im Bestätigungsdialog,
einmal für den Import.

**Wann:** Spätestens wenn Archive einige hundert Megabyte erreichen.

## 3. Browsertest bei Handybreite

**Was:** Ein Playwright-Lauf gegen die gebaute Site bei 390 px, in
`templates/verein-basis/tests/` für das mitgelieferte Template und im
Vereinsrepo für Alunas.

**Warum:** Dass unterhalb von 1023 px der Sprachumschalter fehlte, fiel beim
Lesen des Stylesheets auf, nicht durch einen Test. Der Befund galt Alunas
Seite, die seit dem Cutover im Vereinsrepo lebt; das Basis-Template ist
einsprachig, hat aber ebenso wenig eine Viewport-Prüfung. Die Kompass-E2E
deckt die gebaute Site nicht ab.

**Nummer 2 (Platzhalterbilder als WebP) ist gestrichen:** Das Basis-Template
hat unter `public/` nur die `.htaccess`, die genannten Dateien gab es am
2026-09-12 nicht mehr.

## 4. Betterplace steckt im Kern

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

## 5. Einsortierregeln auf dem Volltext

**Was:** `document_rules.matchField = 'fulltext'` als weiteres Kriterium für Einsortierregeln.

**Warum:** Die Regeln belegen das Ablegen-Formular vor, und zu dem Zeitpunkt ist die Texterkennung noch nicht durch (das Dokument wird erst nach dem Ablegen im Hintergrund gelesen). Ein Volltext-Kriterium greift beim Ablegen daher ins Leere.

**Wann:** Wenn ein Agent oder Hintergrundprozess Dokumente nachträglich klassifiziert und vorschlägt (der Zielzustand aus § 2 der Dokument-Spec), als eigener Vorgang mit eigener Spec.
