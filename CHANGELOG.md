# Änderungen

Alle nennenswerten Änderungen an Aluna Kompass, für die Menschen, die eine
Installation betreiben. Was sich unter der Haube ändert, steht im Git-Verlauf;
hier steht, was ein Verein davon merkt.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Nummern folgen [Semantic Versioning](https://semver.org/lang/de/). Vor
1.0.0 kann jede Minor-Fassung Brüche enthalten — was bricht, steht unter
**Geändert** mit dem, was zu tun ist.

## [Unveröffentlicht]

### Neu

- **Grundausstattung kommt beim Update von selbst.** Was ein Modul mitbringt —
  Rollenvorschläge, Kategorien, Dokumentarten —, legt Kompass bei jedem Start
  nach, falls es fehlt. Was Sie gelöscht, umbenannt oder einer Rolle entzogen
  haben, kommt dabei nie zurück.
- **Aufbewahrungsfrist 8 Jahre.** Für Buchungsbelege gibt es eine eigene Frist
  (Verwaltung → Aufbewahrung). Bestehende Dokumentarten ändern sich nicht.
- **Präfixe von Dokumentarten sind eindeutig** und lassen sich ändern, solange
  die Art noch kein Dokument hat (Verwaltung → Akte).
- **Ein Modul kann sein Ausschalten ablehnen**, sobald es festgeschriebene
  Vorgänge führt — ausgeschaltet würde es nichts mehr vor dem Löschen schützen.
- **Nutzerkonten lassen sich mit Kontakten verknüpfen** (Verwaltung → Nutzer).
  Der Verlauf bleibt erhalten; das eigene Konto verknüpft man einmal selbst,
  ändern kann es danach nur eine zweite Person.
- **Dokumentarten können geschützt werden.** Ein Schutzbereich zeigt die
  Dokumente einer Art nur Personen mit dem Recht dieses Bereichs — in Liste,
  Suche, Datei, Startseite und MCP. Bereiche bringt ein Modul mit (zuerst:
  Finanzen); bis dahin ändert sich nichts.
- **Ordner und Jahrgänge als Bündel.** Die Akte packt einen Ordner oder einen
  Jahrgang als ZIP: PDFs, Inhaltsverzeichnis als PDF und CSV mit Prüfsummen.
  Jede Datei wird dabei gegen ihre Prüfsumme geprüft.
- **Finanzen: Buchen von Hand.** Wer möchte, führt die Vereinskasse jetzt in
  Kompass: Geschäftsjahr, Bankkonten und Kassen mit Anfangsbestand, Kategorien
  und Steuerliches in einer Checkliste einrichten; Einnahmen, Ausgaben,
  Umbuchungen und Sachspenden buchen, auf mehrere Kategorien oder Zwecke
  aufteilen, Belege anhängen und festgeschriebene Buchungen korrigieren. Die
  Barkasse zählt sich zu zweit mit einem eigenen Zählprotokoll; Bankkonten
  und Kassen zeigen ihren Bestand, offene Zahlungen lassen sich anlegen und
  mit einem Klick begleichen. Die Startseite zeigt unter „Finanzen: zu tun“,
  was ansteht, und jedes Projekt bekommt einen eigenen Finanzabschnitt mit
  Zielbetrag, Einnahmen, Ausgaben und Ergebnis.
- **Finanzen: Kontoauszüge laden.** Unter „Hochgeladene Auszüge“ lässt sich
  der Kontoauszug eines Bankkontos oder Zahlungsdiensts als CAMT.053-Datei
  hochladen — auch mehrere auf einmal, jede mit eigenem Ergebnis (neu /
  bereits vorhanden / zurückgehalten). Ein bereits geladener Auszug wird
  erkannt und nicht doppelt übernommen; Zweifelsfälle werden als Kandidaten
  zurückgehalten und lassen sich mit „Dieselbe Zahlung“ oder „Eigene Zahlung“
  entscheiden. Fehlt zwischen zwei Auszügen etwas, meldet Kompass die Lücke,
  der Import gelingt trotzdem. Ein falsch geladener Auszug lässt sich mit
  Ansage und Pflichtnotiz wieder verwerfen; festgeschriebene Buchungen darauf
  sperren das Verwerfen. Jedes Bankkonto zeigt jetzt, bis wann es importiert
  ist und ob Buchbestand und Auszug zusammenpassen. Ein Agent darf Auszüge
  laden, nie festschreiben — das Handbuch erklärt, was das für den Einsatz
  eines Cloud- oder eines lokal betriebenen Sprachmodells bedeutet. Neue
  Abhängigkeit: `fast-xml-parser` (MIT). Diese Fassung bringt dafür eine
  Datenbank-Migration mit, die beim Start von selbst läuft.
- **Finanzen: Kontoauszüge als CSV.** Liefert eine Bank oder ein
  Zahlungsdienst kein CAMT, richtet ein Assistent einmal ein CSV-Format für
  das Konto ein: Er rät zuerst zu CAMT, schlägt Zeichensatz, Trennzeichen,
  Kopfzeile, Datums- und Zahlenformat vor, legt die Spaltenauswahl über eine
  Vorschau der Datei, fragt das Vorzeichen an einer echten Zeile und zeigt
  zum Schluss die erste Zeile als fertigen Kontoumsatz. Danach laden
  CSV-Auszüge wie CAMT — ganz oder gar nicht, mit demselben Schutz vor
  doppelten Zahlungen. Eine Gebührenspalte wird ein eigener Kontoumsatz; mit
  einer Kontostandspalte prüft Kompass, ob die Datei in sich stimmt. Ein Konto
  hat ein Auszugsformat; eine Datei mit anderer Kopfzeile wird nie still
  falsch gelesen, sondern führt zum Formatwechsel mit Bestätigung. Ohne neue
  Abhängigkeit; eine weitere Datenbank-Migration läuft beim Start von selbst.
- **Finanzen: Arbeitsliste.** Unter Finanzen → Arbeitsliste wird aus jedem
  geladenen Kontoumsatz eine Buchung. Kompass schlägt zu jedem Umsatz vor, wie
  er zu buchen ist, und sagt unter „Vorschlag, weil:“, warum: passt zu einer
  schon von Hand erfassten Buchung, Umbuchung zwischen eigenen Konten oder mit
  der Barkasse, zurückgegebene Zahlung, offene Zahlung, eine Regel des Vereins
  oder ein Kontakt, dem die IBAN gehört. Die Liste lässt sich ganz mit der
  Tastatur abarbeiten — Enter übernimmt den Vorschlag als geprüften Entwurf,
  E öffnet die volle Maske, Pfeiltasten wählen und überspringen. Reiter
  trennen sichere von unsicheren Vorschlägen, Entwürfe eines Agenten,
  geprüfte Entwürfe und überfällige offene Zahlungen.
  - **Regeln:** „Künftig immer so?“ macht aus einer Zuordnung eine Regel und
    zählt vorher, wie viele frühere Umsätze sie träfe und wie viele davon
    anders gebucht sind. Regeln wirken nur für künftige Umsätze.
  - **Geld, das dem Verein nicht gehört**, wird eigens gebucht und steht unter
    „Fremdes Geld“, bis es weitergegeben ist.
  - **Beleg von beiden Seiten:** ein PDF auf den Umsatz ziehen oder in der Akte
    nach einem passenden Beleg suchen — oder umgekehrt einen Finanzbeleg in
    der Akte mit „Zu Buchung machen“ buchen. „Belege ohne Buchung“ sammelt,
    was noch fehlt.
  - **Festschreiben gegen den Auszug:** Alle geprüften Entwürfe lassen sich
    auf einmal festschreiben; vorher zeigt Kompass je Konto den Buchbestand
    danach neben dem Endsaldo laut jüngstem Auszug.
  - **Ein Agent bereitet vor, ein Mensch prüft.** Ein KI-Agent kann über MCP
    Entwürfe zu Kontoumsätzen anlegen; sie stehen im Reiter „Vom Agenten
    vorbereitet“. Prüfen und Festschreiben bleiben einem Menschen am
    Bildschirm vorbehalten, solange der Verein es nicht unter Finanzen
    einrichten ausdrücklich erlaubt.

  Das Handbuch hat dafür die Seite „Arbeitsliste“. Eine weitere
  Datenbank-Migration läuft beim Start von selbst.
- **Finanzen: Rechnungen mit ZUGFeRD.** Trägt ein PDF-Beleg eine eingebettete
  ZUGFeRD- oder Factur-X-Rechnung, zeigt Kompass Lieferant, Nummer, Datum,
  Betrag, Umsatzsteuer, Fälligkeit und IBAN in der Karte „Aus der Rechnung“ —
  unter „Belege ohne Buchung“, in der Akte und nach dem Ablegen in der
  Arbeitsliste. Ist die Rechnung noch nicht bezahlt, wird daraus mit einem
  Klick eine offene Zahlung; ist sie schon vom Konto abgegangen, führt die
  Karte zum passenden Kontoumsatz, und der Entwurf bekommt Lieferant, Nummer,
  Kontakt und Steuer aus der Rechnung. Gelesen wird bei jedem Öffnen,
  gespeichert wird von der Rechnung nichts. Das Handbuch erklärt es auf der
  Seite „Arbeitsliste“.
- **Finanzen einrichten:** Wer nur „Finanzen einrichten“ darf, sieht jetzt
  auch die Konten (samt IBAN), Kategorien, Zwecke und Geschäftsjahre, die er
  pflegt. Sperren festgeschriebene Buchungen das Verwerfen eines Auszugs,
  führt der Dialog direkt zu jeder dieser Buchungen.
- **Neue Dokumentart „Zählprotokoll“** (Präfix `KZP`) hält das Ergebnis jeder
  Kassenzählung fest. Trägt eine eigene Dokumentart Ihres Vereins das Präfix
  `KZP` bereits, meldet der Start einen Fehler — benennen Sie das Präfix
  dieser Art vor dem Update um.
- **Sieben neue Theme-Tokens** für die Finanzoberfläche. Ein gespeichertes
  Theme, das sie noch nicht kennt — jede Installation vor diesem Update —,
  übernimmt beim Start automatisch die Vorgabewerte; eigene Anpassungen an
  den übrigen Tokens bleiben unangetastet.
- **Kontostand nachtragen.** Ein hochgeladener Auszug ohne Kontostand (CSV
  ohne Saldospalte) lässt sich jetzt in der Läufe-Tabelle einmalig um den
  Kontostand laut Bank ergänzen — die Kontenabstimmung nutzt ihn danach sofort.
- **Finanzen: Spenden und Zuwendungsbestätigungen.** Unter Finanzen → Spenden
  → Bescheide führt der Verein die Bescheide seines Finanzamts —
  vorläufige Anerkennung (§ 60a), Freistellungsbescheid, Anlage zum
  Körperschaftsteuerbescheid — mit taggenauer Gültigkeit; ein Bescheid wird nie
  gelöscht, sondern als aufgehoben oder ersetzt oder als irrtümlich erfasst
  gekennzeichnet, und sein PDF lässt sich nach dem Erfassen nachreichen. Aus
  einer festgeschriebenen Spende entsteht eine Zuwendungsbestätigung nach
  amtlichem Muster — für Geld und Mitgliedsbeiträge (auch Aufwandsspenden) und
  für Sachzuwendungen.
  Vor dem Ausstellen prüft eine Liste jede Voraussetzung und nennt, was fehlt,
  eine Vorschau zeigt das PDF; unser Exemplar liegt danach in der Akte
  (Präfix `ZWB`, zehn Jahre aufbewahrt). Sachspenden werden mit Gegenstand,
  Zustand, Wertermittlung, Herkunft und Wertunterlage beschrieben. Mit einem
  Unterzeichner, dem Bild seiner Unterschrift und der Anzeige beim Finanzamt
  entstehen Bestätigungen maschinell; sonst tragen sie ein Unterschriftsfeld,
  und die unterschriebene Fassung wird als Eingang abgelegt (`ZWU`). Eine
  falsche Bestätigung wird mit Rückholspur zurückgenommen; „Zu korrigieren“
  zeigt Bestätigungen, deren Bescheid ersetzt oder deren Spende geändert
  wurde, und die Startseite zählt sie. Ausstellen und zurücknehmen kann nur ein
  Mensch, kein Agent.
- **Finanzen: Serienlauf, Spendenbuch und vereinfachter Nachweis.** Unter
  Finanzen → Serienlauf stellt der Verein alle Zuwendungsbestätigungen eines
  Jahres in einem Lauf aus: je Spender eine Sammelbestätigung über Geld und
  Mitgliedsbeiträge, Aufwandsspenden gesondert (immer mit Unterschriftsfeld),
  Sachspenden einzeln — mit Vorschau in drei Gruppen (bereit, braucht
  Unterschrift, Anschrift fehlt), Fortschrittsanzeige und zwei Sammel-PDFs
  zum Drucken (maschinell erstellt / zum Unterschreiben). Ein Versandvermerk
  lässt sich für alle maschinellen Bestätigungen des Laufs auf einmal setzen,
  ein Nachzügler-Lauf holt nach, was noch fehlt; Ausstellen bleibt wie bisher
  einem Menschen vorbehalten. Unter Finanzen → Spendenbuch stehen alle
  Zuwendungen eines Jahres mit ihrer Bestätigung, dazu die Abstimmung
  „Zuwendungen ↔ Bestätigungen“ mit der Differenz nach Gründen (unter dem
  Mindestbetrag, Anschrift fehlt, Sachspende nicht beschrieben, Aufwandsspende
  nicht bestätigt, anonym, sonstige) und, wo eine Bestätigung nach einer
  Rückgabe zu viel bescheinigt, als „zu korrigieren“. Für Kleinspenden druckt
  das Spendenbuch den vereinfachten Nachweis als PDF-Formular.
- **Finanzen: Auslagen einreichen, freigeben, Verzicht.** Unter Finanzen →
  Eigene Anträge reicht eine Person ihre Auslage ein — auch am Telefon:
  Belege als PDF (mit einer Kurzanleitung, wie aus einem Foto eines wird)
  oder eine Fahrt nach Kilometersatz. Die Eingaben werden laufend am Server
  gesichert, Einreichen bleibt immer möglich — fehlt noch etwas, sagt
  Kompass, was zu tun ist, mit einem Sprung zum Feld. Eigene Anträge zeigen
  ihren Zustand in Alltagssprache; ein abgelehnter Antrag lässt sich mit
  „Neu einreichen“ als Entwurf kopieren. Unter Finanzen → Freigaben wartet
  die Warteschlange auf eine zweite Person — nie auf die anlegende Person
  oder deren eigenen Kontakt —, schlägt schwach eine Kategorie vor und zeigt
  nach der Freigabe die Überweisungsdaten mit Kopierknopf für die IBAN.
  Verzichtet jemand stattdessen auf die Erstattung (Aufwandsspende), muss das
  vorher vereinbart gewesen sein — durch einen Vertrag oder die Satzung, ein
  bloßer Vorstandsbeschluss reicht nicht (BMF-Schreiben vom 25. November
  2014); die Freigabe prüft vier Voraussetzungen (Anspruch vorab vereinbart,
  Frist eingehalten, der Verein hätte zahlen können, Verzichtserklärung
  liegt vor), erzeugt die Verzichtserklärung als Vordruck mit
  Unterschriftsfeld und bucht danach eine Aufwandsspende ohne Geldfluss —
  bestätigt wird sie wie jede andere Spende, nie maschinell. Unter
  Einstellungen → Finanzen kommt dafür die Anspruchsgrundlage für
  Aufwandsspenden dazu; der Schalter für Aufwandsspenden bleibt in der
  Vorgabe aus. 18 neue MCP-Werkzeuge, darunter Freigeben nur für einen
  Menschen. Das Handbuch hat dafür die Seite „Auslagen“. Diese Fassung
  bringt dafür eine Datenbank-Migration mit, die beim Start von selbst
  läuft.
- Diese Fassung bringt mehrere Datenbank-Migrationen mit, die beim Start von
  selbst laufen — vor dem Update wie immer ein Backup exportieren.

### Geändert

- **Verzichtsfristen für Aufwandsspenden richtiggestellt.** Ein Verzicht auf
  die Erstattung ist bei einer einmaligen Auslage binnen drei Monaten
  rechtzeitig, bei einer regelmäßigen Tätigkeit binnen zwölf Monaten (BMF-
  Schreiben vom 25. November 2014). Betrifft nur diese neue Fassung.
- **Touch-Maße für Formularfelder.** Auf einem Gerät mit Touch-Bedienung sind
  Eingabefelder, Auswahlfelder und Knöpfe der Finanzformulare jetzt 46 Pixel
  hoch mit größerer Schrift — leichter zu treffen auf dem Telefon.

- **Bibliotheken aktualisiert**, darunter React 19.3 und Next.js 16.3.5. Für
  den Betrieb ändert sich nichts.
- **Stammdaten bei eingeschalteten Finanzen.** Finanzamt, Steuernummer, Art
  und Datum des Bescheids werden dann unter Finanzen → Spenden → Bescheide
  geführt, IBAN, BIC und Bank am Hauptkonto unter Finanzen einrichten →
  Bankkonten und Kassen. In den Stammdaten stehen sie nur noch lesbar, mit dem
  Hinweis, wo sie geführt werden. Wer die Finanzen einschaltet, erfasst den
  geltenden Bescheid einmal dort.
- **Kontoauszug laden ohne Kontoauswahl.** Kompass erkennt das Konto eines
  hochgeladenen Auszugs selbst — an der IBAN bei CAMT.053, am Format bei CSV.
  Eine Rückfrage erscheint nur, wenn mehrere Konten infrage kommen, oder wenn
  sich keines finden lässt.
- **Zuwendungsbestätigung ausstellen: fester Kopf und feste Fußleiste.** Der
  Ausstellen-Dialog scrollt nur noch in der Prüfliste; Titel, Betrag und der
  Knopf „Ausstellen“ bleiben stehen. Die Prüfliste ist jetzt nach Zustand
  gruppiert — was fehlt, was Sie ansehen sollten, was erfüllt oder was nicht
  zutreffend ist — und eine fehlende Unterschrift steht als eigenes
  Kennzeichen in der Liste der Bestätigungen.
- **Geführte Felder in den Stammdaten** stehen jetzt als eigener Baustein da:
  Wert, Kennzeichen „geführt“ und der Link, wo Sie ihn ändern — kein leeres
  graues Eingabefeld mehr.
- **Unterschrift für das maschinelle Verfahren** lässt sich jetzt wie ein
  Beleg auf eine Ablagefläche ziehen, statt über ein einfaches Dateifeld.
- **Datumsanzeige in Finanzen vereinheitlicht.** Kontokarte, Sätze und
  Grenzen, offene Zahlungen und die Barkasse zeigen jetzt durchgängig das
  eingestellte Datumsformat statt eines rohen ISO-Datums.
- **Zuwendungsbestätigungen im Wortlaut der amtlichen Muster.** Der Hinweis
  zur Anerkennung spricht jetzt von der „Ausstellung des Bescheides“, die
  Sammelbestätigung vom Mitgliedsbeitrag im Singular, und der vereinfachte
  Nachweis nennt auch die tatsächliche Durchführung der Zahlung.
- **Steuerbefreiung ab am Bescheid; Sperre statt Begründung.** Jeder Bescheid
  trägt jetzt, ab wann er die Steuerbefreiung ausspricht. Für Zuwendungen
  davor stellt Kompass keine Bestätigung mehr aus — auch nicht im Serienlauf,
  wo sie als blockiert erscheinen; die frühere Begründung „vor dem ältesten
  Bescheid“ entfällt. Das Update ergänzt die Datenbank (Migration 0025);
  bereits erfasste Bescheide bekommen ihr Bescheiddatum als Beginn — prüfen
  Sie unter Finanzen → Spenden → Bescheide, ob das stimmt.

### Behoben

- **Die Vorschau der Webseite öffnet in einem eigenen Tab.** Bisher öffnete
  „Vorschau öffnen“ unter Webseite → Publizieren im selben Tab, und wer
  zurückging, fand Prüfergebnis und gebaute Vorschau leer vor und musste beides
  neu anstoßen. Die Vorschauseite hat außerdem einen Weg zurück zu Publizieren.
- **Finanzen einrichten: Kategorie ändern.** Eine bestehende Kategorie ließ
  sich im Dialog „Ändern“ weder speichern noch stilllegen; beides geht jetzt.
- **Journal: „Geprüfte festschreiben“** scheiterte, statt alle geprüften
  Entwürfe festzuschreiben. Jetzt nimmt der Knopf alle, auch bei mehr als 200
  Entwürfen.
- **Kontoauszüge ohne Referenz der Bank.** Manche Banken schreiben statt einer
  Referenz den Platzhalter „NOTPROVIDED“ in den CAMT-Auszug. Kompass führte
  ihn als echte Referenz und hielt dadurch verschiedene Zahlungen für
  dieselbe; jetzt zählt er als „keine Referenz“.

## [0.1.1] - 2026-09-19

Fehlerbehebungen aus den ersten Tagen im Betrieb, dazu drei kleine Funktionen:
Eingegangene Post lässt sich umklassifizieren, die Sperrwörter der Webseite
sind pflegbar, und Medien lassen sich über MCP herunterladen. Diese Fassung
bringt eine Datenbank-Migration mit, die beim Start von selbst läuft — vor
dem Update wie immer ein Backup exportieren.

### Neu

- **Medien lassen sich über MCP herunterladen.** Das Werkzeug `media_get`
  liefert eine Datei aus der Mediathek samt ihren Angaben, mit denselben
  Rechten wie die Oberfläche. Damit lassen sich etwa Bilder zwischen zwei
  Installationen übertragen, ohne den Umweg über den Browser.
- **Sperrwörter der Webseite lassen sich pflegen.** Unter Webseite →
  Publizieren steht die Liste der Begriffe, die nie auf der Seite erscheinen
  dürfen; ein Treffer sperrt den Publish. Bisher gab es die Prüfung, aber
  keinen Ort, die Begriffe einzutragen. Pflegen darf sie, wer publizieren
  darf; über MCP geht dasselbe.
- **Eingegangene Post lässt sich umklassifizieren.** Unter „Angaben ändern“
  auf der Detailseite bekommen Art, Betreff und Datum eines abgelegten Eingangs
  neue Werte. Eine andere Art bringt eine neue Nummer aus ihrem Präfix; die
  bisherige bleibt als „Früher: …“ am Dokument und wird von der Suche
  gefunden. Der Dialog zeigt vorher, wie sich Nummer und Aufbewahrung ändern.
  Ausgehende Dokumente bleiben unveränderlich.

  Diese Fassung bringt dafür eine Datenbank-Migration mit, die beim Start von
  selbst läuft.
- **Das Nutzermenü nennt die Fassung.** Statt „Build 46535d6“ steht dort
  „Version 0.1.1 (46535d6)“.

### Behoben

- **Die Datenbank wird beim Beenden geschlossen.** Bisher blieb beim Stoppen
  des Containers alles seit dem letzten Abgleich nur in der Nebendatei
  `kompass.db-wal` stehen, die Hauptdatei `kompass.db` war unter Umständen
  fast leer. Solange beide Dateien zusammen gesichert wurden — wie beim
  Backup-Export oder einem Snapshot des ganzen Datenverzeichnisses — ging
  nichts verloren; wer nur `kompass.db` kopierte, hatte einen alten Stand. Ab
  jetzt steht nach jedem Stopp alles in `kompass.db`. Einmal neu starten
  genügt, um eine bestehende Installation aufzuräumen.
- **Safari: Beim Ziehen von Dateien in die Akte stand „0 Dateien ablegen“.**
  Safari verrät erst beim Loslassen, wie viele Dateien es sind. Die Anzeige
  sagt dort jetzt einfach „Dateien ablegen“; abgelegt wurde auch vorher schon
  richtig.
- **Eine offene Maske überschreibt keine Änderung mehr, die inzwischen
  woanders gespeichert wurde.** Wer ein Tier, ein Projekt, einen Eintrag der
  Webseite oder die Variablen der Webseite bearbeitet, während jemand anders —
  in einem zweiten Fenster oder über MCP, etwa beim Übersetzen — denselben
  Datensatz speichert, bekam bisher dessen Änderung still zurückgedreht. Jetzt
  wird das Speichern abgewiesen, mit dem Hinweis, die Seite neu zu laden.
  MCP-Werkzeuge können dasselbe über `expectedVersion` nutzen.
- **Masken behalten ihre Eingaben, wenn das Speichern scheitert.** Bisher
  sprangen bei einem abgelehnten Speichern — etwa einem schon vergebenen Slug —
  alle einfachen Felder auf den Stand beim Öffnen zurück, darunter Name und
  Angaben bei Tieren, Projekten und Kontakten, Wiedervorlagen, Versandvermerke
  und die Masken der Verwaltung. Jetzt bleibt stehen, was getippt wurde.
- **KI-Assistenten können Tiere, Projekte und Webseiten-Einträge wieder über
  MCP anlegen und ändern.** Die Beschreibung dieser Werkzeuge verletzte den
  JSON-Schema-Standard, sobald ein Feld mehrsprachig war; strenge Clients wie
  Claude Code blendeten sie deshalb ganz aus. Lesen, Veröffentlichen und
  Löschen waren nicht betroffen.
- **Ändern über MCP löscht keine Felder mehr, die der Aufruf nicht nennt.**
  Ein Update eines Webseiten-Eintrags ohne das Bild- oder Dateifeld setzte
  dieses auf leer, und eine Erfolgsgeschichte ohne Bildunterschriften verlor
  beide. Jetzt bleibt stehen, was ein Aufruf nicht erwähnt. Wer Einträge über
  MCP geändert hat, sollte Bilder und Downloads einmal prüfen.
- **Notizen deaktivierter Nutzer zeigen wieder den Namen.** In der Akte stand
  bei einer Notiz oder Wiedervorlage einer inzwischen deaktivierten Person
  deren interne Kennung statt ihres Namens.

## [0.1.0] - 2026-09-18

Die erste Fassung. Ein Verein kann damit seine Post führen, seine Kontakte
pflegen und seine Webseite betreiben — Finanzen und Mitgliederverwaltung
kommen in späteren Fassungen (siehe `docs/nordstern.md`).

### Startseite

- **Was ansteht, in Kacheln.** Die Startseite zeigt Post im Eingangskorb,
  Entwürfe, unversandte Briefe, fällige Wiedervorlagen, den Stand der
  Webseite, Löschfälligkeit und, für die Verwaltung, was an der Einrichtung
  noch fehlt. Jede Kachel führt dorthin, wo die Arbeit liegt.
- **Jeder stellt sie sich selbst zusammen.** „Anpassen" schaltet Kacheln ein
  und aus, ordnet sie und stellt ihre Optionen ein — etwa den Zeitraum bei
  „Fällig". Die Auswahl gilt auf jedem Gerät und lässt sich auf die Vorgabe
  zurücksetzen. Auch über MCP: `dashboard_read` sagt einem Agenten, was
  ansteht.
- **Die Einrichtungs-Checkliste verschwindet, wenn sie fertig ist.** Statt
  drei Fortschrittsbalken nennt die Kachel „Einrichtung" nur noch, was fehlt.
- **Backup-Frist als Einstellung.** Unter Verwaltung → Backup steht, ab wie
  vielen Tagen ein Backup als veraltet gilt (Vorgabe 30). Die Startseite
  warnt danach.

### Fundament

- **Nutzer, Rollen und Rechte.** Rollen sind frei benennbar, Rechte fest je
  Modul. Jede Rechteprüfung läuft serverseitig. Niemand vergibt Rechte, die er
  selbst nicht hat, und niemand verwaltet ein Konto mit mehr Rechten als den
  eigenen — wer nur die Zugänge macht, kann sich nicht zum Administrator machen.
- **Anmeldung** mit Argon2id, Sperre nach fünf Fehlversuchen, Startpasswort,
  das beim ersten Anmelden gewechselt werden muss. Die Meldung verrät nicht,
  ob es ein Konto gibt; nach zwanzig Fehlversuchen in fünfzehn Minuten über
  alle Konten pausiert die Anmeldung. Jeder Fehlversuch steht im Protokoll.
- **Änderungsprotokoll.** Jede schreibende Aktion hinterlässt einen Eintrag mit
  Nutzer, Zeit, Kanal und Vorher/Nachher. Auf Datenbankebene gegen Ändern und
  Löschen gesperrt.
- **Einstellungen statt Konstanten.** Vereinsstamm, Steuerdaten, Branding,
  Farben und Regeln stehen in der Datenbank, nicht im Code.
- **Themes** mit Kontrastprüfung, umschaltbar, eigene Themes duplizierbar.
- **Backup und Wiederherstellung** über die Oberfläche, mit Sicherungskopie vor
  jedem Einspielen.
- **Mediathek** mit Ordnern, Verwendungsnachweis und Löschsperre für Dateien,
  die noch irgendwo hängen.
- **Dokument-Pipeline** auf Typst, mit mitgelieferten Basis-Vorlagen.
- **MCP-Server**: Dieselben Dienste wie die Oberfläche, für KI-Assistenten,
  mit den Rechten des Nutzers, dem das Token gehört, und im Protokoll als
  eigener Kanal gekennzeichnet. Vier Dinge bewusst nicht: Backup ein- und
  ausspielen, Dateien abrufen, API-Token verwalten, das eigene Passwort
  ändern.
- **Module** lassen sich je Installation ein- und ausschalten.
- **Aufbewahrung.** Personenbezogene Daten werden nach Ablauf der Frist zur
  Löschung fällig; ein Mensch bestätigt jede Löschung. Fristen werden
  berechnet, nie gespeichert.

### Korrespondenz und Akte

- **Kontakte** mit Rollen über die Zeit und berechneter Aufbewahrungsfrist.
- **Ausgehende Post**: Entwurf, Vorschau, Festschreiben mit Nummer und
  Prüfsumme, Versandvermerk, Storno mit Ersatz statt Löschen.
- Die **Prüfsumme wird vor jeder Ausgabe nachgerechnet**. Passt die Datei im
  Speicher nicht mehr dazu, zeigt Kompass sie nicht an und gibt sie nicht
  heraus, sondern meldet den Befund — auf der Seite und im Änderungsprotokoll.
- **Eingehende Post**: Eingangskorb, Einsortierhilfe mit Regeln, Ordnerbaum.
- **Bezüge** zwischen Dokumenten: Antwort auf, unterschriebene Fassung von,
  ersetzt.
- **Wiedervorlagen** am Dokument, mit Fälligkeitsliste auf der Startseite.
- **Interne Notizen** am Dokument und **Textbausteine** für Briefe.
- **Volltextsuche** über alle abgelegten PDFs, mit Texterkennung für Scans.

### Webseite

- Die Webseite entsteht aus einem **Template, das der Verein mitbringt**, und
  aus Inhalten, die in Kompass gepflegt werden.
- **Mehrsprachige Inhalte**, Sprachen je Installation einstellbar.
- Mitgeliefert ist ein **Beispiel-Template** („Verein Basis“), zweisprachig und
  zum Abwandeln gedacht. Es nimmt Anschrift, Kontakt, Bankverbindung und
  Registereintrag aus den Vereinsdaten in Kompass — auch im Impressum, das
  daraus entsteht. Nur der Vorstand steht im Template: Ämter führt Kompass
  nicht. Wer einsprachig bleiben will, streicht die zweite Sprache in
  `kompass.template.ts`.
- **Vorschau** vor dem Publizieren, mit Unterschieden zum veröffentlichten
  Stand und einer Prüfung auf gesperrte Begriffe.
- **Publizieren** als statische Seite zum Hoster. Im Internet liegen weder
  Datenbank noch Login.

### Module

- **Tiere**: Profile mit Fotos, Status und Vermittlungsgeschichte, für die
  Webseite.
- **Projekte**: öffentliche Projektseiten mit Verweisen nach außen.
- Tierprofile und Projekte lassen sich löschen, solange kein Dokument und keine
  offene Wiedervorlage daran hängt. Alles mit Veröffentlicht-Schalter wird in
  zwei Stufen gelöscht: erst zurückziehen, dann löschen — das gilt jetzt auch
  für Sammlungseinträge der Webseite. Fotos, die nur der gelöschte Datensatz
  verwendet hat, gehen auf Wunsch mit.

### Betrieb

- **Ein Image** für Entwicklung, Test und Produktion, rund 1,6 GB. Es trägt
  nur, was zur Laufzeit gebraucht wird — keine Test- und Bauwerkzeuge.
- **Zwei Migrationen zum Start** (`0000_init`, `0001_dashboard_layouts`);
  beide laufen beim ersten Start. Eine Installation der Vorlaufzeit wird
  nicht migriert, sie wird neu aufgesetzt.
- **Die Aufstellung der Software Dritter liegt im Image** unter
  `/app/THIRD-PARTY-NOTICES.md`, mit Version und Lizenz jedes Pakets, erzeugt
  beim Bau. Den Überblick samt Quellcode-Angebot gibt
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- **Migrationen** laufen beim Start; schlägt eine fehl, startet die Anwendung
  nicht mit halb migrierten Daten. Die Datenbank beginnt mit **einer**
  Migration; jede spätere Fassung bringt höchstens eine weitere mit.
  Installationen aus der Zeit vor 0.1.0 werden nicht migriert, sondern neu
  befüllt.
- **Handbuch** in der Anwendung, über das `?` in der Kopfzeile.
- **Health-Endpunkt** unter `/api/health` mit Fassung, Build und
  Migrationsstand.

### Sicherheit

- Sicherheitskopfzeilen (CSP mit `frame-ancestors`, `X-Frame-Options`,
  `nosniff`, `Referrer-Policy`).
- Das Sitzungscookie wird `secure`, sobald ein Proxy TLS meldet.
- Hochgeladene Dateien werden am Inhalt geprüft, nicht an der Endung, und in
  einer Sandbox ausgeliefert.
- Meldeweg für Schwachstellen: siehe [`SECURITY.md`](SECURITY.md).

[Unveröffentlicht]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DigiJoe79/Aluna-Kompass/releases/tag/v0.1.0
