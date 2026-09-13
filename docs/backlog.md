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

## 17. Startseiten-Hund am Tier markieren statt per Slug-Variable

**Was:** Ein Kennzeichen am Tier, „auf der Startseite zeigen“, gesetzt mit
einem Knopf in der Tiermaske — wie „Hauptfoto“ bei den Fotos. Genau eines je
Gruppe: ein suchender Hund, ein vermittelter Hund mit Geschichte; wer markiert,
löst die vorherige Markierung der Gruppe. Kommt als Feld in die veröffentlichte
Sicht. Das Template liest es und lässt die beiden Variablen „Hund auf der
Startseite“ und „Geschichte auf der Startseite“ fallen; ohne Markierung gilt
weiter die Automatik. Betrifft Schema und Migration, Dienst und MCP-Werkzeug,
Maske, Sicht, Seed und Tests, dazu Template und Deklaration.

**Warum:** Heute tippt jemand einen Slug in eine Variable; ein Tippfehler oder
ein inzwischen vermittelter Hund lässt den Abschnitt still verschwinden. Am
Tier selbst ist die Wahl sichtbar und kann nicht ins Leere zeigen (Joe,
2026-09-13).

**Auch für Projekte:** Dieselbe Markierung an Projekten, dort für zwei
Plätze auf der Startseite statt einem. Heute zeigt das Template die ersten
zwei nach Sortierung; wer teasern will, muss die Reihenfolge der ganzen Liste
umbauen (Joe, 2026-09-13).

**Vorher zu klären:** Ob „auf der Startseite zeigen“ eine feste Funktion
von Kompass ist — ein Kennzeichen am Datensatz, das jedes Template lesen
kann — oder etwas, das ein Template deklariert, weil erst das Template weiß,
wie viele Plätze es hat und für welche Sammlungen und Sichten. Die zweite
Lesart würde die Deklaration um eine Art „Teaser-Plätze je Sicht“ erweitern
und Kompass die Maske dafür bauen lassen; die erste ist einfacher, aber die
Zahl der Plätze stünde dann im Kern.

**Wann:** Nach der Inhaltssitzung, zusammen mit Punkt 16 — beides sind
Felder an der Tiergeschichte und der Tiermaske.

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
