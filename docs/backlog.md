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

## 6. Das Template-Paket exportiert keinen Vertragstyp

**Was:** `@kompass/site-template` liefert `defineTemplate` und die Feldtypen,
aber keinen exportierten Typ für den Vertrag, den ein Template erfüllt. Ein
Vereinsrepo, das sein Template gegen den Vertrag prüfen will, kann ihn nicht
benennen.

**Warum:** Gefunden beim lokalen Vorflug des Cutovers am 2026-09-12 gegen
Alunas Template. Bis dahin lief kein Template außerhalb dieses Repos gegen
das Paket.

**Wann:** Mit Schritt 2 des Nordsterns, sobald Alunas Template aus dem
Testcontainer publiziert; dann zeigt sich, welche Form der Typ braucht.

## 7. Das Basis-Template ignoriert die Vereinsstammdaten

**Was:** `templates/verein-basis` liest keine Werte aus `organization.*`.
Name, Anschrift, Register- und Bankdaten, die der Verein unter Verwaltung →
Einstellungen pflegt, kommen auf der mitgelieferten Seite nicht an; das
Impressum bleibt Sache der Template-Variablen.

**Warum:** Prinzip 2 und die veröffentlichte Sicht `publishedOrganization`
sind genau dafür da. Alunas eigenes Template nutzt sie; das Basis-Template,
das ein neuer Verein als Vorlage bekommt, zeigt es ihm nicht vor. Gefunden
beim Vorflug am 2026-09-12.

**Wann:** Mit Schritt 2, als Vorlagecharakter des Basis-Templates — ein
neuer Verein soll sehen, dass die Stammdaten aus Kompass kommen.

## 8. Seed-Inhalt widerspricht der Seite (Vereinsrepo)

**Was:** Der Seed-Text der Seite „Helfen" in Alunas Template bewirbt einen
Newsletter; die Startseite sagt „ohne Newsletter", und der Nordstern
schließt Newsletter aus.

**Warum:** Inhalt, kein Code, und im Vereinsrepo, nicht hier. Steht trotzdem
hier, weil der Widerspruch vor dem ersten Publish aus Test aufgelöst sein
sollte und sonst niemand ihn sieht.

**Wann:** Vor dem Publish aus Test (Cutover-Plan, Schritt 4). Redaktion, nicht
Entwicklung.
