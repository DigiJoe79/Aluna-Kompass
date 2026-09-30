# Änderungen

Alle nennenswerten Änderungen an Aluna Kompass, für die Menschen, die eine
Installation betreiben. Was sich unter der Haube ändert, steht im Git-Verlauf;
hier steht, was ein Verein davon merkt.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Nummern folgen [Semantic Versioning](https://semver.org/lang/de/). Vor
1.0.0 kann jede Minor-Fassung Brüche enthalten — was bricht, steht unter
**Geändert** mit dem, was zu tun ist.

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

[0.2.2]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DigiJoe79/Aluna-Kompass/releases/tag/v0.1.0
