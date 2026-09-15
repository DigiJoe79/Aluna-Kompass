# Änderungen

Alle nennenswerten Änderungen an Aluna Kompass, für die Menschen, die eine
Installation betreiben. Was sich unter der Haube ändert, steht im Git-Verlauf;
hier steht, was ein Verein davon merkt.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Nummern folgen [Semantic Versioning](https://semver.org/lang/de/). Vor
1.0.0 kann jede Minor-Fassung Brüche enthalten — was bricht, steht unter
**Geändert** mit dem, was zu tun ist.

## [Unveröffentlicht]

## [0.1.0]

Die erste Fassung. Ein Verein kann damit seine Post führen, seine Kontakte
pflegen und seine Webseite betreiben — Finanzen und Mitgliederverwaltung
kommen in späteren Fassungen (siehe `docs/nordstern.md`).

### Fundament

- **Nutzer, Rollen und Rechte.** Rollen sind frei benennbar, Rechte fest je
  Modul. Jede Rechteprüfung läuft serverseitig.
- **Anmeldung** mit Argon2id, Sperre nach fünf Fehlversuchen, Startpasswort,
  das beim ersten Anmelden gewechselt werden muss.
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
  eigener Kanal gekennzeichnet.
- **Module** lassen sich je Installation ein- und ausschalten.
- **Aufbewahrung.** Personenbezogene Daten werden nach Ablauf der Frist zur
  Löschung fällig; ein Mensch bestätigt jede Löschung. Fristen werden
  berechnet, nie gespeichert.

### Korrespondenz und Akte

- **Kontakte** mit Rollen über die Zeit und berechneter Aufbewahrungsfrist.
- **Ausgehende Post**: Entwurf, Vorschau, Festschreiben mit Nummer und
  Prüfsumme, Versandvermerk, Storno mit Ersatz statt Löschen.
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
- **Vorschau** vor dem Publizieren, mit Unterschieden zum veröffentlichten
  Stand und einer Prüfung auf gesperrte Begriffe.
- **Publizieren** als statische Seite zum Hoster. Im Internet liegen weder
  Datenbank noch Login.

### Module

- **Tiere**: Profile mit Fotos, Status und Vermittlungsgeschichte, für die
  Webseite.
- **Projekte**: öffentliche Projektseiten mit Verweisen nach außen.

### Betrieb

- **Ein Image** für Entwicklung, Test und Produktion.
- **Migrationen** laufen beim Start; schlägt eine fehl, startet die Anwendung
  nicht mit halb migrierten Daten.
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
