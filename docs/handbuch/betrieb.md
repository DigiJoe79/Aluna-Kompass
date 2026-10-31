# Betrieb

Kompass läuft als ein Docker-Image auf einem Rechner im Netz des Vereins — ein
NAS, ein kleiner Server, was vorhanden ist. Diese Seite beschreibt
Erstinstallation, Update, Backups und den Weg der Webseite zum Hoster, für die
Person, die diesen Rechner betreut.

## Voraussetzungen

- **Docker** mit Compose, auf amd64 oder arm64. Das veröffentlichte Image ist
  für amd64 gebaut; auf anderer Architektur baut man es selbst (`pnpm image`).
- **Platz:** rund 1,6 GB für das Image, dazu die Daten des Vereins. Die Datenbank
  bleibt lange klein; den Ausschlag geben abgelegte Dokumente und Medien.
- **Arbeitsspeicher:** 1 GB reicht im Alltag. Beim Bauen der Webseite und bei
  der Texterkennung steigt der Bedarf kurzzeitig; auf einem Gerät mit 2 GB
  läuft beides ohne Enge.
- Ein Verzeichnis für die Daten, das Neustarts und Updates überlebt, und ein
  zweites für die Backups.

## Erstinstallation

1. **Verzeichnisse anlegen** — eines für die Daten, eines für die Medien, zum
   Beispiel `kompass/data` und `kompass/media`. **Datenverzeichnis gehört UID
   1000:** Der Container schreibt als Benutzer 1000; `data/` selbst muss ihm
   deshalb gehören — `chown 1000:1000 data` (**ohne** `-R`). Die Unterordner
   je Modul (`core`, `finance`, `dms`, `site`, …) legt der Container beim
   Start selbst an und prüft sie dabei auf Schreibbarkeit; ein `-R` wäre hier
   unnötig und griffe in einen bind-gemounteten Ordner (etwa Medien) hinein,
   dessen Besitz man gerade nicht ändern will. Fehlt der Besitz, bricht der
   Start mit einer Meldung ab, die den Pfad nennt, statt erst beim ersten
   Beleg mit einem stillen Fehler zu scheitern. Wer Daten von einer anderen
   Instanz übernimmt, etwa mit `rsync -a`, übernimmt damit auch deren
   Besitzer — den `chown` danach noch einmal ausführen.

2. **Umgebungsdatei** aus `.env.prod.example` erstellen. Pflicht ist
   `SESSION_SECRET` mit mindestens 32 zufälligen Zeichen, etwa aus
   `openssl rand -hex 24`. Wer Test und Produktion getrennt betreibt, gibt
   jeder Umgebung einen eigenen Wert — sonst gälten Sitzungen aus der einen
   auch in der anderen.

3. **Nur wenn die Webseite von hier aus veröffentlicht wird:** die
   Zugangsdaten zum Hoster in eine Datei legen (siehe „Webseite“). Dieses
   Verzeichnis liegt **neben** dem Datenverzeichnis, nicht darin: Das Backup
   bildet die Daten ab, und ein Geheimnis darf in kein Archiv geraten, das man
   herunterlädt und weitergibt.

4. **Container starten**, mit `docker-compose.prod.yml` als Vorlage. Die Pfade
   darin sind Beispiele und werden auf die eigenen angepasst. Die Vorlage legt
   neben `/data` ein benanntes Volume für `/cache` an (Bild-Cache und Vorschau
   der Webseite). Wer stattdessen ein Verzeichnis einhängt, gibt es UID 1000
   wie das Datenverzeichnis. Dazu kommt das Verzeichnis für `/backups`, etwa
   `kompass/backups`: Besitzer ebenfalls UID 1000 (`chown 1000:1000 backups`),
   und **nie unter dem Datenverzeichnis** — sonst trüge jedes Backup die
   vorigen mit, und Kompass verweigert den Start. Fehlt der Mount, startet
   Kompass trotzdem, warnt aber (siehe „Backups“).

   ```
   docker compose -f docker-compose.prod.yml up -d
   ```

5. **Aufrufen** — `http://<rechner>:3000`. Der erste Aufruf zeigt die
   Einrichtungsseite, genau einmal: Vereinsname, erstes Konto, Sprachen.

6. **Health prüfen** — `http://<rechner>:3000/api/health` nennt Fassung,
   Umgebung und Migrationsstand.

### Das Fenster bis zur Einrichtung

Zwischen dem ersten Start und dem Anlegen des ersten Kontos nimmt Kompass die
Einrichtung von jedem an, der die Adresse erreicht — auch das Einspielen eines
Backups. Anders ginge es nicht: Vor dem ersten Konto gibt es niemanden, an dem
sich eine Anmeldung prüfen ließe.

Im Netz eines Vereins ist das in aller Regel unproblematisch, und das Fenster
ist meist wenige Minuten lang. Wenn Sie in dieser Zeit nicht ausschließen
können, dass jemand anders auf den Container zugreift — etwa weil das Netz
einen Gastzugang hat, weil der Port schon nach außen freigegeben ist oder weil
zwischen Start und Einrichtung längere Zeit liegt —, binden Sie ihn bis zum
Abschluss der Einrichtung nur lokal. Im Compose:

```yaml
ports: ["127.0.0.1:3000:3000"]
```

Danach den Eintrag zurückändern und die Anwendung neu starten. Wer den
Container ohnehin erst startet, wenn er direkt davorsitzt, braucht das nicht.

## Zwei Umgebungen

Wer vor einer Änderung ausprobieren will, wie sie sich auswirkt, betreibt eine
zweite Installation als Testumgebung — eigener Port, eigene Verzeichnisse,
eigene Umgebungsdatei mit `APP_ENV=test`. Außerhalb der Produktion zeigt
Kompass einen Umgebungsbalken, damit niemand die beiden verwechselt: im Test
ocker mit Schraffur (echte Daten, Vorsicht), in der Entwicklung dunkelgrau.

Daten aus der Produktion in den Test holen: dort ein Backup herunterladen, hier
hochladen und einspielen (System › Backup). Danach sind im Test alle Sitzungen
beendet, die Anmeldung läuft mit den Zugangsdaten aus der Produktion. API-Tokens
und Backup-Einstellungen des Tests bleiben, wie sie waren.

Der umgekehrte Weg ist keine gute Idee: Der Test enthält Probierdaten, und die
gehören nicht in die Aufzeichnung, aus der der Verein Rechenschaft ablegt.

## Rollen nach einem Update

Kompass ändert die Rollen einer Installation nie von selbst. Bringt eine neue
Fassung ein neues Recht mit, bekommen es nur die Rollenvorschläge neuer
Installationen; bestehende Rollen ergänzen Sie unter **Einrichtung › Rollen**.
Mit 0.4.0 betrifft das die Rolle *Kassenprüfer*: Sie braucht das Recht
*Kassenprüfung*, damit Prüfer Vermerke, Stichproben und den Prüfbericht in
Kompass schreiben können (siehe [Kassenprüfung](finanzen/kassenpruefung.md)).

## Update

1. **Backup vor Update:** Kompass sichert sich beim Start selbst, wenn
   Migrationen anstehen — ein Backup der Art „Vor Update“ im
   Backup-Verzeichnis, bevor irgendetwas umgebaut wird. Der Start dauert
   deshalb so lange wie ein Backup, und `/api/health` antwortet erst danach.
   Scheitert dieses Backup, startet Kompass **nicht** und migriert nicht; die
   Verantwortlichen bekommen eine Mail, sofern der Versand eingerichtet ist.
   Dann das Log lesen und die Ursache beheben — meist fehlt Platz oder das
   Recht an `/backups`. Nur wenn das nicht geht: einmal mit
   `KOMPASS_SKIP_UPDATE_BACKUP=1` in der Umgebungsdatei starten (ein Start
   ohne Sicherung) **und die Zeile danach wieder entfernen**, sonst fehlt die
   Sicherung auch beim nächsten Update.

2. **Neues Image holen und neu starten.**

   ```
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

   `latest` ist ein beweglicher Tag: Ohne `pull` startet weiter das lokal
   zwischengespeicherte Image. Wer es eindeutig will, trägt statt `latest`
   eine Version ein (`v0.1.0`) — dann ist jede Aktualisierung eine sichtbare
   Änderung der Compose-Datei.

3. **Migrationen** laufen beim Start automatisch. Schlägt eine fehl, startet
   die Anwendung nicht — sie arbeitet nicht auf halb migrierten Daten. Der
   erreichte Stand steht im Health-JSON.

4. **Prüfen:** anmelden, Startseite, `/api/health`. Die Fassung dort sollte die
   neue sein.

### Von 0.1.x auf 0.2.0

Die Fassung 0.2.0 bringt genau eine Migration mit (`0003_finance`). Sie läuft
beim ersten Start des neuen Images von selbst, in einem Zug: Entweder ist sie
danach ganz angewendet, oder die Datenbank bleibt, wie sie war, und die
Anwendung startet nicht. Vorher wie bei jedem Update das Backup aus Schritt 1
exportieren. Danach meldet `/api/health` `migrationCount: 4` statt `3`.

Ein Backup aus 0.1.x lässt sich in 0.2.0 einspielen; es wird beim Einspielen
auf den neuen Stand gebracht. Umgekehrt nicht: Ein Backup aus 0.2.0 weist eine
Installation mit 0.1.x als „aus einer neueren Version“ zurück.

### Von 0.2.0 auf 0.2.1

Die Fassung 0.2.1 bringt genau eine Migration mit (`0004_finance_0_2_1`),
wieder in einem Zug. Danach meldet `/api/health` `migrationCount: 5` statt `4`.

Die Migration legt fest, dass es zu einem Dokument höchstens eine nicht
stornierte offene Zahlung gibt. Hat eine Installation das Modul Finanzen schon
benutzt, vorher prüfen, dass kein Dokument zwei davon hat — sonst scheitert die
Migration, und die Anwendung startet nicht. Auf einer Kopie der Datenbank:

```sql
SELECT document_id, COUNT(*) AS aktive_posten
FROM finance_open_items
WHERE document_id IS NOT NULL AND cancelled_at IS NULL
GROUP BY document_id HAVING COUNT(*) > 1;
```

Liefert die Abfrage Zeilen, je Dokument alle offenen Zahlungen bis auf eine
unter Finanzen → Offene Zahlungen stornieren und dann aktualisieren.

### Von 0.2.1 auf 0.2.2

Die Fassung 0.2.2 bringt genau eine Migration mit (`0005_animals_review`): zwei
neue Spalten an den Tierprofilen für den Prüfmerker. Sie läuft beim Start von
selbst und ändert keine bestehenden Werte; kein Profil hat danach einen Merker.
Danach meldet `/api/health` `migrationCount: 6` statt `5`.

Drei Dinge sind nach dem Update von Hand zu tun oder zu wissen:

- **MCP-Clients, die `animals_list` lesen**, müssen vor dem Update angepasst
  sein: Die Antwort ist ein Objekt `{ animals, total, reviewPending }` mit
  knappen Zeilen statt einer Liste voller Profile. Texte, Fotos und Geschichte
  eines Tiers liefert `animals_get`.
- **Bestehende Tierprofile haben keinen Prüfmerker.** Wer Profile, die ein
  Agent vor dem Update angelegt hat, noch von einem Menschen prüfen lassen
  will, merkt sie einmalig über `animals_request_review` vor.
- **Der Auszug des Änderungsprotokolls** erscheint jetzt auf der Basis
  `a4-plain-slim`. Wer unter Einrichtung → Dokumentvorlagen für den Export früher
  eine Basis fest eingestellt hat, sieht die Zeile dort als „abweichend“ und
  stellt sie mit „Zurücksetzen“ auf die neue Vorgabe. Wer eigene Basis-Vorlagen
  führt und den Auszug im eigenen Kopf haben will, legt eine
  `a4-plain-slim.typ` daneben.
- **Der Bildausschnitt der Tierfotos** steht auf 4:3 mittig. Zeigt das Template
  der Webseite das Hauptfoto in einem anderen Format, unter Einrichtung →
  Tiere einmal Seitenverhältnis und Blickpunkt eintragen.

Wer eine eigene Compose-Datei führt, übernimmt außerdem aus
`docker-compose.prod.yml` den Block `networks` (MTU 1400 für das
Veröffentlichen) und `stop_grace_period: 60s`: Beim Stopp schreibt Kompass die
Nebendatei `kompass.db-wal` in `kompass.db`; ohne Frist beendet Docker den
Container nach 10 Sekunden hart.

### Von 0.2.2 auf 0.2.3

Die Fassung 0.2.3 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`. Nach dem Update ist nichts von Hand zu tun.

Für MCP-Clients: Ein Protokolleintrag `animals.setPhotos` trägt in Vorher und
Nachher jetzt ein Objekt `{ photos, reviewRequestedAt }` statt der bloßen
Fotoliste. Ältere Einträge behalten ihre Form. `media_get` kennt den neuen,
optionalen Parameter `variant`.

### Von 0.2.3 auf 0.2.4

Die Fassung 0.2.4 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`. Ordner, Dokumente und Medien bleiben, wo sie sind.

Vor dem Update zu wissen:

- **MCP-Clients, die die Webseite bauen oder publizieren**, müssen angepasst
  sein: `site_preview_build`, `site_publish` und `site_deploy_check` kehren
  sofort mit `{ started, runId, startedAt }` zurück. Das Ergebnis liefert das
  neue Werkzeug `site_job_result` mit `kind` (`preview`, `publish` oder
  `deployCheck`); abfragen, bis `last.runId` der `runId` des Starts ist.
  Einem Assistenten, der sich Abläufe notiert hat, das einmal sagen.
- **Kein Lauf sollte während des Updates laufen.** Ein Publish, der beim
  Neustart des Containers unterbrochen wird, blockiert zwar keinen späteren
  Lauf mehr, ist aber nicht fertig; danach einfach neu starten.

Nach dem Update ist nichts von Hand zu tun. Ordner pflegt man jetzt in der
Akte selbst statt unter Verwaltung. Neu für MCP-Clients sind
`dms_move_folder` und `dms_create_response`; `dms_move` und `media_move`
nehmen den erwarteten Ort entgegen, `dms_list` und `media_list` den Schalter
`includeSubfolders`. Eigene Themes übernehmen die sechs neuen Farben des
Ordnerbaums aus der Vorgabe.

**Wenn etwas schiefgeht:** Es gibt keinen Weg zurück in eine ältere Fassung der
Datenbank — Migrationen laufen nur vorwärts. Der Rückweg ist das Backup aus
Schritt 1: altes Image eintragen, Container starten, Backup einspielen.
Deshalb Schritt 1 nicht überspringen.

### Von 0.2.4 auf 0.2.5

Die Fassung 0.2.5 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`.

Vor dem Update:

- **Speicherort für `/cache` eintragen** — die Zeile `- kompass-prod-cache:/cache`
  und den Block `volumes:` aus `docker-compose.prod.yml` übernehmen (Test
  entsprechend). Wer seine Daten als Verzeichnisse einhängt, nimmt stattdessen
  ein Verzeichnis **neben** dem Datenverzeichnis, nicht darin (es gehört nicht
  ins Backup), mit Besitzer UID 1000. Ohne Speicherort läuft alles, aber nach
  jedem Update erzeugt der erste Bau alle Bildvarianten neu und dauert
  entsprechend länger.
- **MCP-Clients**, die publizieren, übergeben `expectedContentHash` aus der
  Vorschau; ohne ihn lehnt `site_publish` ab. `site_deploy_check` prüft nur
  noch die Verbindung und liefert `passed` und `checks` statt einer Liste,
  was ein Publish ändern würde.

Nach dem Update:

- Die erste Vorschau erzeugt alle Bildvarianten einmal neu (der Cache trägt
  jetzt eine Version) und dauert bei vielen Fotos einige Minuten. Die Seite
  Publizieren weist darauf hin.

### Von 0.2.5 auf 0.2.6

Die Fassung 0.2.6 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`. Es ändert sich nur die Oberfläche.

Vor dem Update ist nichts Besonderes zu prüfen. Ein Backup (Schritt 1) gehört
wie immer dazu.

Nach dem Update gibt es zwei Handgriffe für die neuen Tierprofile als PDF:

- Unter Einrichtung → Tiere die **Adresse des Online-Profils** eintragen, mit
  `{slug}` als Platzhalter. Ohne sie tragen die PDF-Profile keinen QR-Code, und
  unter dem Namen eines Tiers steht keine Adresse mehr.
- Rollen, die Profile drucken sollen, brauchen das Recht „Dokumente erzeugen“
  (`documents.export`).

Sonst ist nichts von Hand zu tun. Wer sich wundert:

- **Listen wirken niedriger oder höher als vorher.** Die Zeilenhöhe aller
  Listen folgt jetzt der Dichte-Einstellung im Profil („Zeilendichte“ im
  Nutzermenü); wählen Sie dort „normal“ oder „kompakt“.
- **Anlegen und Löschen wandern.** Neue Tiere, Projekte, Partner und
  Webseiten-Einträge legen Sie auf einer eigenen Seite an; Löschen und
  Archivieren steht als letzter Abschnitt der Detailseite.
- **Lesezeichen auf Einstellungsseiten** (Verein, Finanzen, Webseite, Akte)
  führen weiter an die richtige Stelle; der gewählte Reiter steht jetzt in der
  Adresse.
- **Seiten sind schmaler als das Fenster.** Formulare, Detailseiten und
  Einstellungen enden bei 1.200 Pixeln, linksbündig; nur Listen und
  Arbeitsflächen nutzen die ganze Breite. Das ist Absicht: Felder werden auf
  großen Bildschirmen nicht mehr überbreit.
- **Template-Autoren** können mit den neuen Feldoptionen `size` und `group` die
  Eingabemaske ordnen; ohne sie bekommt jedes Feld eine Breite nach seinem Typ.
- MCP-Clients sind nicht betroffen.

### Von 0.5.0 auf 0.5.1

Die Fassung 0.5.1 bringt eine Migration mit
(`0013_dms_unclassified_labels_0_5_1`): Die Dokumentarten „Unklassifiziert
(Eingang)“ und „Unklassifiziert (Ausgang)“ heißen danach „Eingang ohne
Zuordnung“ und „Ausgang ohne Zuordnung“; wer sie selbst umbenannt hat, behält
seinen Namen. `/api/health` meldet danach `migrationCount: 14`. Ein Backup
(Schritt 1) gehört wie immer dazu. Handgriffe sind nicht nötig.

- **Eigene Dokument-Basen:** Das Tierprofil-PDF zeigt oben die Beschriftung
  statt des Datums, dafür bekommen die Basen `a4-plain` und `a4-plain-slim` die
  Slots `hideDate` und `headerLabel`. Eine eigene Basis mit derselben Kennung
  zeigt weiter das Datum, bis sie beide auswertet und in `slots` nennt.
- **Ablehnungen:** Sie stehen jetzt im Wortlaut der Sprachdatei. Wo der Dienst
  bisher einen Namen oder eine Nummer in den Satz einsetzte, fehlt dieser Wert
  teils. Abläufe, die Texte von Ablehnungen auswerten, sollten den `code`
  lesen, nicht den Satz.
- **Mindestbeitrag:** Geht die Umrechnung in einen anderen Rhythmus nicht auf,
  gilt der abgerundete Betrag. Bestehende Vereinbarungen ändern sich nicht.

### Von 0.4.0 auf 0.5.0

Die Fassung 0.5.0 bringt eine Migration mit
(`0012_governance_annual_accounts_0_5_0`): die Tabellen der Gremien, der
Jahresrechnung und der Mittelverwendung samt ihren Sperren. `/api/health`
meldet danach `migrationCount: 13`. Ein Backup (Schritt 1) gehört wie immer
dazu.

**Gremien einschalten und übernehmen.** Der Bereich Gremien ist nach dem
Update aus. Unter **Einrichtung → Module** einschalten, dann den Rollen, die
Sitzungen vorbereiten und protokollieren, die Rechte der Gremien geben (siehe
„Rollen nach einem Update“). Danach unter **Gremien** Organe und Ämter anlegen,
die Satzung mit ihrem eingetragenen Stand erfassen. Alte Sitzungen brauchen Sie
für den Start nicht; siehe „Vergangene Sitzungen nachtragen“ im Kapitel Sitzungen.
Bestehende Kontaktrollen *Vorstandsmitglied* und *Schatzmeister*
ordnet „Bestehende Rollen übernehmen“ einem Amt zu, statt sie doppelt anzulegen.
Solange Gremien eingeschaltet ist, führt es diese beiden Rollen: von Hand lassen
sie sich nicht mehr anlegen, Altzeilen ohne Amt aber weiter beenden.

**Schalter für Agenten an einer Stelle.** Die Schalter „Darf ein Agent …?“
stehen jetzt unter **Verwaltung → Agenten** statt in den Einstellungen von
Backup, Akte, Finanzen und Mitgliedern. Gesetzte Werte bleiben.

**Festgeschriebene Berichte können auf „Prüfung“ zurückfallen.** Kompass ordnet
Zeitpunkte jetzt nach der Zeitzone des Vereins einem Tag und Geschäftsjahr zu,
nicht mehr nach der Weltzeit (UTC). Betroffen ist nur, was zwischen Mitternacht
und 1 Uhr (Sommerzeit: 2 Uhr) geschah. Ein festgeschriebener **Kassenbericht**
(Korrektur an einem Vorjahr, in diesem Zeitfenster angewandt) oder eine
**Belegprüfung** (mehrfach verwendeter Nachweis, in diesem Zeitfenster
hinzugefügt oder eingereicht) zeigt dann einen anderen Tag und fällt auf
„Prüfung“ zurück; die **Zweckmittel-Aufstellung** nur, wenn ein Zweck in der
Neujahrsnacht angelegt, erfüllt oder aufgelöst wurde. Nach dem Update unter
Finanzen → Rechenschaft → Berichte die Stufe der festgeschriebenen Berichte
ansehen und einen zurückgefallenen Bericht neu festschreiben.

**Voranmeldungszeitraum bei „automatisch“.** Ob Kompass monatliche oder
vierteljährliche Umsatzsteuer-Voranmeldungen erwartet, rechnet es jetzt mit der
Zahllast des Vorjahres, wie die Voranmeldung sie ausweist (Erstattungen und
§ 13b-Gutschriften mindern, Steuersatz am Entstehungstag). Lag das Vorjahr knapp
über 9.000 €, kann ein Jahr von Monaten auf Quartale wechseln — dann gehören
festgeschriebene Voranmeldungen dieses Jahres nicht mehr zu den erwarteten
Zeiträumen. Wer den Voranmeldungszeitraum im Reiter Umsatzsteuer der Finanz-Einrichtung fest eingestellt
hat, ist nicht betroffen.

**Kategorien nach DZI prüfen.** Der neue Bericht Jahresrechnung teilt die
Ausgaben nach der Kostenart der Kategorie in Programm, Werbung und Verwaltung.
Das Update bringt die Kategorie „Webseite und Öffentlichkeitsarbeit“
(**Werbung**) mit; neue Installationen ordnen außerdem Zahlungsdienstgebühren
der **Verwaltung** zu. Bestehende Kategorien ändert das Update nicht. Danach
unter Einrichtung → Finanzen → Kategorien prüfen: „Gebühren Zahlungsdienst“ auf
Verwaltung, Ausgaben für Webseite und Öffentlichkeitsarbeit künftig auf die neue
Kategorie, und an „Auszahlung Spendenplattform“ das Merkmal Spendenplattform
(„bestätigt selbst“).

**Adresse der Installation.** Neue Umgebungsvariable `KOMPASS_PUBLIC_URL`: Mit
ihr tragen Mails zu zugewiesenen Wiedervorlagen einen Link (siehe
„E-Mail-Versand einrichten“). Nach dem Eintragen in die Umgebungsdatei den
Container neu erzeugen, nicht nur neu starten.

**Jahresrechnung abzeichnen und publizieren.** Abzeichnen kann ein
Vorstandsmitglied mit „vertritt nach § 26 BGB“ an seiner Rolle, in Kompass nur
mit verknüpftem Konto und dem Recht „Finanzen lesen“. Geben Sie der Rolle Ihres
Vorstands `finance.read` und verknüpfen Sie die Konten der Vorstände mit ihren
Kontakten; sonst bleibt der Weg über den unterschriebenen Scan. Neu ist die
Einstellung „Die MV genehmigt die Jahresrechnung“ der Berichte (Vorgabe aus) —
nach der Satzung setzen. Templates können
die bereitgestellte Jahresrechnung über die Sicht `annualAccounts` zeigen
(`uses: ['finance']`, siehe [Template schreiben](webseite/template-schreiben.md)).

**Mittelverwendungsrechnung.** Kommt ein Verein mit Vorjahren zu Kompass und
lag über der Grenze, den Anfangsvortrag erfassen, solange das erste Kompass-Jahr
offen ist (siehe [Mittelverwendung](finanzen/mittelverwendung.md)). Schon
abgeschlossene Jahre mit Einnahmen über der Grenze bekommen nach dem Update
einen offenen Schritt 13 „Mittelverwendung festschreiben“. Ohne Jahreswahl
zeigt der Jahresabschluss das jüngste beendete Jahr, das nicht fertig ist — das
kann dann ein solches älteres Jahr sein, bis seine Rechnung festgeschrieben ist.

### Von 0.3.2 auf 0.4.0

Die Fassung 0.4.0 bringt eine Migration mit
(`0011_finance_accountability_0_4_0`): neue Tabellen und Sperren für die
Rechenschaft in den Finanzen und Überträge bestehender Werte (Steuererklärung,
Umsatzsteuer-Einstellung, Kennzeichen § 13b; siehe unten). `/api/health`
meldet danach `migrationCount: 12`. Ein Backup (Schritt 1) gehört wie immer
dazu.

Handgriffe nach dem Update (Rechenschaft, Jahresabschluss):

- **Rolle Kassenprüfer:** Unter **Einrichtung › Rollen** der Rolle das neue Recht *Kassenprüfung* geben (siehe
  „Rollen nach einem Update“); sonst schreiben Prüfer keine Vermerke und keinen Prüfbericht in Kompass.
- **Kategorien für die Freigrenze:** Unter **Einrichtung › Finanzen › Kategorien** bei bestehenden Kategorien das
  Merkmal *Für die Freigrenze* setzen — *erstattete Umsatzsteuer* für die USt-Erstattung, *nicht leistungsbezogen* für
  Zuschüsse, Darlehen oder Versicherungsleistungen im wirtschaftlichen Geschäftsbetrieb. Neue Installationen bringen es
  bei der USt-Erstattung schon mit.
- **Schatzmeister pflegen:** Die neue Kontaktrolle *Schatzmeister* mit Zeitraum am Kontakt der Person eintragen. Kompass
  schlägt sie bei der Amtsübergabe vor und führt sie in der Entlastungsliste der Mitgliederversammlung.
- **Kontoauszüge als PDF:** Für jedes abgeschlossene Jahr, dessen Berichte noch festgeschrieben werden, je Bankkonto den
  Auszug zum Stichtag ablegen oder das Fehlen begründen — sonst lehnt das Festschreiben ab.
- **Steuererklärung:** Wo am Geschäftsjahr „Steuererklärung abgegeben am“ stand, legt das Update je Jahr einen
  einjährigen Erklärungszeitraum mit diesem Tag und der Frist 31.07. des Folgejahres an; er steht unter
  **Finanzen › Steuererklärung**. Mehrjährige Zeiträume lassen sich daraus nicht bilden; künftige Zeiträume legen Sie so
  an, wie das Finanzamt sie anfordert.
- **Kategorien für die Anlage Gem:** Neue Installationen bringen „Miet- und Pachteinnahmen“, „Mitgliederbetreuung“ und
  „Zuwendungen an Mitglieder“ mit; bestehende legen sie bei Bedarf unter **Einrichtung › Finanzen › Kategorien** selbst
  an (Einnahmeart *Miete und Pacht* in der Vermögensverwaltung, die beiden anderen als Ausgaben im ideellen Bereich).
- **Kennzeichen § 13b:** Das Update teilt „Reverse Charge (§ 13b)“ in „Leistung aus dem EU-Ausland“ und „übrige
  Leistungen“ — Buchungszeilen nach dem Land des Kontakts oder der IBAN des Kontoumsatzes, Importregeln nach ihrem
  Kontakt. Kategorien mit dieser Vorgabe und Importregeln ohne Kontakt stehen danach auf „EU-Ausland“; bitte unter
  **Einrichtung › Finanzen › Kategorien** und den Regeln der Arbeitsliste prüfen.
- **Umsatzsteuer-Einstellung:** Die Frage „Unternehmer oder USt-IdNr.?“ wird zur datierten Einstellung
  „umsatzsteuerlich Unternehmer“; ein bisheriges „Ja“ gilt ab 2000. USt-IdNr., Voranmeldungszeitraum und Bundesland des
  Finanzamts tragen Sie nach (siehe Handbuch „Finanzen einrichten“).
- **Hinweise zu § 13b im Startplan:** Die Kategorien „Gebühren Zahlungsdienst“, „Software und Internet“ und „Werbung
  und Spendenaufrufe“ erklären nur in neuen Installationen, wann § 13b gilt; bestehende Kategorien bleiben, wie sie
  sind.

### Von 0.3.1 auf 0.3.2

Die Fassung 0.3.2 macht Backups zu einem Hintergrundlauf mit eigenem
Verzeichnis, Ring und Prüfung (siehe „Backups“). Sie bringt **keine
Migration** mit; `/api/health` meldet weiter `migrationCount: 11`. Deshalb
entsteht beim Start auch kein Backup „vor Update“.

Vor dem Update:

1. **Ein letztes Backup mit 0.3.1** wie bisher unter System › Backup
   exportieren und aufheben. Es ist das letzte im alten Format (`.tar.gz`);
   0.3.2 spielt es nicht mehr ein, eine Instanz mit 0.3.1 schon.
2. **Verzeichnis anlegen:** `backups` neben `data`, Besitzer UID 1000
   (`chown 1000:1000 backups`), nicht unter `data`.
3. **Mount ergänzen:** in der Compose-Datei unter `volumes` die Zeile
   `- /pfad/zu/kompass/backups:/backups` (Vorlage: `docker-compose.prod.yml`).

Dann das Image holen und starten wie unter „Update“. Danach:

4. **Prüfen, dass das Verzeichnis eingehängt ist:** Die Backup-Seite zeigt
   keine Warnung „nicht eingehängt“.
5. **Ein Backup von Hand** erstellen (System › Backup, „Backup erstellen“);
   es ist das erste im neuen Format und wird gleich geprüft.
6. **Zeitplan einschalten:** im Reiter „Einstellungen“ unter „Automatisch
   sichern“, Uhrzeit nach Wunsch (Vorgabe 03:00). Wie viele Tages-, Wochen-
   und Monatsstände bleiben (Vorgabe 7, 4 und 12) und die Frist für die
   Warnung (Vorgabe 30 Tage) stehen darunter. Per Agent geht es mit
   `settings_set` und `backup.schedule.enabled`.
7. **Kopie außer Haus** für das neue Verzeichnis einrichten (Abschnitt
   „Backups“).

Wer sich wundert:

- Ein Agent darf ein Backup nur einspielen, wenn das in den
  Backup-Einstellungen erlaubt ist („Darf ein Agent ein Backup einspielen?“,
  Vorgabe aus); umschalten lässt sich das nur in der Oberfläche.
- Die Ersteinrichtung aus einem Backup liest nur noch das neue Format.

### Von 0.3.0 auf 0.3.1

Die Fassung 0.3.1 bringt eine Migration mit (`0010`): eine neue Spalte an
den Dateien der Mediathek (`ai_kind`, für alle bestehenden Dateien „keine“)
und vier Sperren in den Finanzen, die bisher nur der Dienst hielt
(Versandvermerk einer Zuwendungsbestätigung, Warnungen eines abgeschlossenen
Einlesens, Herkunft und Treffer eingelesener Umsätze). Sie ändert keine
bestehenden Werte. `/api/health` meldet danach `migrationCount: 11`. Vor dem
Update ist nichts Besonderes zu prüfen; ein Backup (Schritt 1) gehört wie
immer dazu. Ein Backup aus 0.3.1 lässt sich in 0.3.0 nicht mehr einspielen.

Nichts Neues ist nach dem Update von selbst an. Wer die Bildkennzeichnung
nutzen will:

- **Einschalten** unter Einrichtung → Stammdaten → Medien, „Bildkennzeichnung
  verwenden“. Die Marken („Bearbeitet“, „KI“) und Sätze für die Webseite
  haben neutrale Vorgaben je Sprache; der Verein passt sie dort an.
- **Webseiten-Vorlage prüfen.** Die mitgelieferte `verein-basis` zeigt die
  Marken. Eine eigene Vorlage zeigt sie erst, wenn sie die Sicht
  `aiLabeling` liest; an bearbeiteten Bildern steht bis zu ihrer Anpassung die
  Marke erstellter Bilder (`mark`), nicht `editedMark`. Danach einmal
  „Vorschau bauen“ und publizieren.
- **Bestehende Bilder kennzeichnen**, wo nötig: in der Mediathek im
  Detaildialog, an der Fotokachel eines Tiers oder am Bildfeld
  („Kennzeichnen …“), oder per MCP (`media_set_ai_kind`). Neue Bilder fragt
  Kompass gleich beim Hochladen. Kennzeichnen darf, wer Dateien hochladen
  darf (`media.upload`); ein neues Recht gibt es nicht.

Wer sich wundert:

- Ist die Bildkennzeichnung eingeschaltet, folgt auf jedes Hochladen von
  Bildern ein kurzer Schritt „Bildkennzeichnung“. Vorbelegt ist „Keine“;
  „Fertig“ genügt, wenn nichts zu kennzeichnen ist.

### Von 0.2.12 auf 0.3.0

Die Fassung 0.3.0 bringt eine Migration mit (`0009`): neue Tabellen für
Mitglieder, Lastschrift und den Ausgang der Akte sowie neue Spalten an
Kontakten, Dokumenten und Finanzen. Sie ändert keine bestehenden Werte;
Dokumente, die schon festgeschrieben oder abgelegt sind, bekommen nur ihren
Ablagezeitpunkt nachgetragen (den Zeitpunkt, an dem sie angelegt wurden).
`/api/health` meldet danach `migrationCount: 10`. Vor dem Update ist nichts
Besonderes zu prüfen; ein Backup (Schritt 1) gehört wie immer dazu. Ein Backup aus 0.3.0 lässt sich in
0.2.12 nicht mehr einspielen. Wer von 0.2.10 oder älter kommt, aktualisiert
direkt auf 0.3.0 und erledigt danach auch die Schritte der Abschnitte
dazwischen.

Nichts Neues ist nach dem Update von selbst an. Was der Verein nutzen will,
richtet er so ein:

- **E-Mail-Versand: Mailserver eintragen.** Die Variablen
  `KOMPASS_SMTP_HOST`, `KOMPASS_SMTP_TLS`, `KOMPASS_SMTP_USER` und
  `KOMPASS_SMTP_PASSWORD` gehören in die Umgebungsdatei der Installation
  (Abschnitt „E-Mail-Versand einrichten“ weiter unten); die
  Compose-Vorlagen nennen sie als Kommentar. Eine geänderte Umgebungsdatei
  liest der Container erst beim Neuerstellen
  (`docker compose -f docker-compose.prod.yml up -d --force-recreate`), nicht
  bei einem bloßen Neustart. Ohne `KOMPASS_SMTP_HOST` bleibt der Versand aus,
  und Kompass bietet weiter nur Post.
- **Testumgebung: Umleitung setzen.** Außerhalb der Produktion sendet Kompass
  nur mit `KOMPASS_MAIL_REDIRECT`, und dann jede Mail an diese Adresse. Ohne
  sie bleiben Briefe als „gesperrt“ im Ausgang. Wer Daten aus der Produktion
  in den Test holt, schreibt so keine echten Kontakte an.
- **Absender eintragen.** Unter Einrichtung → Akte → Versand Absender-Adresse
  und -Name, nach Wunsch Antwortadresse und Begleittext je Dokumentart, dann
  „Testmail an mich senden“.
- **Rechte vergeben.** Die neuen Rechte „Dokumente per E-Mail versenden“
  (`dms.send`) und „Lastschrift vorbereiten“ (`finance.directDebit`) kommen an
  keine bestehende Rolle von selbst; geben Sie sie unter Verwaltung → Rollen
  den Rollen, die Briefe verschicken bzw. die Kasse führen.
- **Modul Mitglieder einschalten**, wenn der Verein es nutzen will:
  Einrichtung → Module. Es braucht Kontakte, Finanzen und Akte. Beim
  Einschalten legt es die Rolle „Mitgliederverwaltung“ (mit Versand und
  Festschreiben von Briefen der Akte), drei Mitgliedsarten, die Briefarten und
  die Textbausteine der Mahnstufen an; die Rolle vergeben Sie unter
  Verwaltung → Rollen bzw. Nutzer. Vor dem ersten Mitglied unter Einrichtung →
  Mitglieder eine Beitragsordnung anlegen, die Mitgliedsarten prüfen und für
  Mitglieder mit vorhandenen Nummern die nächste Nummer setzen. Die
  Textbausteine der Mahnstufen sind neutral; was die Satzung nach einer
  letzten Mahnung vorsieht, schreibt der Verein selbst hinein. Wer das Modul
  schon mit einer Vorabfassung (`0.3.0-dev`) eingeschaltet hatte: Die Rolle
  „Mitgliederverwaltung“ entsteht nur einmal; fehlen ihr „Dokumente per
  E-Mail versenden“ und „Dokumente festschreiben“, ergänzen Sie beide unter
  Verwaltung → Rollen.
- **Lastschrift einrichten**, wenn der Verein selbst einzieht: Einrichtung →
  Finanzen → Lastschrift, „Lastschrift nutzen“ einschalten, Gläubiger-ID,
  Konto, die Fristen aus der Lastschriftvereinbarung der Bank und das Format
  der Mandatsreferenz eintragen (siehe
  [Lastschrift einrichten](finanzen/lastschrift-einrichten.md)). Bis dahin
  zeigt Finanzen → Lastschrift nur den Weg dorthin.
- **Agentenschalter prüfen.** Der Schalter der Finanzen heißt jetzt „Darf ein
  Agent festschreiben und Lastschriften bearbeiten?“ (Einrichtung → Finanzen
  → Steuerliches); wer ihn schon eingeschaltet hatte, gibt einem Agenten
  damit auch Mandate, Lastschriftdateien und Einzüge frei. Mitglieder
  (Einrichtung → Mitglieder → Nummern und Fristen) und Akte (Einrichtung →
  Akte → Versand) haben eigene Schalter, beide aus.

Wer sich wundert:

- **Summen an Projekten und Zwecken.** Eine zurückgegebene oder
  zurückgenommene Spende mindert jetzt die Einnahmen, statt als Ausgabe zu
  zählen. Einnahmen und Ausgaben älterer Rückgaben stehen deshalb anders da,
  ohne dass etwas nachzubuchen ist.
- **Bankverbindungen am Kontakt.** Zuordnungen von vor dem Update heißen
  „Herkunft unbekannt“.
- MCP-Clients sehen die Werkzeuge der Mitglieder erst, wenn das Modul
  eingeschaltet ist.

### Von 0.2.11 auf 0.2.12

Die Fassung 0.2.12 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 9`. Vor dem Update gehört wie immer ein Backup (Schritt 1)
dazu. Wer von 0.2.10 kommt, aktualisiert direkt auf 0.2.12 – die Migration aus
0.2.11 läuft beim Start mit – und erledigt danach auch die Schritte aus „Von
0.2.10 auf 0.2.11“.

Nach dem Update:

- **Vergütung des Vorstands beantworten.** Unter Einrichtung → Finanzen →
  Steuerliches steht die Frage „Sind Pauschalen an Vorstandsmitglieder
  vorgesehen?“ mit Ja und Nein. Der Schritt der Checkliste steht nach dem
  Update einmal offen, auch wenn schon etwas gespeichert war – einmal
  beantworten.
- **Checkliste ansehen.** „Konto mit Anfangsbestand“ ist erst erledigt, wenn
  jedes aktive Bankkonto einen Anfangsbestand hat.

Wer sich wundert:

- **Startseite.** Wer keine eigene Anordnung gespeichert hat, sieht die neue
  Vorgabe: Wer „Finanzen: zu tun“ sieht, bekommt breit und schmal, und fünf
  Kacheln, die Zeilen aus „Finanzen: zu tun“ wiederholen, sind aus – unter
  „Anpassen“ lassen sie sich wieder einschalten. Eine gespeicherte Anordnung
  bleibt erhalten und wird auf Spalten verteilt.
- **„Konten“.** Die Seite „Bankkonten und Kassen“ heißt jetzt „Konten“; die
  Adresse ist gleich.
- **Zeilenaktionen.** Bearbeiten und Löschen stehen im Menü ⋯ am Ende einer
  Zeile.

### Von 0.2.10 auf 0.2.11

Die Fassung 0.2.11 bringt eine Migration mit (`0008`): drei Spalten für den
Bildausschnitt an der Erfolgsgeschichte (vorher, nachher) und am Projektbild.
`/api/health` meldet danach `migrationCount: 9`. Vor dem Update gehört wie
immer ein Backup (Schritt 1) dazu.

Nach dem Update:

- **Template nachziehen, falls es Bildformate nennt.** Ein Template, das
  `ratio`, `width` oder `images` nutzt, setzt 0.2.11 voraus: erst Kompass
  aktualisieren, dann das Template synchronisieren. Ein Template ohne diese
  Angaben läuft unverändert weiter.
- **Einmal publizieren.** Tiere, deren Fotos schon einen Ausschnitt haben,
  erscheinen nach dem Update als „nicht publiziert“, weil die Webseite sie
  jetzt zugeschnitten zeigt. Nach einem Publish der Produktion stimmt die
  Liste wieder.

Wer sich wundert:

- **„System“ statt „Einstellungen“.** Der Bereich unten in der Leiste heißt
  jetzt „System“, die Seite mit Verein, Bank und Branding „Stammdaten“. Die
  Adressen sind gleich geblieben.
- **Der Bild-Cache wird kleiner.** Nach jedem Publish der Produktion löscht
  Kompass Bildvarianten, die der Publish nicht brauchte und die seit 30 Tagen
  kein Lauf benutzt hat. Das Publish-Protokoll nennt, wie viel frei wurde.
- **Gibt das Template das Format des Titelbilds vor**, gilt es statt der
  Einstellung „Bildausschnitt“ der Tiere.
- MCP-Clients sind nicht betroffen; die Werkzeuge nehmen zusätzlich einen
  Ausschnitt an und nennen das erwartete Format.

### Von 0.2.9 auf 0.2.10

Die Fassung 0.2.10 bringt eine Migration mit (`0007`): Tabellen für Vorschläge
von Quellen und ihre Herkunft am Tier sowie der festgehaltene Stand der Webseite
je Publish. `/api/health` meldet danach `migrationCount: 8`. Vor dem Update
gehört wie immer ein Backup (Schritt 1) dazu.

Nach dem Update:

- **Vormerken zur Prüfung.** Es ist jetzt eine Einstellung und standardmäßig
  aus. Wer es weiter nutzen will: Einrichtung → Tiere → „Schreiben über MCP
  zur Prüfung vormerken“ einschalten (MCP: `animals.review.onMcpWrite`).
  Schon gesetzte Merker bleiben stehen.
- **Vorschläge von Quellen** sind aus, bis Sie sie einschalten. Wer einen
  Dienst anbinden will: Einrichtung → Tiere → „Vorschläge von Quellen
  annehmen“ einschalten, den Ordner für Fotos aus Vorschlägen wählen, nach
  Wunsch „Vorschläge im Stapel durchgehen“; dem Nutzer des Dienstes eine Rolle
  mit dem Recht „Tiere vorschlagen“ (`animals.propose`) geben. Siehe
  [Vorschläge prüfen](tiere-vorschlaege.md).

Wer sich wundert:

- **„nicht publiziert“ erscheint erst nach dem ersten Publish.** Kompass
  vergleicht mit dem Stand, den ein Publish der Produktion festgehalten hat;
  Publishes von vor dem Update haben keinen. Bis zum ersten Publish nach dem
  Update zeigt die Kopfzeile nichts.

### Von 0.2.8 auf 0.2.9

Die Fassung 0.2.9 bringt eine Migration mit (`0006`): Das Änderungsprotokoll
speichert statt eines fertigen Satzes nur noch Werte. `/api/health` meldet
danach `migrationCount: 7`. Vor dem Update gehört wie immer ein Backup
(Schritt 1) dazu; danach ist nichts zu tun. Backups von vor dem Update lassen
sich weiter einspielen, die Migration zieht sie hoch.

Wer sich wundert:

- **Alte Protokolleinträge zeigen nur die Aktion.** Ihr gespeicherter Satz
  entfällt mit der Migration; Zeit, Person, Kanal, Datensatz und die
  geänderten Felder bleiben. Neue Einträge zeigen einen Satz mit den Werten.
- **Ein Agent liest `summary` nicht mehr.** `audit_query` und `audit_get`
  liefern stattdessen `params` (Werte der Aktion, Personen als ID) und
  `paramUserNames`. Eigene Auswertungen, die `summary` lasen, brauchen eine
  Anpassung.
- **„Template“ heißt in der Oberfläche „Vorlage der Webseite“.** Die Datei
  selbst heißt weiter `kompass.template.ts`.

### Von 0.2.7 auf 0.2.8

Die Fassung 0.2.8 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`. Sie enthält Sicherheitsupdates der Abhängigkeiten, deshalb
lohnt das Update zügig. Vor und nach dem Update ist nichts Besonderes zu tun;
ein Backup (Schritt 1) gehört wie immer dazu.

Wer sich wundert:

- **Datumsformat „ISO“ und Briefe.** Die Einstellung „Datumsformat“ gilt für
  die Anzeige und für Meldungen, nicht für Schriftstücke: Briefe,
  Zuwendungsbestätigungen und Betreffe in der Akte tragen immer TT.MM.JJJJ.

### Von 0.2.6 auf 0.2.7

Die Fassung 0.2.7 bringt keine Migration mit; `/api/health` meldet weiter
`migrationCount: 6`. Vor und nach dem Update ist nichts Besonderes zu tun; ein
Backup (Schritt 1) gehört wie immer dazu.

Wer sich wundert:

- **„Zurückgelegtes Geld“ zeigt zwei Jahre.** Solange das Vorjahr nicht
  abgeschlossen ist, steht sein Höchstbetrag „vorläufig“ neben dem laufenden
  Jahr; nach dem Abschluss verschwindet es.
- **Ein Agent bekommt bei einer Zuführung zur freien Rücklage eine Ablehnung.**
  Über MCP muss das Jahr (`forFiscalYearId`) angegeben werden, solange Vorjahr
  und laufendes Jahr in Frage kommen; die Meldung nennt beide.

## Backups

Kompass sichert sich selbst: im Hintergrund, mit sichtbarem Fortschritt, in
ein eigenes Verzeichnis. Die Seite dazu liegt unter System › Backup;
Agenten erreichen dieselben Dienste über die Werkzeuge `backup_*`.

**Ablage.** Das Verzeichnis nennt die Umgebungsvariable `BACKUP_PATH`, im Image
`/backups`. Je Backup liegen dort zwei Dateien: das Archiv
`kompass-backup-<umgebung>-<JJJJMMTT-HHMMSS>-<art>.tar` (Datenbank, Dokumente,
Medien, Manifest; ohne Kompression, Format 3) und daneben eine Begleitdatei
`.json` mit Art, Prüfergebnis und Prüfsumme. Sitzungen und API-Tokens bleiben
draußen. Das Archiv enthält alle personenbezogenen Daten des Vereins und gehört
an einen Ort, der so geschützt ist wie die Anwendung selbst.

**Umgebungsvariablen.** `BACKUP_PATH` setzt das Image; ändern muss man es nur,
wer ohne Container betreibt (Vorgabe dann `./backups`). Es darf nicht unter dem
Datenverzeichnis liegen. `KOMPASS_SKIP_UPDATE_BACKUP=1` startet **einmal** ohne
das Backup vor Update (siehe „Update“); die Zeile danach wieder entfernen.

**Arten und Ring.** Automatische Backups laufen nachts, wenn der Zeitplan an
ist; verpasst ein Neustart die Uhrzeit, holt Kompass das Backup im nächsten
Takt nach. Vom Ring bleiben 7 Tages-, 4 Wochen- und 12 Monatsstände. „Von Hand“
hat einen Platz: Das vorige geht erst, wenn das neue die Prüfung bestanden hat.
„Vor Update“, „Vor Einspielen“ und „Hochgeladen“ bleiben 30 Tage; das neueste
je Art bleibt immer. Höchstens drei Backups lassen sich **festhalten**, mit
Namen; sie verlassen jeden Ring, bis man sie freigibt.

**Prüfung.** Jedes Backup wird nach dem Schreiben vollständig gelesen:
Dateiliste und Größen, Zustand der Datenbank, Prüfsumme. Ein gescheitertes
Backup bietet Kompass nicht zum Einspielen an.

**Warnungen und Mails.** Der letzte Fehler steht oben auf der Backup-Seite,
bis wieder ein Backup gelingt, und die Kachel „Backup“ der Startseite wird zur
Warnung. Eine Mail an alle aktiven Nutzer mit dem Recht „Backup exportieren“
geht bei: gescheitertem Backup, gescheiterter Prüfung, gescheitertem Aufräumen,
unterbrochenem Backup, gescheitertem Backup vor Update, nicht beschreibbarem
Verzeichnis. Einmal am Tag zusätzlich: wenn der Platz nur noch für weniger als
zwei weitere Backups reicht, und wenn das Verzeichnis nicht eingehängt ist.
Versendet wird über die E-Mail-Einstellungen der Akte; ohne sie gibt es nur
die Anzeige in Kompass.

**Fehlender Mount.** Liegt `/backups` auf demselben Datenträger wie der
Container selbst, fehlt vermutlich der Mount: Die Backups gingen beim
Neuerstellen des Containers verloren. Kompass startet trotzdem, zeigt die
Warnung aber dauerhaft auf Startseite und Backup-Seite, bis der Mount ergänzt
ist (Erstinstallation, Schritt 4).

**Einspielen.** Aus der Liste oder nach dem Hochladen einer Datei. Vorher legt
Kompass ein Backup „Vor Einspielen“ an und prüft das gewählte. Schon ab dem
Start zeigt jede Anfrage die Wartungsseite, Agenten bekommen 503 — so fehlt
im Backup „Vor Einspielen“ nichts. Läuft gerade ein Lauf der Webseite oder ein
anderer Lauf im Hintergrund (etwa ein Datenexport), lehnt Kompass das
Einspielen ab. API-Tokens und
Backup-Einstellungen dieser Installation bleiben erhalten, alle Sitzungen
enden. Die veröffentlichte Webseite, verschickte Mails und eingereichte
Lastschriftdateien gehen nicht zurück. Scheitert das Einspielen, legt Kompass
den vorigen Stand selbst zurück; nichts geht verloren. Der vorige Stand liegt
während des Einspielens unter `<Datenverzeichnis>/.before-import-<zeit>` und
wird nach Erfolg gelöscht.

**Notfall: Einspielen und Zurücklegen gescheitert.** Dann bleibt Kompass in
Wartung; die Seite nennt eine Kennung `restore-…` und den Ordner, in dem der
vorige Stand liegt. Der Merker `<Backup-Verzeichnis>/.jobs/maintenance.json`
nennt denselben Ordner unter `aside`. Nichts neu installieren, keine Dateien
löschen:

1. Container stoppen.
2. Im Ordner aus `aside` nachsehen (`.before-import-<zeit>` im
   Datenverzeichnis):
   - **Er enthält Daten** (`core` und die Ordner der Module): Alles im
     Datenverzeichnis außer den Einträgen mit Punkt am Anfang ist der halb
     eingespielte Stand — in einen Ordner außerhalb des Datenverzeichnisses
     verschieben. Dann den Inhalt des `aside`-Ordners zurück ins
     Datenverzeichnis verschieben.
   - **Er ist leer:** Kompass hatte den vorigen Stand schon zurückgelegt und
     scheiterte erst danach beim Öffnen der Datenbank. Prüfen, ob das
     Datenverzeichnis den alten Stand enthält (`core/db/kompass.db` und die
     Ordner der Module, mit Änderungsdatum vor dem Einspielen). Dann ist
     nichts zu verschieben.
3. Den Merker `.jobs/maintenance.json` im Backup-Verzeichnis löschen.
4. Container starten und das Log lesen. Startet Kompass nicht, liegt im
   Backup-Verzeichnis das Backup „Vor Einspielen“ mit genau diesem Stand.

**Kopie außer Haus.** Liegen die Backups auf demselben Gerät wie die Daten, sind
bei einem Plattenschaden oder einem Verschlüsselungstrojaner beide weg. Das
Verzeichnis `backups/` deshalb regelmäßig auf eine externe Platte oder in einen
Cloud-Speicher kopieren, mit dem Werkzeug des Systems — Kompass kopiert nicht
selbst. Snapshots des Datenverzeichnisses sind eine sinnvolle Ergänzung,
ersetzen die Backups aber nicht: Nur sie kann Kompass wieder einspielen.

## Medien

Die Dateien liegen flach im Medienverzeichnis. Die Ordner der Mediathek sind
virtuell: Sie stehen nur in der Datenbank und ändern nichts an der Ablage auf
der Platte. Neben jedem Rasterbild liegt eine Vorschau `<name>.preview.webp`;
sie ist ein Zwischenspeicher und darf jederzeit gelöscht werden.

## Zugriff von außerhalb

Nicht vorgesehen. Kompass läuft im Netz des Vereins, ohne TLS. Wer von
unterwegs arbeiten muss, nutzt ein VPN in dieses Netz.

Wer die Anwendung dennoch über einen Reverse Proxy erreichbar macht, sollte
TLS davorschalten. Meldet der Proxy das per `X-Forwarded-Proto`, setzt Kompass
das Sitzungscookie von selbst auf `secure`.

## MCP

Endpunkt `http://<rechner>:3000/mcp` (Streamable HTTP), Anmeldung mit einem
persönlichen API-Token aus dem Profil (`Authorization: Bearer akx_…`). Ein
Token wirkt mit den Rechten des Nutzers, dem es gehört; jeder Vorgang steht im
Änderungsprotokoll mit dem Kanal „MCP“.

## Webseite

**Das Template unter `<daten>/site/template`.** Kompass pflegt nicht die Seite,
sondern die Inhalte, die ein Astro-Template deklariert. Beim ersten Start legt
der Container das mitgelieferte Basis-Template dort ab; ein vorhandenes bleibt
unberührt, auch bei einem Update. Der Verein ersetzt es durch sein eigenes und
liest es unter Einrichtung → Webseite → Vorlage ein.

**Startinhalte.** Bringt ein Template ein Verzeichnis `seed/` mit, erscheint
unter Einrichtung → Webseite → Vorlage der Knopf „Startinhalte“ — einmalig, solange die
Webseite leer ist. Danach ist die Datenbank die Quelle. Das mitgelieferte
Basis-Template hat kein `seed/`.

**Dieses Verzeichnis ist eine Vertrauensgrenze.** Der Bau führt den Code des
Templates aus, mit den Rechten des Containers. Wer dorthin schreiben darf, kann
im Container Code ausführen. Es gehört deshalb dem Benutzer des Containers
(UID 1000) und niemandem sonst, und es wird nicht über eine Netzwerkfreigabe
geteilt. Mehr dazu unter [Template einlesen](webseite/template-einlesen.md).

**Veröffentlichen.** Kompass überträgt die gebaute Seite per `rsync` über SSH
zum Hoster. Dafür braucht es die `SITE_*`-Variablen in der Umgebungsdatei
(siehe `.env.prod.example`): Zieladresse, Benutzer, Zielverzeichnis und
entweder einen Schlüssel (`SITE_DEPLOY_KEY_FILE`) oder ein Passwort in einer
Datei (`SITE_DEPLOY_PASSWORD_FILE`). Ohne diese Variablen zeigt Kompass nur
eine Vorschau und keinen Publish-Knopf.

Die Passwortdatei wird schreibgeschützt in den Container eingehängt, gehört dem
Benutzer des Containers und hat die Rechte 600. Das Passwort steht damit nie in
der Prozessliste.

**Vor dem ersten Veröffentlichen:** Einrichtung → Webseite → Verbindung →
„Verbindung testen“. Der Test baut nichts und überträgt nichts. Er meldet sich
am Ziel an, prüft, ob das Zielverzeichnis da ist, legt dort eine kleine
Probedatei an und löscht sie wieder (Schreibrecht) und zählt die Dateien am
Ziel. Nach wenigen Sekunden steht je Punkt ein Haken oder eine Meldung, etwa
„Anmeldung abgelehnt“, „Verzeichnis fehlt“ oder „keine Schreibrechte“. Was ein
Publish ändern würde, zeigt die Vorschau auf der Seite Publizieren.

**Wenn ein Publish abbricht.** Gelöscht wird am Ziel erst, nachdem alle neuen
Dateien übertragen sind; eine abgebrochene Übertragung lässt die alte Seite
stehen. Sie kann Reste `.~tmp~` im Zielverzeichnis hinterlassen, die der
nächste Lauf räumt.

**Wenn die Verbindung beim Schlüsselaustausch abbricht.** Meldet der Test
„Connection closed“ direkt nach dem Schlüsselaustausch, obwohl Zugangsdaten und
Adresse stimmen, liegt es meist an der Pfad-MTU: Auf manchen Anschlüssen (PPPoE,
Tunnel) passen Pakete von 1500 Byte nicht durch, und die Rückmeldung darüber
erreicht den Container nicht. Die Compose-Dateien setzen deshalb die MTU des
Netzes auf 1400. Bei einer selbst geführten Datei den Block `networks` aus
`docker-compose.prod.yml` übernehmen und die Anwendung neu bereitstellen.

Solange die Seite noch nicht öffentlich sein soll, hält `SITE_STAGING=1` sie
aus den Suchmaschinen: `noindex`, `Disallow: /`, keine Sitemap.

## Dokument-Basisvorlagen

Unter `<daten>/core/document-templates` liegen die Seitenrahmen für erzeugte
PDFs. Kompass liefert die generischen Basen `a4-plain`, `a4-plain-slim`,
`a4-quer-plain-slim`, `a4-mit-briefkopf`, `a4-ohne-briefkopf` und `a4-formular` mit; ein Verein legt hier eigene
`.typ`-Dateien ab, um eine zu ergänzen oder zu ersetzen (gleiche Kennung
gewinnt). `a4-formular` zeichnet Vereinskopf, Fußzeile und — wenn die Vorlage
eine Anschrift liefert — auf Seite 1 das Anschriftfeld für den Fensterumschlag
DIN lang (`slots.recipient`, darüber klein `slots.recipientLabel`, rechts
`slots.infoBlock`; Lage nach DIN 5008 Form B: Anschriftfeld 45–90 mm von
oben, Rücksendezeile unten in der Vermerkzone, Anschrift ab 62,7 mm, Text 25 mm
von links, Informationsblock ab 125 mm; der Text beginnt dann bei 94 mm). Wer sie ersetzt, ändert den Kopf eines
Formulars wie der Zuwendungsbestätigung, nie dessen Wortlaut — der steht in der
Vorlage des Moduls. Zeichnet die eigene Fassung das Anschriftfeld, trägt sie im
`bases.json` desselben Verzeichnisses das Kennzeichen
`{ "id": "a4-formular", "label": "…", "kind": "form", "slots": ["recipient", "recipientLabel", "infoBlock"] }`;
ohne Kennzeichen setzen die Vorlagen Anschrift und Aussteller wie bisher selbst
in den Text. Daneben optional
`fonts/` für eigene Schriften und `assets/` für Grafiken, die eine Basis
einbindet — das Vereinslogo kommt weiter aus Einrichtung → Stammdaten → Darstellung.

Die Finanzberichte erscheinen auf `a4-quer-plain-slim` (quer: Kassenbericht,
Einnahmen-Überschuss-Rechnung) und `a4-plain-slim` (hoch: Vermögensübersicht,
Kontenabstimmung). Beide zeichnen die Slots `footerNote` (Erzeugungszeit
und Kurz-Hash, klein vor der Seitenzahl), `stage` und `stageText` — die
Ausgabestufe des Berichts: vorläufig quer als Hinweiszeile oben rechts im Kopf,
hoch als Schrägstempel; zur Prüfung unter dem Titel und im Kopf; festgeschrieben
nur mit Vermerk, als Hinweiszeile im Kopf. Wer eine der beiden durch eine eigene Fassung ersetzt, trägt in
`bases.json` die Slots ein, die sie zeichnet
(`"slots": ["stage", "stageText", "footerNote"]`), und zeichnet sie — sonst
fehlt auf dem Papier, ob ein Bericht vorläufig ist.

**Ein leeres Verzeichnis ist gültig** — dann gelten die mitgelieferten Basen.
Auch dies ist eine Vertrauensgrenze: Jede `.typ` läuft beim Rendern als Code im
Container.

## Texterkennung

Abgelegte PDFs werden im Hintergrund durchsuchbar gemacht; bei Scans über eine
Texterkennung. Beides bringt das Image mit, es ist nichts zu installieren.
Eingebettete Rechnungen (ZUGFeRD) liest Kompass mit `pdfdetach`, das wie die
Textebene zu poppler-utils gehört; wer außerhalb des Images betreibt, braucht
dieses Paket vollständig. Die Sammel-PDFs des Serienlaufs bei den Spenden
fügt Kompass mit `pdfunite` zusammen, ebenfalls aus poppler-utils — fehlt es,
bleibt der Lauf selbst unberührt, nur der Sammeldruck weist auf das fehlende
Werkzeug hin.
Startet der Container mitten in einem Lauf neu, erkennt er die unterbrochene
Arbeit beim nächsten Start und nimmt sie wieder auf.

## E-Mail-Versand einrichten

Briefe der Akte können als PDF-Anhang einer E-Mail an den Kontakt gehen. Kompass
sendet dabei nur; es empfängt keine Mails, Antworten landen im Postfach des
Vereins. Den Zugang zum Mailserver legt die Installation fest, in der
Umgebungsdatei:

| Variable | Bedeutung |
|---|---|
| `KOMPASS_SMTP_HOST` | Mailserver des Postfachs. Fehlt die Variable, ist der Versand aus: Kompass bietet dann nur Post. |
| `KOMPASS_SMTP_TLS` | `implicit` (Vorgabe, Port 465) oder `starttls` (Port 587). Ohne gesicherte Verbindung sendet Kompass nicht. |
| `KOMPASS_SMTP_PORT` | Nur, wenn der Server einen anderen Port nennt. |
| `KOMPASS_SMTP_USER`, `KOMPASS_SMTP_PASSWORD` | Anmeldung am Mailserver. Das Passwort gehört in die Umgebungsdatei, nicht in die Compose-Datei. |
| `KOMPASS_MAIL_REDIRECT` | Außerhalb der Produktion Pflicht: Jede Mail geht an diese Adresse, nie an einen Kontakt. Der Betreff nennt die ursprüngliche Adresse. |

**Testumgebung.** Mit `APP_ENV=test` oder `development` sendet Kompass ohne
`KOMPASS_MAIL_REDIRECT` gar nichts: Briefe bleiben als „gesperrt“ im Ausgang.
So schreibt eine Testumgebung mit Daten aus der Produktion nie echte Kontakte
an. Als Umleitung eignet sich ein eigenes Postfach für Tests.

**Absender.** Unter Einrichtung → Akte stehen Absender-Adresse,
Absender-Name (Vorgabe: der Name des Vereins) und eine Antwortadresse. Die
Absender-Adresse muss zum Postfach passen, an dem sich Kompass anmeldet;
sonst lehnen viele Empfänger die Mail ab. SPF und DKIM richtet der Anbieter
des Postfachs ein, Kompass prüft das nicht. „Testmail an mich senden“ schickt
eine Mail an die eigene Adresse und zeigt, ob alles stimmt.

**Recht.** Senden dürfen Rollen mit dem Recht „Dokumente per E-Mail
versenden“ (`dms.send`). Bestehende Rollen bekommen es nicht von selbst;
geben Sie es unter Verwaltung → Rollen der Rolle, die Briefe verschickt.
Agenten bereiten den Versand vor; senden dürfen sie erst, wenn der Verein
unter Verwaltung → Agenten „Darf ein Agent Dokumente per E-Mail senden?“
einschaltet.

**Ablauf.** Kompass reiht Briefe in einen Ausgang ein und sendet im
Hintergrund, höchstens so viele je Minute, wie die Einstellung sagt (Vorgabe
20). Scheitert eine Sendung, versucht Kompass es nach einer und nach fünf
Minuten erneut; danach steht sie als „nicht zugestellt“ im Ausgang, mit dem
Grund des Servers. Der Versandvermerk am Brief entsteht erst, wenn der
Mailserver die Mail angenommen hat. Rückläufer, die später als Mail kommen,
sieht Kompass nicht.

**Datenschutz.** Das Änderungsprotokoll nennt nur die Nummer des Briefs, keine
Adresse und keinen Namen. Die Empfängeradresse steht im Ausgang und wird 90
Tage nach dem Versand dort entfernt. Mit dem Anbieter des Postfachs braucht
der Verein einen Vertrag zur Auftragsverarbeitung, und seine
Datenschutzhinweise sollten den Versand per E-Mail nennen.

**Mail bei einer zugewiesenen Wiedervorlage.** Wer eine Wiedervorlage einer
anderen Person zuweist, schickt ihr über denselben Weg eine kurze Mail: wer sie
zugewiesen hat, wann sie fällig ist und woran sie hängt. Den Link setzt Kompass
aus der Adresse der Installation zusammen:

| Variable | Bedeutung |
|---|---|
| `KOMPASS_PUBLIC_URL` | Adresse, unter der die Menschen im Verein Kompass aufrufen, etwa `https://kompass.example.org` (ohne `/` am Ende). Fehlt sie, nennt die Mail statt eines Links den Weg „Startseite → Fällig“. |

Die Mail geht nur an aktive Konten mit gültiger Adresse und nie an die Person,
die die Wiedervorlage selbst anlegt. Darf die Person den Vorgang nicht lesen,
nennt die Mail keinen Titel. Ohne Absender unter Einrichtung → Akte geht keine
Mail; die Wiedervorlage entsteht trotzdem.
