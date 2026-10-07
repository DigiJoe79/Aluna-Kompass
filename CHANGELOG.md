# Änderungen

Alle nennenswerten Änderungen an Aluna Kompass, für die Menschen, die eine
Installation betreiben. Was sich unter der Haube ändert, steht im Git-Verlauf;
hier steht, was ein Verein davon merkt.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Nummern folgen [Semantic Versioning](https://semver.org/lang/de/). Vor
1.0.0 kann jede Minor-Fassung Brüche enthalten — was bricht, steht unter
**Geändert** mit dem, was zu tun ist.

## [0.2.8] - 2026-10-07

Eine Wartungsfassung mit Sicherheitsupdates: Abhängigkeiten mit bekannten
Lücken sind aktualisiert, Dialoge sehen überall gleich aus, und ein Datum
erscheint überall im eingestellten Format und am Tag des Vereins. Keine
Migration (`migrationCount` bleibt 6), nach dem Update ist nichts zu tun.

### Sicherheit

- Abhängigkeiten mit bekannten Lücken aktualisiert, darunter `proxy-addr`
  (Vertrauen in Weiterleitungen), `sharp` (Bildverarbeitung) und das
  MCP-SDK.

### Geändert

- **Einheitliche Dialoge.** Dialoge und Seitenfenster tragen ihren Titel überall
  gleich. Der Satz, was eine Aktion bewirkt — Löschen, Überschreiben,
  Veröffentlichen —, steht gut lesbar; ergänzende Erläuterungen treten zurück.
- **Ein Datum, ein Format.** Listen, Hinweise und Meldungen folgen der
  Einstellung „Datumsformat“, auch Meldungen wie „gehalten bis …“.
  Schriftstücke — Briefe, Zuwendungsbestätigungen, Betreffe in der Akte —
  tragen weiterhin immer TT.MM.JJJJ.

### Behoben

- Zwischen Mitternacht und ein bzw. zwei Uhr zeigte Kompass an mehreren
  Stellen noch den Vortag: im Datum eines Briefs aus einem Entwurf, bei
  „Zuletzt bestätigt“, im Verlauf einer Buchung (dort mit UTC-Uhrzeit) und als
  „heute“ auf einigen Finanzseiten.
- Auf dem Telefon liefen Hilfe, Medienwahl, Dokumentvorlagen und die
  Dokumente einer Kontaktseite seitlich aus dem Bild; beim Backup lag das
  Datum des letzten Exports über seiner Bezeichnung.

## [0.2.7] - 2026-10-06

Eine Wartungsfassung: Kompass nennt Dokumente in der Akte lesbar, die freie
Rücklage zeigt im Frühjahr das richtige Jahr, und die Oberfläche passt besser
auf das Telefon. Keine Migration (`migrationCount` bleibt 6), nach dem Update
ist nichts zu tun. Wer über die KI-Schnittstelle (MCP) Geld der freien
Rücklage zuführt, muss das Jahr angeben, solange das Vorjahr noch nicht
abgeschlossen ist.

### Geändert

- **Lesbare Betreffe.** Beschlüsse zu zurückgelegtem Geld und zu Umwidmungen,
  Belege zu Auslagen und Zuwendungsbestätigungen tragen in der Akte den Namen
  der Rücklage, die Zwecke oder ein deutsches Datum statt einer internen
  Kennung oder „2026-04-15“. Bereits abgelegte Dokumente behalten ihren Betreff.
- **Freie Rücklage zu Jahresbeginn.** Bis das Vorjahr abgeschlossen ist, zeigt
  „Zurückgelegtes Geld“ dessen Höchstbetrag als „vorläufig“ neben dem laufenden
  Jahr, und das Formular schlägt das Vorjahr vor. Bisher stand im Frühjahr ein
  Höchstbetrag von 0 € da und jede Rücklage als „überschritten“.

### Behoben

- Ein abgelehnter Vorgang an zurückgelegtem Geld oder eine abgelehnte
  Umwidmung ließ das hochgeladene Protokoll trotzdem in der Akte liegen.
- Auf dem Telefon liefen Startseite, Kopfzeile, Seitenköpfe und Kontaktwege
  seitlich aus dem Bild; Zuwendungsbestätigungen, Bescheide und das
  Änderungsprotokoll waren in einem üblichen Laptopfenster rechts abgeschnitten.

## [0.2.6] - 2026-10-06

Die Oberfläche wird einheitlicher: Einstellungen mit Unterbereichen haben überall
dieselben Reiter, Listen denselben Kopf und öffnen mit einem Klick in die Zeile,
Mehrfachauswahl hat dieselbe Leiste und Knöpfe dieselben Farben. Speichern
sieht überall gleich aus und ist nie ausgegraut; wenn Kompass etwas ablehnt,
steht der Grund dort, wo Sie gehandelt haben, mit Auswegen — auch wenn zwei
Menschen denselben Eintrag bearbeiten. Neue Tiere, Projekte, Partner und
Webseiten-Einträge legen Sie auf einer eigenen Seite an, Löschen und
Archivieren steht als letzter Abschnitt der Seite. Jede Seite hat eine feste
Breite, Formulare ordnen ihre Felder in einem Raster, und Dialoge passen auf das
Telefon. Neu sind Tierprofile als
PDF, eine Seite je Tier, einzeln oder als Mappe aus der gefilterten Liste.
Keine Migration (`migrationCount` bleibt 6). Nach dem Update unter
Verwaltung → Tiere die Adresse des Online-Profils eintragen; ohne sie tragen
die PDF-Profile keinen QR-Code und unter dem Tiernamen steht keine Adresse.
Rollen, die Profile drucken sollen, brauchen „Dokumente erzeugen“. Was
auffällt: Die Zeilenhöhe der Listen folgt der Dichte-Einstellung im Profil, auf
dem Telefon stehen die Knöpfe unter Formularen untereinander, und die Reiter
der Einstellungen stehen in der Adresse. Alte Lesezeichen auf einen Bereich
führen weiter an die richtige Stelle. Die neue Handbuchseite „Speichern und
Meldungen“ erklärt das Zusammenspiel.

### Hinzugefügt

- Projekte: Liste nach Name und Art sortierbar; die eigene Reihenfolge für die
  Webseite bleibt die Vorgabe.
- **Tierprofile als PDF.** In der Hundeliste lassen sich Hunde ankreuzen, auch
  alle der gefilterten Liste auf einmal; „Als PDF“ lädt eine Mappe mit einer
  Seite je Hund. Im Profil eines Hundes gibt es dasselbe für ihn allein. Die
  Seite zeigt Hauptfoto, drei weitere Fotos, die Angaben, Kurz- und Langtext;
  ein langer Text wird kleiner gesetzt und notfalls gekürzt, mit QR-Code zum
  Online-Profil. Dafür braucht es das Recht „Dokumente erzeugen“ und unter
  Verwaltung → Tiere die neue Adresse des Online-Profils.

- **Feste Adressen für Tiere.** Den URL-Teil eines Tierprofils bildet Kompass jetzt beim Anlegen selbst (Name und kurze Kennung, etwa `luna-7k3f`); er lässt sich danach nicht mehr ändern, auch nicht über MCP. Zwei Hunde dürfen gleich heißen, und eine Adresse wird nie an einen anderen Hund vergeben. Wer über MCP Tiere anlegt, schickt keinen `slug` mehr mit.

### Geändert

- **Adresse unter dem Hundenamen** kommt jetzt aus der Einstellung „Adresse des
  Online-Profils“ statt aus einem festen Pfad; ohne Einstellung bleibt die Zeile
  leer.
- **Einheitliche Oberfläche.** Reiter, Listen, Marken, Knöpfe und
  Mehrfachauswahl sehen überall gleich aus und nutzen die Farben des Themes,
  auch im Dunkelmodus. Ein Klick in eine Listenzeile öffnet den Eintrag (mit
  Cmd- bzw. Strg-Klick in einem neuen Tab); die Zeilenhöhe folgt der
  Dichte-Einstellung im Profil.
- **Speichern und Meldungen.** Speichern ist nie ausgegraut; ohne Änderung
  sagt die Leiste „Nichts geändert“. Lehnt Kompass etwas ab, steht der Grund
  mit Auswegen dort, wo Sie gehandelt haben, und ein Bestätigungsdialog bleibt
  offen. Hat jemand anderes den Eintrag inzwischen geändert, legt die Maske Ihre
  Eingaben neben den neuen Stand, statt sie zu verwerfen.
- **Anlegen und Löschen.** Tiere, Projekte, Partner und Webseiten-Einträge
  legen Sie auf einer eigenen Seite an; Löschen und Archivieren steht als
  letzter Abschnitt der Detailseite, nie neben Speichern.
- **Breiten und Formulare.** Jede Seite hat eine von drei Breiten (Abläufe
  schmal, Formulare und Einstellungen bis 1.200 Pixel, Listen und
  Arbeitsflächen voll). Formularfelder stehen in einem Raster nach der Breite
  der Karte, kurze Werte schmal, Langtext breit; auf großen Bildschirmen wird
  kein Feld mehr überbreit. Dialoge haben vier Größen und kommen auf dem
  Telefon als Blatt von unten oder als Vollbild. Bei mehrsprachigen Feldern
  steht das Sprachkürzel im Feld.
- **Einstellungen:** Der gewählte Reiter steht in der Adresse; alte
  Lesezeichen auf einen Bereich führen weiter an die richtige Stelle.
- **Für Template-Autoren:** Neue Feldoptionen `size` und `group` steuern die
  Eingabemaske (Breite eines Feldes, Abschnitt mit Titel). Die Plätze einer
  Mehrfachauswahl (`references`) stehen als einzelne Felder im Raster, `size`
  gilt je Platz. Ältere Kompass-Fassungen übergehen die Optionen.

### Behoben

- Webseite → Template einlesen: Verlangt das Template Sprachen, die nicht
  eingerichtet sind, nennt Kompass sie und den Weg (Einstellungen → Sprachen →
  hinzufügen), auch über MCP.
- Verwaltung → Module: Lässt sich ein Modul nicht ein- oder ausschalten, weil
  andere davon abhängen, nennt Kompass die Module mit Namen (statt mit ihren
  Schlüsseln) und sagt, was zuerst zu tun ist.
- Einstellungen → Sprachen: Eine Sprache, die die Webseite braucht (weil das
  Template sie verlangt), lässt sich nicht mehr entfernen — auch nicht über MCP;
  Kompass nennt den Grund. Bisher verschwand etwa „en“ stillschweigend aus der
  ausgelieferten Webseite.
- Einstellungen: Die Seiten „Akte“ und „Finanzen“ tragen den Namen ihrer
  Rubrik als Überschrift (statt „Akte – Stammdaten“ und „Finanzen
  einrichten“).
- Einstellungen → Erscheinungsbild → Duplizieren: Ist der Schlüssel ungültig
  (etwa mit Großbuchstaben), steht der Grund am Feld, statt dass nichts
  passiert.

## [0.2.5] - 2026-10-03

Die Webseite wird robust und durchschaubar. Vorschau, Verbindungstest und
Publish zeigen Schritt für Schritt, was gerade läuft („Bildvarianten 342 von
1.533“), auf der Seite und oben in der Kopfzeile — auch wenn ein Lauf über MCP
gestartet wurde. Läufe lassen sich abbrechen, ein Zeitlimit beendet sie
wirklich, und ein Neustart mitten im Lauf hinterlässt nichts Blockiertes. Die
Seite Publizieren ist ein Ablauf mit genau einer Hauptaktion je Schritt; die
Einrichtung (Template, Verbindung, Cache, gesperrte Begriffe) liegt neu unter
Einstellungen → Webseite, und „Verbindung testen“ prüft nur noch die
Verbindung, in Sekunden. Keine Migration. **Zu tun:** einen Speicherort für
`/cache` eintragen (siehe Handbuch, „Von 0.2.4 auf 0.2.5“); ohne ihn läuft
alles, aber jeder erste Bau nach einem Update dauert länger. Nach dem Update
entstehen alle Bildvarianten einmal neu. **Es bricht etwas für MCP-Clients**,
die publizieren: `site_publish` verlangt den `expectedContentHash` der
geprüften Vorschau, und `site_deploy_check` liefert Prüfpunkte statt einer
Liste, was ein Publish ändern würde (siehe **Geändert**).

### Hinzugefügt

- Webseite: Jeder Lauf kennt seine Schritte und zählt mit, in Worten mit
  Tausenderpunkt (z. B. „Bildvarianten 342 von 1.533“, „86 Seiten“). Der erste
  Schritt heißt „Inhalte prüfen“; beim Publish mit übernommener Vorschau steht „Seite bauen“ sofort auf „übersprungen“, das Kopieren zählt mit; ein Lauf über MCP trägt die Marke
  „MCP“ mit dem Namen des API-Tokens und der Person, für die er läuft.
- Webseite: Vorschau, Verbindungstest und Publish lassen sich abbrechen, ein
  Publish bis zum Beginn der Übertragung, über die Laufkarte oder
  `site_job_cancel`.
- Webseite: Einstellungen → Webseite → Cache zeigt Zahl, Größe und Alter der
  Bildvarianten und der Vorschau; „Cache leeren“ fragt nach und ist während
  eines Laufs gesperrt. Per MCP: `site_cache_status` und `site_cache_clear`.
- Webseite: Ein laufender Bau oder Publish steht auf jeder Seite oben mit Schritt und Zähler, auch wenn er über MCP gestartet wurde. Ein Klick führt zum Veröffentlichen.
- Veröffentlichen: Laufkarte mit Schritten, Fortschritt und Abbrechen; bei einem gescheiterten, unterbrochenen oder am Zeitlimit beendeten Lauf öffnet „Protokoll ansehen“ das Protokoll; die Historie und das Protokoll nennen, ob ein Publish über die Oberfläche oder über MCP (mit Token-Namen) kam; eine über MCP gebaute Vorschau gibt den Publish frei und steht nach dem Neuladen noch da.

### Geändert

- Webseite: „Publizieren“ steht immer in der Leiste; ohne Template führt die
  Seite in die Einstellungen. Die Einrichtung liegt neu unter Einstellungen →
  Webseite.
- Webseite: Template einlesen und Startinhalte liegen unter Einstellungen →
  Webseite → Template; die alte Adresse leitet weiter.
- Webseite: Verbindung testen liegt unter Einstellungen → Webseite →
  Verbindung, mit Ziel, Adresse und Anmeldeart aus der Umgebung (Geheimnisse
  nur als gesetzt oder fehlt), mit Haken oder Meldung je Prüfpunkt.
- Webseite: Die Liste der gesperrten Begriffe pflegen Sie unter Einstellungen →
  Webseite; ein Treffer in der Vorschau verlinkt auf den Inhalt und, mit dem
  Recht, auf die Liste.
- Veröffentlichen: Hinweis, wenn der erste Bau wegen leerem Bild-Cache länger
  dauert.
- Handbuch: neue Seite „Webseite einrichten“; Template und Publizieren
  verweisen dorthin.
- Webseite: Ein Lauf merkt sich, ob er über die Oberfläche oder per MCP
  gestartet wurde.
- MCP: `site_variables_get` liefert die Version der Variablen, `site_variables_set` nimmt sie als `expectedVersion` und überschreibt keine Änderung, die inzwischen gespeichert wurde.
- Webseite: Beim Publish wird am Ziel erst gelöscht, wenn alle neuen Dateien da
  sind; der Template-Bau sieht keine Geheimnisse der Anwendung mehr.
- Webseite: „Verbindung testen“ baut nichts mehr. Er prüft in Sekunden
  Anmeldung, Zielverzeichnis, Schreibrecht (Probedatei anlegen und löschen)
  und zählt die Dateien am Ziel, je Punkt mit Haken oder konkreter Meldung.
- Webseite: Zwischenstände des Seitenbaus liegen im Cache statt im
  Datenverzeichnis und fallen damit aus dem Backup; Reste älterer Fassungen
  räumt der erste Bau weg.
- Webseite: Der Server prüft beim Publish, dass genau der Stand der gezeigten
  Vorschau übertragen wird, und lehnt sonst mit „Vorschau nicht mehr aktuell“
  ab.
- Betrieb: `/cache` als eigenes Volume in den Compose-Vorlagen, `tini` als Init
  im Image. Siehe Handbuch, „Von 0.2.4 auf 0.2.5“.
- Webseite: Laufzustand und Ergebnisse von Vorschau, Verbindungstest und Publish kommen gekürzt aus einer Quelle (Zahlen, die ersten 20 Pfade, Protokollende).
- MCP: `site_job_result` und `site_publishes` antworten gekürzt (Schalter `paths`, `log`); neu `site_publish_get` und `site_job_cancel`. `site_publish` verlangt den `contentHash` der geprüften Vorschau; ohne `expectedContentHash` wird der Aufruf abgelehnt. `site_job_result` liefert für `deployCheck` `passed` und die Prüfpunkte, nach einem Zeitlimit die gerissene Grenze und den Zählerstand und bei einem gescheiterten Publish den Grund (`failure`).
- Publish-Historie: Das Protokoll öffnet in einem zugänglichen Dialog und wird erst dann geladen, mit Kopieren; Status mit Symbol und Wort, Name statt Kennung, Änderungen in Worten, die letzten fünf, Ältere auf Wunsch.
- Handbuch Publizieren: Laufanzeige und Abbrechen.
- Webseite: Prüfen und der Abgleich vor dem Publish lesen keine Originalbilder mehr und sind auch bei vielen Fotos in Sekunden fertig (Backlog 47).
- Veröffentlichen: Die Seite zeigt eine Karte mit genau einem Schritt und einer Hauptaktion. „Prüfen“ ist der erste Schritt der Vorschau, Hinweise stehen als Kurzbilanz mit aufklappbaren Einzelheiten, ein gesperrter Begriff verlinkt auf den Inhalt, auch bei einem Hund oder Projekt. Der Bestätigungsdialog schließt beim Start, und der Lauf steht in Karte und Kopfzeile. Nach dem Neuladen steht die letzte Vorschau wieder da, als „nicht mehr aktuell“, wenn sich Inhalte geändert haben.

### Behoben

- Änderungsprotokoll: Ein Vorgang über MCP nennt in der Detailansicht den Namen
  des API-Tokens statt seiner Kennung, wie es die Seite „API-Tokens“ verspricht;
  `audit_query` und `audit_get` liefern ihn als `apiTokenName` mit.
- Webseite: Wird Kompass während eines Laufs neu gestartet, steht der Lauf
  danach als „unterbrochen“ da, statt endlos zu warten; ein unterbrochener
  Publish erscheint in der Historie.
- Webseite: Ein Zeitlimit beendet den Lauf wirklich und meldet den Schritt,
  statt „ENOTEMPTY“ anzuzeigen und im Hintergrund weiterzuarbeiten.
- Webseite: Ein abgebrochener Bau oder Publish hinterlässt keine
  weiterlaufenden Astro-, rsync- oder ssh-Prozesse mehr; Astro bricht nicht
  mehr nach festen 5 Minuten ab.
- Webseite: Ein unlesbares Bild bricht den Bau nicht mehr ab, es wird mit
  Namen gemeldet; ein abgebrochener Lauf hinterlässt keine kaputten
  Bildvarianten mehr, und die Bildvarianten entstehen schneller.
- Webseite: Eine abgebrochene Vorschau wird von einem folgenden Publish nicht
  mehr als fertig übernommen.
- Webseite: Nach dem Speichern eines Eintrags zeigt die Leiste keine offenen Änderungen mehr, „Verwerfen“ kehrt zum gespeicherten Stand zurück, und ein zweites Speichern ohne Neuladen gelingt.
- Webseite: Wer Inhalte nur ansehen darf, sieht in den Sammlungen keine Knöpfe mehr, die dann scheitern. Die Vorschau der Webseite sieht nur, wer die Webseite ansehen darf.
- Mediathek: „Verwendet in“ nennt Webseiten-Einträge mit ihrem Namen statt einer Kennung und Variablen mit ihrer Beschriftung.
- Webseite: Jede Fehlermeldung des Moduls erscheint als verständlicher Satz, in der Oberfläche wie über MCP — nicht mehr als „Der Vorgang ist nicht möglich“ mit technischem Text.
- Webseite: Die Publish-Historie lädt nicht mehr alle Dateilisten und Protokolle mit; die Seite lädt dadurch deutlich schneller (Backlog 39).
- Startseite: Die Kachel Webseite meldet einen laufenden Lauf, warnt auch bei abgebrochenem Publish und verlinkt Leser nicht mehr auf eine gesperrte Seite.
- Veröffentlichen: Der Bestätigungsdialog ragte mit drei Knöpfen über den Rand und verdeckte während des Publish die Laufanzeige; „Abbrechen“ schloss nur den Dialog.

### Sicherheit

- Abhängigkeiten aktualisiert: Das mitgelieferte Basis-Template baut mit
  Astro 7.3.5 und bekommt darüber `devalue` 5.9.4, frei von den sechs
  bekannten Lücken in 5.9.2 (Rechenzeit und Speicher beim Serialisieren).
  Dazu kleine Fehlerbehebungen in `next-intl` 4.14.7, `lucide-react` 1.48.0
  und `vitest` 5.0.2. Für den Betrieb ändert sich nichts.

## [0.2.4] - 2026-10-02

Akte und Mediathek bekommen einen Ordnerbaum: Ordner stehen mit vollem Namen
als aufklappbarer Baum, lassen sich dort anlegen, umbenennen und per Ziehen
oder Tastatur verschieben, und jede Änderung kann man 10 Sekunden lang
rückgängig machen. In der Akte kommen „Antworten“ und „Folgeschreiben“ dazu.
Vorschau, Verbindungstest und Publish der Webseite laufen im Hintergrund und
brechen nicht mehr mit einer Zeitüberschreitung ab. Keine Migration. **Es
bricht etwas für MCP-Clients**, die die Webseite bauen oder publizieren: Die
drei Werkzeuge kehren sofort zurück, das Ergebnis liefert `site_job_result`
(siehe **Geändert**).

### Hinzugefügt

- Akte und Mediathek: Ordner pflegen Sie direkt im Ordnerbaum — anlegen,
  umbenennen (auch mit F2), samt Unterordnern verschieben per Ziehen, per
  Tastatur oder über „Verschieben nach…“, leere Ordner löschen; das Menü am
  Ordner öffnet auch ein Rechtsklick. Wo etwas nicht abgelegt werden kann,
  steht der Grund an der Zeile. Jede Änderung lässt sich 10 Sekunden lang
  rückgängig machen. In der Akte ziehen Dokumentarten und Einsortierregeln
  mit, wenn ein Ordner umbenannt oder verschoben wird.
- Akte: Dokumente lassen sich ankreuzen und gemeinsam in einen Ordner
  verschieben — per Ziehen oder „Verschieben nach…“.
- Akte: Passen mehr Dokumente, als die Liste auf einmal zeigt, sagt ein Satz
  darunter, wie viele es insgesamt sind.
- Mediathek: Eine Kachel ziehen Sie auf einen Ordner, um die Datei zu
  verschieben. Dateien aus dem Dateimanager landen beim Loslassen sofort im
  Ordner darunter. „Ohne Ordner“ zeigt die Dateien, die in keinem Ordner
  liegen.
- Akte: „Antworten“ an eingegangener Post und „Folgeschreiben“ an einem
  eigenen, abgelegten Brief beginnen einen Entwurf im selben Ordner, an den
  Absender bzw. denselben Empfänger, mit dem Betreff „Ihr Schreiben vom …“
  bzw. „Unser Schreiben vom …“ und dem Bezug „Antwort auf“.
- Themes: sechs neue Farben für den Ordnerbaum (Ablageziel, gesperrtes Ziel,
  Führungslinien); eigene Themes übernehmen die Vorgabe, bis man sie ändert.
- MCP: neues Werkzeug `dms_create_response` — derselbe Entwurf wie
  „Antworten“/„Folgeschreiben“ in der Akte.
- MCP: neues Werkzeug `dms_move_folder`. `dms_move` und `media_move` nehmen
  den erwarteten Ort entgegen und verschieben nichts, was inzwischen woanders
  liegt. `dms_list` und `media_list` nehmen `includeSubfolders: true` und
  liefern dann zu einem Ordner auch den Inhalt aller Unterordner; ohne den
  Schalter bleibt es genau dieser Ordner.

### Geändert

- Hinweise (Toasts): Erfolg, Warnung, Fehler und Information tragen einen
  Rand in ihrer Statusfarbe, nicht nur ein anderes Symbol.
- Akte: Ein neuer Brief übernimmt den gerade geöffneten Ordner; den Ordner
  wählen Sie im Ordnerbaum.
- Akte und Mediathek: Die Ordner stehen als aufklappbarer Baum mit vollem
  Namen statt als flache Liste. Zähler zeigen die Summe samt Unterordnern,
  der Baum merkt sich, was aufgeklappt war, Buchstaben springen zum Ordner,
  „Tastenkürzel“ erklärt die Bedienung. Ein geöffneter Ordner zeigt auch den
  Inhalt seiner Unterordner; die Spalte „Ordner“ sagt, wo darunter etwas
  liegt. Auf dem Telefon öffnet ein Knopf über der Liste den Ordnerbaum.
- Akte: Über der Liste steht, wo Sie sind. Ordner pflegen Sie nicht mehr in
  der Verwaltung, sondern in der Akte; ein Unterordner lässt sich nur noch in
  einem vorhandenen Ordner anlegen.
- Akte: Den Ordner eines Dokuments wählen Sie im Ordnerbaum statt in einer
  langen Liste; beim Ablegen nennt Kompass die Dateien, die kein PDF sind.
- Mediathek: Der Auswahldialog zeigt den Ordnerbaum und zählt nur, was gerade
  gewählt werden kann.
- Meldungen unten rechts übernehmen die Farben des Themes.
- Vorschau, „Verbindung testen“ und Publish laufen jetzt im Hintergrund. Sie
  bauen die Seite, und nach vielen neuen Bildern dauert das Minuten — über MCP
  brach der KI-Assistent deshalb mitten im Lauf mit einer Zeitüberschreitung
  ab. Auf der Publizieren-Seite zeigt die Laufanzeige oben, was läuft; die
  Seite darf man dabei verlassen und neu laden. Das Ergebnis des letzten
  Verbindungstests steht mit Zeitpunkt auch nach dem Neuladen noch da. Ein
  Neustart des Containers mitten im Lauf blockiert keinen späteren Lauf mehr.
- **Bruch für MCP-Clients:** `site_preview_build`, `site_publish` und
  `site_deploy_check` liefern nicht mehr das Ergebnis, sondern kehren sofort
  mit `{ started: true, runId, startedAt }` zurück — läuft schon etwas:
  `{ started: false, running }`. Das Ergebnis liest das neue Werkzeug
  `site_job_result` mit `kind` (`preview`, `publish` oder `deployCheck`):
  alle paar Sekunden abfragen, bis `last.runId` der `runId` des Starts ist.
  Dann steht unter `last.result` dasselbe wie bisher in der Antwort, ein
  Fehler (etwa `blockedTermsPresent` beim Publish) unter `last.error`. Fehler,
  die vor dem Start feststehen (fehlende Bestätigung, kein Ziel), kommen wie
  bisher direkt. Ein Agent, der publiziert, ruft also `site_publish` mit
  `confirm: true` und fragt danach `site_job_result` mit `kind: publish` ab;
  die Historie bleibt `site_publishes`.

### Behoben

- Mediathek: Auch in der Listenansicht lassen sich Dateien auf einen Ordner
  ziehen.
- Akte: Solange die Texterkennung eines Dokuments läuft, bleiben Verschieben
  und Rückgängig auf der Dokumentseite flüssig.
- Mediathek: Ein Ordner mit `_`, `%` oder Emoji im Namen nimmt beim
  Umbenennen keine fremden Ordner mehr mit; zu tiefe Ziele werden abgewiesen.
- Akte und Mediathek: Die Ablagefläche beim Ziehen von Dateien steht im
  sichtbaren Teil der Liste, auch wenn diese lang ist.
- Akte und Mediathek: Die Ordnerspalte bleibt beim Scrollen langer Listen
  stehen.
- Formulare nennen bei einem Fehler, was nicht stimmt, statt nur ‚ein Feld
  braucht eine Angabe‘. Tierprofile zeigen die Grenze von 12 Fotos schon bei
  der Auswahl.
- Mediathek: Der Knopf „Hochladen“ meldet eine Datei, die es schon gibt, wie
  das Ablegen per Ziehen als Fehler mit Grund statt als Erfolg.
- Mediathek: Mit vielen Dateien öffnet sie wieder schnell — mit gut 1500
  Dateien dauerte „Alle Dateien“ mehrere Sekunden. Die Liste zeigt höchstens
  200 Dateien und sagt darunter, wie viele es insgesamt sind; Ordner, Suche
  und Art grenzen ein. Auch `media_list` antwortet schneller.
- Akte und Mediathek: Am Telefon lässt sich nichts mehr ziehen, was dort nicht
  abgelegt werden kann; verschoben wird über „Verschieben nach…“.

## [0.2.3] - 2026-10-01

Eine Wartungsfassung: aktualisierte Abhängigkeiten ohne bekannte Lücken und
kleine Fehler aus 0.2.2, vor allem im Tierprofil — das Vermittlungsjahr aus
„Status ändern“ wird nicht mehr überschrieben, und die Speicherleiste zählt
nur noch, was ein Speichern wirklich ändert. Das Protokoll von
`site_deploy_check` liest sich nicht mehr, als räumte ein Publish die Seite
leer. Keine Migration, nichts bricht; MCP-Clients, die Protokolleinträge
`animals.setPhotos` auswerten, finden die Fotos dort jetzt unter `photos`.

### Hinzugefügt

- MCP: `media_get` liefert auf Wunsch statt des Originals die kleine
  Vorschau aus der Mediathek (`variant: preview`, WebP, höchstens 320 Pixel
  breit) und nennt den Dateityp. Ein KI-Assistent, der nur sehen will, was
  auf einem Bild ist, muss so kein Foto von mehreren Megabyte laden.

### Behoben

- Änderungsprotokoll: Die Einträge zu Fotos und Erfolgsgeschichte eines Tiers
  zeigen jetzt auch, ob das Profil damit zur Prüfung vorgemerkt wurde — wie
  schon die Einträge zum Anlegen und Ändern.
- Tierprofil: Der Haken „Beim Bestätigen veröffentlichen“ zählt in der
  Speicherleiste nicht mehr als ungespeicherte Änderung — er wirkt nur beim
  Bestätigen, ein Speichern ändert daran nichts.
- Buchungsliste und Änderungsprotokoll: Das Suchfeld (im Protokoll auch die
  Datumsfelder) leert sich, wenn der Filter von außen zurückgenommen wird —
  über die Seitenleiste, den Zurück-Knopf oder den Filter-Chip —, statt den
  alten Text weiter zu zeigen. Wie schon in Tier-, Kontaktliste und Akte.
- Tierprofil: Das Vermittlungsjahr aus „Status ändern“ steht jetzt sofort im
  Reiter „Geschichte“. Bisher zeigte das Feld bis zum Neuladen das alte Jahr,
  und ein Speichern in der Maske schrieb es über das eben gesetzte.
- Webseite: Das Protokoll von `site_deploy_check` (MCP) führt die Dateien am
  Ziel jetzt als Liste „am Ziel“ statt als rsync-Zeilen „*deleting“. Es las
  sich bisher, als räumte ein Publish die Live-Seite leer; was ein Publish
  wirklich entfernt, steht weiter in `publishWould.removed` und im Abschnitt
  zum Build.
- Tierprofil: „Status ändern“ auf „vermittelt“ setzt das abgefragte
  Vermittlungsjahr jetzt auch, wenn das Tier schon eine Erfolgsgeschichte hat
  (in der Oberfläche wie über MCP). Bisher blieb dort das alte Jahr stehen.
  Das Änderungsprotokoll zeigt das Jahr vorher und nachher.

### Sicherheit

- Abhängigkeiten aktualisiert: Die Bibliotheken für Adressprüfung
  (`fast-uri`, eine mittelschwere Lücke), Dateimuster (`brace-expansion`) und
  der Webserver unter dem MCP-Zugang (`hono`) sind auf dem Stand ohne bekannte
  Lücken; das MCP-SDK kommt in Fassung 2.1. Für den Verein ändert sich nichts
  Sichtbares.

## [0.2.2] - 2026-09-30

Tierprofile lassen sich jetzt prüfen: Was ein Agent über MCP schreibt, wartet
als Vorschlag auf einen Menschen. Die Tierliste trägt einige hundert Hunde,
das Profil führt von Hund zu Hund, die Startseite zählt die offenen
Prüfungen, und das Publizieren warnt vor Veröffentlichtem, das noch niemand
gesehen hat. Im Tierprofil gibt es eine Speicherleiste für alles, und die
Fotos stehen dort im Ausschnitt, in dem die Webseite sie zeigt. Die Seite
Dokumentvorlagen sagt, worauf ein Dokument erscheint, und der PDF-Auszug des
Änderungsprotokolls ist lesbar. Für MCP-Clients bricht `animals_list` (siehe
**Geändert**).

Diese Fassung bringt genau eine Datenbank-Migration mit
(`0005_animals_review`), die beim Start von selbst läuft — vor dem Update wie
immer ein Backup exportieren. Was nach dem Update von Hand zu tun ist, steht im
Betriebshandbuch unter „Von 0.2.1 auf 0.2.2“.

### Hinzugefügt

- **Prüfmerker an Tierprofilen.** Ein Tierprofil kann als „Prüfung offen“
  vorgemerkt sein, mit Zeitpunkt und einer kurzen Notiz, was anzusehen ist. Der
  Merker steht quer zu „veröffentlicht“: Ein neues wie ein schon
  veröffentlichtes Profil kann auf eine Prüfung warten. Bestehende Profile
  haben nach dem Update keinen Merker. Auf der Webseite erscheint er nie.
- **Was ein Agent schreibt, wartet auf einen Menschen.** Legt ein Agent über
  MCP ein Tierprofil an oder ändert er Texte, Fotos, Erfolgsgeschichte oder
  Übersetzungen, merkt Kompass das Profil von selbst zur Prüfung vor. Die
  Änderung steht sofort im Profil; der Merker sagt nur, dass noch niemand
  draufgeschaut hat. Statuswechsel und Veröffentlichen setzen ihn nicht, und
  Änderungen in der Oberfläche auch nicht.
  Jedes Vormerken steht als eigener Eintrag (`animals.requestReview`) im
  Änderungsprotokoll, direkt vor der Änderung, die es ausgelöst hat.
- **Neues MCP-Werkzeug `animals_request_review`.** Ein Agent merkt damit ein
  Profil ausdrücklich zur Prüfung vor und schreibt in eine Notiz (höchstens
  500 Zeichen, keine Personendaten), was anzusehen ist, etwa „zwei neue Fotos“
  oder „beim Partner nicht mehr gelistet“. `animals_get` liefert Merker und
  Notiz mit. Verlangt `animals.manage`.
- **Die Prüfung bestätigt nur ein Mensch.** Den Merker nimmt allein die
  Oberfläche zurück; über MCP gibt es dafür kein Werkzeug, ein Agent kann
  seinen eigenen Vorschlag nicht freigeben. Hat der Agent das Profil nach dem
  Öffnen der Maske noch einmal geändert, wird das Bestätigen abgewiesen, bis
  die Seite neu geladen ist.
- **Beispieldaten mit offener Prüfung.** Die Entwicklungsdaten (`pnpm seed`)
  bringen zwei weitere erfundene Hunde mit, die auf eine Prüfung warten: einen
  neuen, unveröffentlichten und einen veröffentlichten mit geänderten Texten
  und Fotos. Bestehende Installationen sind nicht betroffen.
- **Tierliste für einige hundert Hunde.** Über der Liste steht ein Umschalter
  „Alle“ und „Prüfung offen“, jeweils mit der Zahl der Profile; „Prüfung
  offen“ zeigt zuerst, was am längsten wartet. Dazu kommen eine Namenssuche
  und Filter nach Status, Aufenthalt und Veröffentlichung, eine Zeile wie
  „17 von 187 Hunden“ und zwei neue Spalten: die Zahl der Fotos und das Datum
  der letzten Änderung. Nach „Hund“ und „Geändert“ lässt sich sortieren. Ein
  wartendes Profil trägt die Marke „Prüfung offen“, die Notiz dazu erscheint
  beim Überfahren mit der Maus. Auswahl und Sortierung stehen in der Adresse
  der Seite und bleiben beim Öffnen eines Profils erhalten.

- **Prüfen am Stück im Tierprofil.** Wartet ein Profil auf eine Prüfung, steht
  über den Reitern ein Band: „Prüfung offen seit …“ mit der Notiz dazu. Der
  Knopf unten heißt dann „Geprüft“: Er speichert Texte und Fotos und nimmt den
  Merker zurück. Bei einem noch nicht veröffentlichten Hund steht im Band der
  Haken „Beim Bestätigen veröffentlichen“; er ist gesetzt, wer ihn
  herausnimmt, bestätigt nur. Wer das Profil aus der Liste „Prüfung offen“
  geöffnet hat, bekommt „Geprüft und weiter“ und landet beim nächsten
  wartenden Hund, nach dem letzten wieder in der Liste. „Speichern“ bleibt als
  zweiter Knopf daneben und lässt die Prüfung offen. Ohne offene Prüfung heißt
  der Knopf in einer gefilterten Liste „Speichern und weiter“.
- **Publizieren warnt vor Veröffentlichtem mit offener Prüfung.** „Prüfen“
  und „Vorschau bauen“ auf der Seite Webseite → Publizieren zeigen eine vierte
  Befundzeile „Prüfung offen“: jedes veröffentlichte Tierprofil, das noch auf
  eine Prüfung wartet, mit Link ins Profil. Die Zeile warnt nur; publizieren
  lässt sich weiterhin, und der Publish nimmt diese Profile mit. Noch nicht
  veröffentlichte Profile stehen dort nicht, sie gehen ja nicht live. Über MCP
  liefern `site_export_check` und `site_preview_build` dasselbe als
  `pendingReview`.
- **Kachel „Tiere: Prüfung offen“ auf der Startseite.** Sie zählt die
  Tierprofile, die auf eine Prüfung warten, veröffentlichte wie
  unveröffentlichte, und führt mit einem Klick in die Tierliste mit dem
  Umschalter „Prüfung offen“. Wer Tiere sehen darf und seine Startseite nie
  angepasst hat, sieht sie von selbst; wer eine eigene Anordnung gespeichert
  hat, schaltet sie unter „Anpassen“ ein.

### Geändert

- **Bruch für MCP-Clients: `animals_list` liefert knappe Zeilen in einem
  Objekt.** Die Antwort ist nicht mehr eine Liste voller Profile, sondern
  `{ animals, total, reviewPending }`. Die Zeilen unter `animals` tragen Name,
  Slug, Status, Aufenthalt, Kennzeichen, Veröffentlichung, Prüfmerker,
  Fotoanzahl und das Hauptfoto, aber **keine Texte, keine Fotoliste und keine
  Erfolgsgeschichte** mehr; die beiden Zähler gelten für den ganzen Bestand,
  auch wenn gefiltert wird. Neu sind Filter (`text`, `status`, `location`,
  `isPublished`, `reviewPending`) und eine Sortierung (`orderBy`). Was zu tun
  ist: Skripte und Agenten, die die Antwort als Liste lesen, greifen auf
  `animals` zu; wer Texte, Fotos oder die Geschichte eines Tiers braucht, ruft
  danach `animals_get` mit dessen `id`. Der Grund: Bei einigen hundert Hunden
  sprengte die alte Antwort jeden Agentenkontext.
- **Ein Fototausch zählt als Änderung am Profil.** Wer die Fotos eines Tiers
  ändert, schreibt jetzt auch „zuletzt geändert“ fort. Eine Maske, die vor dem
  Fototausch geöffnet wurde, meldet beim Speichern den veralteten Stand, statt
  still darüberzuschreiben.
- **Die Tierliste lädt Vorschaubilder statt der Originalfotos** und baut sich
  dadurch auch bei vielen Hunden zügig auf. Neben dem Aufenthalt steht jetzt
  der Ort.
- **Tierprofil: Texte und Fotos auf einem Reiter, ein Speichern.** Die Reiter
  „Texte“ und „Fotos“ sind zu „Texte und Fotos“ zusammengelegt: links die
  Texte, rechts die Fotos, auf schmalen Bildschirmen untereinander. Der Knopf
  „Fotos speichern“ entfällt; Hauptfoto, Reihenfolge und Auswahl werden mit
  „Speichern“ unten zusammen mit den Texten gespeichert, und die Leiste zählt
  eine Fotoänderung als ungespeicherte Änderung mit. Was zu beachten ist: Wer
  Fotos ändert und die Seite ohne „Speichern“ verlässt, verliert die Änderung
  wie bei jedem anderen Feld. Ein Klick auf ein Foto öffnet das Original in
  einem neuen Tab.
- **Tierprofil: eine Speicherleiste für alles.** „Speichern“ schreibt, was auf
  irgendeinem Reiter geändert wurde, auch die Erfolgsgeschichte; der Knopf
  „Geschichte speichern“ entfällt, und die Zählung der ungespeicherten
  Änderungen gilt über alle Reiter. Der Schalter „Veröffentlicht“ im Profil
  wirkt nicht mehr sofort, sondern zählt als Änderung und wird mit „Speichern“
  geschrieben. Was zu beachten ist: Wer im Profil veröffentlicht oder
  zurückzieht, muss danach speichern. In der Liste schaltet der Schalter
  weiterhin sofort, und „Status ändern“ schreibt weiterhin gleich.
- **Tierfotos im Ausschnitt der Webseite.** Neue Einstellungsseite Tiere unter
  Einstellungen: Seitenverhältnis und Blickpunkt, in denen die Webseite das
  Hauptfoto zeigt. Das Tierprofil zeigt die Fotos dann im selben Rahmen, und
  beim Wählen des Hauptfotos ist zu sehen, was die Seite abschneidet. Vorgabe
  ist 4:3 mittig wie bisher. Was zu tun ist: Zeigt das Template der eigenen
  Webseite die Fotos in einem anderen Format, dieses einmal dort eintragen.
- **Dokumentvorlagen: übersichtlicher.** Die Seite unter Verwaltung zeigt jetzt
  zwei Tabellen statt eines zugeklappten Kastens. Die erste nennt je
  Basis-Vorlage, ob sie mitgeliefert oder eine eigene ist. Die zweite nennt je
  Dokumentart, nach Modul gruppiert, auf welcher Basis sie tatsächlich
  erscheint; „Vorgabe der Vorlage“ nennt die Kennung der Vorgabe, eine
  Abweichung davon ist markiert und lässt sich zurücksetzen. Was zu beachten
  ist: Wer für den Export des Änderungsprotokolls früher eine Basis fest
  eingestellt hat, sieht die Zeile jetzt als „abweichend“; der Auszug erscheint
  erst nach „Zurücksetzen“ auf der neuen schlanken Basis.
- **Das Tierprofil kennt seinen Platz in der Liste.** Wer ein Profil aus einer
  gefilterten oder sortierten Liste öffnet, sieht oben rechts „3 von 17“ mit
  Pfeilen zum vorherigen und nächsten Hund derselben Auswahl. Der gewählte
  Reiter bleibt beim Blättern stehen, und „Zurück zur Übersicht“ führt in
  dieselbe Auswahl zurück.

- **Abhängigkeiten aktualisiert.** Der Monatsstand der Bibliotheken ist
  eingezogen, durchweg Fehlerbehebungen und kleine Fassungen: unter anderem
  Next.js 16.3.6, Zod 4.6.5, Drizzle 0.45.3 und Astro 7.3.4 für das
  mitgelieferte Basis-Template. Für den Betrieb ändert sich nichts.

### Behoben

- **Filterfelder zeigen wieder, was gilt.** In der Kontaktliste und in der Akte
  nahm ein Klick auf den Eintrag in der Seitenleiste (oder der Zurück-Knopf des
  Browsers) den Filter zurück, die Felder zeigten aber weiter die alte
  Auswahl. Sie folgen jetzt der Adresse.

- **PDF-Auszug des Änderungsprotokolls ist lesbar.** Die Spaltenköpfe waren
  auf einer eigenen Basis-Vorlage mit farbigem Fettdruck unsichtbar, und die
  Spalte mit dem eigentlichen Inhalt war wenige Zeichen breit. Jetzt haben
  Zeitpunkt, Nutzer mit Kanal und Aktion feste schmale Spalten, der Rest gehört
  Objekt und Zusammenfassung. Der Zeitpunkt steht als Datum und Uhrzeit in der
  Zeitzone des Vereins statt als ISO-Zeit in UTC, der Kanal in Worten, und wo
  die Ansicht den Namen eines Datensatzes zeigt, zeigt ihn auch der Auszug
  statt der ID. Die Aktion bleibt wie in der Ansicht ihr Schlüssel. Der Auszug
  erscheint jetzt auf der neuen, schlanken Basis `a4-plain-slim` mit schmalen
  Rändern, die Kompass mitliefert. Wer eigene Basis-Vorlagen führt und den
  Auszug im eigenen Kopf haben will, legt eine `a4-plain-slim.typ` daneben;
  ohne sie erscheint der Auszug in der mitgelieferten, neutralen Fassung.

## [0.2.1] - 2026-09-29

Fehlerbehebungen vor der ersten echten Buchung: Zuwendungsbestätigungen im
Wortlaut des Musters, Begründungen für Zwecke im Minus an allen Wegen,
Löschsperren in der Datenbank und ein sicheres Beenden. Diese Fassung bringt
genau eine Datenbank-Migration mit (`0004_finance_0_2_1`), die beim Start von
selbst läuft — vor dem Update wie immer ein Backup exportieren. Wer eine eigene
Compose-Datei führt (auch in der Container Station), übernimmt zwei Zeilen aus
`docker-compose.prod.yml`: den Block `networks` (MTU) und
`stop_grace_period: 60s`. Einzelheiten im Betriebshandbuch unter „Update“.

### Geändert

- **Kopfleiste zeigt nur den Namen.** Die Rollen standen unter dem Namen oben
  rechts und wurden abgeschnitten; sie entfallen dort.
- **Das Image baut auf Debian 13.** Der Container basiert jetzt auf
  `node:26-trixie-slim` statt auf Debian 12, mit OpenSSH 10, rsync 3.5,
  Tesseract 5.5 und Poppler 25. Der Grund: Ein Hoster mit OpenSSH 10 bevorzugt
  einen Schlüsselaustausch, den der alte Client nicht beherrschte; das
  Veröffentlichen brach dort ab. Die Texterkennung im Posteingang läuft mit den
  neuen Paketen unverändert, kann bei einzelnen Scans aber leicht anders lesen.
  Nichts zu tun, außer das neue Image zu ziehen.
- **Einstellungen → „Akte“.** Der Menüpunkt heißt nur noch „Akte“ statt „Akte
  einrichten“, wie „Finanzen“.
- **Unterschrift auf der maschinell erstellten Bestätigung.** Das Faksimile ist
  auf 75 % verkleinert und sitzt knapp über der Linie. Das Amt neben dem Namen
  wird beim Unterzeichner mit eingetragen („Name (Amt)“).

### Behoben

- **Einstellungen → Steuer & Bescheide: Satzungszweck entfernt.** Das Feld
  versprach, wörtlich in Zuwendungsbestätigungen zu erscheinen, wurde aber seit
  0.2.0 nirgends mehr gelesen: Die begünstigten Zwecke stehen am Bescheid unter
  Finanzen → Spenden → Bescheide. Ein dort früher eingetragener Text bleibt in
  der Datenbank liegen, wirkt aber nicht.
- **Datum des Bescheids im Format des Vereins.** Unter Einstellungen → Steuer &
  Bescheide stand es als 2026-07-29 statt 29.07.2026.
- **Stornierte offene Zahlung zeigt keinen offenen Betrag mehr.** Sie stand als
  „storniert“ da und nannte trotzdem weiter den vollen Betrag als offen; jetzt 0,00 €.
- **Hinweis „offene Zahlung schon vorhanden“ passt zu jedem Dokument.** Der Satz sprach
  nur von einer Rechnung, obwohl die Sperre für jedes Dokument gilt (etwa einen
  Kontoauszug). Er sagt jetzt „Dokument“; über die KI-Schnittstelle nennt die
  Ablehnung außerdem den vorhandenen Posten und dessen Zahlungsreferenz.
- **KI-Assistenten sehen die Werte einer Ablehnung.** Über die KI-Schnittstelle
  stehen Beträge, Namen und Daten, die im Satz einer Ablehnung vorkommen, jetzt
  auch als eigene Felder bereit, nicht nur im deutschen Text.
- **Zurückgenommene Zuwendungsbestätigung steht in der Akte als storniert.** Bisher
  blieb ihr Dokument dort „ausgestellt“, und das PDF sah gültig aus. Jetzt wird es
  beim Zurücknehmen mit storniert, ebenso eine abgelegte unterschriebene Fassung.
  Bereits zurückgenommene Bestätigungen werden nicht nachträglich angepasst.
- **Nachträglicher Entwurf einer Zahlung an einen Partner zeigt die Summe.** Ein
  Entwurf für bereits gezahlte Zeilen stand bei 0,00 €, bis er eingereicht war;
  jetzt zeigt er, auch im Protokoll, die Summe der gewählten bezahlten Zeilen.
- **Festgeschriebenes lässt sich auch in der Datenbank nicht löschen.** Was die
  Löschregeln der Finanzen als unlöschbar führen — Geschäftsjahre, Abschluss-
  ereignisse, offene Zahlungen, Begründungen und „Keine Rückzahlung“-Vermerke
  zu Buchungen, Bescheide von Partnern, Angaben zu Sachspenden festgeschriebener
  Zeilen, Kandidaten gebuchter Umsätze —, sperrt jetzt ein Trigger, nicht nur
  der Dienst. Im Alltag ändert sich nichts: Entwürfe und Auszüge lassen sich
  weiter verwerfen.
- **Eine offene Zahlung je Dokument, auch in der Datenbank.** Zu einem Dokument
  kann es nur eine nicht stornierte offene Zahlung geben; ein zweiter Versuch
  meldet, dass es schon eine gibt, statt mit einem technischen Fehler
  abzubrechen. Eine stornierte Zahlung zählt nicht mit. Vor dem Einspielen
  prüfen, dass kein Dokument zwei aktive offene Zahlungen hat.
- **Zuwendungsbestätigung: „vom Finanzamt Finanzamt Jülich“.** Der Name des
  Finanzamts steht mit seinem vollen Namen im Feld; der Mustersatz setzte
  „Finanzamt“ davor noch einmal. Jetzt steht es einmal, im Wortlaut des
  amtlichen Musters, auch im Hinweis zum maschinellen Verfahren.
- **Vereinfachter Zuwendungsnachweis mit vorläufiger Bescheinigung (§ 60a AO).**
  Liegt nur eine vorläufige Bescheinigung vor, fehlte dem Nachweis der Zweck im
  Wortlaut „Wir fördern nach unserer Satzung …“. Er wird jetzt gebildet; ein
  Fehler dabei landet im Protokoll. Außerdem trägt eine Statusmarke jetzt den
  Text „fehlt“.
- **Dokumentart mit Ablageregeln lässt sich nicht mehr kaputt löschen.**
  Zeigen Ablageregeln auf die Art, lehnt Kompass das Löschen ab und nennt die
  Regeln, statt mit einem Datenbankfehler zu scheitern.
- **Modul einschalten meldet, woran es scheitert.** Bricht die Einrichtung
  eines Moduls ab (etwa weil ein Nummernpräfix schon vergeben ist), zeigt
  Kompass den Grund und eine Abhilfe statt „Technischer Fehler“; das gilt auch
  für den MCP-Weg.
- **Finanzen: Freigeben-Fenster.** Gibt es keine Zwecke, füllt die Kategorie
  die ganze Breite statt neben einer leeren Spalte zu stehen.
- **Veröffentlichen bricht auf manchen Anschlüssen ab.** Wo die Pfad-MTU unter
  1500 liegt (PPPoE, Tunnel), erreicht die Rückmeldung „Paket zu groß“ den
  Container nicht, und der Verbindungsaufbau zum Hoster blieb hängen. Die
  mitgelieferten Compose-Dateien setzen die MTU des Netzes auf 1400. **Wer eine
  eigene Compose-Datei führt** (auch in der Container Station), übernimmt den
  Block `networks` aus `docker-compose.prod.yml` und stellt die Anwendung neu
  bereit. Hinweise dazu stehen im Betriebshandbuch unter „Webseite“.
- **Beim Beenden landen alle Änderungen in `kompass.db`.** Bisher blieb ein Teil
  in der Nebendatei `kompass.db-wal`, wenn beim Stopp noch eine zweite
  Verbindung zur Datenbank offen war; wer nur `kompass.db` sicherte, hatte einen
  alten Stand. Jetzt wird beim Stopp immer übertragen, und ein Fehler dabei
  steht im Protokoll. Die mitgelieferten Compose-Dateien geben dem Stopp
  60 Sekunden (`stop_grace_period`), damit er nicht nach 10 Sekunden
  abgeschnitten wird; wer von Hand stoppt, gibt `docker stop -t 60`. Eine
  Sicherung per Dateikopie im laufenden Betrieb braucht weiterhin `-wal` und
  `-shm` (oder die Sicherungsfunktion).
- **Zuordnung korrigieren verlangt die Begründung, wenn ein Zweck ins Minus
  geht.** Bisher konnte man über „Zuordnung ändern“ eine Ausgabe auf einen
  Zweck legen (oder eine Einnahme von ihm wegnehmen) und ihn damit unter null
  bringen, ohne dass Kompass nachfragte; beim Buchen wäre die Begründung
  Pflicht gewesen. Jetzt fragt der Dialog danach. Im abgeschlossenen Jahr wird
  bei der Freigabe erneut geprüft; eine mit dem Antrag gegebene Begründung
  gilt dort weiter. Die Begründung steht an der Korrektur, nicht im
  Änderungsprotokoll.
- **Die Begründung „Zweck im Minus“ wird nur einmal verlangt.** Wer eine Auslage
  oder eine Zahlung an Partner freigab und dabei begründete, dass ein Zweck ins
  Minus geht, musste dieselbe Begründung beim Festschreiben der Zahlung noch
  einmal eingeben. Läuft die Buchung über den Posten des Antrags, gilt jetzt
  die Begründung des Antrags und steht auch an der Buchung. Jede andere Buchung
  auf denselben Zweck braucht weiter ihre eigene Begründung.
- **Serienlauf: eine einzige Zuwendung ergibt eine Einzelbestätigung.** Hatte
  ein Spender im Jahr nur eine Geldzuwendung, stellte der Serienlauf trotzdem
  eine „Sammelbestätigung“ mit Zeitraum aus. Jetzt gilt wie beim Einzelausstellen:
  eine Zeile, eine Einzelbestätigung; erst ab zwei Zeilen die Sammelbestätigung.
  Dasselbe gilt für eine einzige Aufwandsspende (weiterhin mit Unterschriftsfeld).
  Sachspenden bleiben einzeln. Die Vorschau nennt die Art, die ausgestellt wird.

## [0.2.0] - 2026-09-28

Kompass führt jetzt die Finanzen des Vereins: vom Kontoauszug über Belege und
Buchungen bis zur Zuwendungsbestätigung nach amtlichem Muster, mit Auslagen,
Freigaben durch eine zweite Person, Zahlungen an Partner, Zwecken und
Rücklagen. Finanzen ist ein eigenes Modul und nach dem Update aus. Der
Jahresabschluss — Einnahmen-Überschuss-Rechnung, Vermögensübersicht,
Kassenbericht, Prüfpaket — kommt mit 0.3.0. Diese Fassung bringt eine
Datenbank-Migration mit, die beim Start von selbst läuft — vor dem Update wie
immer ein Backup exportieren.

### Neu

**Finanzen**

- **Konten und Buchungen.** Bankkonten und Kassen mit Anfangsbestand;
  Einnahmen, Ausgaben, Umbuchungen und Sachspenden, aufteilbar auf Kategorien,
  Zwecke und Projekte, mit Belegen. Eine festgeschriebene Buchung wird nur noch
  storniert, nie geändert. Das Journal zeigt je Konto ein Kontoblatt mit
  laufendem Saldo, jedes Projekt seinen Finanzabschnitt.
- **Kontoauszüge laden.** CAMT.053 oder, nach einmaliger Einrichtung, CSV
  der eigenen Bank; ein schon geladener Auszug wird erkannt. Die Arbeitsliste
  macht aus jedem Umsatz eine Buchung, schlägt vor, wie sie zu buchen ist, und
  nennt den Grund. Regeln machen aus einer Zuordnung eine dauerhafte.
- **Belege und Rechnungen.** Ein PDF lässt sich auf einen Umsatz ziehen oder
  in der Akte suchen; „Belege ohne Buchung“ sammelt, was fehlt. Eine
  eingebettete ZUGFeRD- oder Factur-X-Rechnung liefert Lieferant, Betrag,
  Fälligkeit und IBAN; daraus wird eine offene Zahlung mit QR-Code für die
  Banking-App.
- **Barkasse** mit Zählung zu zweit und Zählprotokoll in der Akte.
- **Spenden und Zuwendungsbestätigungen.** Die Bescheide des Finanzamts mit
  taggenauer Gültigkeit; Bestätigungen nach amtlichem Muster für Geld-,
  Mitgliedsbeitrags- und Sachzuwendungen, einzeln oder im Serienlauf mit
  Sammelbestätigung; das Spendenbuch stimmt Spenden und Bestätigungen
  gegeneinander ab. Ausstellen und Zurücknehmen bleibt einem Menschen
  vorbehalten.
- **Auslagen und Freigaben.** Jede Person reicht ihre Auslage ein, auch vom
  Telefon, mit Belegfoto oder Kilometern; eine zweite Person gibt frei. Wer
  auf die Erstattung verzichtet (Aufwandsspende), braucht eine vorher
  vereinbarte Grundlage; die Freigabe prüft sie und erzeugt die
  Verzichtserklärung. Aufwandsspenden sind in der Vorgabe ausgeschaltet.
- **Zahlungen an Partner.** Förderung oder Auftrag an eine gemeinnützige
  Organisation, eine öffentliche Stelle, eine Organisation im Ausland oder
  eine Person im Auftrag des Vereins. Kompass verlangt je Art die passenden
  Nachweise, Sachwerte immer mit Empfangsbestätigung; die Frist läuft in
  Monaten ab der Zahlung. Freigabe und Anerkennung liegen bei einer zweiten
  Person.
- **Zwecke und Rücklagen.** Jeder Zweck mit Vortrag, Zugängen, Verwendung und
  Bestand; „Zweck ändern“ mit Beschluss und Freigabe. Geht ein Zweck ins
  Minus oder die freie Rücklage über ihren Höchstbetrag, fragt Kompass nach
  einer Begründung.
- **Personen.** Ehrenamts- und Übungsleiterpauschalen je Person und
  Kalenderjahr gegen die Grenze, mit Warnung beim Überschreiten; Zahlungen an
  Vorstand und Nahestehende je Geschäftsjahr gesondert.
- **Einrichtung.** Eine Checkliste führt durch Geschäftsjahr, erstes Konto,
  Finanzrollen, Kategorien und Steuerliches. Beim ersten Einschalten entstehen
  fünf Rollen ohne Mitglieder: Schatzmeister, Freigeber Finanzen, Auslagen
  einreichen, Kassenprüfer, Finanz-Agent.
- **Startseite.** „Finanzen: zu tun“ und Kacheln zu Konten im Minus,
  Bestätigungen zum Korrigieren, Zahlungen an Partner ohne Nachweis und
  Zwecken im Minus.
- **MCP.** Werkzeuge für alle Bereiche der Finanzen. Ein Agent bereitet vor;
  Festschreiben, Freigeben und Ausstellen bleiben Menschen vorbehalten, solange
  der Verein es nicht ausdrücklich erlaubt.

**Kern und übrige Module**

- **Nutzer und Kontakte verknüpfen** (Verwaltung → Nutzer). Die eigene
  Verknüpfung setzt man einmal selbst, ändern kann sie danach nur eine zweite
  Person.
- **Kontakte lassen sich in der Oberfläche bearbeiten**, nicht mehr nur über
  MCP.
- **Schutzbereiche für Dokumentarten.** Dokumente einer geschützten Art sehen
  nur Personen mit dem passenden Recht — in Liste, Suche, Datei, Startseite
  und MCP.
- **Akte als ZIP.** Ein Ordner oder Jahrgang lässt sich mit Inhaltsverzeichnis
  und Prüfsummen herunterladen.
- **Dokumentarten ändern und löschen.** Präfixe sind eindeutig und lassen sich
  ändern, eine Art ohne Dokument lässt sich löschen.
- **Fehlende eigene Basis-Vorlage wird gemeldet**, wenn ein Modul eine nutzt,
  die die Installation nicht selbst führt.
- **Zeitzone des Vereins** in den Vereinsdaten (Vorgabe Europe/Berlin).
- **Tiere** haben ein Freitextfeld „Ort“.

### Geändert

- **Eine Datenbank-Migration für 0.2.0.** Sie läuft beim Start; schlägt sie
  fehl, startet Kompass nicht auf halb migrierten Daten. Vorher ein Backup
  exportieren (Verwaltung → Backup).
- **Finanzen ist nach dem Update aus** und wird unter Einrichtung → Module
  bewusst eingeschaltet. Die übrigen Module und Daten bleiben unberührt.
- **Präfixe der Dokumentarten vor dem Einschalten prüfen.** Finanzen bringt
  eigene Arten mit den Präfixen `KZP`, `ZWB`, `ZWU`, `VZE`, `VZU` und `PNW`.
  Trägt eine Art des Vereins eines davon, auch eine stillgelegte, scheitert
  das Einschalten; die Oberfläche zeigt dann nur „Technischer Fehler“, die
  Ursache steht im Serverprotokoll, gespeichert wird nichts. Geben Sie dieser
  Art vorher ein anderes Präfix oder löschen Sie sie. Die vorhandenen Arten
  für Kontoauszüge (`KTO`) und Protokolle (`PRT`) übernimmt Finanzen.
- **Eigene Dokument-Basen:** Wer eigene Basis-Vorlagen führt, legt auch
  `a4-formular` an (Zuwendungsbestätigung, Verzichtserklärung) — sonst tragen
  diese den mitgelieferten Kopf.
- **Stammdaten, die jetzt die Finanzen führen** — Finanzamt, Steuernummer,
  Bescheid, IBAN, BIC und Bank des Hauptkontos — stehen in den allgemeinen
  Stammdaten bei eingeschalteten Finanzen nur noch lesbar, mit Verweis auf
  ihren neuen Ort.
- **Das Änderungsprotokoll zeigt Namen statt Kennungen** bei Tieren,
  Projekten, Kontakten und Dokumenten; Gelöschtes erscheint als gelöscht.

### Behoben

- **Das Änderungsprotokoll speicherte bei Kontakten Namen und Anschriften.**
  Neue Einträge nennen nur die geänderten Felder; den Namen zeigt die Ansicht
  live aus dem Kontakt. Ältere Einträge bleiben, wie sie sind.
- **„Heute“ galt in UTC.** Zwischen Mitternacht und ein bzw. zwei Uhr lag der
  heutige Tag in der Zukunft, Fristen liefen eine Stunde versetzt, und am
  1. Januar konnte ein Dokument die Nummer des Vorjahrs bekommen. Tag und
  Nummernjahr gelten jetzt in der Zeitzone des Vereins.
- **Ausgeschaltete Module waren über eine direkte Adresse erreichbar** — Akte,
  Kontakte und Projekte samt Dateien und Export. Jetzt steht dort ein Hinweis.
- **Die Bezüge eines Dokuments** stehen in der Reihenfolge, in der sie
  angelegt wurden.
- **Fehlendes Schreibrecht fiel erst beim ersten Upload auf**, mit einer
  stillen Meldung. Kompass legt die Ablagen der Module beim Start an und
  meldet den Pfad sofort.
- **Regelverstöße der Datenbank** brachen die Oberfläche ab und kamen über MCP
  als roher Text an. Jetzt steht dort ein verständlicher Satz.
- **Prüfmeldungen** kamen über MCP auf Englisch und in der Oberfläche oft nur
  als „Ungültiger Wert.“; jetzt nennen beide dieselbe deutsche Meldung.
- **Das MCP-Werkzeug zum Anlegen von Kontakten** bot Agenten nur Personen an,
  jetzt auch Organisationen.
- **Der Verbindungstest vor dem Publizieren** zeigte jede Datei am Ziel als
  „würde entfernt“. Jetzt trennt er, was am Ziel liegt und was ein Publish
  ändern würde.
- **„Vorschau öffnen“** unter Webseite → Publizieren öffnet einen eigenen Tab;
  Prüfergebnis und Vorschau gehen beim Zurückgehen nicht mehr verloren.

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

[0.2.4]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DigiJoe79/Aluna-Kompass/releases/tag/v0.1.0
