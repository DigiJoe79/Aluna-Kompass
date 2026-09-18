# Änderungen

Alle nennenswerten Änderungen an Aluna Kompass, für die Menschen, die eine
Installation betreiben. Was sich unter der Haube ändert, steht im Git-Verlauf;
hier steht, was ein Verein davon merkt.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Nummern folgen [Semantic Versioning](https://semver.org/lang/de/). Vor
1.0.0 kann jede Minor-Fassung Brüche enthalten — was bricht, steht unter
**Geändert** mit dem, was zu tun ist.

## [Unveröffentlicht]

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

[Unveröffentlicht]: https://github.com/DigiJoe79/Aluna-Kompass/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DigiJoe79/Aluna-Kompass/releases/tag/v0.1.0
