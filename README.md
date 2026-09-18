# Aluna Kompass

Vereinsverwaltung für gemeinnützige Vereine — eine Anwendung für Webseite, Dokumenten-Management, Kontakte und alles, was der Verein sonst führt. Läuft auf eigener Hardware im eigenen Netz, eine Installation je Verein.

## Worum es geht

Ein gemeinnütziger Verein schuldet Rechenschaft: dem Finanzamt, dem Registergericht, dem Transparenzregister, den Mitgliedern und Spendern. Kompass ist der Ort, an dem jeder Vorgang genau einmal entsteht und bleibt — und aus dem alles erzeugt wird, was der Verein nach außen geben muss: Briefe, Protokolle, Zuwendungsbestätigungen, die öffentliche Webseite, später Jahresfinanzbericht und Kassenprüfungsunterlagen.

Der Grundsatz dahinter: **ein Vorgang, eine Quelle.** Nichts wird abgetippt, kopiert oder nachträglich einsortiert. Jede Änderung steht im Änderungsprotokoll; Rechenschaftsrelevantes wird storniert, nie gelöscht.

Der Kern ist generisch und für jeden Verein gleich. Was ein Verein braucht und ein anderer nicht, ist ein Modul, das sich je Installation ein- und ausschalten lässt.

## Was heute da ist

| Bereich | Inhalt |
|---|---|
| **Fundament** | Nutzer, Rollen und Rechte, Einstellungen statt Konstanten, Themes, Änderungsprotokoll, Backup und Import, Modul-System, Dokument-Pipeline mit Basis-Vorlagen, Mediathek |
| **Webseite** | Die Vereinsseite wird in Kompass gepflegt und als statische Seite aus einem Template gebaut, das der Verein selbst mitbringt. Im Internet gibt es weder Datenbank noch Login. |
| **Kontakte und Akte** | Kontakte mit Rollen über die Zeit und berechneter Aufbewahrungsfrist. Die Akte für ein- und ausgehende Post: Entwurf, Festschreiben, Nummer, Storno statt Löschen, Ordner, Bezüge, Wiedervorlage, Volltext mit Texterkennung. |
| **Projekte, Tiere** | Vereinsspezifische Module — heute mit ihrem öffentlichen Teil für die Webseite. |
| **MCP** | Was die Oberfläche kann, kann auch ein KI-Assistent über MCP — dieselben Dienste, dieselben Rechte, dasselbe Protokoll. Vier Dinge bewusst nicht: Backup ein- und ausspielen, Dateien abrufen, API-Token verwalten, das eigene Passwort ändern. Ein Test hält die Liste vollständig. |

Was als Nächstes kommt — Finanzen, Mitglieder und Gremien, das Tiermodul in seiner Vollstufe — und warum in dieser Reihenfolge, steht in [`docs/nordstern.md`](docs/nordstern.md). Dort steht auch, was Kompass **nicht** ist: kein Newsletter, kein Mailprogramm, kein Kalender, kein Aufgabenmanager, kein Webseiten-Baukasten, kein Multi-Tenant.

## Warum die Webseite so gebaut ist

Die meisten Vereinsseiten laufen auf einem CMS wie WordPress: eine Anwendung mit Datenbank, Anmeldung und Plugins, die dauerhaft im Internet steht. Das ist bequem — und es ist die größte Angriffsfläche, die ein kleiner Verein hat. Jede Lücke in Kern, Theme oder einem der Plugins ist öffentlich erreichbar, rund um die Uhr, und wird von Skripten gesucht, die nicht fragen, wie groß der Verein ist. Wer die Seite übernimmt, hat den Adminzugang, die Kontaktformulare, oft auch Mitglieder- oder Spenderdaten, die irgendwann „nur kurz“ dort gelandet sind. Dafür ist der Verein verantwortlich — nach DSGVO gegenüber jeder betroffenen Person, und meldepflichtig binnen 72 Stunden. Ein ehrenamtlicher Vorstand kann eine solche Anwendung nicht so pflegen, wie sie es verlangt: Updates einspielen, Plugins prüfen, Backups testen, Logs lesen.

Kompass dreht das um:

- **Die Daten bleiben zu Hause.** Kontakte, Post, Mitglieder, Beschlüsse liegen auf dem NAS des Vereins, im eigenen Netz, hinter der eigenen Tür. Nichts davon steht im Internet.
- **Die Webseite ist fertige Dateien.** Kompass baut sie mit [Astro](https://astro.build) aus einem Template, das der Verein selbst mitbringt, und lädt HTML, Bilder und CSS auf einen gewöhnlichen Webspace. Dort läuft kein Programm, gibt es keine Datenbank, keine Anmeldung, nichts zu aktualisieren. Was nicht existiert, kann nicht übernommen werden.
- **Nur Freigegebenes verlässt das Haus.** Die Seite liest ausschließlich Sichten, die ein Modul ausdrücklich veröffentlicht — ein Tier zeigt sein Profil, nicht seine Tierarztrechnungen. Interner Datensatz und öffentliche Sicht sind zwei Dinge (Prinzip 4 in [`AGENTS.md`](AGENTS.md)).
- **Publizieren ist ein bewusster Schritt.** Nur aus der Prod-Instanz, mit Prüfung vor dem Hochladen, und der Publish steht wie alles andere im Änderungsprotokoll.

Der Webspace kostet ein paar Euro im Jahr und braucht keine Wartung. Das NAS muss sicher betrieben werden — das stimmt, und [`docs/handbuch/betrieb.md`](docs/handbuch/betrieb.md) beschreibt, wie. Aber es steht im eigenen Netz, nicht am offenen Internet, und das ist der Unterschied.

## Betrieb

Kompass läuft als ein Docker-Image auf dem NAS oder Server des Vereins, mit Dev, Test und Prod strikt getrennt. Voraussetzungen, Installation, Update, Backup und Webseiten-Publish: [`docs/handbuch/betrieb.md`](docs/handbuch/betrieb.md). Das vollständige Handbuch liegt unter [`docs/handbuch/`](docs/handbuch/inhalt.md) und ist in der App über das „?“ in der Kopfleiste erreichbar.

## Entwicklung

Voraussetzungen: Node 24 oder neuer, pnpm 11, Docker für die vollständige Prüfung. Für die Texterkennung lokal `tesseract`, `tesseract-lang` und `poppler`.

```bash
pnpm install
cp apps/kompass/.env.example apps/kompass/.env   # SESSION_SECRET setzen
pnpm dev                                          # http://localhost:3000, Einrichtung beim ersten Aufruf
pnpm seed                                         # erfundene Beispieldaten für Kern und alle Module
```

Prüfen, bevor etwas gepusht wird:

```bash
pnpm typecheck
pnpm test
pnpm verify        # Typecheck, alle Tests, E2E kalt, Image-Build, E2E gegen das Image (~4 min, braucht Docker)
```

Aufbau des Repos:

```
apps/kompass/          Next.js-Anwendung: Oberfläche, MCP-Endpunkt, E2E-Tests
packages/core/         Kern: Dienste, Datenbank, Rechte, Änderungsprotokoll, Modul-System
packages/modules/      Fachmodule: animals, contacts, dms, projects, site
packages/documents/    Dokument-Pipeline (Markdown → Typst → PDF)
packages/mcp/          MCP-Server über den Kerndiensten
packages/site-template/ Vertrag zwischen Kompass und einem Webseiten-Template
templates/verein-basis/ Mitgeliefertes Basis-Template für die Vereinsseite
docs/                  Nordstern, Betrieb, Backlog, Hilfeseiten
```

Regeln, Prinzipien und alle Befehle: [`AGENTS.md`](AGENTS.md). Die neun Prinzipien dort — generischer Kern, Konfiguration statt Konstanten, nichts Rechenschaftsrelevantes wird gelöscht, ein Weg zu den Daten, TDD ab der ersten Zeile — gelten für jeden Beitrag.

## Fragen, Fehler und Sicherheit

- **Fragen und Fehler** gehören in ein [Issue](https://github.com/DigiJoe79/Aluna-Kompass/issues).
  Hilfreich: welche Fassung (Fuß der Seitenleiste oder `/api/health`) und was du erwartet hast.
- **Sicherheitslücken** bitte **nicht** als Issue, sondern über den privaten
  Meldekanal — der Weg steht in [`SECURITY.md`](SECURITY.md).
- **Quellcode der mitgelieferten Fremdsoftware** (GPL/LGPL): ein Issue genügt.
  Die Aufstellung steht in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- **Mitarbeiten**: [`CONTRIBUTING.md`](CONTRIBUTING.md) — was man zuerst wissen
  muss; die Regeln selbst stehen in [`AGENTS.md`](AGENTS.md).

## Lizenz

Apache-2.0 — siehe [`LICENSE`](LICENSE) und [`NOTICE`](NOTICE).

Die Lizenz erlaubt Nutzung, Änderung und Weitergabe, auch kommerziell.
Sie gewährt ausdrücklich Patentrechte (§ 3), verlangt einen Hinweis auf
geänderte Dateien (§ 4b) und räumt keine Rechte am Namen „Aluna Kompass“
ein (§ 6).
