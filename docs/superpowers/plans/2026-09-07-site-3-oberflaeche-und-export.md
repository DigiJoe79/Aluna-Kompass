# Oberfläche, MCP und Export für Templates — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Was ein Template deklariert, wird bedienbar: eine Konfigurationsmaske für die Variablen, je Sammlung eine Liste mit Pflege, MCP-Werkzeuge für beides, und ein Export, der die Publish-Pipeline unverändert weiterbenutzt.

**Architecture:** Masken entstehen zur Laufzeit aus dem gespeicherten JSON-Schema — ein Renderer wählt je Feld das Widget aus `.meta()`. Weil Sammlungen erst mit dem eingelesenen Template existieren, dürfen Navigation und MCP-Werkzeuge eines Moduls künftig auch Funktionen von `deps` sein; der MCP-Handler baut seine Liste ohnehin je Anfrage.

**Tech Stack:** TypeScript, Zod 4.5, Next 16 (App Router, Server Actions), React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitte 4, 7, 8.

**Voraussetzung:** Plan `2026-09-07-site-2-vertrag-und-resync.md` ist abgeschlossen.

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`.
- Code Englisch, Oberfläche über `messages/de.json` in Sie-Form. Labels aus dem Template sind Daten und werden nicht übersetzt.
- Kein statischer Farbwert im Anwendungscode, nur Theme-Tokens (`apps/kompass/tests/no-color-literals.test.ts` prüft das).
- Seiten, die Datenbankinhalte zeigen, tragen `export const dynamic = 'force-dynamic'` (`apps/kompass/tests/no-static-db-pages.test.ts` prüft das).
- Jedes MCP-Werkzeug zeigt sein echtes Zod-Schema; zu jedem Permission-Key gehört mindestens ein Werkzeug, das ihn nennt (`apps/kompass/tests/mcp-tools.test.ts`).
- Tests mit Vitest gegen `createTestDeps()`, E2E mit Playwright gegen Port 3100.

---

### Task 1: Manifeste vertragen Laufzeit-Beiträge

**Files:**
- Modify: `packages/core/src/modules/manifest.ts`, `packages/mcp/src/handler.ts`, `apps/kompass/src/lib/navigation.ts`
- Modify: `apps/kompass/tests/mcp-tools.test.ts`
- Test: `packages/core/tests/manifest-runtime.test.ts`, `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Produces: `ModuleManifest.mcpTools?: readonly McpToolDefinition[] | ((deps: Deps) => readonly McpToolDefinition[])`, `ModuleManifest.navigationFor?: (deps: Deps) => NavigationItem[]`, `NavigationItem.label?: string`, `moduleMcpTools(deps, manifest): readonly McpToolDefinition[]`

- [ ] **Step 1: Tests schreiben**

```ts
// packages/core/tests/manifest-runtime.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModule, moduleMcpTools, ok } from '../src';
import { createTestDeps } from '@kompass/core/testing';

const tool = (name: string) => ({ name, description: `Does ${name}. Requires demo.manage.`, inputSchema: z.object({}), handler: async () => ok(null) });

describe('runtime contributions', () => {
  it('takes a static tool list as before', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: ['demo.manage'], mcpTools: [tool('demo_a')] });
    expect(moduleMcpTools(createTestDeps(), m).map((t) => t.name)).toEqual(['demo_a']);
  });

  it('takes a function and calls it with deps', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: ['demo.manage'], mcpTools: (deps) => [tool(`demo_${deps.env}`)] });
    expect(moduleMcpTools(createTestDeps(), m).map((t) => t.name)).toEqual(['demo_test']);
  });

  it('treats a missing list as empty', () => {
    const m = defineModule({ key: 'demo', version: '1', permissions: [] });
    expect(moduleMcpTools(createTestDeps(), m)).toEqual([]);
  });
});
```

```ts
// in apps/kompass/tests/navigation.test.ts ergänzen
it('adds runtime items with their own label after the static ones', () => {
  const groups = buildNavigation({
    manifests: [{ key: 'site', version: '1', permissions: ['site.manage'], navigation: [{ key: 'site.template', href: '/site/template', icon: 'x', group: 'site', permission: 'site.manage' }] } as ModuleManifest],
    enabledKeys: new Set(['site']),
    permissions: new Set(['site.manage']),
    extraItems: { site: [{ key: 'site.collection.articles', href: '/site/c/articles', icon: 'list', group: 'site', permission: 'site.view', label: 'Artikel' }] },
  });
  const site = groups.find((g) => g.key === 'site')!;
  expect(site.items.map((i) => i.href)).toEqual(['/site/template', '/site/c/articles']);
  expect(site.items.at(-1)!.label).toBe('Artikel');
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/manifest-runtime.test.ts && pnpm --filter @kompass/app test tests/navigation.test.ts`
Expected: FAIL — `moduleMcpTools` fehlt, `extraItems` unbekannt

- [ ] **Step 3: Manifest erweitern**

```ts
// packages/core/src/modules/manifest.ts
export interface NavigationItem {
  key: string;
  href: string;
  icon: string;
  group: string;
  permission?: string;
  /** Beschriftung aus Daten. Fehlt sie, kommt der Text aus `nav.<key>`. */
  label?: string;
}

export interface ModuleManifest {
  // … unverändert
  mcpTools?: readonly McpToolDefinition[] | ((deps: Deps) => readonly McpToolDefinition[]);
  /** Einträge, die erst zur Laufzeit feststehen — etwa je Sammlung eines Templates. */
  navigationFor?: (deps: Deps) => NavigationItem[];
}

export const moduleMcpTools = (deps: Deps, manifest: ModuleManifest): readonly McpToolDefinition[] =>
  typeof manifest.mcpTools === 'function' ? manifest.mcpTools(deps) : (manifest.mcpTools ?? []);
```

- [ ] **Step 4: Handler und Navigation anpassen**

In `packages/mcp/src/handler.ts` die Zeile, die die Werkzeuge sammelt, auf `moduleMcpTools(deps, m)` umstellen. In `apps/kompass/src/lib/navigation.ts` `extraItems?: Record<string, NavigationItem[]>` ergänzen und je Modul anhängen; die Beschriftung nimmt `item.label ?? t(\`nav.${item.key}\`)`.

- [ ] **Step 5: Die Werkzeugprüfung nachziehen**

In `apps/kompass/tests/mcp-tools.test.ts` die Liste über `moduleMcpTools(deps, m)` bilden, mit `createTestDeps()`. Ein Modul ohne eingelesenes Template liefert dabei keine Werkzeuge — das ist gültig, solange es auch keine eigenen Permission-Keys unbedient lässt. Da `site.view`, `site.manage` und `site.publish` von den festen Werkzeugen aus Task 6 genannt werden, bleibt die Prüfung scharf.

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test
git add -A
git commit -m "feat(modules): let a module contribute tools and navigation at runtime"
```

---

### Task 2: Werte lesen und schreiben

**Files:**
- Create: `packages/modules/site/src/values.ts`
- Test: `packages/modules/site/tests/values.test.ts`

**Interfaces:**
- Produces: `readValues(deps): Record<string, unknown>`, `setValues(deps, ctx, input)`

- [ ] **Step 1: Tests schreiben**

```ts
describe('site values', () => {
  it('returns the declared defaults before anything was saved', async () => { /* leere Tabelle, Schema mit zwei Variablen → beide mit Leerwert */ });
  it('saves and reads back a value', async () => { /* setValues, readValues */ });
  it('needs site.manage', async () => { /* forbidden */ });
  it('rejects a value the template schema does not allow', async () => { /* Zahl über max → validation, Pfad nennt die Variable */ });
  it('rejects a key the template does not declare', async () => { /* validation, unknownVariable */ });
  it('rejects a locale the installation does not keep', async () => { /* validation, unknownLocale — über validate aus dem Kern */ });
  it('writes one audit entry per save with before and after', async () => { /* action site.values.update */ });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/values.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Umsetzen**

`readValues` liest alle Zeilen aus `siteValues` und ergänzt fehlende Schlüssel mit dem Leerwert ihres Typs (`''`, `0`, `null`, `[]`, `{}` je nach Widget). `setValues(deps, ctx, { values })` baut aus dem gespeicherten Template-Schema ein Zod-Objektschema — dafür wird das JSON-Schema **nicht** zurückverwandelt, sondern die Prüfung läuft über die im Schema hinterlegten Grenzen:

```ts
/** Aus dem gespeicherten JSON-Schema ein prüfbares Zod-Schema je Feld. */
export function schemaFor(field: FieldSchema): z.ZodType<unknown> { … }
```

`schemaFor` bekommt eigene Tests in Task 4 Step 1, weil der Maskenrenderer dieselbe Abbildung braucht; hier wird es nur benutzt.

- [ ] **Step 4: Tests ausführen und Commit**

```bash
pnpm --filter @kompass/module-site test tests/values.test.ts
git add -A && git commit -m "feat(site): read and write the template variables"
```

---

### Task 3: Sammlungseinträge pflegen

**Files:**
- Create: `packages/modules/site/src/entries.ts`
- Test: `packages/modules/site/tests/entries.test.ts`

**Interfaces:**
- Produces: `listEntries(deps, ctx, collection)`, `getEntry(deps, ctx, id)`, `createEntry(deps, ctx, input)`, `updateEntry(deps, ctx, input)`, `deleteEntry(deps, ctx, input)`, `reorderEntries(deps, ctx, input)`, `setEntryPublished(deps, ctx, input)`

- [ ] **Step 1: Tests schreiben**

```ts
describe('site entries', () => {
  it('creates an entry against the declared fields and returns it', async () => { /* … */ });
  it('needs site.manage to write and site.view to read', async () => { /* forbidden je Dienst */ });
  it('refuses an unknown collection', async () => { /* notFound */ });
  it('refuses a duplicate slug inside the same collection but allows it in another', async () => { /* conflict duplicateSlug */ });
  it('refuses a slug where the collection declares none', async () => { /* validation */ });
  it('refuses the entry beyond max', async () => { /* conflict tooManyEntries */ });
  it('refuses publishing where the collection is not publishable', async () => { /* conflict notPublishable */ });
  it('deletes an entry and writes an audit entry that keeps what was removed', async () => { /* action site.entry.delete, before trägt die Daten */ });
  it('reorders within one collection and leaves the others untouched', async () => { /* … */ });
});
```

Das Löschen ist erlaubt und gewollt: Redaktionelle Inhalte sind Arbeitsmaterial (`AGENTS.md`, Prinzip 3). Der Audit-Eintrag hält den entfernten Datensatz fest, damit nachvollziehbar bleibt, was verschwunden ist.

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/entries.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Umsetzen**

Jeder Dienst folgt dem Standardablauf. Die Feldprüfung baut auf `schemaFor` aus Task 2; `slug`, `sortOrder` und `isPublished` liegen als Spalten, die übrigen Felder als JSON in `data`. `sortOrder` beim Anlegen ist `max + 1` innerhalb der Sammlung.

- [ ] **Step 4: Tests ausführen und Commit**

```bash
pnpm --filter @kompass/module-site test tests/entries.test.ts
git add -A && git commit -m "feat(site): keep collection entries, deletion included"
```

---

### Task 4: Der Maskenrenderer

**Files:**
- Create: `apps/kompass/src/components/schema-form/index.tsx`, `field.tsx`, `state.ts`
- Test: `apps/kompass/tests/schema-form.test.ts`

**Interfaces:**
- Consumes: das gespeicherte JSON-Schema aus Plan 2
- Produces: `<SchemaForm schema={…} value={…} errors={…} locales={…} onChange={…} />`, `blankFor(field)`, `setAtPath(value, path, next)`

Der Aufbau ist am 2026-09-07 in einer Feldstudie erprobt: 195 Zeilen für mehrsprachige Felder mit Fehlt-Markierung, Markdown mit Vorschau, Bildauswahl, Datum, Auswahl, Stringliste und verschachtelte Objektlisten mit Hinzufügen, Sortieren, Löschen und sichtbarer Obergrenze.

- [ ] **Step 1: Tests für die reine Logik schreiben**

```ts
// apps/kompass/tests/schema-form.test.ts
describe('setAtPath', () => {
  it('writes into nested objects without touching siblings', () => { /* … */ });
  it('writes into a list by index and keeps the other entries', () => { /* … */ });
});

describe('blankFor', () => {
  it('gives a localized field one empty string per locale', () => { /* {de:'',en:''} */ });
  it('gives a list an empty array, an asset null, a number zero, a select its first value', () => { /* … */ });
});

describe('schemaFor', () => {
  it('rebuilds bounds from the stored json schema', () => { /* number mit min/max, text mit maxLength */ });
  it('accepts any locale key and leaves the locale check to the core', () => { /* … */ });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app test tests/schema-form.test.ts`
Expected: FAIL

- [ ] **Step 3: Logik und Renderer schreiben**

`state.ts` trägt `setAtPath` und `blankFor`, `field.tsx` die Widget-Auswahl, `index.tsx` das Formular. Widgets nach `meta.widget`: `localized` (bis drei Sprachen nebeneinander, darüber Reiter; Markdown mit Vorschauumschalter), `asset` (`MediaPicker`), `select`, `number`, `text`, `markdown`, Liste von Objekten, Liste von Strings; Datum über `format: 'date'`.

Fehler kommen als `Record<pfad, meldung>` herein und werden am Feld gezeigt — der Pfad ist derselbe, den `validate` liefert (`title.de`, `blocks.2.href`).

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/app test tests/schema-form.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass/src/components/schema-form apps/kompass/tests/schema-form.test.ts
git commit -m "feat(site): build forms from a stored schema"
```

---

### Task 5: Die Seiten

**Files:**
- Create: `apps/kompass/src/app/(shell)/site/template/page.tsx` und `sync-client.tsx`, `actions.ts`
- Create: `apps/kompass/src/app/(shell)/site/variables/page.tsx`, `variables-form.tsx`
- Create: `apps/kompass/src/app/(shell)/site/c/[collection]/page.tsx`, `list-client.tsx`, `[id]/page.tsx`, `entry-form.tsx`
- Modify: `apps/kompass/src/lib/navigation.ts` (Aufruf), `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/site-template.spec.ts`

- [ ] **Step 1: Template-Seite**

Zeigt Name, Zeitpunkt des letzten Einlesens und einen Knopf „Template einlesen". Der Knopf ruft `previewTemplateSync` und zeigt die Befunde: verlustbehaftete zuerst und hervorgehoben, harmlose darunter, blockierende mit dem Hinweis, was zuerst zu tun ist. Fehlt eine geforderte Sprache, steht das ganz oben mit Verweis auf `/admin/locales`. Bestätigen ruft `applyTemplateSync`.

- [ ] **Step 2: Variablen-Seite**

`SchemaForm` über die Variablen des gespeicherten Schemas, Speichern über `setValues`. Validierungsfehler kommen aus dem `Result` und landen als `Record<pfad, meldung>` im Formular.

- [ ] **Step 3: Sammlungsseiten**

`/site/c/[collection]` listet die Einträge mit ihrem ersten Textfeld als Bezeichnung, dazu je nach Merkmal Sortierknöpfe, Veröffentlicht-Schalter und Löschen über `ConfirmDialog`. `/site/c/[collection]/[id]` bearbeitet einen Eintrag über `SchemaForm`; `neu` als `[id]` legt an.

- [ ] **Step 4: Navigation füllen**

`siteModule.navigationFor = (deps) => …` liefert je Sammlung einen Eintrag mit `label` aus dem Template und `href` `/site/c/<key>`, dazu „Variablen". Die App reicht das Ergebnis als `extraItems` an `buildNavigation`.

- [ ] **Step 5: E2E**

```ts
// apps/kompass/e2e/site-template.spec.ts
test('reads a template, fills a variable and keeps a collection entry', async ({ page }) => {
  // Template in das für die E2E konfigurierte Verzeichnis schreiben, dann:
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await expect(page.getByRole('region', { name: 'Befunde' })).toContainText('wird leer angelegt');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.locator('[name="claim.de"]').fill('Wir bauen Modelle');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.getByRole('link', { name: 'Notizen' }).click();
  await page.getByRole('link', { name: 'Neu' }).click();
  await page.locator('[name="body"]').fill('Erste Notiz');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('table')).toContainText('Erste Notiz');
});
```

Die Playwright-Konfiguration bekommt dafür `SITE_TEMPLATE_DIR` auf ein Verzeichnis unter `e2e/.tmp/`.

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A && git commit -m "feat(site): read templates and keep their content in the interface"
```

---

### Task 6: MCP-Werkzeuge

**Files:**
- Create: `packages/modules/site/src/mcp-tools.ts`
- Modify: `packages/modules/site/src/manifest.ts`
- Test: `packages/modules/site/tests/mcp-tools.test.ts`

- [ ] **Step 1: Tests schreiben**

```ts
describe('site mcp tools', () => {
  it('offers the fixed tools even without a template', () => { /* site_template_read, site_template_sync, site_variables_get/set */ });
  it('adds five tools per collection, six where it is publishable', () => { /* site_notes_list/_get/_create/_update/_delete (+_set_published) */ });
  it('names the fields of a collection in its create schema', () => { /* properties nicht leer */ });
  it('describes every tool with the permission it needs', () => { /* jede description enthält site.view oder site.manage */ });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Expected: FAIL, Modul fehlt

- [ ] **Step 3: Umsetzen**

`SITE_MCP_TOOLS = (deps) => [...fixed, ...collections.flatMap(toolsFor)]`, im Manifest als `mcpTools: SITE_MCP_TOOLS`. Die `inputSchema` der Sammlungswerkzeuge kommen aus `schemaFor` über die Felder der Sammlung — dieselbe Abbildung wie in der Maske, damit ein Client genau das schicken kann, was die Oberfläche anbietet. `site_template_read` gibt Name, Sprachen, Variablen und Sammlungen aus, damit ein Client die Struktur kennt, ohne ins Volume zu sehen.

- [ ] **Step 4: Prüfung bestätigen**

Run: `pnpm --filter @kompass/app test tests/mcp-tools.test.ts`
Expected: PASS — jeder Permission-Key des Moduls wird genannt, jedes Werkzeug zeigt seine Argumente.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(site): expose variables and collections over MCP"
```

---

### Task 7: Export und Publish

**Files:**
- Create: `packages/modules/site/src/export.ts`
- Modify: `packages/modules/site/src/service.ts` (Publish-Sicherung einhängen)
- Test: `packages/modules/site/tests/export.test.ts`

- [ ] **Step 1: Tests schreiben**

```ts
describe('site export', () => {
  it('writes variables, collections and used views into one content.json', async () => { /* Form aus der Spec */ });
  it('leaves out entries that are not published where the collection is publishable', async () => { /* … */ });
  it('keeps only the locales the installation configured', async () => { /* Restmüll einer entfernten Sprache erscheint nicht */ });
  it('reports a used view whose module is disabled instead of writing an empty list', async () => { /* conflict moduleDisabled */ });
  it('refuses to export while the template file differs from the read state', async () => { /* conflict templateStale */ });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Expected: FAIL

- [ ] **Step 3: Umsetzen**

`exportSiteContent(deps, ctx, { jobDir })` im Modul `site` schreibt:

```json
{ "variables": { … }, "collections": { … }, "views": { … }, "assets": [ … ] }
```

Die Sichten kommen wie bisher über `publishedViews` der aktivierten Module, gefiltert auf `uses`. Vor allem anderen läuft `templateIsCurrent` aus Plan 2; ist der Stand veraltet, bricht der Export mit `conflict('templateStale', …)` ab.

**Die Pipeline bleibt vorerst, wo sie ist.** Build, Bildvarianten, Prüfsummen, Diff, rsync und Historie liegen weiter in `packages/modules/website/src/pipeline/`; `site` bringt in diesem Plan nur den Export und die Sicherung mit. Der Umzug gehört nach Plan 4, aus zwei Gründen: Dort verschwindet `website`, der Umzug ist also ein Verschieben statt einer Verdopplung — und der E2E-Test für den Publish braucht ein baubares Astro-Template, das dort als Basis-Template ohnehin entsteht. Bis dahin publiziert Aluna über `website`; `site` hat keinen Publish-Bedarf.

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test`
Expected: PASS

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A && git commit -m "feat(site): export template content and publish it"
```

---

## Abschluss dieses Plans

Danach ist das Modul vollständig bedienbar: einlesen, pflegen, publizieren — über Oberfläche und MCP. Was fehlt, ist das mitgelieferte Template und die Ablösung des alten Moduls; beides in Plan 4.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Masken aus dem Schema (Abschnitt 4) → Task 4. Oberfläche und MCP (Abschnitt 7) → Task 5, 6. Export in der Form der Spec und unveränderte Pipeline (Abschnitt 8) → Task 7. Publish-Sicherung → Task 7 Step 3, gebaut in Plan 2. Sammlungsmerkmale wirken sich aus → Task 3 (Prüfungen), Task 5 Step 3 (Bedienung), Task 6 (`_set_published` nur wo `publishable`).

**Platzhalter:** Task 2, 3 und 5 nennen Testnamen mit ihrer Zusicherung statt ausgeschriebener Rümpfe, weil alle demselben im Repo etablierten Aufbau folgen; die Zusicherung selbst steht jeweils da. Die einzige neue Abbildung — `schemaFor`, vom JSON-Schema zurück zu Zod — bekommt in Task 4 eigene Tests, bevor Task 2 und 6 sie benutzen. Das ist bewusst so gereiht.

**Typkonsistenz:** `schemaFor(field: FieldSchema): z.ZodType<unknown>` wird in Task 2, 3, 4 und 6 gleich benannt und gleich benutzt. `FieldSchema` stammt aus Plan 2 Task 3. Fehlerpfade sind überall die von `validate` gelieferten Punktpfade. `moduleMcpTools(deps, manifest)` aus Task 1 wird in Task 6 und im Handler verwendet.

**Offene Abhängigkeit:** Der Publish von `site` ist nach diesem Plan noch nicht möglich — Export und Sicherung stehen, die Pipeline zieht erst in Plan 4 um. Das ist beabsichtigt: Ein Umzug dorthin ist ein Verschieben, eine Portierung hierher wäre ein Duplikat mit begrenzter Lebensdauer. Aluna publiziert in dieser Zeit über `website`.
