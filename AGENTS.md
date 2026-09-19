# AGENTS.md

Regeln für alle, die an diesem Repo arbeiten (menschlich oder agentisch). Kanonische Quelle für Ziel und Coding-Regeln; die Design-Specs unter `docs/intern/specs/` beschreiben das Was, dieses Dokument das Wie.

## Ziel

Aluna Kompass ist ein Open-Source-Vereinsverwaltungstool für gemeinnützige Vereine: Single Source of Truth für alle Vereinsvorgänge, aus der Jahresbericht, Kassenprüfungsunterlagen und Rechenschaftsdokumente erzeugt werden. Generischer Kern plus optionale, pro Installation schaltbare Module. Eine Installation pro Verein, kein Multi-Tenancy. Aluna Tierhilfe e.V. ist Erstnutzer und Taktgeber, nicht Grenze der Zielgruppe.

Das Gesamtbild — Säulen, Grenzen, Roadmap — steht in `docs/nordstern.md`. Jede neue Spec nennt die Säule, zu der sie gehört; wer das Bild ändert, zieht den Nordstern im selben Commit nach.

## Neun Prinzipien

1. **Generischer Kern, optionale Module.** Keine Vereinsspezifika im Kern. Faustregel: Würde ein anderer Verein bei einem Namen stutzen, ist er zu spezifisch.
2. **Konfiguration statt Konstanten.** Vereinsstamm, Steuerdaten, Branding, Farben, Regeln sind Einstellungen in der Datenbank. Kein statischer Farbwert im Anwendungscode — nur Theme-Tokens. Env-Vars nur für Betriebsparameter (Pfade, Port, Secrets, Umgebungsname).
3. **Nichts Rechenschaftsrelevantes wird gelöscht.** Rechenschaft meint die Pflichten gegenüber Finanzamt und Transparenzregister: Finanzdaten, Belege, Beschlüsse, Dokumente sowie der Verlauf von Nutzern, Rollen und Rechten. Dort gilt Storno/Deaktivieren/Widerrufen statt Löschen. Was nur auf der Webseite steht — die Inhalte, die das Template deklariert (Variablen, Sammlungseinträge), Tierprofile, Projekte, dazu Medien — ist Arbeitsmaterial und darf gelöscht werden. Rechenschaftsrelevant ist nicht der Datensatz, sondern die Spur, die an ihm hängt: Solange ein Halter läuft (`retentionHolds`) oder noch etwas auf ihn zeigt (`recordReferences`), bleibt er. Was einen Veröffentlicht-Schalter hat, wird in zwei Stufen gelöscht: erst zurückziehen, dann löschen. Der Löschvorgang selbst steht im Änderungsprotokoll: was verschwindet, ist der Inhalt, nicht die Tatsache, dass jemand ihn entfernt hat. Jede schreibende Aktion erzeugt einen Eintrag im Änderungsprotokoll (Nutzer, Zeit, Kanal, Vorher/Nachher). Die vollständige, maßgebliche Aufstellung, welche Entität löschbar ist und warum, steht als `deletionRules` am Manifest jedes Moduls — ein Modul regelt nur, was ihm gehört; der Kern führt seine Regeln in `packages/core/src/deletion-policy.ts`, und `deletionPolicy(registry)` liefert die Summe einer Installation. Personenbezogene Daten sind die Ausnahme von „nichts wird gelöscht": Nach Ablauf der gesetzlichen Aufbewahrung werden sie zur Löschung **fällig** (DSGVO Art. 17). Fällig heißt nicht gelöscht — ein Mensch bestätigt jede Löschung unter Verwaltung → Aufbewahrung; die Frist selbst wird berechnet, nie gespeichert, und steht als `retentionClass` an der Löschregel.
4. **Interner Datensatz ≠ veröffentlichte Sicht.** Webseite und Berichte lesen nur explizit freigegebene Sichten.
5. **Abgeleitete Werte werden berechnet, nie gespeichert.**
6. **Rechteprüfung nur serverseitig**, zentral in der Service-Schicht vor jeder schreibenden Aktion. Permission-Keys fest im Code je Modul, Rollen frei benennbar.
7. **Code Englisch, Oberfläche über i18n.** Eine Sprachdatei `messages/de.json` (Sie-Form), kein hartcodierter UI-Text.
8. **Ein Weg zu den Daten.** Oberfläche und MCP rufen dieselbe Service-Schicht (`packages/core`). Keine Fachlogik in Adaptern. Ein neues Modul bringt seine Werkzeuge mit: zu jedem Permission-Key gehört mindestens eines, das ihn in seiner Beschreibung nennt, und jedes Werkzeug zeigt sein echtes Zod-Schema — nicht `any`. Wo ein Recht bewusst ohne MCP bleibt, steht es begründet in `apps/kompass/tests/mcp-tools.test.ts`.
9. **Nie in Prod testen.** TDD ab der ersten Zeile. Dev/Test/Prod strikt getrennt, Umgebungsbalken außerhalb von Prod, Website-Publish nur aus Prod. Vor jedem Push `pnpm verify` — drei Prüfringe, siehe `docs/intern/specs/2026-09-08-pruefringe-design.md`.

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
- Eigene Kennzeichen in `.meta()` nie mit reservierten JSON-Schema-Namen (`required`, `type`, `properties`, `items`, `default`, `enum`, `format` …): Zod 4 schreibt `.meta()` ungefiltert ins JSON-Schema, das MCP-Clients zu sehen bekommen, und ein strenger Client verwirft das ganze Werkzeug. `apps/kompass/tests/mcp-schemas.test.ts` prüft jedes ausgelieferte Werkzeugschema gegen das Metaschema.
- Masken mit ungesteuerten Feldern (`defaultValue`) nutzen `ActionForm` (`apps/kompass/src/components/forms/action-form.tsx`) statt `<form action>`: React 19 setzt ein `<form action>` nach jedem Durchlauf zurück, auch nach einem abgelehnten Speichern, und die Eingaben wären weg. Ausnahmen sind Anmeldung, Passwort und Einrichtung, wo ein falsches Passwort ruhig verschwinden soll.
- Handbuch: Jede neue Seite der Oberfläche bringt ihre Handbuchseite unter `docs/handbuch/` und ihren `help`-Eintrag mit (Modul: im Manifest; Kern: `apps/kompass/src/lib/help.ts`). Eine Seite beginnt mit `# Titel` und einem Kurzabsatz; `apps/kompass/tests/handbook-complete.test.ts` prüft Vollständigkeit und Form. Spec: `2026-09-14-handbuch-und-hilfe-design.md`.
- Ein Modul, das Vorgänge an fremden Datensätzen führt (Buchungen an Projekten, Bestandsbuch an Tieren, Dokumente an allem), meldet sie über `retentionHolds` **und** `recordReferences`. Der erste Haken sichert die Rechenschaft, der zweite die Integrität; wer nur einen bedient, gibt trotzdem nichts frei, weil beide geprüft werden (`buildDeletionPreview` in `packages/core/src/deletion-guards.ts`).

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
- `scripts/third-party-notices.sh [image] [--pruefen]` — die Aufstellung der Software Dritter entsteht beim Bau **im Image** (`--erzeugen` im Dockerfile, nach `/app/THIRD-PARTY-NOTICES.md`); ohne Flag gibt das Skript sie aus. `--pruefen` verlangt, dass sie da ist und jede npm-Lizenz auf der Positivliste steht — so läuft es in `pnpm image:check` und in der CI vor dem Hochladen. `THIRD-PARTY-NOTICES.md` im Repo ist eine Übersicht **ohne Versionen**; wer ein `apt-get install` ins Dockerfile schreibt, trägt das Paket dort ein (Test).
- `pnpm dev:reset` — Entwicklungsdatenbank verwerfen und mit Seed **und** den Tieren und Projekten des Prototyps neu aufbauen (nur `APP_ENV=development`; Prototyp-Pfad über `PROTOTYPE_DIR`)
- Texterkennung lokal: `brew install tesseract tesseract-lang poppler` — ohne sie meldet die Akte „Texterkennung nicht verfügbar", und `packages/text-extraction` überspringt seine Tests nicht, sondern schlägt fehl.
- Betrieb: `docs/handbuch/betrieb.md` — die allgemeine Anleitung, die mit jeder Installation ausgeliefert wird (Voraussetzungen, Erstinstallation, Update, Backup, Webseite). **Sie nennt keine Hardware, keinen Hoster und keinen Verein**; `apps/kompass/tests/no-association-content.test.ts` prüft das, weil `docs/handbuch` im Image liegt. Alunas konkreter Aufbau steht in `docs/intern/betrieb-aluna-qnap.md` (nicht im Repo). Compose-Vorlagen `docker-compose.test.yml` und `docker-compose.prod.yml`, CI `.github/workflows/ci.yml`

## Release

- **Eine Fassung, eine Stelle.** Die Nummer steht in der `package.json` im
  Wurzelverzeichnis; alle Pakete des Workspace tragen dieselbe.
  `apps/kompass/next.config.ts` reicht sie zur Bauzeit weiter, `/api/health`
  und das Nutzermenü („Version 0.1.1 (46535d6)“) zeigen sie. Nirgends ein zweites Mal hinschreiben —
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

### Ablauf einer Fassung

1. **Je Fassung ein Branch von `main`**, benannt nach der Nummer, die er
   ausliefert: `dev-0.1.1` für Fehlerbehebungen, `dev-0.2.0` für ein neues
   Modul. Jeder Push darauf baut, prüft und lädt `:dev-x.y.z` samt `sha-*` hoch
   (`ci.yml`, `branches: ['dev-*']`; ein Push auf `main` startet keinen Lauf, das tut erst der Release-Tag) — dieses Bild läuft auf der
   Testinstanz. Der erste Commit setzt die Nummer in allen `package.json` auf
   die **Vorabnummer** `x.y.z-dev`: So zeigt die Testinstanz „Version
   0.1.1-dev (…)“ und nicht die alte Fassung.
2. **Ein Commit je Aufgabe**, der CHANGELOG-Eintrag unter „Unveröffentlicht“
   im selben Commit — der erste Eintrag eines Zyklus legt die Überschrift an;
   leer steht sie nie da. Ein Fehler in einem eigenen, noch nicht gepushten Commit
   wird per `git commit --fixup` und `git rebase --autosquash` eingefaltet,
   nicht als eigener Commit angehängt. Gepushte Commits bleiben, wie sie sind.
3. **Abnahme auf der Testinstanz**, gegen eine frische Kopie der Produktion.
   Eine Testinstanz läuft nur vorwärts: Ihr Schema ist so neu wie die jüngste
   Fassung, die je auf ihr lief. Vor dem Wechsel auf eine ältere Fassung
   werden ihre Daten deshalb neu aus der Produktion gezogen.
4. **Release**: im letzten Commit des Branches `-dev` von der Nummer streichen
   (alle `package.json`) und „Unveröffentlicht“ zur Nummer mit Datum machen. Nach lokalem
   `pnpm verify` und grünem Job `test` des Branch-Laufs lokal nach `main`
   squashen (`git merge --squash dev-x.y.z`), `vX.Y.Z` auf den Sammelcommit
   setzen, `main` und den Tag einzeln pushen — nie `git push --tags`, lokale
   Tags bleiben lokal. Auf den Job `image` des Branches wird nicht gewartet:
   Der Tag-Lauf wiederholt den Image-Ring und lädt `x.y.z` und `latest` nur bei
   Grün hoch. Ein roter Tag-Lauf veröffentlicht nichts; der Tag wird dann
   gelöscht und nach dem Fix neu gesetzt.
5. **Aufräumen**: `scripts/zyklus-aufraeumen.sh x.y.z` (erst mit `-n`). Es
   setzt das lokale Archiv-Tag `archiv/x.y.z`, löscht die Registry-Tags
   `dev-x.y.z` und die `sha-*` der Branch-Commits, die Actions-Caches von
   Branch und Tag, die Läufe des Branches und den Branch selbst. `x.y.z`,
   `latest` und der Tag-Lauf bleiben. Danach die Testinstanz auf `latest`.
6. **Laufen zwei Branches parallel** (etwa ein `dev-0.1.2` während `dev-0.2.0`),
   wird nach jedem Release der andere auf das neue `main` rebased.
7. **Dependabot** stellt seine Pull Requests gegen `main`; sein CI-Lauf prüft
   sie samt Image-Ring. Was damit geschieht, hängt davon ab, ob ein Zyklus
   offen ist:
   - **Ein `dev-x.y.z` läuft:** Der PR wird in den Branch übernommen
     (`git merge --squash`) und dann geschlossen — die Aktualisierung kommt
     mit der nächsten Fassung und läuft vorher über die Testinstanz.
   - **Kein Zyklus offen** (Pause): Der PR wird zur **Wartungsfassung**.
     Nach grünem PR-Lauf squashen nach `main`, im selben Zug Patchnummer hoch
     und ein CHANGELOG-Abschnitt „Abhängigkeiten aktualisiert“, Tag `vx.y.z+1`.
     Eine Abnahme auf der Testinstanz nur, wenn Sichtbares betroffen ist
     (React, Next, UI-Bibliotheken) — dann den PR stattdessen in einen kurzen
     `dev-x.y.z+1` übernehmen, der das Test-Image baut.
   Sicherheitsupdates kommen außerhalb des Monatsplans und werden genauso,
   aber ohne Aufschub behandelt.

## Quellen

- Arbeitsdokumente liegen in `docs/intern/` — ein **eigenes privates Git**, im öffentlichen Repo per `.gitignore` ausgeschlossen. Wer daran arbeitet, committet dort getrennt; ein öffentlicher Checkout hat das Verzeichnis nicht.
  - Specs: `docs/intern/specs/` — chronologisch, jede nennt die Säule, zu der sie gehört. Der Index mit einer Zeile je Spec steht in `docs/intern/README.md`; `apps/kompass/tests/spec-index.test.ts` hält ihn vollständig, wo das Verzeichnis vorliegt.
  - Pläne: `docs/intern/plans/`
  - Design-Referenz Stufe 1: `docs/intern/design/fundament/design_handoff_aluna_kompass_fundament/README.md`
  - Alunas konkreter Betrieb: `docs/intern/betrieb-aluna-qnap.md`; Release-Befundliste: `docs/intern/release-0.1.0.md`
  - Backlog: `docs/intern/backlog.md` (bewusst zurückgestellte Punkte mit Begründung)
- Nordstern: `docs/nordstern.md` (Gesamtbild, Grenzen, Roadmap)
- Hilfeseite für die schreibende Person: `docs/handbuch/akte/brief-schreiben.md` — welche Formatierungen ein Brief kennt. Der Beispielbrief darin ist zugleich Fixture: `packages/documents/tests/markdown-render.test.ts` liest ihn aus der Seite und rendert ihn.
