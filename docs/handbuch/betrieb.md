# Betrieb

Kompass läuft als ein Docker-Image auf einem Rechner im Netz des Vereins — ein
NAS, ein kleiner Server, was vorhanden ist. Diese Seite beschreibt
Erstinstallation, Update, Backup und den Weg der Webseite zum Hoster, für die
Person, die diesen Rechner betreut.

## Voraussetzungen

- **Docker** mit Compose, auf amd64 oder arm64. Das veröffentlichte Image ist
  für amd64 gebaut; auf anderer Architektur baut man es selbst (`pnpm image`).
- **Platz:** rund 2 GB für das Image, dazu die Daten des Vereins. Die Datenbank
  bleibt lange klein; den Ausschlag geben abgelegte Dokumente und Medien.
- **Arbeitsspeicher:** 1 GB reicht im Alltag. Beim Bauen der Webseite und bei
  der Texterkennung steigt der Bedarf kurzzeitig; auf einem Gerät mit 2 GB
  läuft beides ohne Enge.
- Ein Verzeichnis für die Daten, das Neustarts und Updates überlebt.

## Erstinstallation

1. **Verzeichnisse anlegen** — eines für die Daten, eines für die Medien, zum
   Beispiel `kompass/data` und `kompass/media`.

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
   darin sind Beispiele und werden auf die eigenen angepasst.

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

**Wenn etwas schiefgeht:** Es gibt keinen Weg zurück in eine ältere Fassung der
Datenbank — Migrationen laufen nur vorwärts. Der Rückweg ist das Backup aus
Schritt 1: altes Image eintragen, Container starten, Backup einspielen.
Deshalb Schritt 1 nicht überspringen.

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
liest es unter Webseite → Template ein.

**Startinhalte.** Bringt ein Template ein Verzeichnis `seed/` mit, erscheint
unter Webseite → Template der Knopf „Startinhalte“ — einmalig, solange die
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

**Vor dem ersten Veröffentlichen:** Publizieren-Seite → „Verbindung testen“.
Der Lauf meldet sich am Ziel an, überträgt nichts und listet auf, was dort
liegt und ein Publish entfernen würde. Kommt die Liste leer zurück, zeigt das
Zielverzeichnis ins Leere — ein vertippter Pfad lässt `rsync` nicht scheitern,
er trifft nur nichts.

Solange die Seite noch nicht öffentlich sein soll, hält `SITE_STAGING=1` sie
aus den Suchmaschinen: `noindex`, `Disallow: /`, keine Sitemap.

## Dokument-Basisvorlagen

Unter `<daten>/core/document-templates` liegen die Seitenrahmen für erzeugte
PDFs. Kompass liefert die generischen Basen `a4-plain`, `a4-mit-briefkopf` und
`a4-ohne-briefkopf` mit; ein Verein legt hier eigene `.typ`-Dateien ab, um eine
zu ergänzen oder zu ersetzen (gleiche Kennung gewinnt). Daneben optional
`fonts/` für eigene Schriften und `assets/` für Grafiken, die eine Basis
einbindet — das Vereinslogo kommt weiter aus den Einstellungen.

**Ein leeres Verzeichnis ist gültig** — dann gelten die mitgelieferten Basen.
Auch dies ist eine Vertrauensgrenze: Jede `.typ` läuft beim Rendern als Code im
Container.

## Texterkennung

Abgelegte PDFs werden im Hintergrund durchsuchbar gemacht; bei Scans über eine
Texterkennung. Beides bringt das Image mit, es ist nichts zu installieren.
Startet der Container mitten in einem Lauf neu, erkennt er die unterbrochene
Arbeit beim nächsten Start und nimmt sie wieder auf.
