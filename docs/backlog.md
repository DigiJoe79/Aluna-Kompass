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

## 5. Einsortierregeln auf dem Volltext

**Was:** `document_rules.matchField = 'fulltext'` als weiteres Kriterium für Einsortierregeln.

**Warum:** Die Regeln belegen das Ablegen-Formular vor, und zu dem Zeitpunkt ist die Texterkennung noch nicht durch (das Dokument wird erst nach dem Ablegen im Hintergrund gelesen). Ein Volltext-Kriterium greift beim Ablegen daher ins Leere.

**Wann:** Wenn ein Agent oder Hintergrundprozess Dokumente nachträglich klassifiziert und vorschlägt (der Zielzustand aus § 2 der Dokument-Spec), als eigener Vorgang mit eigener Spec.

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

## 9. Fotos auf der Hundeseite vergrößern (Vereinsrepo)

**Was:** Hauptfoto und Miniaturbilder verlinken auf die größte Bildvariante;
ein Inline-Skript öffnet sie in einem nativen `<dialog>` mit Blättern, Escape
und Klick daneben. Ohne JavaScript öffnet der Link das Bild selbst. Keine
Bibliothek, keine Fremdaufrufe. Dazu ein Browsertest und ein Fixture-Hund mit
zwei Fotos.

**Warum:** Hunde mit mehreren Fotos zeigen die weiteren nur als Miniaturen,
die sich nicht öffnen lassen (2026-09-13).

**Wann:** Entscheidung offen — Joe und Nicole entscheiden, ob und wie.

## 12. Template-Upload als Archiv über die Oberfläche

**Was:** Unter Webseite → Template ein Archiv hochladen, das Kompass in das
Template-Verzeichnis entpackt, Punktdateien inklusive, Besitzer `node`.

**Warum:** Handkopien über Freigaben verlieren Punktdateien und setzen falsche
Besitzer — so fehlte am 2026-09-13 die `.htaccess` auf dem Server. Das
Sync-Skript im Vereinsrepo deckt das für Entwickler ab, nicht für den Verein.

**Wann:** Wenn jemand außer Joe Templates einspielen soll.

## 13. Kachel „Hunde vermittelt“ aus den Daten (Vereinsrepo)

**Was:** In der Vertrauensleiste die Zahl der vermittelten Hunde aus
`views.animals` zählen, statt einer festen Zahl.

**Warum:** Die Weiterleitungsquote ist am 2026-09-13 als Versprechen
gestrichen worden. Eine gezählte Zahl verspricht nichts und wächst von selbst.

**Wann:** Sobald die Zahl zweistellig ist; heute stünde dort 2.

## 18. Vereinfachter Zuwendungsnachweis als Download (Vereinsrepo)

**Was:** Ein PDF in der Sammlung „Formulare“, das der Spender zum Kontoauszug
legt: Angaben zur Steuerbegünstigung, Verwendungszweck, Hinweis auf den
Freistellungs- oder § 60a-Bescheid. Die FAQ-Antwort zur Spendenbescheinigung
verlinkt es.

**Warum:** Die FAQ verweist seit 2026-09-13 bis 300 € auf den vereinfachten
Nachweis nach § 50 Abs. 4 EStDV. Der verlangt neben dem Kontoauszug einen vom
Verein erstellten Beleg. Ohne PDF muss der Spender fragen.

**Wann:** Jetzt möglich — der Bescheid nach § 60a AO liegt vor (Joe,
2026-09-13). Vor dem Go-live, damit die FAQ-Antwort auf etwas zeigt.

## 20. Maske und MCP überschreiben sich bei mehrsprachigen Feldern

**Was:** Ein Speichern aus der Maske ersetzt jedes mehrsprachige Feld
vollständig, mit allen Sprachen, so wie sie beim Laden des Formulars standen.
Kommt dazwischen eine Änderung über MCP (etwa `translations_set`, das nur eine
Sprache schreibt), geht sie beim nächsten Speichern der Maske verloren. Zwei
Abhilfen, eine reicht: Die Maske sendet nur Sprachen, die sich gegenüber dem
geladenen Stand geändert haben, und der Dienst mischt je Sprache — oder ein
Versionsstempel am Datensatz weist ein Speichern ab, dessen Ladestand veraltet
ist, mit Hinweis statt stillem Überschreiben.

**Warum:** Am 2026-09-13 um 18:01 UTC schrieb ein Agent die englischen Texte
von Akiko über MCP; um 18:03 speicherte Nicole die Maske, die sie vorher
geöffnet hatte, und alle sechs englischen Felder waren wieder leer. Das
Änderungsprotokoll zeigt es vollständig (vorher gefüllt, nachher leer), aber
niemand hat es bemerkt, bis die Lückenliste erneut sechs Einträge zeigte. Mit
Agenten als zweitem Kanal wird das der Normalfall, nicht die Ausnahme.

**Wann:** Vor dem ersten Übersetzungslauf gegen Prod, spätestens sobald
Inhalte parallel in Maske und über MCP gepflegt werden.

## 21. Alt-Text am Medium

**Was:** Ein optionales Feld `alt` (mehrsprachig) am Medien-Datensatz, gepflegt
im Detail-Dialog der Mediathek und über `media_*`-Werkzeuge. Der Website-Export
gibt es in `assets[]` mit, das Template setzt es statt `alt=""`.

**Warum:** Das Basis-Template markiert heute jedes Bild als dekorativ. Für eine
barrierefreie Webseite braucht jedes inhaltliche Bild eine Beschreibung, und
sie gehört ans Medium, nicht an jede Verwendung. Das Feld ändert den
Template-Vertrag (`content.json`), deshalb nicht nebenbei (Durchsicht
2026-09-13).

**Wann:** Mit dem nächsten Schritt am Template-Vertrag, oder sobald die
Webseite barrierefrei sein soll.

## 22. Referenzabfrage der Mediathek in einer Sammelabfrage

**Was:** `listMediaAssets` fragt heute je Asset jedes aktive Modul über
`mediaReferences(deps, assetId)`. Der Haken des Website-Moduls liest dafür
jedes Mal alle Sammlungseinträge und den Template-Stand. Ein zweiter,
optionaler Haken `mediaReferencesAll(deps)` liefert alle Fundstellen eines
Moduls auf einmal; `listMediaAssets` nutzt ihn, wo er da ist, und fällt sonst
auf die Einzelabfrage zurück.

**Warum:** Aufwand wächst mit Assets mal Einträgen. Bei Dutzenden Assets
unmerklich, bei Hunderten spürbar (Durchsicht 2026-09-13). Kein Verhalten
ändert sich, deshalb erst, wenn es messbar ist.

**Wann:** Sobald die Mediathek-Seite spürbar langsam wird, oder mit dem
Auswahl-Dialog in den Formularen, der dieselbe Liste lädt.

## 23. Sperrwörter der Webseite pflegbar machen

**Was:** Ein Feld für die Einstellung `site.blockedTerms` — die Begriffe, die
nie auf der Webseite erscheinen dürfen und deren Treffer den Publish sperren.
Naheliegend als eigener Reiter oder Block unter Webseite → Publizieren, wo
die Treffer angezeigt werden; dazu das MCP-Werkzeug, das die Liste liest und
setzt (Prinzip 8, ein Weg zu den Daten).

**Warum:** Die Einstellung existiert (`packages/modules/site/src/settings.ts`,
Vorgabe leer) und die Prüfung liest sie — aber weder die Oberfläche noch ein
MCP-Werkzeug kann sie schreiben. Aufgefallen beim Schreiben des Handbuchs am
2026-09-14: `webseite/publizieren.md` beschreibt die Prüfung, kann aber nicht
sagen, wo man die Wörter einträgt.

**Wann:** Vor dem ersten Publish aus Prod, wenn Aluna einen alten
Vereinsnamen oder Platzhalter sperren will — sonst mit dem nächsten
Site-Vorhaben. Bis dahin steht die Liste leer und die Prüfung meldet nichts.
