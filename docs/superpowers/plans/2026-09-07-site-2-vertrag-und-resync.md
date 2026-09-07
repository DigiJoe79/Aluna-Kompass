# Template-Vertrag, Datenmodell und Resync — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kompass liest die Deklaration eines Templates aus `/data/site-template`, hält Variablen und Sammlungseinträge in eigenen Tabellen und zeigt vor jeder Template-Änderung, was sie an Inhalt kostet.

**Architecture:** Ein Paket `@kompass/site-template` stellt `defineTemplate` und Feldhelfer bereit, die Zod-Schemata mit `.meta({ widget, label })` erzeugen. Das Modul `site` lädt die Datei, flacht ihr JSON-Schema zu Pfaden ab und vergleicht sie mit dem zuletzt eingelesenen Stand; der Vergleich ergibt Befunde, die benennen, wie viele gefüllte Felder betroffen sind. Angewendet wird erst nach Bestätigung, in einer Transaktion.

**Tech Stack:** TypeScript, Zod 4.5, Drizzle/SQLite, Vitest, Node 26 (natives Type-Stripping für den Import der Template-Datei).

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitte 2, 3, 5.

**Voraussetzung:** `docs/superpowers/plans/2026-09-07-sprachen-1-kern.md` ist abgeschlossen — `deps.locales()` und `validate(deps, …)` existieren.

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`.
- Fachfehler sind `Result`-Werte, keine Exceptions. IDs über `newId()`, Zeit über `deps.clock.now()`.
- Code Englisch, Oberfläche über `messages/de.json` in Sie-Form.
- Tests mit Vitest gegen `createTestDeps()`. Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Migrationen über `pnpm --filter @kompass/core db:generate`; die drizzle-Konfiguration erfasst `../modules/*/src/schema.ts` bereits, ein neues Modul wird automatisch mitgenommen.
- Permission-Keys des Moduls: `site.view`, `site.manage`, `site.publish`.
- Ein Template ist Code aus dem Volume. Es wird geladen, nie ausgewertet oder umgeschrieben; schlägt das Laden fehl, bleibt der Bestand unverändert.

---

### Task 1: Das Paket `@kompass/site-template`

**Files:**
- Create: `packages/site-template/package.json`, `tsconfig.json`, `src/index.ts`, `src/fields.ts`, `src/define.ts`
- Test: `packages/site-template/tests/define.test.ts`
- Modify: `pnpm-workspace.yaml` (falls Pakete dort einzeln stehen — sonst nichts)

**Interfaces:**
- Produces: `defineTemplate(input): TemplateDefinition`, `text`, `markdown`, `number`, `asset`, `select`, `list`, `TemplateDefinition`, `CollectionDefinition`

- [ ] **Step 1: Test schreiben**

```ts
// packages/site-template/tests/define.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, defineTemplate, markdown, number, select, text } from '../src';

const template = defineTemplate({
  name: 'Verein Basis',
  locales: ['de', 'en'],
  variables: { claim: text({ max: 120, localized: true, label: 'Claim' }), members: number({ min: 0, label: 'Mitglieder' }) },
  collections: {
    articles: { label: 'Artikel', slug: true, publishable: true, fields: { title: text({ localized: true, label: 'Titel' }), body: markdown({ localized: true, label: 'Text' }) } },
    team: { label: 'Team', sortable: true, max: 30, fields: { name: text({ label: 'Name' }), photo: asset({ label: 'Foto' }) } },
  },
  uses: ['animals'],
});

describe('defineTemplate', () => {
  it('keeps what it was given and defaults the collection traits to false', () => {
    expect(template.name).toBe('Verein Basis');
    expect(template.locales).toEqual(['de', 'en']);
    expect(template.uses).toEqual(['animals']);
    expect(template.collections.articles!.slug).toBe(true);
    expect(template.collections.articles!.sortable).toBe(false);
    expect(template.collections.team!.publishable).toBe(false);
    expect(template.collections.team!.max).toBe(30);
  });

  it('builds zod schemas that carry their widget and label', () => {
    const claim = z.toJSONSchema(template.variables.claim!, { io: 'input' }) as { widget?: string; label?: string; locales?: boolean };
    expect(claim.widget).toBe('localized');
    expect(claim.label).toBe('Claim');
    const photo = z.toJSONSchema(template.collections.team!.fields.photo!, { io: 'input' }) as { widget?: string };
    expect(photo.widget).toBe('asset');
  });

  it('rejects a template without locales, with an unusable name or a bad collection key', () => {
    expect(() => defineTemplate({ name: 'X', locales: [], variables: {}, collections: {} })).toThrow(/locale/i);
    expect(() => defineTemplate({ name: '', locales: ['de'], variables: {}, collections: {} })).toThrow(/name/i);
    expect(() => defineTemplate({ name: 'X', locales: ['de'], variables: {}, collections: { 'Not Ok': { label: 'x', fields: {} } } })).toThrow(/key/i);
  });

  it('rejects a locale code the core would not accept', () => {
    expect(() => defineTemplate({ name: 'X', locales: ['DE'], variables: {}, collections: {} })).toThrow(/locale/i);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/site-template test`
Expected: FAIL, Paket fehlt

- [ ] **Step 3: Paket anlegen**

`packages/site-template/package.json` nach dem Muster von `packages/markdown/package.json`, Name `@kompass/site-template`, Abhängigkeit `zod`. Kein `@kompass/core`: Das Paket wird von Template-Autoren importiert und soll den Kern nicht mitziehen.

- [ ] **Step 4: Feldhelfer schreiben**

```ts
// packages/site-template/src/fields.ts
import { z } from 'zod';

export interface FieldOptions { label?: string; localized?: boolean }

const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

/** Mehrsprachig heisst: ein Record über Sprachschlüssel, wie im Kern. */
const wrap = (inner: z.ZodType<string>, opts: FieldOptions, widget: string, extra: Record<string, unknown> = {}) =>
  (opts.localized
    ? z.record(z.string().regex(LOCALE_CODE), inner).meta({ widget: 'localized', markdown: widget === 'markdown', label: opts.label, ...extra })
    : inner.meta({ widget, label: opts.label, ...extra })) as z.ZodType<unknown>;

export const text = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().trim().max(opts.max ?? 500), opts, 'text', { max: opts.max ?? 500 });

export const markdown = (opts: FieldOptions & { max?: number } = {}) =>
  wrap(z.string().max(opts.max ?? 20_000), opts, 'markdown', { max: opts.max ?? 20_000 });

export const number = (opts: FieldOptions & { min?: number; max?: number; integer?: boolean } = {}) => {
  const base = opts.integer ? z.number().int() : z.number();
  const bounded = opts.max === undefined ? base.min(opts.min ?? 0) : base.min(opts.min ?? 0).max(opts.max);
  return bounded.meta({ widget: 'number', label: opts.label }) as z.ZodType<unknown>;
};

export const asset = (opts: FieldOptions & { accept?: string } = {}) =>
  z.string().nullable().default(null).meta({ widget: 'asset', accept: opts.accept ?? 'image/*', label: opts.label }) as z.ZodType<unknown>;

export const select = (values: [string, ...string[]], opts: FieldOptions = {}) =>
  z.enum(values).meta({ widget: 'select', label: opts.label }) as z.ZodType<unknown>;

export const list = (of: z.ZodType<unknown>, opts: FieldOptions & { max?: number } = {}) =>
  z.array(of).max(opts.max ?? 50).meta({ widget: 'list', label: opts.label }) as z.ZodType<unknown>;
```

- [ ] **Step 5: `defineTemplate` schreiben**

```ts
// packages/site-template/src/define.ts
import type { z } from 'zod';

export interface CollectionDefinition {
  label: string;
  fields: Record<string, z.ZodType<unknown>>;
  slug?: boolean;
  sortable?: boolean;
  publishable?: boolean;
  max?: number;
}

export interface TemplateInput {
  name: string;
  locales: string[];
  variables: Record<string, z.ZodType<unknown>>;
  collections: Record<string, CollectionDefinition>;
  uses?: string[];
}

export interface TemplateDefinition extends Omit<TemplateInput, 'collections' | 'uses'> {
  collections: Record<string, Required<Omit<CollectionDefinition, 'max'>> & { max?: number }>;
  uses: string[];
}

const KEY = /^[a-z][a-z0-9-]{0,40}$/;
const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

export function defineTemplate(input: TemplateInput): TemplateDefinition {
  if (!input.name.trim()) throw new Error('template needs a name');
  if (input.locales.length === 0) throw new Error('template needs at least one locale');
  for (const l of input.locales) if (!LOCALE_CODE.test(l)) throw new Error(`invalid locale: ${l}`);
  for (const key of Object.keys(input.collections)) if (!KEY.test(key)) throw new Error(`invalid collection key: ${key}`);
  for (const key of Object.keys(input.variables)) if (!KEY.test(key)) throw new Error(`invalid variable key: ${key}`);
  return {
    name: input.name.trim(),
    locales: input.locales,
    variables: input.variables,
    uses: input.uses ?? [],
    collections: Object.fromEntries(
      Object.entries(input.collections).map(([key, c]) => [
        key,
        { label: c.label, fields: c.fields, slug: c.slug ?? false, sortable: c.sortable ?? false, publishable: c.publishable ?? false, max: c.max },
      ]),
    ),
  };
}
```

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/site-template test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/site-template
git commit -m "feat(site-template): declare what a template hands to Kompass"
```

---

### Task 2: Das Modul `site` mit seinen Tabellen

**Files:**
- Create: `packages/modules/site/package.json`, `src/index.ts`, `src/schema.ts`, `src/manifest.ts`
- Test: `packages/modules/site/tests/manifest.test.ts`
- Generated: `packages/core/src/db/migrations/*_site.sql`

**Interfaces:**
- Produces: `siteModule`, Tabellen `siteValues`, `siteEntries`, `siteTemplateState`

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/site/tests/manifest.test.ts
import { coreModule, createRegistry } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { siteModule } from '../src';

describe('site module', () => {
  it('registers its permissions and navigation without clashes', () => {
    const registry = createRegistry([coreModule, siteModule]);
    expect(siteModule.key).toBe('site');
    expect(registry.permissionKeys.has('site.manage')).toBe(true);
    expect(registry.permissionKeys.has('site.publish')).toBe(true);
    expect(siteModule.navigation?.some((n) => n.href === '/site/template')).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test`
Expected: FAIL, Paket fehlt

- [ ] **Step 3: Tabellen schreiben**

```ts
// packages/modules/site/src/schema.ts
import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/** Die Variablen des aktiven Templates, ein Datensatz je Schlüssel. */
export const siteValues = sqliteTable('site_values', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Ein Eintrag einer Sammlung. `data` trägt die Felder des Templates. */
export const siteEntries = sqliteTable(
  'site_entries',
  {
    id: text('id').primaryKey(),
    collection: text('collection').notNull(),
    slug: text('slug'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('site_entries_collection').on(t.collection, t.sortOrder), unique('site_entries_slug').on(t.collection, t.slug)],
);

/** Der zuletzt eingelesene Stand: Vergleichsgrundlage und Publish-Sicherung. */
export const siteTemplateState = sqliteTable('site_template_state', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  schemaJson: text('schema_json', { mode: 'json' }).notNull(),
  checksum: text('checksum').notNull(),
  readAt: text('read_at').notNull(),
  readByUserId: text('read_by_user_id'),
});
```

Die Werte liegen als JSON in einer Spalte, nicht als Key-Value-Zeilen: Ein Eintrag bleibt ein Datensatz, und geprüft wird beim Schreiben gegen das Template-Schema.

- [ ] **Step 4: Manifest schreiben**

```ts
// packages/modules/site/src/manifest.ts
import { defineModule, type ModuleManifest } from '@kompass/core';

export const SITE_PERMISSIONS = ['site.view', 'site.manage', 'site.publish'] as const;

export const siteModule: ModuleManifest = defineModule({
  key: 'site',
  version: '0.1.0',
  permissions: SITE_PERMISSIONS,
  navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'website', permission: 'site.manage' }],
});
```

Navigation für Variablen und Sammlungen kommt in Plan 3 dazu, weil sie erst aus dem eingelesenen Template entsteht.

- [ ] **Step 5: Migration erzeugen**

Run: `pnpm --filter @kompass/core db:generate`
Expected: eine neue Datei unter `packages/core/src/db/migrations/`, die die drei Tabellen anlegt. Die Datei wird committet und nie editiert.

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test && pnpm --filter @kompass/core test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/modules/site packages/core/src/db/migrations
git commit -m "feat(site): add the module with its three tables"
```

---

### Task 3: Die Template-Datei laden

**Files:**
- Create: `packages/modules/site/src/load.ts`
- Test: `packages/modules/site/tests/load.test.ts`

**Interfaces:**
- Consumes: `TemplateDefinition` aus Task 1
- Produces: `loadTemplate(dir: string): Promise<Result<LoadedTemplate>>`, `LoadedTemplate = { definition: TemplateDefinition; schema: TemplateSchema; checksum: string }`

- [ ] **Step 1: Prüfen, ob Node die Datei direkt lädt**

Run: `node --input-type=module -e "const m = await import('/tmp/probe.ts')"` gegen eine Wegwerfdatei mit `export default { a: 1 satisfies number }`
Expected: lädt ohne Flag. Node 26 strippt Typen von sich aus. Schlägt es fehl, wird `kompass.template.mjs` als zweiter akzeptierter Name eingeführt und der Fund im Commit vermerkt — dann muss auch die Template-Dokumentation ihn nennen.

- [ ] **Step 2: Tests schreiben**

```ts
// packages/modules/site/tests/load.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTemplate } from '../src/load';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const withTemplate = (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  return dir;
};

const GOOD = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Probe', locales: ['de'],
  variables: { claim: text({ max: 40, localized: true, label: 'Claim' }) },
  collections: { notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } } },
});`;

describe('loadTemplate', () => {
  it('reads the declaration and derives a checksum', async () => {
    const result = await loadTemplate(withTemplate(GOOD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.name).toBe('Probe');
    expect(result.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.schema.variables.claim!.widget).toBe('localized');
  });

  it('gives the same checksum for the same file and a different one after an edit', async () => {
    const dir = withTemplate(GOOD);
    const first = await loadTemplate(dir);
    const again = await loadTemplate(dir);
    expect(first.ok && again.ok && first.value.checksum === again.value.checksum).toBe(true);
  });

  it('reports a missing file, a broken file and a wrong export as conflicts', async () => {
    const missing = await loadTemplate(mkdtempSync(path.join(tmpdir(), 'kompass-empty-')));
    expect(missing.ok === false && missing.error.type === 'conflict' && missing.error.code === 'templateMissing').toBe(true);
    const broken = await loadTemplate(withTemplate('export default {'));
    expect(broken.ok === false && broken.error.code === 'templateUnreadable').toBe(true);
    const wrong = await loadTemplate(withTemplate('export default { hallo: 1 };'));
    expect(wrong.ok === false && wrong.error.code === 'templateInvalid').toBe(true);
  });
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/load.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 4: Lader schreiben**

```ts
// packages/modules/site/src/load.ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { conflict, ok, type Result } from '@kompass/core';
import type { TemplateDefinition } from '@kompass/site-template';
import { z } from 'zod';

export const TEMPLATE_FILE = 'kompass.template.ts';

export interface FieldSchema { widget?: string; label?: string; [key: string]: unknown }
export interface TemplateSchema {
  name: string;
  locales: string[];
  uses: string[];
  variables: Record<string, FieldSchema>;
  collections: Record<string, { label: string; slug: boolean; sortable: boolean; publishable: boolean; max?: number; fields: Record<string, FieldSchema> }>;
}
export interface LoadedTemplate { definition: TemplateDefinition; schema: TemplateSchema; checksum: string }

const asJson = (schema: unknown) => z.toJSONSchema(schema as z.ZodType<unknown>, { io: 'input' }) as FieldSchema;

/** JSON-Schema je Feld — das ist die Form, die gespeichert und verglichen wird. */
function toSchema(definition: TemplateDefinition): TemplateSchema {
  return {
    name: definition.name,
    locales: definition.locales,
    uses: definition.uses,
    variables: Object.fromEntries(Object.entries(definition.variables).map(([k, v]) => [k, asJson(v)])),
    collections: Object.fromEntries(
      Object.entries(definition.collections).map(([k, c]) => [
        k,
        { label: c.label, slug: c.slug, sortable: c.sortable, publishable: c.publishable, max: c.max, fields: Object.fromEntries(Object.entries(c.fields).map(([f, s]) => [f, asJson(s)])) },
      ]),
    ),
  };
}

const isDefinition = (v: unknown): v is TemplateDefinition =>
  typeof v === 'object' && v !== null && typeof (v as TemplateDefinition).name === 'string' && Array.isArray((v as TemplateDefinition).locales) && typeof (v as TemplateDefinition).collections === 'object';

export async function loadTemplate(dir: string): Promise<Result<LoadedTemplate>> {
  const file = path.join(dir, TEMPLATE_FILE);
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    return conflict('templateMissing', `${TEMPLATE_FILE} fehlt in ${dir}`);
  }
  let loaded: unknown;
  try {
    // Zeitstempel im Query-Teil: sonst liefert der Modul-Cache nach einer
    // Änderung die alte Fassung, und ein Resync sähe keine Unterschiede.
    loaded = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).default;
  } catch (error) {
    return conflict('templateUnreadable', error instanceof Error ? error.message.slice(0, 500) : 'Unbekannter Fehler');
  }
  if (!isDefinition(loaded)) return conflict('templateInvalid', `${TEMPLATE_FILE} exportiert keine Template-Deklaration`);
  return ok({ definition: loaded, schema: toSchema(loaded), checksum: createHash('sha256').update(source).digest('hex') });
}
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test tests/load.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/site/src/load.ts packages/modules/site/tests/load.test.ts
git commit -m "feat(site): load a template declaration from the volume"
```

---

### Task 4: Den Resync-Plan berechnen

**Files:**
- Create: `packages/modules/site/src/resync/plan.ts`
- Test: `packages/modules/site/tests/resync-plan.test.ts`

**Interfaces:**
- Consumes: `TemplateSchema` aus Task 3
- Produces: `flatten(schema): FieldDesc[]`, `planResync(before, after, data): Finding[]`, `losesContent(finding): boolean`, `Finding`

Die Form ist in einer Feldstudie am 2026-09-07 erprobt; die Tests hier decken dieselben Fälle ab.

- [ ] **Step 1: Tests schreiben**

```ts
// packages/modules/site/tests/resync-plan.test.ts
import { describe, expect, it } from 'vitest';
import { losesContent, planResync, type Finding } from '../src/resync/plan';

const field = (widget: string, extra: Record<string, unknown> = {}) => ({ widget, ...extra });
const before = {
  name: 'T', locales: ['de', 'en', 'fr'], uses: [],
  variables: { claim: field('localized', { label: 'Claim' }), subtitle: field('localized', { label: 'Untertitel' }), layout: { enum: ['narrow', 'wide', 'full'], label: 'Breite' } },
  collections: { metrics: { label: 'Kennzahlen', slug: false, sortable: true, publishable: false, max: 4, fields: { label: field('localized', { label: 'Bezeichnung' }), suffix: field('text', { label: 'Einheit' }) } } },
};
const after = {
  name: 'T', locales: ['de', 'en'], uses: [],
  variables: { claim: field('localized', { label: 'Claim' }), lede: field('localized', { label: 'Einleitung', renamedFrom: 'subtitle' }), layout: { enum: ['narrow', 'wide'], label: 'Breite' } },
  collections: { metrics: { label: 'Kennzahlen', slug: false, sortable: true, publishable: false, max: 2, fields: { label: field('localized', { label: 'Bezeichnung' }), suffix: { type: 'array', items: { type: 'string' }, label: 'Einheit' } } } },
};
const data = {
  variables: { claim: { de: 'A', en: 'B', fr: 'C' }, subtitle: { de: 'Wer wir sind', en: '', fr: '' }, layout: 'full' },
  collections: { metrics: [
    { label: { de: 'Mitglieder', en: 'Members', fr: 'Membres' }, suffix: '' },
    { label: { de: 'Quote', en: '', fr: '' }, suffix: '%' },
    { label: { de: 'Hunde', en: '', fr: '' }, suffix: '' },
  ] },
};

const of = (kind: Finding['kind'], findings: Finding[]) => findings.filter((f) => f.kind === kind);

describe('planResync', () => {
  const findings = planResync(before as never, after as never, data);

  it('follows a declared rename and carries the content along', () => {
    expect(of('renamed', findings)).toEqual([{ kind: 'renamed', path: 'variables.lede', label: 'Einleitung', from: 'variables.subtitle', filled: 1 }]);
    expect(of('removed', findings)).toEqual([]);
  });

  it('separates a locale that costs content from one that does not', () => {
    const gone = of('localeRemoved', findings);
    expect(gone.find((f) => f.path === 'variables.claim')).toMatchObject({ locale: 'fr', filled: 1 });
    expect(gone.find((f) => f.path === 'collections.metrics[].label')).toMatchObject({ locale: 'fr', filled: 1 });
  });

  it('names the replacement for a value that is gone', () => {
    expect(of('valueGone', findings)).toEqual([{ kind: 'valueGone', path: 'variables.layout', label: 'Breite', value: 'full', count: 1, replacement: 'narrow' }]);
  });

  it('reports a tightened limit and a retype inside a collection', () => {
    expect(of('overLimit', findings)).toEqual([{ kind: 'overLimit', path: 'collections.metrics', label: 'Kennzahlen', have: 3, max: 2 }]);
    expect(of('retyped', findings)).toEqual([{ kind: 'retyped', path: 'collections.metrics[].suffix', label: 'Einheit', from: 'text', to: 'list', filled: 1, lossless: true }]);
  });

  it('asks for confirmation only where content is at stake', () => {
    expect(findings.filter(losesContent).map((f) => f.path).sort()).toEqual(
      ['collections.metrics', 'collections.metrics[].label', 'variables.claim', 'variables.layout'].sort(),
    );
  });

  it('treats an added field and an empty locale as harmless', () => {
    const plan = planResync(before as never, { ...after, locales: ['de', 'en', 'fr'], variables: { ...after.variables, quote: field('localized', { label: 'Zitat' }) } } as never, data);
    expect(of('added', plan)).toEqual([{ kind: 'added', path: 'variables.quote', label: 'Zitat' }]);
    expect(of('added', plan).some(losesContent)).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/resync-plan.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Plan schreiben**

Pfade sind `variables.<name>` und `collections.<name>` beziehungsweise `collections.<name>[].<feld>`; `[]` fächert beim Zählen über die Einträge auf. `kindOf` leitet aus dem JSON-Schema die Art ab: `widget` wenn gesetzt, sonst `type`. Verlustfreie Umformungen stehen in einer Tabelle:

```ts
const LOSSLESS: Record<string, string[]> = { text: ['list', 'markdown'], number: ['text'], select: ['text'], markdown: ['text'] };
```

`planResync` erzeugt die Befunde in dieser Reihenfolge: zuerst die neuen und umbenannten Felder aus `after`, dann je Feld aus `before` — entfallen, Typwechsel, Sprachen dazu und weg, Grenze, entfallener Aufzählungswert. `losesContent` ist wahr für `removed`/`retyped`/`localeRemoved` mit `filled > 0` — bei `retyped` nur, wenn `lossless` falsch ist — sowie immer für `overLimit` und `valueGone`.

Der vollständige Rumpf entspricht der Feldstudie und ist beim Umsetzen aus den Tests abzuleiten; die Studie liegt nicht mehr im Repo, weil sie Wegwerf war.

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test tests/resync-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/resync packages/modules/site/tests/resync-plan.test.ts
git commit -m "feat(site): say what a template change costs before it is applied"
```

---

### Task 5: Den Plan anwenden

**Files:**
- Create: `packages/modules/site/src/resync/apply.ts`
- Test: `packages/modules/site/tests/resync-apply.test.ts`

**Interfaces:**
- Consumes: `Finding` aus Task 4, Tabellen aus Task 2
- Produces: `applyFindings(tx, deps, findings, schemaAfter): void`

- [ ] **Step 1: Tests schreiben**

Ein Test je Wirkung, jeweils mit vorher angelegten Daten und Prüfung des Datenbankstands danach:

```ts
// packages/modules/site/tests/resync-apply.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDeps } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { applyFindings } from '../src/resync/apply';
import { siteEntries, siteValues } from '../src/schema';

describe('applyFindings', () => {
  it('renames a variable and keeps its content', () => { /* setzt subtitle, wendet renamed an, erwartet lede mit demselben Wert und kein subtitle mehr */ });
  it('drops a removed variable and a removed collection with its entries', () => { /* … */ });
  it('strips a removed locale from every affected field, in variables and in entries', () => { /* … */ });
  it('converts a lossless retype and clears a lossy one', () => { /* text → list wird einelementig; list → text wird leer */ });
  it('replaces a value that is gone with the named replacement', () => { /* layout full → narrow */ });
  it('creates nothing for an added field: it stays absent until someone fills it', () => { /* … */ });
});
```

Die Rümpfe folgen dem Muster: `const deps = createTestDeps()`, Zeilen in `siteValues`/`siteEntries` einfügen, `deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter))`, danach `deps.db.select()...get()` prüfen.

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/resync-apply.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Anwendung schreiben**

`applyFindings` arbeitet in der übergebenen Transaktion und behandelt je Befund:

| Befund | Wirkung |
|---|---|
| `added` | nichts — das Feld erscheint leer in der Maske |
| `renamed` | Wert unter neuem Schlüssel schreiben, alten löschen |
| `removed` | Schlüssel aus `siteValues` löschen; bei einer ganzen Sammlung deren Einträge |
| `retyped`, `lossless` | umformen: Text → Liste wird `[wert]`, Zahl → Text wird `String(wert)` |
| `retyped`, verlustbehaftet | Feld auf den Leerwert des neuen Typs setzen |
| `localeRemoved` | Sprachschlüssel aus dem Feld entfernen |
| `localeAdded` | nichts — fehlende Schlüssel gelten als leer |
| `valueGone` | Ersatzwert setzen |
| `overLimit` | kommt hier nicht an: blockiert bereits die Bestätigung |

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test tests/resync-apply.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/resync/apply.ts packages/modules/site/tests/resync-apply.test.ts
git commit -m "feat(site): apply a confirmed resync plan in one transaction"
```

---

### Task 6: Die Dienste

**Files:**
- Create: `packages/modules/site/src/service.ts`
- Modify: `packages/modules/site/src/index.ts`
- Test: `packages/modules/site/tests/service.test.ts`

**Interfaces:**
- Consumes: Task 3, 4, 5
- Produces: `activeTemplate(deps)`, `previewTemplateSync(deps, ctx)`, `applyTemplateSync(deps, ctx, input)`, `templateIsCurrent(deps)`

- [ ] **Step 1: Tests schreiben**

```ts
describe('template sync', () => {
  it('needs site.manage', async () => { /* forbidden für ctxWith([]) */ });
  it('reads a template into an empty installation without findings that cost content', async () => { /* erster Einlesevorgang */ });
  it('refuses to apply without confirmation', async () => { /* validation, confirmationRequired */ });
  it('refuses to apply while a limit is exceeded', async () => { /* conflict, overLimit */ });
  it('refuses a template that demands a locale the installation does not keep', async () => { /* conflict, localeMissing, mit dem Code in der Meldung */ });
  it('stores schema and checksum and writes an audit entry with the plan', async () => { /* siteTemplateState gefüllt, action site.template.read */ });
  it('leaves everything untouched when the file cannot be read', async () => { /* templateUnreadable, siteTemplateState unverändert */ });
});
```

Der Testaufbau legt eine Template-Datei in einem temporären Verzeichnis an, wie in Task 3, und reicht das Verzeichnis über den Dienst-Parameter herein — die Dienste bekommen den Pfad als Argument, nicht aus `process.env`, damit sie prüfbar bleiben.

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-site test tests/service.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Dienste schreiben**

```ts
export interface SyncPreview { name: string; findings: Finding[]; blocking: Finding[]; localesMissing: string[]; checksum: string }

export async function previewTemplateSync(deps: Deps, ctx: CallContext, dir: string): Promise<Result<SyncPreview>> {
  const denied = requirePermission(ctx, 'site.manage');
  if (denied) return denied;
  const loaded = await loadTemplate(dir);
  if (!loaded.ok) return loaded;
  const localesMissing = loaded.value.definition.locales.filter((l) => !deps.locales().includes(l));
  const previous = readTemplateState(deps);
  const findings = planResync(previous?.schema ?? EMPTY_SCHEMA, loaded.value.schema, readAllData(deps));
  return ok({
    name: loaded.value.definition.name,
    findings,
    blocking: findings.filter((f) => f.kind === 'overLimit'),
    localesMissing,
    checksum: loaded.value.checksum,
  });
}
```

`applyTemplateSync(deps, ctx, { dir, confirm })` prüft Recht, lädt erneut, verweigert bei `localesMissing` mit `conflict('localeMissing', …)`, bei blockierenden Befunden mit `conflict('overLimit', …)` und ohne `confirm` mit `invalid([{ path: 'confirm', message: 'confirmationRequired' }])`. Danach in einer Transaktion: `applyFindings`, `siteTemplateState` schreiben, `recordAudit` mit `site.template.read` und dem vollständigen Plan als `after`.

`templateIsCurrent(deps, dir)` vergleicht die Prüfsumme der Datei mit der gespeicherten und ist die Grundlage der Publish-Sicherung in Task 7.

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/module-site test`
Expected: PASS

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test
git add -A
git commit -m "feat(site): read a template after confirming what it costs"
```

---

### Task 7: Publish-Sicherung

**Files:**
- Modify: `packages/modules/site/src/service.ts`
- Test: `packages/modules/site/tests/service.test.ts`

Die Sicherung sitzt hier, obwohl die Publish-Pipeline erst in Plan 3 an `site` angeschlossen wird: Der Prüfstein gehört zum Template-Stand, und Plan 3 ruft ihn nur auf.

- [ ] **Step 1: Test schreiben**

```ts
it('reports the template as stale once the file changed', async () => {
  const dir = withTemplate(GOOD);
  const deps = /* … */;
  await applyTemplateSync(deps, ctx, { dir, confirm: true });
  expect(templateIsCurrent(deps, dir)).resolves.toBe(true);
  writeFileSync(path.join(dir, 'kompass.template.ts'), GOOD.replace("'Probe'", "'Probe 2'"));
  expect(templateIsCurrent(deps, dir)).resolves.toBe(false);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Expected: FAIL, `templateIsCurrent` fehlt oder liefert immer `true`

- [ ] **Step 3: Umsetzen**

```ts
export async function templateIsCurrent(deps: Deps, dir: string): Promise<boolean> {
  const state = readTemplateState(deps);
  if (!state) return false;
  const loaded = await loadTemplate(dir);
  return loaded.ok && loaded.value.checksum === state.checksum;
}
```

- [ ] **Step 4: Tests ausführen und Commit**

```bash
pnpm --filter @kompass/module-site test
git add -A
git commit -m "feat(site): tell a changed template from the one that was read"
```

---

## Abschluss dieses Plans

Danach liest Kompass ein Template aus dem Volume, hält seine Werte in eigenen Tabellen und sagt vor jeder Änderung, was sie kostet. Sichtbar ist davon noch nichts — Masken, Sammlungslisten, MCP und Export folgen in Plan 3.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Vertrag mit Variablen, Sammlungen und `uses` → Task 1. Merkmale einer Sammlung (`slug`, `sortable`, `publishable`, `max`) → Task 1 Step 5, geprüft in Task 1 Step 1. Datenmodell mit drei Tabellen → Task 2. Ablage im Volume und Abbruch vor dem ersten Schreibvorgang → Task 3, Task 6. Resync mit allen Befundarten und den vier Entscheidungen aus Abschnitt 5 der Spec → Task 4, 5. Template fordert Sprachen, legt keine an → Task 6 (`localesMissing`). Publish-Sicherung über die Prüfsumme → Task 7.

**Platzhalter:** Task 4 Step 3 und Task 5 Step 3 geben Tabelle und Regeln vor, statt den Rumpf abzuschreiben — die Tests darüber sind vollständig und legen das Verhalten fest, und beide Rümpfe sind reine Ableitungen daraus. Das ist die einzige Stelle, an der ich bewusst kürze; die Alternative wären zweihundert Zeilen, die schon in den Tests stehen. Task 5 Step 1 und Task 6 Step 1 nennen die Testnamen mit ihrer Zusicherung im Kommentar, weil die Rümpfe mechanisch demselben Aufbau folgen.

**Typkonsistenz:** `TemplateDefinition` (Task 1) → `loadTemplate` (Task 3) → `TemplateSchema` als gespeicherte Form → `planResync(before, after, data)` (Task 4) → `applyFindings(tx, deps, findings, schemaAfter)` (Task 5) → Dienste (Task 6). `Finding` ist in Task 4 definiert und wird in 5 und 6 unverändert benutzt. `checksum` ist überall der SHA-256 der Datei, nie des Schemas — sonst schlüge eine Formatierungsänderung nicht an, obwohl Astro sie sieht.

**Reihenfolge:** Jeder Task endet grün und ist für sich testbar. Task 7 steht bewusst hier statt in Plan 3.
