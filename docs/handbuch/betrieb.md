# Betrieb

Kompass läuft als ein Docker-Image auf einem Rechner im Netz des Vereins — ein
NAS, ein kleiner Server, was vorhanden ist. Diese Seite beschreibt
Erstinstallation, Update, Backup und den Weg der Webseite zum Hoster, für die
Person, die diesen Rechner betreut.

## Voraussetzungen

- **Docker** mit Compose, auf amd64 oder arm64. Das veröffentlichte Image ist
  für amd64 gebaut; auf anderer Architektur baut man es selbst (`pnpm image`).
- **Platz:** rund 1,6 GB für das Image, dazu die Daten des Vereins. Die Datenbank
  bleibt lange klein; den Ausschlag geben abgelegte Dokumente und Medien.
- **Arbeitsspeicher:** 1 GB reicht im Alltag. Beim Bauen der Webseite und bei
  der Texterkennung steigt der Bedarf kurzzeitig; auf einem Gerät mit 2 GB
  läuft beides ohne Enge.
- Ein Verzeichnis für die Daten, das Neustarts und Updates überlebt.

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
   wie das Datenverzeichnis.

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
Kompass einen Umgebungsbalken, damit niemand die beiden verwechselt.

Daten aus der Produktion in den Test holen: dort exportieren, hier importieren
(Verwaltung → Backup). Danach sind im Test alle Sitzungen beendet, die
Anmeldung läuft mit den Zugangsdaten aus der Produktion. API-Tokens werden
nicht mitkopiert.

Der umgekehrte Weg ist keine gute Idee: Der Test enthält Probierdaten, und die
gehören nicht in die Aufzeichnung, aus der der Verein Rechenschaft ablegt.

## Update

1. **Backup exportieren** (Verwaltung → Backup → Export erstellen) und die
   Datei sichern. Kompass tut das nicht von selbst — der Schritt ist die
   Rückfahrkarte, wenn eine Migration schiefgeht.

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
  `a4-plain-slim`. Wer unter Verwaltung → Dokumentvorlagen für den Export früher
  eine Basis fest eingestellt hat, sieht die Zeile dort als „abweichend“ und
  stellt sie mit „Zurücksetzen“ auf die neue Vorgabe. Wer eigene Basis-Vorlagen
  führt und den Auszug im eigenen Kopf haben will, legt eine
  `a4-plain-slim.typ` daneben.
- **Der Bildausschnitt der Tierfotos** steht auf 4:3 mittig. Zeigt das Template
  der Webseite das Hauptfoto in einem anderen Format, unter Einstellungen →
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

## Backups

- **Aus der Anwendung** (Verwaltung → Backup): eine Datei
  `kompass-backup-<umgebung>-<datum>.tar.gz` mit Datenbank, Medien und
  Manifest. Sitzungen und API-Tokens bleiben bewusst draußen.
- **Auf Dateiebene:** Snapshots des Datenverzeichnisses sind eine sinnvolle
  Ergänzung, ersetzen den Export aber nicht — er ist die Form, die Kompass
  auch wieder einlesen kann.
- Das Archiv enthält alle personenbezogenen Daten des Vereins. Es gehört an
  einen Ort, der so geschützt ist wie die Anwendung selbst, und nicht
  unverschlüsselt in einen geteilten Ordner.
- Nach einem Import bleibt der vorherige Stand als `.before-import-<zeit>`
  neben den Daten liegen. Nach der Prüfung kann er gelöscht werden.

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
liest es unter Einstellungen → Webseite → Template ein.

**Startinhalte.** Bringt ein Template ein Verzeichnis `seed/` mit, erscheint
unter Einstellungen → Webseite → Template der Knopf „Startinhalte“ — einmalig, solange die
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

**Vor dem ersten Veröffentlichen:** Einstellungen → Webseite → Verbindung →
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
`a4-mit-briefkopf`, `a4-ohne-briefkopf` und `a4-formular` mit; ein Verein legt hier eigene
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
einbindet — das Vereinslogo kommt weiter aus den Einstellungen.

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
