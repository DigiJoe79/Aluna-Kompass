# Cutover: Aluna zieht um, `website` verschwindet — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alunas Inhalte laufen auf dem Modul `site`, ihre Seite lebt im Vereins-Repo, und `website` ist aus diesem Repo verschwunden.

**Architecture:** Ein einmaliges Skript überführt den Bestand aus den `website_*`-Tabellen nach `site_values` und `site_entries`. Erst wenn Alunas Installation nachweislich auf `site` läuft und von dort publiziert, entfallen Modul, Tabellen und `apps/site`.

**Tech Stack:** Astro 7, TypeScript, Drizzle/SQLite, Vitest, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitt 10.

**Voraussetzung:** `2026-09-07-site-4-basis-template.md` ist abgeschlossen.

**Reihenfolge:** Task 1 nimmt `website` das Publizieren. Danach kann Aluna erst wieder veröffentlichen, wenn Task 2 die Inhalte umgezogen hat — die beiden gehören zeitlich zusammen und sollten nicht über Tage auseinanderfallen.

## Voraussetzungen

**Vor Task 1 — erfüllt am 2026-09-07:** Alunas Template existiert im Repo von
Aluna Tierhilfe e.V. (`Webseite/kompass-template`), liegt im Testcontainer unter
`/data/site-template` und wurde dort eingelesen. Damit stehen die
Sammlungsschlüssel und Variablen fest, auf die Task 2 abbildet.

**Vor Task 2:** Ein Publish aus der Testumgebung ist durchgelaufen und die Seite
im Browser geprüft. Das lässt sich erst nach Task 1 feststellen — vorher gibt es
in `site` keine Pipeline. Die frühere Fassung dieser Liste verlangte den Publish
schon vor Task 1 und war damit im Kreis geschlossen.

**Vor Task 4:** Alunas Installation läuft in der Testumgebung vollständig auf
`site` — Inhalte migriert, Publish geprüft. Vorher wird `website` nicht
entfernt: Seine Tabellen sind bis dahin die einzige vollständige Kopie der
Inhalte.

Was fehlt, wird hergestellt, bevor der zugehörige Task beginnt.

## Global Constraints

- Nichts Rechenschaftsrelevantes wird gelöscht; redaktionelle Inhalte dürfen weg (`AGENTS.md`, Prinzip 3).
- Migrationen über `pnpm --filter @kompass/core db:generate`; erzeugte Dateien werden committet und nie editiert.
- Der Umzug läuft gegen Testdaten, nie gegen Prod (`AGENTS.md`, Prinzip 9).
- Zielplattform des Images ist amd64; unter Apple Silicon `--platform linux/amd64`.

---

### Task 1: Die Publish-Kette von `website` nach `site`

**Files:**
- Modify: `packages/modules/site/src/export.ts` (Sperrwörter, Übersetzungslücken)
- Create: `packages/modules/site/src/settings.ts` (`site.blockedTerms`)
- Move: `packages/modules/website/src/pipeline/` → `packages/modules/site/src/pipeline/`
- Move: `packages/modules/website/src/services/publishes.ts` → `packages/modules/site/src/services/`
- Create: `packages/modules/site/tests/pipeline.test.ts` (neu geschrieben, nicht verschoben)
- Move: `apps/kompass/src/app/(shell)/website/publish/` → `.../site/publish/`
- Modify: `packages/modules/website/src/manifest.ts`, `mcp-tools.ts`, `export.ts` (Publish entfällt dort)
- Modify: `packages/modules/site/src/mcp-tools.ts`, `apps/kompass/messages/de.json`, `apps/kompass/playwright.config.ts`
- Generated: Migration, die `website_publishes` in `site_publishes` umbenennt

**Interfaces:**
- Consumes: `exportSiteContent`, `templateIsCurrent`, `activeTemplate` aus Plan 3
- Produces: `runPreview(deps, ctx, env)`, `runPublish(deps, ctx, env, { confirm })`, `checkDeployTarget(deps, ctx, env)` im Modul `site`

Dieser Task ist grösser als ein Umzug, und er nimmt `website` das Publish-Recht — deshalb steht er hier und nicht in Plan 4. Von hier an publiziert nur noch `site`; Alunas Inhalte müssen also in Task 2 unmittelbar folgen.

- [ ] **Step 1: Die Prüfungen generisch machen**

`jobs.ts` erwartet von `exportSiteContent` ein `{ gaps, violations }`, das die Fassung in `site` nicht liefert. Beides muss über beliebige Feldstrukturen laufen, nicht über eine feste Feldliste — dieselbe Mechanik wie bei der Sprachbereinigung im Kern.

```ts
// packages/modules/site/src/export.ts
/** Jeder Text im Export, mit seinem Pfad — Variablen wie Sammlungseinträge. */
function* texts(node: unknown, path: string): Generator<{ path: string; locale: string; value: string }> { … }

export interface ExportChecks {
  gaps: { path: string; locale: string }[];
  violations: { path: string; term: string; excerpt: string }[];
}
```

`gaps`: Ein Feld, dessen Leitsprache gefüllt ist, während eine weitere Sprache leer bleibt — `translationGaps` aus dem Kern liefert die Regel, hier angewandt auf jeden Textpfad. `violations`: Treffer aus `site.blockedTerms`, mit Pfad, Begriff und Umgebung.

Tests: ein Sperrwort in einer Variablen, eines in einem Sammlungseintrag, eine Lücke in einem verschachtelten Feld, und ein Lauf ohne Befunde.

- [ ] **Step 2: `site.blockedTerms` als Moduleinstellung**

```ts
export const SITE_SETTINGS: SettingDefinition[] = [
  { key: 'site.blockedTerms', schema: z.array(z.string().trim().min(2).max(80)).max(50), default: [] },
];
```

Ins Manifest aufnehmen. Die Liste von `website` zieht in Task 2 mit den Inhalten um; hier entsteht nur das Feld.

- [ ] **Step 3: Pipeline verschieben**

```bash
git mv packages/modules/website/src/pipeline packages/modules/site/src/pipeline
git mv packages/modules/website/src/services/publishes.ts packages/modules/site/src/services/publishes.ts
```

Anzupassen sind die Importe und der Bezug auf `exportSiteContent`. **`SITE_DIR` entfällt**: Es zeigte auf `apps/site`; das Template-Verzeichnis steht in `SITE_TEMPLATE_DIR`. Zwei Variablen für dasselbe wären eine Fehlerquelle, gerade weil sie im Container aus verschiedenen Zeilen kommen.

- [ ] **Step 4: `pipeline.test.ts` neu schreiben**

Der alte Test baut `apps/site` gegen das alte Inhaltsmodell und lässt sich nicht mitnehmen. Der neue Test baut gegen `templates/verein-basis`: Template einlesen, eine Variable setzen, einen Eintrag anlegen, `runPreview`, danach `runPublish` in ein lokales Zielverzeichnis, und prüfen, dass die erwartete Datei dort liegt — **einschliesslich eines Bildes**, denn genau das hat der Export bis `790cdb7` verloren.

- [ ] **Step 5: `website` verliert sein Publish**

Aus `packages/modules/website` entfernen: die Permission `website.publish`, den Navigationseintrag „Publizieren", die Werkzeuge `website_deploy_check` und `website_export_check`, die Rechteprüfung in seinem `export.ts`. Sonst bleibt ein Recht ohne Werkzeug zurück, und `apps/kompass/tests/mcp-tools.test.ts` schlägt zu Recht an.

- [ ] **Step 6: Die Historie umbenennen, nicht neu anlegen**

`site_publishes` in `packages/modules/site/src/schema.ts` aufnehmen, in `website/src/schema.ts` entfernen.

Run: `pnpm --filter @kompass/core db:generate`
Expected: eine Migration mit `ALTER TABLE website_publishes RENAME TO site_publishes`. Erzeugt drizzle stattdessen ein Löschen und Anlegen, wird die Datei **nicht** übernommen — dann ist sie von Hand als Umbenennung zu schreiben. Alunas Publish-Historie reicht über Jahre und ist ein Betriebsprotokoll.

- [ ] **Step 7: Oberfläche und Werkzeuge**

`apps/kompass/src/app/(shell)/website/publish/` nach `site/publish/` verschieben; inhaltlich unverändert bis auf die Herkunft der Dienste. Übersetzungen unter `website.publish` in `de.json` nach `site.publish` umhängen.

MCP: `site_preview_build`, `site_publish` und `site_deploy_check` neu — Vorgänger gibt es nur für `site_deploy_check` und `site_export_check`, die übrigen entstehen hier. Jedes nennt `site.publish` in seiner Beschreibung.

- [ ] **Step 8: Gesamtlauf**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: alles grün. `apps/kompass/e2e/website-publish.spec.ts` wird dabei zu `site-publish.spec.ts` und arbeitet gegen das Basis-Template; `SITE_TEMPLATE_DIR` ist in der Playwright-Konfiguration bereits gesetzt.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(site): move the publish chain over, history included"
```

---

### Task 2: Alunas Inhalte übernehmen

**Files:**
- Create: `scripts/migrate-website-to-site.ts`
- Test: `scripts/tests/migrate-website-to-site.test.ts`

**Interfaces:**
- Produces: `migrateWebsiteToSite(deps, opts): MigrationReport`

- [ ] **Step 1: Tests schreiben**

```ts
describe('migrate website to site', () => {
  it('carries page texts into variables named after their page and field', async () => { /* website_pages.about.body → variables.aboutBody */ });
  it('carries articles, team, faqs and downloads into entries with their slug and order', async () => { /* … */ });
  it('keeps the published flag where the collection is publishable', async () => { /* … */ });
  it('reports one line per source table with counts', async () => { /* Bericht als Rückgabewert */ });
  it('refuses to run twice and leaves the second attempt untouched', async () => { /* conflict alreadyMigrated, wenn site_entries nicht leer ist */ });
  it('refuses to run in production', async () => { /* env production → conflict */ });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Expected: FAIL

- [ ] **Step 3: Skript schreiben**

Das Ziel ist Alunas Template, dessen Deklaration zu diesem Zeitpunkt feststeht. Die Zuordnung steht als Tabelle im Skript, nicht als Automatik:

```ts
const PAGE_FIELDS: { page: string; field: 'title' | 'lede' | 'body'; variable: string }[] = [
  { page: 'about', field: 'body', variable: 'aboutBody' },
  // … je Seite und Feld ein Eintrag, so viele wie Alunas Template Variablen deklariert
];
const COLLECTIONS = [
  { from: 'website_articles', to: 'articles', fields: ['title', 'lede', 'body'] },
  { from: 'website_team', to: 'team', fields: ['name', 'position', 'photoAssetId'] },
  { from: 'website_faqs', to: 'faq', fields: ['category', 'question', 'answer'] },
  { from: 'website_downloads', to: 'documents', fields: ['title', 'assetId'] },
];
```

Was Alunas Template fest codiert, wandert nicht mit: Diese Texte stehen künftig im Template und werden beim Umzug einmal von Hand übertragen. Das Skript nennt am Ende, welche Seitenfelder es *nicht* übernommen hat, damit nichts unbemerkt zurückbleibt.

- [ ] **Step 4: Gegen echte Daten proben**

```bash
pnpm dev:reset
pnpm tsx scripts/migrate-website-to-site.ts --dry-run
```

Expected: Bericht ohne Schreibvorgang; Zahlen stimmen mit den Listen in der Oberfläche überein.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-website-to-site.ts scripts/tests
git commit -m "feat(migration): move Aluna's content into the template model"
```

---

### Task 3: Alunas Seite herauslösen

**Files:**
- Delete: `apps/site/`
- Modify: `Dockerfile`, `pnpm-workspace.yaml`, `AGENTS.md`, `docs/betrieb.md`
- Modify: `apps/kompass/playwright.config.ts` (`SITE_DIR` → Testtemplate)

- [ ] **Step 1: Ins Vereins-Repo überführen**

`apps/site` wird als Alunas Template in das Repo von Aluna Tierhilfe e.V. übernommen, dort um `kompass.template.ts` ergänzt und gegen die Testumgebung geprüft. Erst wenn es dort publiziert, geht es hier weg.

- [ ] **Step 2: Aus diesem Repo entfernen**

Löschen, aus dem Workspace nehmen, aus dem Dockerfile die Zeilen für `apps/site` entfernen und stattdessen `templates/verein-basis` kopieren. `AGENTS.md` unter „Befehle" die Site-Zeilen ersetzen.

- [ ] **Step 3: Prüfen, dass nichts von Aluna übrig ist**

Run: `grep -rniE "aluna|tierhilfe|shelter|zuhause-gesucht|betterplace" --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.json' packages apps templates | grep -v node_modules`
Expected: nur Treffer in `docs/` und in Commit-Nachrichten. Jeder Treffer in Code ist ein Fund und gehört behoben.

- [ ] **Step 4: Gesamtlauf**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e && docker build --platform linux/amd64 -t kompass-local .`
Expected: alles grün, Image ohne Aluna-Inhalte

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move Aluna's site out of the product repo"
```

---

### Task 4: Das Modul `website` entfernen

**Files:**
- Delete: `packages/modules/website/`
- Modify: `apps/kompass/src/modules.ts`, `apps/kompass/src/app/(shell)/website/` (Seiten entfernen), `apps/kompass/messages/de.json`
- Create: eine Migration, die die `website_*`-Tabellen entfernt

- [ ] **Step 1: Erst wenn der Umzug steht**

Voraussetzung: Alunas Installation läuft in der Testumgebung auf `site`, publiziert von dort, und die Inhalte stimmen. Vorher wird hier nichts gelöscht — die alten Tabellen sind bis dahin die einzige vollständige Kopie.

- [ ] **Step 2: Modul und Seiten entfernen**

Run: `grep -rn "module-website\|@kompass/module-website\|websiteModule" --include='*.ts' --include='*.tsx' --include='*.json' packages apps | grep -v node_modules`

Jede Stelle entfernen. `installedModules` enthält danach `[siteModule, animalsModule]`.

- [ ] **Step 3: Tabellen entfernen**

Migration, die `website_pages`, `website_articles`, `website_team`, `website_faqs` und `website_downloads` entfernt. `website_publishes` ist zu diesem Zeitpunkt bereits als `site_publishes` umbenannt (Task 1).

Run: `pnpm --filter @kompass/core db:generate`

- [ ] **Step 4: Backlog und Doku nachziehen**

`docs/backlog.md`: Punkt zu den Übersetzungen der Webseite prüfen — er bezieht sich auf das alte Modell. `docs/betrieb.md`: Abschnitt „Webseite" auf das Template-Verzeichnis umschreiben, inklusive des Satzes, dass `/data/site-template` eine Vertrauensgrenze ist. `AGENTS.md`: Quellenliste um die neue Spec ergänzen.

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A
git commit -m "refactor: retire the website module"
```

---

## Abschluss dieses Plans

Danach ist Kompass ein Produkt, das man einem anderen Verein geben kann: Es
bringt ein neutrales Template mit, und nichts im Image erinnert an Tierschutz.
Alunas Seite lebt in ihrem eigenen Repo und wird von derselben Kompass-Fassung
publiziert wie jede andere.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Publish-Kette mitsamt Historie und den generischen
Prüfungen (Abschnitt 8) → Task 1. Migration gegen Testdaten, danach löschbar
(Abschnitt 10) → Task 2. `apps/site` verlässt das Repo → Task 3. Ablösung von
`website` inklusive Tabellen → Task 4.

**Platzhalter:** Task 2 Step 3 nennt die Zuordnung als Tabellenkopf statt
vollständig. Sie hängt an Alunas Template-Deklaration, die ausserhalb dieses
Repos entsteht — deshalb steht sie unter den Voraussetzungen und wird beim
Ausführen gefüllt, nicht geraten. Die Zielschlüssel im Beispiel (`articles`,
`team`, `faq`, `documents`) sind genau das: ein Beispiel. Sie müssen mit den
Sammlungen des Basis-Templates nicht übereinstimmen, weil Aluna ein eigenes
Template hat.

**Reihenfolge:** Task 4 hängt an einer Bedingung, die kein Test prüfen kann —
dass Alunas Installation wirklich läuft. Deshalb steht sie als erster Schritt
dieses Tasks und zusätzlich unter den Voraussetzungen.

**Typkonsistenz:** `migrateWebsiteToSite(deps, opts)` liefert `MigrationReport`
mit einer Zeile je Quelltabelle; der Bericht wird in Task 2 Step 1 geprüft und in
Step 4 gelesen.

---

## Nachtrag zur Ausführung (2026-09-08)

Drei Dinge standen so nicht im Plan und mussten beim Ausführen entschieden
werden. Sie stehen hier, weil sie den Zuschnitt des Cutovers verändert haben.

**1. Die Projekte hingen an fremden Rechten.** `packages/core/src/projects/service.ts`
prüfte `website.view` und `website.manage` — Rechte, die das Modul mitbrachte.
Mit Task 4 wären sie aus der Registry verschwunden und niemand hätte Projekte
mehr pflegen können. Sie bekommen deshalb eigene Kernrechte (`projects.view`,
`projects.manage`), sechs MCP-Werkzeuge in `@kompass/mcp`, eine eigene
Navigationsgruppe (`nav.groups.core`), die Oberfläche unter `/projects` statt
`/website/projects` und eine Datenmigration, die die Rechte bestehender Rollen
überträgt. Das ist der Zwischenschritt zu dem eigenen Kernmodul, das die
Entscheidung vom 2026-09-07 ohnehin vorsieht.

**2. `pnpm dev:reset` hing am Webseiten-Modul.** `scripts/import-prototype.ts`
schrieb Seiten, Artikel, Team, FAQ und Site-Fakten in die `website_*`-Tabellen.
Es führt jetzt nur noch Tiere und Projekte; seine Tests sind ins Tiermodul
gezogen, weil sie sonst mit `packages/modules/website/tests/` verschwunden
wären. Der Entwicklungsstand danach entspricht dem, was ein neuer Verein
vorfindet: Bestand gefüllt, `site` leer.

**3. Task 3 Step 3 stand eine Stufe zu früh.** Der `grep` nach Aluna-Begriffen
kann erst grün werden, wenn `website` weg ist — bis dahin führt das Modul
`website.shelterDogCount`. Er ist jetzt ein Test
(`apps/kompass/tests/no-association-content.test.ts`), und seine Wortliste ist
kürzer als geplant: `aluna` bleibt erlaubt, so heisst das Produkt; `shelter`
gehört legitim ins Tiermodul; `betterplace` steckt im Kern und ist deshalb als
Backlog-Punkt 6 vermerkt statt hier stillschweigend geduldet.

**Nicht geprüft:** `docker build` — in dieser Umgebung gibt es kein Docker.
Typecheck, alle Tests und die 46 E2E-Fälle sind grün.
