# AGENTS.md

Regeln für alle, die an diesem Repo arbeiten (menschlich oder agentisch). Kanonische Quelle für Ziel und Coding-Regeln; die Design-Specs unter `docs/superpowers/specs/` beschreiben das Was, dieses Dokument das Wie.

## Ziel

Aluna Kompass ist ein Open-Source-Vereinsverwaltungstool für gemeinnützige Vereine: Single Source of Truth für alle Vereinsvorgänge, aus der Jahresbericht, Kassenprüfungsunterlagen und Rechenschaftsdokumente erzeugt werden. Generischer Kern plus optionale, pro Installation schaltbare Module. Eine Installation pro Verein, kein Multi-Tenancy. Aluna Tierhilfe e.V. ist Erstnutzer und Taktgeber, nicht Grenze der Zielgruppe.

Das Gesamtbild — Säulen, Grenzen, Roadmap — steht in `docs/nordstern.md`. Jede neue Spec nennt die Säule, zu der sie gehört; wer das Bild ändert, zieht den Nordstern im selben Commit nach.

## Neun Prinzipien

1. **Generischer Kern, optionale Module.** Keine Vereinsspezifika im Kern. Faustregel: Würde ein anderer Verein bei einem Namen stutzen, ist er zu spezifisch.
2. **Konfiguration statt Konstanten.** Vereinsstamm, Steuerdaten, Branding, Farben, Regeln sind Einstellungen in der Datenbank. Kein statischer Farbwert im Anwendungscode — nur Theme-Tokens. Env-Vars nur für Betriebsparameter (Pfade, Port, Secrets, Umgebungsname).
3. **Nichts Rechenschaftsrelevantes wird gelöscht.** Rechenschaft meint die Pflichten gegenüber Finanzamt und Transparenzregister: Finanzdaten, Belege, Beschlüsse, Dokumente sowie der Verlauf von Nutzern, Rollen und Rechten. Dort gilt Storno/Deaktivieren/Widerrufen statt Löschen. Was nur auf der Webseite steht — die Inhalte, die das Template deklariert (Variablen, Sammlungseinträge), dazu Medien — ist Arbeitsmaterial und darf gelöscht werden. Der Löschvorgang selbst steht im Änderungsprotokoll: was verschwindet, ist der Inhalt, nicht die Tatsache, dass jemand ihn entfernt hat. Jede schreibende Aktion erzeugt einen Eintrag im Änderungsprotokoll (Nutzer, Zeit, Kanal, Vorher/Nachher). Die vollständige, maßgebliche Aufstellung, welche Entität löschbar ist und warum, steht als `deletionRules` am Manifest jedes Moduls — ein Modul regelt nur, was ihm gehört; der Kern führt seine Regeln in `packages/core/src/deletion-policy.ts`, und `deletionPolicy(registry)` liefert die Summe einer Installation. Personenbezogene Daten sind die Ausnahme von „nichts wird gelöscht": Nach Ablauf der gesetzlichen Aufbewahrung werden sie zur Löschung **fällig** (DSGVO Art. 17). Fällig heißt nicht gelöscht — ein Mensch bestätigt jede Löschung unter Verwaltung → Aufbewahrung; die Frist selbst wird berechnet, nie gespeichert, und steht als `retentionClass` an der Löschregel.
4. **Interner Datensatz ≠ veröffentlichte Sicht.** Webseite und Berichte lesen nur explizit freigegebene Sichten.
5. **Abgeleitete Werte werden berechnet, nie gespeichert.**
6. **Rechteprüfung nur serverseitig**, zentral in der Service-Schicht vor jeder schreibenden Aktion. Permission-Keys fest im Code je Modul, Rollen frei benennbar.
7. **Code Englisch, Oberfläche über i18n.** Eine Sprachdatei `messages/de.json` (Sie-Form), kein hartcodierter UI-Text.
8. **Ein Weg zu den Daten.** Oberfläche und MCP rufen dieselbe Service-Schicht (`packages/core`). Keine Fachlogik in Adaptern. Ein neues Modul bringt seine Werkzeuge mit: zu jedem Permission-Key gehört mindestens eines, das ihn in seiner Beschreibung nennt, und jedes Werkzeug zeigt sein echtes Zod-Schema — nicht `any`. Wo ein Recht bewusst ohne MCP bleibt, steht es begründet in `apps/kompass/tests/mcp-tools.test.ts`.
9. **Nie in Prod testen.** TDD ab der ersten Zeile. Dev/Test/Prod strikt getrennt, Umgebungsbalken außerhalb von Prod, Website-Publish nur aus Prod. Vor jedem Push `pnpm verify` — drei Prüfringe, siehe `docs/superpowers/specs/2026-09-08-pruefringe-design.md`.

## Coding-Regeln

- Service-Signatur: `fn(deps, ctx, input) → Promise<Result<T>>`. Ablauf: `requirePermission` → `validate` (Zod) → `db.transaction` → `recordAudit` in derselben Transaktion → `ok(...)`.
- Fachfehler sind `Result`-Werte (`forbidden`, `validation`, `notFound`, `conflict`, `unauthorized`), nie Exceptions. Nur technische Fehler werfen.
- IDs: ULID (`newId()`). Zeit: `deps.clock.now()` — nie `new Date()` in Fachcode. Zeitstempel ISO-8601 UTC. Geld: Integer in Cent.
- Passwörter: Argon2id. Tokens und Startpasswörter werden nur als Hash gespeichert und genau einmal im Klartext zurückgegeben.
- Tests: Vitest. Service-Tests gegen `createTestDeps()` (In-Memory-SQLite mit echten Migrationen). Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Sichten nie strenger als ihre Dienste: Ein Modul mit `publishedViews` hat einen Test `tests/views-hold.test.ts`, der einen Datensatz mit nur den Pflichtfeldern über den Dienst anlegt, veröffentlicht und alle Sichten mit `loadAllViews` aus `@kompass/core/testing` lädt. Muster: `packages/modules/animals/tests/views-hold.test.ts`.
- Seed-Daten für jedes Modul und jede neue Fachfunktion. Ein neues Modul bringt einen `seed`-Haken im Manifest mit, Kern-Funktionen einen Block unter `packages/core/src/seed/`; beide laufen über `seedDevelopment`. Regeln: frei erfundene Beispiele (das Repo ist öffentlich, `no-association-content.test.ts`), idempotent (kein Lauf, wenn schon Zeilen da sind), mit Varianten der wichtigen Zustände, und ein Test wie `…/tests/seed.test.ts`. Muster: `packages/modules/contacts/src/seed.ts`, `packages/modules/animals/src/seed.ts`, `packages/modules/dms/src/seed.ts`, `packages/modules/projects/src/seed.ts`. In `development` liegen sie neben den Prototyp-Daten von `dev:reset`; NAS-Test bleibt Aluna-only, weil dort `seedDevelopment` nicht läuft.
- Migrationen: `pnpm --filter @kompass/core db:generate` nach jeder Schema-Änderung; erzeugte SQL-Dateien werden committet und nie nachträglich editiert.
- Keine Löschfunktionen außer den in den `deletionRules` des eigenen Manifests als `deletable: true` geführten (Kern: `packages/core/src/deletion-policy.ts`; `defineModule` prüft jede Regel, `apps/kompass/tests/deletion-policy.test.ts` die Summe) — jede mit Eintrag im Änderungsprotokoll. Flüchtige Infrastruktur (Sitzungen löschen, Tokens widerrufen) steht dort nicht, weil sie keinen Vereinsvorgang abbildet.
- Handbuch: Jede neue Seite der Oberfläche bringt ihre Handbuchseite unter `docs/handbuch/` und ihren `help`-Eintrag mit (Modul: im Manifest; Kern: `apps/kompass/src/lib/help.ts`). Eine Seite beginnt mit `# Titel` und einem Kurzabsatz; `apps/kompass/tests/handbook-complete.test.ts` prüft Vollständigkeit und Form. Spec: `2026-09-14-handbuch-und-hilfe-design.md`.
- Zwei Grenzfälle sind bewusst noch nicht freigegeben: **Projekte** tragen mit der Säule Finanzen Finanzfelder, **Tierprofile** mit der Tiere-Vollstufe Bestandsbuch und § 11-Nachweise (Roadmap-Schritte 3 und 5 in `docs/nordstern.md`). Beide dokumentieren dann Vorgänge und nicht mehr nur Webseiteninhalt. Wer vorher eine Löschfunktion dafür bauen will, entscheidet diese Frage mit.

## Befehle

- `pnpm install` — Abhängigkeiten
- `pnpm test` — alle Tests; `pnpm --filter @kompass/core test` — nur Kern
- `pnpm typecheck` — TypeScript
- `pnpm --filter @kompass/app e2e` — Playwright-E2E (Start den Dev-Server auf Port 3100 selbst)
- `pnpm verify` — **vor dem Push**: Typecheck, alle Tests, E2E gegen `next dev` **mit geleertem `.next`**, Image-Build und dieselbe E2E-Suite gegen den laufenden Container. Braucht Docker; rund vier Minuten.
- `pnpm e2e:cold` — nur der zweite Ring, und zwar kalt. Das Leeren ist kein Ritual: `next dev` übersetzt jede Route beim ersten Aufruf, und lokal liegen dafür zwei Gigabyte warm, die es auf einem CI-Läufer nie gibt. Wer warm prüft, prüft eine andere Anwendung — am 11.09. kostete das vier rote Online-Läufe hintereinander.
- `pnpm image` — nur das Image bauen, für die eigene Architektur (schnell). `pnpm image:release` baut amd64 wie die CI.
- `pnpm e2e:image` — die E2E-Suite gegen ein gebautes `kompass-local` auf Port 3200. Prüft die Verpackung: gebündelter Code, `/data`-Volume, mitgeliefertes Template, Modulauflösung.
- `pnpm dev:image [up|down|reset]` — eine **stehende** Testumgebung auf Port 3300, mit Daten, die Neustarts überleben. Zum Anklicken, wenn die Frage „verhält es sich als Container auch so?" lautet. Der Alltag bleibt `pnpm dev`: Dort siehst du eine Änderung sofort, hier kostet sie einen Neubau.
- `pnpm --filter @kompass/core db:generate` — Migration aus Schema erzeugen
- `pnpm seed` — Entwicklungsdaten für Kern **und** alle Module, ohne etwas zu verwerfen (nur `APP_ENV=development`). `pnpm --filter @kompass/core seed` kennt nur den Kern und schaltet kein Modul ein.
- `scripts/doc-preview.sh [basis-id] [verzeichnis]` — Live-Vorschau einer Dokument-Basisvorlage: rendert einen Beispielbrief, öffnet das PDF und rendert bei jeder Änderung an der `.typ` neu
- `pnpm --filter verein-basis dev` — mitgeliefertes Basis-Template mit Fixture unter `http://localhost:4321`
- `pnpm --filter verein-basis test` — Tests des Basis-Templates
- `pnpm import:prototype` — Einmalige Übernahme der Tiere und Projekte aus dem Prototyp
- `pnpm --filter @kompass/app mcp:check <url> [token]` — MCP-Endpunkt einer laufenden Instanz prüfen
- `scripts/third-party-notices.sh [image] [--pruefen]` — erzeugt `THIRD-PARTY-NOTICES.md` aus einem gebauten Image (Vorgabe `kompass-local`). Die Datei wird **erzeugt, nicht gepflegt**: Wer ein `apt-get install` ins Dockerfile schreibt, lässt sie danach neu schreiben. `--pruefen` meldet Abweichungen, ohne zu schreiben — so läuft sie in der CI vor dem Hochladen des Images.
- `pnpm dev:reset` — Entwicklungsdatenbank verwerfen und mit Seed **und** den Tieren und Projekten des Prototyps neu aufbauen (nur `APP_ENV=development`; Prototyp-Pfad über `PROTOTYPE_DIR`)
- Texterkennung lokal: `brew install tesseract tesseract-lang poppler` — ohne sie meldet die Akte „Texterkennung nicht verfügbar", und `packages/text-extraction` überspringt seine Tests nicht, sondern schlägt fehl.
- Betrieb: `docs/handbuch/betrieb.md` — die allgemeine Anleitung, die mit jeder Installation ausgeliefert wird (Voraussetzungen, Erstinstallation, Update, Backup, Webseite). **Sie nennt keine Hardware, keinen Hoster und keinen Verein**; `apps/kompass/tests/no-association-content.test.ts` prüft das, weil `docs/handbuch` im Image liegt. Alunas konkreter Aufbau steht in `docs/intern/betrieb-aluna-qnap.md` (nicht im Repo). Compose-Vorlagen `docker-compose.test.yml` und `docker-compose.prod.yml`, CI `.github/workflows/ci.yml`

## Release

- **Eine Fassung, eine Stelle.** Die Nummer steht in der `package.json` im
  Wurzelverzeichnis; alle Pakete des Workspace tragen dieselbe.
  `apps/kompass/next.config.ts` reicht sie zur Bauzeit weiter, `/api/health`
  und der Fuß der Schiene zeigen sie. Nirgends ein zweites Mal hinschreiben —
  `apps/kompass/tests/version.test.ts` wacht darüber.
- **Kein Hochziehen ohne Eintrag.** `CHANGELOG.md` führt zuerst
  „Unveröffentlicht"; beim Release wird daraus die Nummer. Der Eintrag ist für
  den Betreiber geschrieben, nicht für Entwickler: was ein Verein davon merkt,
  nicht welche Datei sich geändert hat. Derselbe Test verlangt zu jeder Nummer
  einen Abschnitt.
- **Ein Commit je Vorhaben.** Feature-Branches werden **als Sammelcommit**
  nach `main` gebracht (Squash), nicht als Verlauf einzelner Schritte. Auf
  `main` steht damit je Zeile ein abgeschlossenes Vorhaben.
- **Der Tag sitzt auf `main`.** `vX.Y.Z` kommt auf den Sammelcommit, der die
  Fassung ausmacht — nie auf einen Arbeitsstand. Erst dann erzeugt die CI aus
  `type=semver` ein Registry-Tag; ohne Git-Tag entstehen nur `sha-*` und
  `latest`.
- **Der Push löst ein Mensch aus**, nach `pnpm verify`.

## Quellen

- Specs: `docs/superpowers/specs/` (Fundament: `2026-09-05-fundament-design.md`; Webseite als Template: `2026-09-07-site-template-design.md`; Prüfringe: `2026-09-08-pruefringe-design.md`; Löschbarkeit und Mediathek: `2026-09-09-loeschbarkeit-und-mediathek-design.md`; Dokument-Pipeline und Basis-Vorlagen: `2026-09-09-dokument-pipeline-und-basisvorlagen-design.md`; Kontakte: `2026-09-10-kontakte-design.md`; Dokumente und Korrespondenz: `2026-09-10-dokumente-und-korrespondenz-design.md`; Volltext und Texterkennung: `2026-09-11-volltext-und-texterkennung-design.md`; Akte fertig: `2026-09-12-akte-fertig-design.md`; Mediathek Auswahl und Vorschau: `2026-09-13-mediathek-auswahl-und-vorschau-design.md`)
- Pläne: `docs/superpowers/plans/`
- Nordstern: `docs/nordstern.md` (Gesamtbild, Grenzen, Roadmap)
- Backlog: `docs/backlog.md` (bewusst zurückgestellte Punkte mit Begründung)
- Hilfeseite für die schreibende Person: `docs/handbuch/akte/brief-schreiben.md` — welche Formatierungen ein Brief kennt. Der Beispielbrief darin ist zugleich Fixture: `packages/documents/tests/markdown-render.test.ts` liest ihn aus der Seite und rendert ihn.
- Design-Referenz Stufe 1: `docs/design/fundament/design_handoff_aluna_kompass_fundament/README.md`
