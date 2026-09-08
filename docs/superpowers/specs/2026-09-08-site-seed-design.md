# Aluna Kompass — Startinhalte aus dem Template (Design)

Stand 2026-09-08. Ergänzt Stufe 3 („Webseiten-Templates",
`2026-09-07-site-template-design.md`) um einen einmaligen Weg, mit dem ein
Template seine Anfangsinhalte mitbringt.

## 1. Ziel, Zuschnitt, Nicht-Ziele

**Ziel.** Ein Template-Paket kann neben Code und Deklaration auch die
**Startinhalte** der Webseite mitführen — die Werte der Variablen, die Einträge
der Sammlungen und die dazugehörigen Dateien. Ein Betreiber übernimmt sie **ein
einziges Mal** in eine frische Installation. Danach lebt der Inhalt in der
Datenbank und wird dort gepflegt; das Template ist wieder nur Code und Schema.

**Warum.** Alunas Seite hat elf Variablen und vier Sammlungen Inhalt, der heute
in drei Vorläufer-Repos verstreut liegt (`aluna-tierhilfe-v2`, `aluna-static`,
Prototyp-Import). Der Cutover-Plan (`2026-09-07-site-5-cutover.md`, Abschnitt
„Stand") sieht vor, diesen Inhalt von Hand ins CMS zu pflegen. Das ist viel
Arbeit, nicht wiederholbar und über UI und MCP verstreut. Mit einer Seed-Fixette
im Template-Repo wird der Inhalt versioniert, per PR reviewbar, und eine frische
DEV- oder TEST-Installation baut sich mitsamt Inhalt aus einem Artefakt wieder
auf.

**Entscheidungen aus dem Brainstorming (2026-09-08):**

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Nach dem Go-live ist die **DB alleinige Quelle**. Der Seed ist reiner Bootstrap und friert ein. | Template-Repo bleibt führend, Inhalte werden nach PROD nachgezogen (Merge-/Migrationsproblem, quasi git-backed CMS) |
| 2 | Das Seeden ist ein **expliziter Schritt** — ein Knopf auf der Template-Seite. | Stiller Nebeneffekt des Template-Einlesens; automatisch beim ersten Container-Start |
| 3 | **Einmal, dann nie wieder.** Eine Sperre (`site.seedAppliedAt`) plus Leerprüfung. Template-Einlesen bleibt beliebig oft möglich. | „In leere Felder nachtragen" bei jedem Aufruf; Force-/Erneut-anwenden in der Oberfläche |
| 4 | **Kein MCP-Werkzeug.** Der Knopf genügt; Seeden ist Einrichtung, kein Betrieb. | `site_seed_apply` als MCP-Tool für UI/MCP-Parität |
| 5 | Der Seed deckt nur, was das **Template deklariert** (Variablen + Sammlungen + deren Assets). | Stammdaten, Projekte, Hunde, Moduleinstellungen mit im Seed |
| 6 | Seed-Format ist **identisch zum Kompass-Export**. `fixtures/example/` bleibt davon getrennt. | Eigenes Seed-Schema; `fixtures/example/` als Seed wiederverwenden |
| 7 | `templates/verein-basis` bekommt **kein** `seed/`. | Basis-Template bringt generische Demo-Inhalte mit |

**Nicht-Ziele.** Fortlaufender Abgleich Template → DB; Seed für Stammdaten
(`organization.*`), Projekte, Hunde oder Moduleinstellungen; ein MCP-Werkzeug;
ein zweiter Anwendungslauf ohne frische DB; Auto-Seeden beim Container-Start.

## 2. Seed-Format und Ort

Ein neues, optionales Verzeichnis im Template-Paket, innerhalb der
Vertrauensgrenze `/data/site-template`:

```
seed/
  content.json      { variables, collections, assets }  — Form des Kompass-Exports
  assets/
    nicole.jpg
    selbstauskunft.pdf
    …
```

- **`content.json` hat exakt die Form, die `exportSiteContent` erzeugt.** Gelesen
  werden `variables`, `collections` und `assets`. Ein mitgeführtes `views` wird
  ignoriert (das liefern Kern und Fachmodule).
- **`assets` ist die Abbildung `logische ID → Dateiname`.** Asset-Felder in
  `variables` und `collections` tragen die logischen IDs; die Dateien liegen
  unter `seed/assets/<filename>`.
- **Zwei Autorenwege:** die Datei von Hand füllen (wie
  `fixtures/example/content.json`), oder den Inhalt einmal in einer
  Wegwerf-Installation pflegen, den Export nehmen (`content.json` +
  `assets/`-Dateien) und nach `seed/` legen.
- **`fixtures/example/` bleibt unberührt** — weiterhin die Fixture für den
  eigenständigen `astro build` in CI und Tests. Getrennter Zweck, getrennter
  Lebenszyklus.
- **`templates/verein-basis` bekommt kein `seed/`.** Ein neuer Verein findet
  `site` leer vor (Cutover-Nachtrag 2026-09-08). Der Seed ist pro Template
  opt-in.

Der Eintrag je Sammlung darf `slug`, `sortOrder` und `isPublished` führen, muss
aber nicht: fehlt `sortOrder`, gilt die Array-Reihenfolge; fehlt `isPublished`,
gilt `false`.

## 3. `applySeed`

Neue Funktion im `site`-Modul:

```ts
applySeed(deps: Deps, ctx: CallContext, opts: { confirm: boolean }): Promise<Result<SeedReport>>

interface SeedReport {
  variables: number;   // gesetzte Variablen
  entries: number;     // angelegte Einträge, je Sammlung aufgeschlüsselt
  byCollection: Record<string, number>;
  assets: number;      // hochgeladene Dateien
  applied: boolean;    // false beim Trockenlauf
}
```

**Recht:** `site.manage` (wie Template-Einlesen und Sammlungspflege).

**Vorbedingungen, in dieser Reihenfolge:**

1. Ein Template ist eingelesen (`activeTemplate` ≠ null). Sonst
   `conflict('noTemplate', …)`.
2. `site.seedAppliedAt` ist ungesetzt. Sonst `conflict('alreadySeeded', …)`.
3. `site_values` **und** `site_entries` sind beide leer. Sonst
   `conflict('siteNotEmpty', …)`. Sicherheitsnetz gegen den Fall einer verlorenen
   Sperre; überschreibt nie vorhandenen Inhalt.
4. `seed/content.json` existiert und parst. Sonst `conflict('noSeed', …)`.
5. Alle in `assets` genannten Dateien liegen unter `seed/assets/`. Sonst
   `conflict('seedAssetsMissing', <Liste>)` — geprüft **vor** jedem
   Schreibvorgang.
6. Jeder Seed-Wert besteht die Schema-Prüfung des aktiven Templates
   (`schemaFor`, dieselbe wie `setValues`/`createEntry`). Sonst `invalid([…])`.

Schlägt eine Vorbedingung fehl **oder** ist `confirm: false`, kommt der
`SeedReport` als Trockenlauf zurück (`applied: false`), ohne Schreibvorgang.

**Bei `confirm: true`, in einer Transaktion:**

- Jede Datei aus `seed/assets/` über `storeMediaInternal` ablegen
  (`declaredMimeType: 'application/pdf'` für PDFs, sonst Sniff und Maße). Dedup
  nach Inhalts-Hash ist eingebaut. Ergebnis: Abbildung `logische ID → Media-ID`.
- Für jedes Feld mit `widget === 'asset'` im aktiven Schema den Wert über die
  Abbildung umschreiben.
- `setValues` für die Variablen.
- Je Sammlungseintrag `createEntry` in Array- bzw. `sortOrder`-Reihenfolge,
  danach `setEntryPublished` für die als veröffentlicht markierten.
- `site.seedAppliedAt = isoNow(deps.clock)` über `writeSettingInternal`.
- `recordAudit({ action: 'site.seed.apply', entityType: 'siteTemplate',
  summary: 'Startinhalte aus dem Template übernommen (N Variablen, M Einträge,
  K Dateien)' })`.

Alle Schreibwege sind die bestehenden, auditierten Funktionen — kein direkter
Zugriff auf die Tabellen.

**Neue Einstellung** in `SITE_SETTINGS`:

```ts
{ key: 'site.seedAppliedAt', schema: z.string().nullable(), default: null, systemOnly: true }
```

**Fluchtweg für DEV/TEST:** eine frische DB (`dev:reset`, neues Container-Volume)
löscht die Sperre. Bewusst kein „erneut anwenden" in der Oberfläche.

**Prod:** nicht hart gesperrt. Leerprüfung und `confirm` genügen. In der Praxis
bekommt Prod seine Inhalte beim Go-live über das TEST→PROD-Backup und ruft
`applySeed` nie.

## 4. Abgrenzung

Der Seed deckt genau, was das Template deklariert. Nicht:

| Nicht im Seed | Warum | Woher stattdessen |
|---|---|---|
| `organization.*` (Name, IBAN, Anschrift, E-Mail, Gründungsjahr) | Kern-Einstellungen, unabhängig vom Template | `settings_set`, einmal; oder über das PROD-Backup |
| Projekte | Kern-Tabelle `projects`, Betriebsdaten des Vorstands | `/projects`, `project_create`; in DEV `import-prototype.ts` |
| Hunde / Geschichten | Modul `animals` | `/animals`, `animals_create`; in DEV `import-prototype.ts` |
| `site.blockedTerms` | Moduleinstellung, kein Inhalt | `settings_set` |

Das Template-Paket ist Alunas **Webseite**, nicht Alunas Stammdaten oder
Betriebsprotokoll. „Sauber an einer Stelle" gilt für den Webseiteninhalt — die
elf Variablen und vier Sammlungen, also das „von der alten Seite portieren"-
Problem.

## 5. Oberfläche

Auf der Template-Seite (`apps/kompass/src/app/(shell)/site/template/page.tsx`),
unter dem Einlese-Abschnitt, eine Karte **„Startinhalte"**:

- **Mit Knopf sichtbar**, wenn `seed/content.json` im Template-Verzeichnis liegt
  **und** `site.seedAppliedAt` ungesetzt **und** `site` leer ist.
- Knopf „Startinhalte übernehmen" → Dialog mit dem Trockenlauf-Bericht
  („11 Variablen, 13 Einträge, 17 Dateien"). Bestätigen wendet an.
- **Danach** (oder wenn `site` nicht leer): Karte zeigt „Startinhalte übernommen
  am &lt;Datum&gt;", kein Knopf.
- **Kein `seed/` im Template:** Karte fehlt ganz.

Neue Server-Action `applySeedAction` in `site/actions.ts`, ruft `applySeed`.
Übersetzungen unter `site.seed.*` in `apps/kompass/messages/de.json`.

Kein MCP-Werkzeug (Entscheidung 4).

## 6. Tests

**`packages/modules/site/tests/seed.test.ts`** — gegen eine Mini-Fixture unter
`packages/modules/site/tests/fixtures/seed/`:

- wendet Variablen + Einträge an; Asset-Dateien landen in `media_assets`, die
  Feldwerte tragen die echten Media-IDs
- Trockenlauf (`confirm: false`) liefert Bericht, schreibt nichts
- `site.seedAppliedAt` gesetzt → `conflict('alreadySeeded')`
- `site_values` oder `site_entries` nicht leer → `conflict('siteNotEmpty')`
- kein Template eingelesen → `conflict('noTemplate')`
- `seed/content.json` fehlt → `conflict('noSeed')`
- fehlende Asset-Datei → `conflict('seedAssetsMissing')` mit Namensliste, kein
  Schreibvorgang
- im Seed als veröffentlicht markierte Einträge kommen veröffentlicht heraus;
  Reihenfolge = Array-Reihenfolge
- Seed-Wert verletzt `max` eines Feldes → `invalid`
- zweiter Aufruf nach erfolgreichem Seed → `conflict('alreadySeeded')`
- doppelt referenzierte Datei → eine Media-ID (Dedup)

**`apps/kompass/tests/entrypoint.test.ts`** (oder eine Template-Test) — 
`templates/verein-basis` hat kein `seed/`.

**e2e** — in die bestehende Site-Spec: Knopf auf der Template-Seite,
Bestätigungsdialog mit Bericht, „übernommen"-Zustand danach.

**Nicht Teil dieser Umsetzung:** Alunas tatsächlicher Seed-Inhalt
(`Webseite/kompass-template/seed/` im Vereinsrepo) — der entsteht bei der
Redaktionsarbeit. Dieses Feature liefert die leere Fähigkeit.

## 7. Dateien

- `packages/modules/site/src/seed.ts` (neu) — `applySeed`, `SeedReport`,
  Format-Parsing
- `packages/modules/site/src/settings.ts` — `site.seedAppliedAt`
- `packages/modules/site/src/index.ts` — Export von `applySeed`
- `packages/modules/site/tests/seed.test.ts` (neu),
  `packages/modules/site/tests/fixtures/seed/` (neu)
- `apps/kompass/src/app/(shell)/site/template/page.tsx` — Karte „Startinhalte"
- `apps/kompass/src/app/(shell)/site/actions.ts` — `applySeedAction`
- `apps/kompass/messages/de.json` — `site.seed.*`
- `apps/kompass/e2e/` — Ergänzung der Site-Spec
- `templates/verein-basis/README.md` — Hinweis, dass ein Verein `seed/` optional
  anlegen kann

## 8. Self-Review

**Platzhalter.** Keine offenen TBD.

**Konsistenz.** Abschnitt 2 nennt `assets` als gelesen; Abschnitt 1-Korrektur aus
dem Brainstorming ist eingearbeitet (früher hieß es „ignoriert"). Sperre
(`site.seedAppliedAt`) und Leerprüfung sind in Abschnitt 3 und 5 gleich
beschrieben.

**Zuschnitt.** Ein Plan. Keine Zerlegung nötig — eine Funktion, eine Einstellung,
eine Karte, ein Testlauf.

**Mehrdeutigkeit.** „Frische DB löscht die Sperre": `site.seedAppliedAt` ist eine
Zeile in `site_settings`; ein Backup-Import trägt sie mit (dann kein erneutes
Seeden — gewollt, der Import brachte ja Inhalt). Nur eine wirklich neue DB
(`dev:reset`, neues Volume) hat die Zeile nicht.
