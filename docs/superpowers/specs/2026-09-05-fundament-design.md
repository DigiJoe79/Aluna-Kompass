# Aluna Kompass — Stufe 1 „Fundament" (Design)

Status: freigegeben im Brainstorming, zur Umsetzung
Datum: 2026-09-05

## 1. Gesamtbild

### Produktidee

Aluna Kompass ist ein Vereinsverwaltungstool, das **alle Vorgänge eines gemeinnützigen e.V.** als Single Source of Truth erfasst, so dass Jahresfinanzbericht, Kassenprüfungsunterlagen, Zuwendungsbestätigungen und die übrigen Rechenschaftsdokumente vollständig aus dem Tool erzeugt werden können. Die öffentliche Webseite des Vereins wird im Tool gepflegt und als deterministischer statischer Build zum Hoster ausgeliefert — es gibt **kein CMS und keine Datenbank im Internet**.

Zielgruppe: **generischer Kern** (Finanzen, Mitglieder, Rollen, Einstellungen, Webseite) für jeden gemeinnützigen Verein, plus **optionale, pro Installation ein-/ausschaltbare Module** für Vereinsspezifisches (für Aluna Tierhilfe e.V.: Tiere & Vermittlung). Aluna ist treibender Erstnutzer; das Projekt ist als Open Source gedacht.

Tenancy: **eine Installation pro Verein**, kein Multi-Tenancy.

### Betrieb

- Docker-Container auf dem vereinseigenen QNAP TS-873 (x86_64, QTS 5.2, Container Station), **nur im LAN** erreichbar, drei Nutzer (Vorstand).
- Drei Umgebungen mit identischem Image: Dev (lokal), Test und Prod (zwei Container auf dem NAS).
- Website-Publish läuft aus dem Container heraus (NAS hat ausgehend Internet).

### Stack (Entscheidung „Ansatz A")

TypeScript-Monorepo: Next.js (Admin-App) · SQLite über Drizzle · Tailwind + shadcn/ui · next-intl · Astro (statischer Website-Build, ab Stufe 2) · **Typst** als PDF-Engine (nicht Chromium) · MCP-Server (offizielles TypeScript-SDK) · Vitest + Playwright.

Verworfene Alternativen: SvelteKit + Astro (schlanker, aber kleineres Ökosystem, kein Vorteil bei drei LAN-Nutzern); Django + HTMX (stärkste Formular-/Berichts-Basis, aber Sprachwechsel und Bruch mit dem vorhandenen Astro-Prototyp). Chromium als PDF-Engine verworfen, weil der Verein bereits eine Typst-Pipeline mit Branding und Formularvorlagen besitzt (`Aluna Tierhilfe e.V./Vorlagen/`), Typst deterministisch rendert und ~30 MB statt mehrerer hundert MB wiegt.

### Stufenplan

Jede Stufe erhält eine eigene Spec und einen eigenen Implementierungsplan.

1. **Fundament** (dieses Dokument): Monorepo, Docker, Login, Rollen/Rechte, Einstellungen, Modul-System, i18n, Änderungsprotokoll, Dokumenten-Engine, MCP-Server, Dev/Test/Prod.
2. **Webseite**: Seiten, Team, FAQ, Projekte (öffentliche Felder), Medien, Astro-Build, Publish aus dem Tool. Tiermodul in Minimalstufe (Profil + Status für die Hundeseiten). Import der Daten aus dem bestehenden Astro-Prototyp. Ergebnis: WordPress abgelöst.
3. **Finanzen**: Konten, Buchungen mit Sphären-Zuordnung, Projekte (Finanzseite), Rücklagen nach § 62 AO, Belege, Storno statt Löschen, Kontakte, Zuwendungsbestätigungen, Kostenerstattungen, Mittelweitergabe, EÜR/Vermögensübersicht/Kassenprüfungsunterlagen.
4. **Tiere & Vermittlung** (Aluna-Modul, Vollstufe): Bestandsbuch, Herkunft/Verbleib, Verträge, Patenschaften, Partner-Shelter.
5. **Mitglieder & Gremien**: Mitgliederstamm, Beiträge als Buchungen, Mitgliederversammlung (Einladung, Anwesenheit, Protokoll), Vorstandsbeschlüsse, Satzungs-/Beitragsordnungsstände.

### Rechenschaftspflichten als Arbeitsraster

Diese Pflichten eines gemeinnützigen e.V. müssen vom Datenmodell von Tag 1 an tragbar sein; sie werden in den Fachstufen konkret ausgestaltet:

- Einnahmen-Überschuss-Rechnung nach den vier Sphären (ideeller Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher Geschäftsbetrieb).
- Vermögensübersicht zum Jahresende.
- Mittelverwendungsrechnung (§ 55 AO) und Rücklagen nach Art (§ 62 AO).
- Zuwendungsbestätigungen nach amtlichem Muster, Doppel-Aufbewahrung, Aufzeichnungspflicht (§ 50 EStDV).
- Belege und Aufbewahrung (10 Jahre, § 147 AO); Unveränderbarkeit im GoBD-Sinne: Storno statt Löschen, Änderungsprotokoll.
- Tätigkeitsbericht, Kassenprüfung, Mitgliederversammlungs-Protokolle, Vereinsregister, Transparenzregister, Satzungs-/Beitragsordnungsstände.
- Datenschutz (Verzeichnis der Verarbeitungstätigkeiten, Löschfristen).
- Tierschutzspezifisch (Modul): § 11 TierSchG, Bestandsbuch, Tierschutzverträge, TRACES.

## 2. Grundprinzipien (gelten für alle Stufen, wandern in `AGENTS.md`)

1. **Generischer Kern, optionale Module.** Der Kern kennt keine Vereinsspezifika. Faustregel: Würde ein anderer Verein bei einem Namen/Wert stutzen, ist er zu spezifisch für den Kern.
2. **Konfiguration statt Konstanten.** Vereinsstamm, Steuerdaten, Satzungszweck, Branding, Rücklagenregeln sind admin-editierbare Einstellungen, nie Code-Konstanten, nie Env-Vars (Env-Vars nur für Betriebsparameter: Pfade, Port, Secrets, Umgebungsname). **Das gilt auch für Farben: kein statischer Farbwert im Anwendungscode.** Komponenten, Typst-Vorlagen und der Website-Build verwenden ausschließlich Theme-Tokens (siehe Abschnitt 6, „Themes"); die Token-Werte kommen aus dem aktiven Theme in den Einstellungen.
3. **Nichts Rechenschaftsrelevantes wird gelöscht.** Storno/Ersetzen statt Löschen; jede schreibende Aktion erzeugt einen Eintrag im Änderungsprotokoll (Nutzer, Zeit, Kanal, Vorher/Nachher).
4. **Interner Datensatz ≠ veröffentlichte Sicht.** Webseite und Berichte lesen nur explizit freigegebene Sichten.
5. **Abgeleitete Werte werden berechnet, nie gespeichert.**
6. **Rechteprüfung ausschließlich serverseitig**, zentral in der Service-Schicht vor jeder schreibenden Aktion. Permission-Keys fest im Code je Modul; Rollen frei benennbar.
7. **Code Englisch, Oberfläche über i18n.** Eine Sprachdatei `messages/de.json`, kein hartcodierter UI-Text. Nutzdaten (Rollennamen, Projektnamen, Website-Inhalte) sind ausgenommen; Website-Inhalte werden als DE/EN-Paar gespeichert, wo nötig.
8. **Ein Weg zu den Daten.** Oberfläche und MCP-Server rufen dieselbe Service-Schicht mit derselben Rechteprüfung und demselben Protokoll. Keine Fachlogik in Adaptern.
9. **Nie in Prod testen.** TDD ab der ersten Zeile; Dev/Test/Prod strikt getrennt; sichtbarer Umgebungsbalken außerhalb von Prod; Publish nur aus Prod.

Konventionen: ULID-Strings als Primärschlüssel; Zeitstempel als ISO-8601 in UTC; Geldbeträge als Integer in Cent; Fremdschlüssel aktiv; WAL-Modus.

## 3. Ziel und Nicht-Ziele der Stufe 1

**Ziel:** Ein lauffähiger Container auf dem NAS, in dem sich die Vorstände einloggen, Nutzer/Rollen/Einstellungen pflegen, Module ein-/ausschalten, ein Typst-Dokument erzeugen, ein Backup exportieren/importieren und über MCP dieselben Vorgänge auslösen können. Alle Register, an die sich Fachmodule später anhängen, existieren und sind getestet.

**Nicht-Ziele:** Fachmodule (Projekte, Tiere, Buchungen, Kontakte, Mitglieder); Self-Signup; Passwort-Reset per E-Mail; Zugriff von außerhalb des LAN (VPN ist Sache des NAS); Multi-Tenancy; HTTPS/Reverse-Proxy im Container; Postgres/Redis; ausfüllbare PDF-Formularfelder (bleiben in der Pipeline des Vereinsrepos).

## 4. Repo-Struktur und Stack

```
apps/
  kompass/          Next.js-Admin-App (App Router, TypeScript) — nur UI + Adapter
  site/             Astro-Paket für den Website-Build (entsteht erst in Stufe 2)
packages/
  core/             Fachlogik: Schema, Migrationen, Service-Schicht, Rechte, Audit, Settings, Modul-Registry
  mcp/              MCP-Server (Tool-Definitionen → core), kein Fachcode
  documents/        Typst-Basis-Template, Kernvorlagen, Rendering-Aufruf
  modules/<name>/   ein Paket je Fachmodul (ab Stufe 2)
docs/superpowers/   Specs und Pläne
```

- pnpm-Workspaces, TypeScript strict, ESLint + Prettier.
- Next.js App Router; Server Components; Server Actions als dünne Adapter auf `packages/core`.
- Drizzle ORM auf SQLite (`better-sqlite3`); Migrationen versioniert im Repo, beim Prozessstart automatisch angewendet.
- Auth: Session-Cookie (httpOnly, sameSite=lax), Sessions in DB, Passwörter mit Argon2id. Keine externe Auth-Bibliothek.
- MCP: Streamable-HTTP-Transport unter `/mcp` im Kompass-Prozess; Bearer-Token → `apiTokens`.
- Typst-Binary im Image (Version gepinnt), Aufruf als Kindprozess.
- i18n: next-intl, Single-Locale, `messages/de.json` (Anrede: Sie-Form), Formatter für Datum/Währung.
- UI: Tailwind + shadcn/ui; Design-Tokens als CSS-Custom-Properties (`--color-primary`, …) aus den Branding-Einstellungen injiziert.

## 5. Datenmodell des Kerns

Alle Tabellen englisch benannt, camelCase in Drizzle, snake_case in SQLite.

**users** — id, name, email (unique), passwordHash, mustChangePassword, isActive, failedLoginCount, lockedUntil (nullable), lastLoginAt (nullable), createdAt, updatedAt. Kein Einladungs-Status: Ein Admin legt den Nutzer an, das System erzeugt ein Startpasswort, das genau einmal angezeigt wird; beim ersten Login erzwingt `mustChangePassword` ein neues Passwort. Nach 5 Fehlversuchen wird der Account 15 Minuten gesperrt (Login zeigt die verbleibenden Versuche an); ein Admin kann jederzeit ein neues Startpasswort setzen. Passwortregel: mindestens 12 Zeichen, keine Zeichenklassen-Pflicht, Stärkeanzeige im UI. Startpasswörter sind sprechbare Wortketten (z. B. `wiese-kanu-73-lampe`, vier Elemente aus einer deutschen Wortliste plus Zahl, ≥ 12 Zeichen), weil sie mündlich weitergegeben werden. Ein Passwortwechsel beendet alle anderen Sitzungen des Nutzers; API-Tokens bleiben gültig.
**sessions** — id, userId, createdAt, expiresAt
**apiTokens** — id, userId, name, tokenHash (unique), createdAt, lastUsedAt, revokedAt. Klartext-Token wird genau einmal angezeigt.
**roles** — id, name (unique), description, isProtected, createdAt. Rollen werden nie gelöscht (eine nicht mehr benötigte Rolle wird von allen Nutzern entfernt und bleibt leer stehen). Die beim Setup angelegte Rolle „Administration" ist `isProtected`: nicht editierbar, hat immer alle Rechte, und mindestens ein aktiver Nutzer muss sie tragen — damit sich niemand aussperrt.
**rolePermissions** — roleId, permissionKey (PK zusammengesetzt). Permission-Keys sind Code-Konstanten aus der Registry; unbekannte Keys werden beim Schreiben abgewiesen.
**userRoles** — userId, roleId (PK zusammengesetzt). Effektive Rechte = Vereinigung.
**settings** — key (PK), value (JSON), updatedAt, updatedByUserId. Jeder Schlüssel wird von Kern oder Modul mit Zod-Schema und Default registriert; unregistrierte Schlüssel werden abgewiesen.
**auditLog** — id, occurredAt, userId (nullable bei `system`), channel (`ui` | `mcp` | `system`; `system` für Migrationen, Seed, Import, automatische Sperren), action, entityType, entityId, before (JSON, nullable), after (JSON, nullable), summary, apiTokenId (nullable, bei `mcp`), ipAddress (nullable), requestId (Vorgangs-ID, erscheint identisch auf der 500-Seite und im Serverlog), environment (`APP_ENV` zum Zeitpunkt des Eintrags — bleibt nach einem Import nach Test lesbar). Nur INSERT; kein UPDATE/DELETE (durch SQLite-Trigger abgesichert).
**mediaAssets** — id, filename (enthält Content-Hash), mimeType, bytes, width, height (nullable), uploadedByUserId, createdAt. Dateien unter `MEDIA_PATH`.
**documents** — id, templateKey, number (lückenlos je Vorlage und Jahr im Format `<PREFIX>-<JAHR>-<NNN>`, z. B. `BRF-2026-004`; jede Vorlage definiert ein dreibuchstabiges Präfix), entityType (nullable), entityId (nullable), inputSnapshot (JSON), assetId, status (`issued` | `voided`), voidedAt, voidedByUserId, voidReason (alle nullable), createdByUserId, createdAt. Ein Dokument wird nie gelöscht, sondern storniert; die PDF bleibt erhalten und trägt in der Liste den Zustand „storniert". Ersatzdokumente erhalten eine neue Nummer.

Kern-Settings (Schlüssel, alle admin-editierbar):
- `organization.*`: name, legalForm, street, postalCode, city, country, registerCourt, registerNumber, taxNumber, taxOffice, exemptionNoticeDate, exemptionNoticeType (`60a` | `exemption`), statutoryPurpose, email, website, iban, bic, bankName
- `branding.*`: logoAssetId, fontBody, fontHeading, `activeTheme` (Theme-Key)
- `themes`: Liste benannter Themes; jedes Theme = Key, Name, vollständiger Token-Satz für `light` und `dark` (siehe Abschnitt 6, „Themes"). Das mitgelieferte, neutrale Default-Theme ist der registrierte Standardwert dieser Einstellung und liegt als reine Datendatei im Kern (`packages/core/src/themes/default-theme.ts`, die einzige Datei mit Farbwerten) — so bleibt es bei Updates nachziehbar; Aluna hinterlegt sein eigenes Theme als Daten in der Datenbank. (Ursprünglich als Seed-Eintrag geplant; nach Umsetzung 2026-09-05 angepasst.)
- `modules.enabled`: string[]
- `system.*` (nur vom System geschrieben, im Admin lesbar): `lastImportAt`, `lastImportSource`, `lastExportAt` — speist Umgebungsbalken („Daten vom …") und Backup-Seite.

Kern-Permission-Keys: `users.manage`, `roles.manage`, `settings.manage`, `modules.manage`, `audit.view`, `documents.create`, `documents.view`, `media.upload`, `backup.export`, `backup.import`.

## 6. Modul-System und Service-Schicht

**Manifest.** Jedes Modul exportiert `ModuleManifest`: `key`, `permissions[]`, `tables`, `migrations`, `settings[]` (key, zod-Schema, default), `navigation[]`, `mcpTools[]`, `documentTemplates[]`, `publishedViews[]`. Der Kern führt eine Registry; nur Module in `modules.enabled` werden geladen (Navigation, Routen, MCP-Tools, Sichten). Tabellen deaktivierter Module bleiben erhalten.

**Service-Signatur.** Jede Fachfunktion: `fn(ctx: CallContext, input: Input): Promise<Result<Output>>`.
- `CallContext`: `userId`, `permissions: Set<string>`, `channel`.
- Ablauf: Rechteprüfung → Zod-Validierung → DB-Transaktion (Schreiben + Audit-Eintrag in derselben Transaktion) → Ergebnis.
- `Result` ist `{ ok: true, value } | { ok: false, error }` mit Fehlertypen `forbidden`, `validation` (Feldliste), `notFound`, `conflict`. Technische Fehler werfen.
- Audit-Eintrag wird von einem gemeinsamen Helfer geschrieben, nicht pro Service handgestrickt.

**Adapter.** Server Actions bauen `ctx` aus der Session, MCP-Tools aus dem Token; beide rufen nur Services und übersetzen `Result` (UI: i18n-Fehlermeldungen; MCP: strukturierte Fehlerantwort).

**Veröffentlichte Sichten.** Reine Lesefunktionen ohne `ctx`, die ein Modul für die Webseite registriert (`publishedProjects()` ab Stufe 2). Sie geben ausschließlich Felder zurück, die im Sichten-Schema als öffentlich deklariert sind. Stufe 1 liefert Schnittstelle + Test.

**MCP-Tools des Kerns:** `settings.get`, `settings.set`, `roles.list`, `roles.create`, `roles.update`, `roles.assign`, `users.list`, `users.create`, `audit.query`, `documents.render`, `modules.list`, `modules.setEnabled`. Ein Tool je Service-Funktion; Beschreibungen englisch.

**Themes.** Der Kern definiert ein festes **Token-Schema** (Namen und Bedeutung), nie Werte:
- Marke: `--color-primary`, `--color-primary-ink`, `--color-primary-soft`, `--color-accent`, `--color-accent-deep`, `--color-accent-soft`
- Status: `--color-success`, `--color-success-bg`, `--color-warning`, `--color-warning-bg`, `--color-error`, `--color-error-bg`, `--color-info`, `--color-info-bg`
- Flächen: `--bg`, `--surface`, `--surface-2`, `--sidebar-bg`, `--topbar-bg`
- Schrift und Linien: `--ink`, `--ink-2`, `--muted`, `--muted-2` (nur Icons/Trenner, nie Text), `--on-primary`, `--on-primary-muted`, `--line`, `--line-2`, `--line-strong`
- Interaktion (aus der Design-Runde ergänzt): `--focus-ring`, `--hover-surface`, `--active-surface`, `--selected-bg`, `--selected-ink`, `--link`, `--link-hover`, `--disabled-ink`, `--disabled-bg`
- Tabellen und Felder (ergänzt): `--table-head-bg`, `--table-zebra`, `--table-row-hover` (Zebra, Hover und Auswahl müssen drei unterscheidbare Werte bleiben), `--input-bg`, `--input-placeholder`, `--code-bg`, `--neutral-badge-bg`, `--neutral-badge-ink`, `--tooltip-bg`, `--tooltip-ink`
- Tiefe (ergänzt): `--overlay`, `--shadow-sm`, `--shadow-md` (Schatten und Overlay sind Theme-Werte, weil sie im Dunkel anders sein müssen)
- Typografie und Form: `--font-body`, `--font-heading`, `--font-mono` (Tabellenziffern für Beträge, IBAN, Keys, Zeitstempel), `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-full`, `--row-h`
- Die konkreten Werte des Default-Themes (Hell/Dunkel) stehen im Design-Handoff (Token-Sheet `1a`, siehe Abschnitt „Design-Referenz") und werden als Seed-Daten übernommen, nicht in Code.
- `--row-h` (36/44/56 px): Das Theme liefert den Grundwert; die Zeilendichte ist eine **Nutzer-Einstellung im Browser** (wie der Sidebar-Zustand), keine Vereinseinstellung. Dichte ist Ergonomie, nicht Marke.
- Ein Theme liefert für jedes Token einen Wert für `light` und für `dark`. **Keine Vererbung** vom Default-Theme: Jedes Theme ist vollständig, damit eine Änderung am Default kein anderes Theme verschiebt. „Duplizieren" füllt ein neues Theme mit allen Werten vor. Das Schema wird mit Zod validiert; unvollständige Themes werden abgewiesen.
- Themes sind keine Rechenschaftsdaten und dürfen gelöscht werden, außer dem aktiven Theme und dem Default-Theme. Module werden nie gelöscht, nur deaktiviert.
- Die App injiziert die Tokens des aktiven Themes zur Laufzeit als CSS-Custom-Properties in `:root` (Hell/Dunkel über `prefers-color-scheme` und einen Nutzer-Schalter). Tailwind-Farben sind ausschließlich auf diese Custom-Properties gemappt; shadcn/ui-Komponenten werden auf dieselben Tokens umgestellt.
- Typst-Vorlagen erhalten dieselben Tokens (Farben, Schriften) als Parameter aus dem aktiven Theme; der Website-Build (Stufe 2) liest sie ebenfalls aus den Einstellungen.
- Admin-UI: Theme anlegen/duplizieren/bearbeiten mit Live-Vorschau (Hell und Dunkel nebeneinander, nicht hinter einem Umschalter), aktives Theme wählen. Das Default-Theme ist schreibgeschützt; „Bearbeiten" legt eine Kopie an. Eine WCAG-Kontrastprüfung (reine Funktion, unit-getestet) warnt mit Zahl und Vorschlag, wenn ein definiertes Tokenpaar unter AA fällt; sie blockiert das Speichern nicht. Der Umgebungsbalken (Dev/Test) hat bewusst feste, theme-unabhängige Signalfarben, damit er nie „wegdesignt" werden kann — die einzige erlaubte Ausnahme, als Konstante mit Kommentar markiert.

**Oberfläche.** App-Shell (Sidebar aus Manifesten, einklappbar auf eine 56-px-Icon-Leiste, Zustand je Nutzer im Browser gemerkt; ab 1024 px Breite legt sich die Sidebar als Drawer über den Inhalt und zweispaltige Formulare brechen auf eine Spalte; Topbar mit Vereinsname + Umgebungsbalken; Topbar-Suche ist in Stufe 1 eine Befehlspalette (Cmd/Ctrl+K) über Navigationsziele, Einstellungsfelder und vorhandene Aktionen — **keine** Suche nach Nutzer- oder Rollennamen; Einträge inaktiver Module erscheinen ausgegraut mit Grund; Module hängen später ihre Entitäten an), Fehlerseiten für 403 „Kein Recht", 404 und einen generischen technischen Fehler (z. B. Datenbank nicht erreichbar), Ladezustände für Export, Import und Dokument-Rendering, Login, Einrichtungsseite beim ersten Start (legt genau einmal einen Admin an), Admin-Bereich: Nutzer, Rollen, Einstellungen (Vereinsstamm, Branding), Module, Änderungsprotokoll, Dokumente, Backup, eigenes Profil (Passwort, API-Tokens).

## 7. Dokumenten-Engine

- `packages/documents`: Basis-Template `base.typ` (abgeleitet vom Aluna-Template, alle Vereinsdaten/Branding als Parameter, Briefkopf optional) + Vorlagen je Dokumentart, jede mit `key`, Zod-Schema, Typst-Datei.
- Kernvorlagen in Stufe 1: `letterhead` (Briefbogen mit Freitext) und `audit-log-export` (Änderungsprotokoll als Liste).
- `renderDocument(ctx, templateKey, input)`: Rechteprüfung → Validierung → JSON in Temp-Verzeichnis → `typst compile --root <templates>` → Ergebnis als Media-Asset → Eintrag in `documents` mit vollständigem `inputSnapshot`. Typst-Fehler → `validation`-artiger Fehler mit Typst-Ausgabe, nichts gespeichert.
- Determinismus: gleiche Eingabe + Template + Typst-Version ⇒ byte-identische PDF. Typst-Version gepinnt, Schriften im Repo, keine Systemzeit im Template (Datum kommt aus den Daten). Test: zweimal rendern, Hash vergleichen.
- Schriften (Design-Entscheidung): Source Sans 3 (Fließtext), Source Serif 4 (Überschriften), IBM Plex Mono (Mono), alternativ wählbar Public Sans und Atkinson Hyperlegible — alle SIL Open Font License, **im Repo self-hosted** (kein CDN, das NAS darf offline sein). Dieselben Schriftdateien nutzen App und Typst. Office-Schriften (Calibri/Cambria) kommen nicht ins Repo; eigene Schriftdateien sind ein späterer Upload.
- Vorlagen mit rechtlich vorgegebenem Text (z. B. Zuwendungsbestätigung, Stufe 3) tragen den Text fest in der Typst-Datei und nehmen nur Daten entgegen.

## 8. Testing, Umgebungen, Auslieferung

**TDD auf drei Ebenen:**
- Service-Tests (`packages/core`, Vitest) gegen frische SQLite-DB je Testdatei mit echten Migrationen. Pro Service: Erfolg, `forbidden`, `validation`, Audit-Eintrag. Regeltests: kein Löschpfad für protokollierte Entitäten; `auditLog` ist unveränderbar (Trigger); Sichten reichen keine internen Felder durch; Rendering ist deterministisch.
- Theme-Regeltests: ein Vitest-Test (`apps/kompass/tests/no-color-literals.test.ts`) scannt `apps/kompass/src` auf Hex-, rgb()-, hsl()- und oklch()-Literale (Ausnahme: Umgebungsbalken, explizit markiert) und läuft in `pnpm test` und CI; Test, dass jedes Theme das vollständige Token-Schema erfüllt; Test, dass das Default-Theme der registrierte Standardwert der Einstellung `themes` ist.
- Adapter-Tests: Token → `ctx`; widerrufenes/abgelaufenes Token wird abgewiesen; `Result`-Fehler kommen strukturiert an.
- End-to-End (Playwright, gegen gebauten Container): Login, Rolle anlegen/zuweisen, Einstellung ändern, Dokument erzeugen, Umgebungsbalken sichtbar.

**Umgebungen:** Konfiguration nur über Env-Vars: `APP_ENV` (`development` | `test` | `production`), `DATABASE_PATH`, `MEDIA_PATH`, `PORT`, `SESSION_SECRET`.
- Dev: `pnpm dev`, SQLite im Repo (git-ignoriert), Seed-Skript (Admin + Beispielrollen).
- Test/Prod: identisches Image, zwei Compose-Dienste `kompass-test` / `kompass-prod` mit eigenen Ports und Volumes (`/share/Container/kompass-<env>/{data,media}`).
- Umgebungsbalken bei allem außer `production`. Website-Publish (Stufe 2) nur bei `production`.
- Backup: Export (ZIP aus DB-Datei + Medien; enthält Nutzer **mit** Passwort-Hashes, damit ein Restore ohne Neuanlage funktioniert, aber **ohne** Sitzungen und API-Tokens — ein Prod-Token darf in Test nie gültig sein) und Import (überschreibt vollständig, Bestätigung durch Eintippen des Umgebungsnamens) im Admin-Bereich. Nach einem Import sind alle Sitzungen ungültig (die Sessions-Tabelle wurde mitersetzt); der Nutzer landet auf der Login-Seite mit dem Hinweis „Import abgeschlossen". Der Import-Warnzustand nutzt die Warnfarbe, nicht Rot: Rot bleibt Validierungsfehlern und destruktiven Aktionen vorbehalten.

**Auslieferung:** GitHub Actions: Tests → Multi-Stage-Docker-Build (amd64; arm64 optional) → Push in die GitHub Container Registry, Tag je Release. Auf dem NAS: Image erst für Test ziehen, nach Freigabe für Prod; Backup-Export vor jedem Prod-Update ist Pflicht (Anleitung). Migrationen laufen beim Start.

**Repo-Hygiene:** `AGENTS.md` mit Prinzipien und Coding-Regeln (kanonisch); `CLAUDE.md` als dünner Verweis plus Befehle; `docs/superpowers/specs` und `plans`.

## 8a. Design-Referenz

Das High-Fidelity-Design für Stufe 1 liegt unter `docs/design/fundament/design_handoff_aluna_kompass_fundament/` (`README.md` mit vollständiger Token-, Screen- und Verhaltensdokumentation; `Aluna Kompass Fundament.dc.html` als Design-Board mit den Artboards `1a`–`1q` und `2a`–`2f`). Es ist **Design-Referenz, kein Produktionscode**: Screens werden mit shadcn/ui-Komponenten im Next.js-Projekt nachgebaut, die Prototyp-Dateien werden nicht kopiert. Board-Chrome, Anmerkungen und Prototyp-Interna (`support.js`, Tweak-Panel) sind nicht Teil des Produkts.

Verbindlich aus dem Design übernommen: Token-Schema und Default-Werte (`1a`), Shell-Maße (Sidebar 248/56 px, Topbar 56 px, Drawer unter 1180 px), Umgebungsbalken-Farben (Test `#1A1A1A`/`#F2C200`, Dev `#B3261E`/`#FFFFFF` — die einzigen nicht themebaren Farbwerte), Rechte-Matrix mit sichtbaren Permission-Keys, Feld-Diff im Protokoll, Einmal-Dialoge ohne Schließen-× (Startpasswort, API-Token), Import-Bestätigung durch Eintippen des Umgebungsnamens, Fehlerseiten innerhalb der Shell, drei Lademuster (Balken, Schrittliste ohne Abbrechen, Skelett).

Abweichung vom Design-Text: Der Export enthält Passwort-Hashes (Handoff `1o` sagt „Zugangsdaten nicht"), siehe Abschnitt 8 — ohne Hashes wäre ein Restore nicht anmeldbar. Ausgeschlossen sind nur Sitzungen und API-Tokens.

## 9. Offene Punkte für spätere Stufen (bewusst nicht hier entschieden)

- Zuschnitt von „Projekt" zwischen Webseite (Stufe 2) und Finanzen (Stufe 3): Stufe 2 legt die Tabelle mit öffentlichen Feldern an, Stufe 3 erweitert sie.
- Sphären-, Rücklagen- und Kontenmodell: Stufe 3.
- Tier-Bestandsbuch und § 11 TierSchG-Nachweise: Stufe 4.
