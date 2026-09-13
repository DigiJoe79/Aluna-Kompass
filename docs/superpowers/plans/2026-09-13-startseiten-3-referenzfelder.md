# Startseiten-Referenzen, Plan 3: Referenzfelder in der Template-Deklaration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Template deklariert einen Startseitenplatz als Verweis auf einen Datensatz einer veröffentlichten Sicht; Kompass zeigt dafür eine Auswahl, prüft beim Speichern und Einlesen, meldet veraltete Verweise beim Export und liefert die Optionen über MCP (Backlog 17, Spec § 3 und § 4).

**Architecture:** Zwei Helfer `reference`/`references` in `@kompass/site-template` legen Sicht, Schlüsselfeld, Anzeigefeld und eine Bedingung als Widget-Metadaten ins Template-Schema. Im Site-Modul löst eine neue Datei `reference-fields.ts` die Sicht über die Registry auf und wendet die Bedingung an; Dienst (`setValues`), Einlesen (`applyTemplateSync`), Export (`exportSiteContent`) und die Variablenmaske rufen dieselben Funktionen. Der Export schreibt `null` für veraltete Werte und meldet sie als `stale`; der Resync stuft `text → reference` als verlustfrei ein.

**Tech Stack:** TypeScript, Zod 4 (`.meta()` → `z.toJSONSchema`), Drizzle, Vitest, Next 16 (Server Components, Server Actions, next-intl), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md`, § 2 bis § 4, § 9, § 10.

## Global Constraints

- AGENTS.md: Dienste nach Muster, Fachfehler als `Result`, Rechteprüfung nur serverseitig, ein Weg zu den Daten (Maske und MCP rufen dieselben Funktionen).
- `where` kennt genau zwei Operatoren: Gleichheit auf einen Skalar und `{ present: true }`. Nichts weiter.
- Leer heißt Automatik: Ein leerer Referenzwert ist `null` (bzw. `[]`), nie ein Sonderwort wie `auto`.
- `key` Vorgabe `slug`, `labelField` Vorgabe `name`, mehrsprachige Beschriftung in der Leitsprache (`deps.locales()[0]`), sonst erste Sprache mit Inhalt.
- Kein hartcodierter UI-Text: neue Schlüssel in `apps/kompass/messages/de.json` unter `site.form` und `site.publish.check`; `apps/kompass/tests/no-hardcoded-ui-text.test.ts` und `message-keys.test.ts` müssen grün bleiben.
- Referenzfelder gibt es nur in `variables`, nicht in Sammlungen (Spec § 11).
- Commit je Task, kein Push. Vor jedem Commit `pnpm typecheck` und die Tests der berührten Pakete grün. Vor dem letzten Commit des Plans `pnpm verify`.

---

### Task 1: `reference` und `references` in `@kompass/site-template`

**Files:**
- Modify: `packages/site-template/src/index.ts`
- Test: `packages/site-template/tests/define.test.ts`

**Interfaces:**
- Produces:
  - `reference(opts: { view: string; label?: string; where?: Where; key?: string; labelField?: string; renamedFrom?: string }): z.ZodType<string | null>`
  - `references(opts: { …wie oben…; max: number }): z.ZodType<string[]>`
  - `type Where = Record<string, string | number | boolean | { present: true }>`
  - JSON-Schema-Metadaten: `{ widget: 'reference' | 'references', view, key, labelField, where?, label?, renamedFrom? }`, bei `references` zusätzlich `maxItems`.

- [ ] **Step 1: Tests schreiben**

In `packages/site-template/tests/define.test.ts` den Import um `reference, references` erweitern und ans Ende der Datei anhängen:

```ts
describe('reference fields', () => {
  it('reference carries view, key, labelField and where as widget metadata, with slug and name as defaults', () => {
    const schema = z.toJSONSchema(reference({ view: 'animals', label: 'Hund auf der Startseite', where: { status: 'lookingForHome', story: { present: true } } }), { io: 'input' }) as Record<string, unknown>;
    expect(schema).toMatchObject({ widget: 'reference', view: 'animals', key: 'slug', labelField: 'name', label: 'Hund auf der Startseite', where: { status: 'lookingForHome', story: { present: true } } });
    expect(reference({ view: 'animals' }).parse(null)).toBe(null);
    expect(reference({ view: 'animals' }).parse('chiara')).toBe('chiara');
    expect(reference({ view: 'animals' }).parse(undefined)).toBe(null);
  });

  it('references is an ordered list with maxItems, and needs a positive max', () => {
    const schema = z.toJSONSchema(references({ view: 'projects', max: 2, label: 'Projekte' }), { io: 'input' }) as Record<string, unknown>;
    expect(schema).toMatchObject({ widget: 'references', view: 'projects', key: 'slug', labelField: 'name', maxItems: 2 });
    expect(references({ view: 'projects', max: 2 }).parse(['a', 'b'])).toEqual(['a', 'b']);
    expect(references({ view: 'projects', max: 2 }).safeParse(['a', 'b', 'c']).success).toBe(false);
    expect(() => references({ view: 'projects', max: 0 })).toThrow(/max/);
    expect(() => references({ view: 'projects', max: 1.5 })).toThrow(/max/);
  });

  it('rejects an empty view and anything in where beyond a scalar or { present: true }', () => {
    expect(() => reference({ view: ' ' })).toThrow(/view/);
    expect(() => reference({ view: 'animals', where: { story: { present: false } as never } })).toThrow(/where/);
    expect(() => reference({ view: 'animals', where: { status: ['a'] as never } })).toThrow(/where/);
    expect(() => reference({ view: 'animals', where: { story: { present: true, extra: 1 } as never } })).toThrow(/where/);
  });

  it('types a reference variable as string | null | undefined and a references variable as string[] | undefined', () => {
    const t = defineTemplate({ name: 'X', locales: ['de'], variables: { dog: reference({ view: 'animals' }), projects: references({ view: 'projects', max: 2 }) }, collections: {}, uses: ['animals', 'projects'] });
    expectTypeOf<InferContent<typeof t>['variables']['dog']>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<InferContent<typeof t>['variables']['projects']>().toEqualTypeOf<string[] | undefined>();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/site-template test`
Expected: FAIL, `reference` ist kein Export.

- [ ] **Step 3: Helfer schreiben**

In `packages/site-template/src/index.ts` nach `objectList` (vor dem Abschnitt `InferContent`):

```ts
// ---------------------------------------------------------------------------
// Verweise auf Datensätze veröffentlichter Sichten
// ---------------------------------------------------------------------------

/**
 * Eine Bedingung über Felder der Sicht. Ein Skalar heißt Gleichheit,
 * `{ present: true }` heißt „nicht null“. Mehr Operatoren gibt es bewusst nicht
 * (Spec 2026-09-13, Entscheidung 3): Was ein Template darüber hinaus filtert,
 * filtert es selbst.
 */
export type WhereValue = string | number | boolean | { present: true };
export type Where = Record<string, WhereValue>;

export interface ReferenceOptions extends FieldOptions {
  /** Name einer veröffentlichten Sicht des Kerns oder eines Moduls aus `uses`. */
  view: string;
  /** Feld der Sicht, dessen Wert gespeichert wird. Vorgabe `slug`. */
  key?: string;
  /** Feld der Sicht, das die Auswahl zeigt. Vorgabe `name`. */
  labelField?: string;
  where?: Where;
}

const isPresentClause = (v: unknown): v is { present: true } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && (v as { present?: unknown }).present === true;

function checkReference(opts: ReferenceOptions): void {
  if (!opts.view || !opts.view.trim()) throw new Error('reference needs a view');
  for (const [field, value] of Object.entries(opts.where ?? {})) {
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
    if (!scalar && !isPresentClause(value)) throw new Error(`invalid where for ${field}: only a scalar or { present: true }`);
  }
}

const referenceMeta = (opts: ReferenceOptions) => ({
  view: opts.view.trim(),
  key: opts.key ?? 'slug',
  labelField: opts.labelField ?? 'name',
  ...(opts.where === undefined ? {} : { where: opts.where }),
});

/** Ein Verweis auf genau einen Datensatz; `null` heißt: keine Wahl, das Template entscheidet. */
export const reference = (opts: ReferenceOptions): z.ZodType<string | null> => {
  checkReference(opts);
  return z.string().nullable().default(null).meta(meta(opts, 'reference', referenceMeta(opts))) as z.ZodType<string | null>;
};

/** Eine geordnete Liste von Verweisen mit fester Zahl an Plätzen. */
export const references = (opts: ReferenceOptions & { max: number }): z.ZodType<string[]> => {
  checkReference(opts);
  if (!Number.isInteger(opts.max) || opts.max < 1) throw new Error(`references needs a positive integer max: ${opts.view}`);
  return z.array(z.string()).max(opts.max).meta(meta(opts, 'references', referenceMeta(opts))) as z.ZodType<string[]>;
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/site-template test && pnpm --filter @kompass/site-template typecheck`
Expected: PASS. Sollte `z.toJSONSchema` das verschachtelte `where` nicht mitnehmen, prüfe die Ausgabe mit `console.log(JSON.stringify(schema))`: Zod 4 kopiert Metadaten aus `.meta()` unverändert in das JSON-Schema; `asset` nutzt denselben Weg für `accept`.

- [ ] **Step 5: Commit**

```bash
git add packages/site-template/src/index.ts packages/site-template/tests/define.test.ts
git commit -m "feat(site-template): reference and references point a variable at a published view"
```

---

### Task 2: Schema-Ableitung und Leerwerte im Site-Modul

**Files:**
- Modify: `packages/modules/site/src/field-schema.ts`
- Test: `packages/modules/site/tests/field-schema.test.ts`

**Interfaces:**
- Produces: `schemaFor` kennt `reference` (`z.string().nullable().default(null)`) und `references` (`z.array(z.string()).max(maxItems)`); `blankValue` liefert `null` bzw. `[]`.

- [ ] **Step 1: Tests schreiben**

In `packages/modules/site/tests/field-schema.test.ts` den Import aus `@kompass/site-template` um `reference, references` erweitern und einen `describe`-Block anhängen:

```ts
describe('reference widgets', () => {
  it('reference accepts a string or null and blanks to null', () => {
    const field = asJson(reference({ view: 'animals', label: 'Hund' }));
    expect(widgetOf(field)).toBe('reference');
    const s = schemaFor(field);
    expect(s.parse('chiara')).toBe('chiara');
    expect(s.parse(null)).toBe(null);
    expect(s.safeParse(42).success).toBe(false);
    expect(blankValue(field)).toBe(null);
  });

  it('references accepts up to maxItems strings and blanks to an empty list', () => {
    const field = asJson(references({ view: 'projects', max: 2, label: 'Projekte' }));
    expect(widgetOf(field)).toBe('references');
    const s = schemaFor(field);
    expect(s.parse(['a'])).toEqual(['a']);
    expect(s.safeParse(['a', 'b', 'c']).success).toBe(false);
    expect(blankValue(field)).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- field-schema`
Expected: FAIL (`reference` fällt in den `default`-Zweig, der `z.string()` liefert; `blankValue` gibt `''`).

- [ ] **Step 3: Ableitung ergänzen**

In `schemaFor` vor `default:`:

```ts
    case 'reference':
      return z.string().nullable().default(null);
    case 'references': {
      let arr = z.array(z.string());
      const maxItems = (field as { maxItems?: number }).maxItems;
      if (typeof maxItems === 'number') arr = arr.max(maxItems);
      return arr;
    }
```

In `blankValue`:

```ts
    case 'asset':
    case 'reference':
      return null;
    case 'list':
    case 'objectList':
    case 'references':
      return [];
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test -- field-schema && pnpm --filter @kompass/app test -- schema-form`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/field-schema.ts packages/modules/site/tests/field-schema.test.ts
git commit -m "feat(site): the schema mapping knows reference and references"
```

---

### Task 3: Auflösung der Sicht und Prüfung der Werte

**Files:**
- Create: `packages/modules/site/src/reference-fields.ts`
- Modify: `packages/modules/site/src/index.ts` (Export)
- Test: `packages/modules/site/tests/reference-fields.test.ts`

**Interfaces:**
- Consumes: `deps.registry.manifests` (jedes Manifest mit `key`, `publishedViews`), `PublishedView` aus `@kompass/core`; `TemplateSchema`, `FieldSchema` aus `./types`.
- Produces (alle in `reference-fields.ts`):
  - `referenceMetaOf(field: FieldSchema): ReferenceFieldMeta | null` mit `{ view, key, labelField, where?, multiple, max? }`
  - `findView(deps, uses: string[], name: string): { view: PublishedView; moduleKey: string } | null`
  - `matchesWhere(row: Record<string, unknown>, where?: Record<string, unknown>): boolean`
  - `resolveReferenceOptions(deps, uses: string[], field: FieldSchema): ReferenceOption[]` mit `ReferenceOption = { value: string; label: string }`
  - `checkReferenceValues(deps, schema: TemplateSchema, values: Record<string, unknown>): StaleReference[]` mit `StaleReference = { field: string; value: string }`
  - `duplicateReferences(schema: TemplateSchema, values: Record<string, unknown>): string[]` (Feldnamen mit doppelten Werten)
  - `checkReferenceFields(deps, schema: TemplateSchema): Result<null>` (`conflict('unknownView')`, `conflict('unknownViewField')`)

- [ ] **Step 1: Tests schreiben**

```ts
// packages/modules/site/tests/reference-fields.test.ts
import { coreModule, setSetting, unwrap } from '@kompass/core';
import { animalsModule, createAnimal, setAnimalPublished, setAnimalStatus, setAnimalStory } from '@kompass/module-animals';
import { createProject, projectsModule, setProjectPublished } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reference, references } from '@kompass/site-template';
import type { FieldSchema, TemplateSchema } from '../src/types';
import { checkReferenceFields, checkReferenceValues, duplicateReferences, findView, matchesWhere, referenceMetaOf, resolveReferenceOptions } from '../src/reference-fields';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;
const animalsCtx = ctxWith(['animals.manage', 'animals.view']);
const projectsCtx = ctxWith(['projects.manage', 'projects.view']);

const schemaWith = (variables: Record<string, FieldSchema>, uses: string[] = ['animals', 'projects']): TemplateSchema => ({ name: 'T', locales: ['de', 'en'], uses, variables, collections: {} });

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const dog = (slug: string, name: string) => createAnimal(deps, animalsCtx, { slug, name, sex: 'female', birthText: {}, sizeText: {}, summary: {}, body: {} });
  const bruno = unwrap(await dog('bruno', 'Bruno'));
  const akiko = unwrap(await dog('akiko', 'Akiko'));
  const draft = unwrap(await dog('entwurf', 'Entwurf'));
  for (const a of [bruno, akiko]) unwrap(await setAnimalPublished(deps, animalsCtx, { id: a.id, isPublished: true }));
  unwrap(await setAnimalStatus(deps, animalsCtx, { id: akiko.id, status: 'adopted', adoptedYear: 2025 }));
  unwrap(await setAnimalStory(deps, animalsCtx, { id: akiko.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2025 }));
  const hof = unwrap(await createProject(deps, projectsCtx, { slug: 'hof', name: { de: 'Der Hof', en: 'The yard' }, type: 'ongoing', summary: {}, body: {} }));
  const futter = unwrap(await createProject(deps, projectsCtx, { slug: 'futter', name: { de: '', en: 'Food' }, type: 'ongoing', summary: {}, body: {} }));
  for (const p of [hof, futter]) unwrap(await setProjectPublished(deps, projectsCtx, { id: p.id, isPublished: true }));
  void draft;
  return deps;
};

describe('referenceMetaOf', () => {
  it('reads the widget metadata and defaults key and labelField', () => {
    expect(referenceMetaOf(asJson(reference({ view: 'animals' })))).toEqual({ view: 'animals', key: 'slug', labelField: 'name', where: undefined, multiple: false, max: undefined });
    expect(referenceMetaOf(asJson(references({ view: 'projects', max: 2, key: 'slug', labelField: 'name', where: { status: 'active' } })))).toEqual({ view: 'projects', key: 'slug', labelField: 'name', where: { status: 'active' }, multiple: true, max: 2 });
    expect(referenceMetaOf({ widget: 'text' })).toBe(null);
  });
});

describe('findView and matchesWhere', () => {
  it('finds a view of the core or of a module named in uses, and nothing else', async () => {
    const deps = await setup();
    expect(findView(deps, [], 'organization')?.moduleKey).toBe('core');
    expect(findView(deps, ['animals'], 'animals')?.moduleKey).toBe('animals');
    expect(findView(deps, [], 'animals')).toBe(null);
    expect(findView(deps, ['animals'], 'ghost')).toBe(null);
  });

  it('applies equality and presence, and nothing else', () => {
    expect(matchesWhere({ status: 'adopted', story: null }, { status: 'adopted' })).toBe(true);
    expect(matchesWhere({ status: 'adopted', story: null }, { status: 'adopted', story: { present: true } })).toBe(false);
    expect(matchesWhere({ status: 'adopted', story: { quote: {} } }, { status: 'adopted', story: { present: true } })).toBe(true);
    expect(matchesWhere({ isEmergency: true }, { isEmergency: true })).toBe(true);
    expect(matchesWhere({ isEmergency: false }, { isEmergency: true })).toBe(false);
    expect(matchesWhere({ anything: 1 }, undefined)).toBe(true);
  });
});

describe('resolveReferenceOptions', () => {
  it('lists published rows that satisfy where, labelled by name, in view order', async () => {
    const deps = await setup();
    const looking = resolveReferenceOptions(deps, ['animals'], asJson(reference({ view: 'animals', where: { status: 'lookingForHome' } })));
    expect(looking).toEqual([{ value: 'bruno', label: 'Bruno' }]);
    const stories = resolveReferenceOptions(deps, ['animals'], asJson(reference({ view: 'animals', where: { status: 'adopted', story: { present: true } } })));
    expect(stories).toEqual([{ value: 'akiko', label: 'Akiko' }]);
  });

  it('shows a localized label in the leading locale, else the first locale with content', async () => {
    const deps = await setup();
    const options = resolveReferenceOptions(deps, ['projects'], asJson(references({ view: 'projects', max: 2 })));
    expect(options).toEqual([{ value: 'hof', label: 'Der Hof' }, { value: 'futter', label: 'Food' }]);
  });

  it('is empty for a view the template does not use', async () => {
    const deps = await setup();
    expect(resolveReferenceOptions(deps, [], asJson(reference({ view: 'animals' })))).toEqual([]);
  });
});

describe('checkReferenceValues and duplicateReferences', () => {
  it('names every value that is not among the options, per field', async () => {
    const deps = await setup();
    const schema = schemaWith({ dog: asJson(reference({ view: 'animals', where: { status: 'lookingForHome' } })), projects: asJson(references({ view: 'projects', max: 2 })) });
    expect(checkReferenceValues(deps, schema, { dog: 'bruno', projects: ['hof', 'futter'] })).toEqual([]);
    expect(checkReferenceValues(deps, schema, { dog: 'akiko', projects: ['hof', 'ghost'] })).toEqual([{ field: 'dog', value: 'akiko' }, { field: 'projects', value: 'ghost' }]);
    expect(checkReferenceValues(deps, schema, { dog: null, projects: [] })).toEqual([]);
    expect(checkReferenceValues(deps, schema, {})).toEqual([]);
  });

  it('finds a value used twice in a references field', () => {
    const schema = schemaWith({ projects: asJson(references({ view: 'projects', max: 2 })) });
    expect(duplicateReferences(schema, { projects: ['hof', 'hof'] })).toEqual(['projects']);
    expect(duplicateReferences(schema, { projects: ['hof', 'futter'] })).toEqual([]);
  });
});

describe('checkReferenceFields', () => {
  it('accepts a declaration whose view and fields exist', async () => {
    const deps = await setup();
    const schema = schemaWith({ dog: asJson(reference({ view: 'animals', where: { status: 'adopted', story: { present: true } } })) });
    expect(checkReferenceFields(deps, schema).ok).toBe(true);
  });

  it('refuses a view outside core and uses, and a field the view does not have', async () => {
    const deps = await setup();
    const noUse = checkReferenceFields(deps, schemaWith({ dog: asJson(reference({ view: 'animals' })) }, []));
    expect(noUse.ok === false && noUse.error.type === 'conflict' && noUse.error.code).toBe('unknownView');
    const badField = checkReferenceFields(deps, schemaWith({ dog: asJson(reference({ view: 'animals', where: { colour: 'red' } })) }));
    expect(badField.ok === false && badField.error.type === 'conflict' && badField.error.code).toBe('unknownViewField');
    const badLabel = checkReferenceFields(deps, schemaWith({ org: asJson(reference({ view: 'organization', key: 'name', labelField: 'nickname' })) }));
    expect(badLabel.ok === false && badLabel.error.type === 'conflict' && badLabel.error.code).toBe('unknownViewField');
  });
});
```

Prüfe, dass `@kompass/module-animals` und `@kompass/module-projects` in `packages/modules/site/package.json` als `devDependencies` stehen (`export.test.ts` nutzt Projekte schon); fehlt Animals, ergänze `"@kompass/module-animals": "workspace:*"` unter `devDependencies` und führe `pnpm install` aus.

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- reference-fields`
Expected: FAIL, Datei fehlt.

- [ ] **Step 3: Datei schreiben**

```ts
// packages/modules/site/src/reference-fields.ts
import { conflict, ok, type Deps, type PublishedView, type Result } from '@kompass/core';
import type { z } from 'zod';
import type { FieldSchema, TemplateSchema } from './types';

/**
 * Referenzfelder: eine Variable, die auf einen Datensatz einer veröffentlichten
 * Sicht zeigt (Spec 2026-09-13, § 3 und § 4). Alles, was Sicht, Bedingung und
 * Beschriftung betrifft, steht hier einmal — Maske, Dienst, Einlesen und
 * Export rufen dieselben Funktionen.
 */

export interface ReferenceFieldMeta {
  view: string;
  key: string;
  labelField: string;
  where?: Record<string, unknown>;
  multiple: boolean;
  max?: number;
}

export interface ReferenceOption {
  value: string;
  label: string;
}

export interface StaleReference {
  field: string;
  value: string;
}

export function referenceMetaOf(field: FieldSchema): ReferenceFieldMeta | null {
  if (field.widget !== 'reference' && field.widget !== 'references') return null;
  const f = field as { view?: unknown; key?: unknown; labelField?: unknown; where?: unknown; maxItems?: unknown };
  return {
    view: typeof f.view === 'string' ? f.view : '',
    key: typeof f.key === 'string' ? f.key : 'slug',
    labelField: typeof f.labelField === 'string' ? f.labelField : 'name',
    where: f.where && typeof f.where === 'object' && !Array.isArray(f.where) ? (f.where as Record<string, unknown>) : undefined,
    multiple: field.widget === 'references',
    max: typeof f.maxItems === 'number' ? f.maxItems : undefined,
  };
}

/** Die Sicht mit diesem Namen — aus dem Kern oder aus einem Modul, das `uses` nennt. */
export function findView(deps: Deps, uses: string[], name: string): { view: PublishedView; moduleKey: string } | null {
  for (const manifest of deps.registry.manifests) {
    if (manifest.key !== 'core' && !uses.includes(manifest.key)) continue;
    const view = manifest.publishedViews?.find((v) => v.name === name);
    if (view) return { view, moduleKey: manifest.key };
  }
  return null;
}

const isPresentClause = (v: unknown): boolean => !!v && typeof v === 'object' && (v as { present?: unknown }).present === true;

/** Gleichheit auf einen Skalar oder `{ present: true }`; mehrere Einträge sind ein Und. */
export function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  for (const [field, expected] of Object.entries(where ?? {})) {
    const actual = row[field];
    if (isPresentClause(expected)) {
      if (actual === null || actual === undefined) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

function labelOf(row: Record<string, unknown>, labelField: string, locales: readonly string[]): string {
  const raw = row[labelField];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const text = raw as Record<string, string>;
    for (const locale of locales) if (text[locale]) return text[locale]!;
    return Object.values(text).find((v) => typeof v === 'string' && v.length > 0) ?? '';
  }
  return raw === null || raw === undefined ? '' : String(raw);
}

/** Die wählbaren Datensätze eines Referenzfelds, in der Reihenfolge der Sicht. */
export function resolveReferenceOptions(deps: Deps, uses: string[], field: FieldSchema): ReferenceOption[] {
  const meta = referenceMetaOf(field);
  if (!meta) return [];
  const found = findView(deps, uses, meta.view);
  if (!found) return [];
  const locales = deps.locales();
  return (found.view.load(deps) as Record<string, unknown>[])
    .filter((row) => matchesWhere(row, meta.where))
    .map((row) => ({ value: String(row[meta.key] ?? ''), label: labelOf(row, meta.labelField, locales) }))
    .filter((option) => option.value.length > 0);
}

const valuesOf = (meta: ReferenceFieldMeta, raw: unknown): unknown[] => {
  if (meta.multiple) return Array.isArray(raw) ? raw : [];
  return raw === null || raw === undefined || raw === '' ? [] : [raw];
};

/** Jeder gespeicherte Wert, der nicht (mehr) unter den Optionen steht. */
export function checkReferenceValues(deps: Deps, schema: TemplateSchema, values: Record<string, unknown>): StaleReference[] {
  const stale: StaleReference[] = [];
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta || !(field in values)) continue;
    const allowed = new Set(resolveReferenceOptions(deps, schema.uses, fieldSchema).map((o) => o.value));
    for (const value of valuesOf(meta, values[field])) {
      if (typeof value !== 'string' || !allowed.has(value)) stale.push({ field, value: String(value) });
    }
  }
  return stale;
}

/** Felder, in denen derselbe Datensatz zweimal gewählt ist. */
export function duplicateReferences(schema: TemplateSchema, values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta?.multiple || !(field in values)) continue;
    const list = valuesOf(meta, values[field]);
    if (new Set(list).size !== list.length) out.push(field);
  }
  return out;
}

/**
 * Beim Einlesen: Die Sicht muss es geben, und `key`, `labelField` und jedes
 * Feld in `where` müssen in ihrem Schema stehen. Erst hier ist die Registry
 * bekannt; `defineTemplate` kann das nicht prüfen.
 */
export function checkReferenceFields(deps: Deps, schema: TemplateSchema): Result<null> {
  for (const [field, fieldSchema] of Object.entries(schema.variables)) {
    const meta = referenceMetaOf(fieldSchema);
    if (!meta) continue;
    const found = findView(deps, schema.uses, meta.view);
    if (!found) {
      return conflict('unknownView', `Die Variable „${field}“ verweist auf die Sicht „${meta.view}“, die weder der Kern noch ein Modul aus uses liefert`);
    }
    const shape = ((found.view.schema as unknown as z.ZodObject<z.ZodRawShape>).shape ?? {}) as Record<string, unknown>;
    for (const name of [meta.key, meta.labelField, ...Object.keys(meta.where ?? {})]) {
      if (!(name in shape)) {
        return conflict('unknownViewField', `Die Variable „${field}“ nennt das Feld „${name}“, das die Sicht „${meta.view}“ nicht hat`);
      }
    }
  }
  return ok(null);
}
```

In `packages/modules/site/src/index.ts` ergänzen: `export * from './reference-fields';`

Prüfe, ob `PublishedView` aus `@kompass/core` exportiert ist (`grep -n "PublishedView" packages/core/src/index.ts`); die Manifest-Typen kommen über `export *` aus `modules/manifest.ts`. Prüfe `conflict`s Signatur: `grep -n "export function conflict" -A3 packages/core/src/result.ts` — zwei Argumente, Code und Meldung.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test -- reference-fields && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/reference-fields.ts packages/modules/site/src/index.ts packages/modules/site/tests/reference-fields.test.ts packages/modules/site/package.json pnpm-lock.yaml
git commit -m "feat(site): reference fields resolve their view, apply where and name what no longer holds"
```

(`package.json` und `pnpm-lock.yaml` nur, wenn Step 1 sie geändert hat.)

---

### Task 4: Prüfung beim Einlesen des Templates

**Files:**
- Modify: `packages/modules/site/src/service.ts` (`previewTemplateSync`, `applyTemplateSync`)
- Test: `packages/modules/site/tests/service.test.ts`

**Interfaces:**
- Consumes: `checkReferenceFields` aus Task 3.

- [ ] **Step 1: Test schreiben**

In `packages/modules/site/tests/service.test.ts` (nutzt `templateDir(source)` und `GOOD`, siehe Kopf der Datei) einen `describe`-Block anhängen. Die Deps brauchen die Module, deren Sichten das Template nennt: Lies, wie `createTestDeps` dort aufgerufen wird, und gib für diesen Block `manifests: [coreModule, animalsModule, siteModule]` an (`animalsModule` aus `@kompass/module-animals`).

```ts
describe('reference fields at read time', () => {
  const REFS = `
import { defineTemplate, reference } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { dog: reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund' }) },
  collections: {},
  uses: ['animals'],
});`;

  it('reads a template whose reference names an existing view and field', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const applied = await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: templateDir(REFS), confirm: true });
    expect(applied.ok).toBe(true);
  });

  it('refuses a reference to a view the template does not use, before writing anything', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const result = await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: templateDir(REFS.replace("uses: ['animals'],", '')), confirm: true });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code).toBe('unknownView');
    expect(activeTemplate(deps)).toBe(null);
  });

  it('refuses a where field the view does not have, in preview as in apply', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const dir = templateDir(REFS.replace("status: 'lookingForHome'", "colour: 'red'"));
    const preview = await previewTemplateSync(deps, ctxWith(['site.manage']), dir);
    expect(preview.ok === false && preview.error.type === 'conflict' && preview.error.code).toBe('unknownViewField');
    const applied = await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true });
    expect(applied.ok === false && applied.error.type === 'conflict' && applied.error.code).toBe('unknownViewField');
  });
});
```

Importe ergänzen, soweit sie fehlen: `activeTemplate`, `previewTemplateSync` aus `../src/service`, `animalsModule` aus `@kompass/module-animals`, `siteModule` aus `../src/manifest`.

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- service`
Expected: Der erste Test besteht schon, die beiden anderen scheitern (kein `conflict`).

- [ ] **Step 3: Prüfung einbauen**

In `service.ts` importieren: `import { checkReferenceFields } from './reference-fields';`

In `previewTemplateSync` nach `if (!loaded.ok) return loaded;`:

```ts
  const refs = checkReferenceFields(deps, loaded.value.schema);
  if (!refs.ok) return refs;
```

In `applyTemplateSync` an derselben Stelle (nach `if (!loaded.ok) return loaded;`) dieselben zwei Zeilen.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test -- service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/service.ts packages/modules/site/tests/service.test.ts
git commit -m "feat(site): reading a template checks that every reference names a view and fields that exist"
```

---

### Task 5: Prüfung beim Speichern, Optionen als Dienst und MCP-Werkzeug

**Files:**
- Modify: `packages/modules/site/src/values.ts` (`setValues`, neu `listReferenceOptions`)
- Modify: `packages/modules/site/src/mcp-tools.ts` (`site_variables_options`)
- Test: `packages/modules/site/tests/values.test.ts`, `packages/modules/site/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `checkReferenceValues`, `duplicateReferences`, `resolveReferenceOptions`, `referenceMetaOf` aus Task 3.
- Produces: `listReferenceOptions(deps, ctx): Promise<Result<Record<string, ReferenceOption[]>>>` (Recht `site.view`, `conflict('noTemplate')` ohne Template); `setValues` liefert `validation` mit `referenceNotFound` bzw. `duplicateReference` je Feld; Werkzeug `site_variables_options`.

- [ ] **Step 1: Tests schreiben**

In `packages/modules/site/tests/values.test.ts`: Der bestehende `seedTemplate` schreibt `uses: []`. Ergänze eine Variante mit `uses` und den Tiermodul-Deps. Am Ende der Datei:

```ts
describe('reference values', () => {
  const withAnimals = async () => {
    const deps = createTestDeps({ locales: ['de', 'en'], manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['animals.manage', 'animals.view']);
    const bruno = unwrap(await createAnimal(deps, ctx, { slug: 'bruno', name: 'Bruno', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    unwrap(await setAnimalPublished(deps, ctx, { id: bruno.id, isPublished: true }));
    deps.db
      .insert(siteTemplateState)
      .values({
        id: 'current',
        name: 'T',
        schemaJson: { name: 'T', locales: ['de', 'en'], uses: ['animals'], variables: { dog: asJson(reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund' })), dogs: asJson(references({ view: 'animals', max: 2, label: 'Hunde' })) }, collections: {} },
        checksum: 'a'.repeat(64),
        readAt: 't',
        readByUserId: null,
      })
      .run();
    return deps;
  };

  it('saves a value that is among the options and rejects one that is not', async () => {
    const deps = await withAnimals();
    const manage = ctxWith(['site.manage']);
    const saved = unwrap(await setValues(deps, manage, { values: { dog: 'bruno' } }));
    expect(saved.dog).toBe('bruno');
    const stale = await setValues(deps, manage, { values: { dog: 'ghost' } });
    expect(stale.ok === false && stale.error.type === 'validation' && stale.error.issues).toEqual([{ path: 'dog', message: 'referenceNotFound' }]);
    expect(readValues(deps).dog).toBe('bruno');
  });

  it('accepts null as no choice, and refuses the same record twice in a references field', async () => {
    const deps = await withAnimals();
    const manage = ctxWith(['site.manage']);
    expect(unwrap(await setValues(deps, manage, { values: { dog: null } })).dog).toBe(null);
    const twice = await setValues(deps, manage, { values: { dogs: ['bruno', 'bruno'] } });
    expect(twice.ok === false && twice.error.type === 'validation' && twice.error.issues).toEqual([{ path: 'dogs', message: 'duplicateReference' }]);
  });

  it('lists the options per reference field for the mask and for MCP', async () => {
    const deps = await withAnimals();
    const options = unwrap(await listReferenceOptions(deps, ctxWith(['site.view'])));
    expect(options).toEqual({ dog: [{ value: 'bruno', label: 'Bruno' }], dogs: [{ value: 'bruno', label: 'Bruno' }] });
    const denied = await listReferenceOptions(deps, ctxWith([]));
    expect(denied.ok === false && denied.error.type).toBe('forbidden');
  });
});
```

Importe ergänzen: `coreModule` aus `@kompass/core`; `animalsModule, createAnimal, setAnimalPublished` aus `@kompass/module-animals`; `reference, references` aus `@kompass/site-template`; `listReferenceOptions` aus `../src/values`.

In `packages/modules/site/tests/mcp-tools.test.ts` im Test `offers the fixed tools even without a template` die Liste der erwarteten festen Werkzeuge um `site_variables_options` ergänzen (lies die Erwartung dort und füge den Namen an der passenden Stelle ein), und einen Test anhängen:

```ts
  it('site_variables_options calls listReferenceOptions', () => {
    const deps = withTemplate({});
    const tools = Object.fromEntries(moduleMcpTools(deps, siteModule).map((t) => [t.name, t]));
    expect(tools.site_variables_options?.service).toBe(listReferenceOptions);
    expect(tools.site_variables_options?.description).toContain('site.view');
  });
```

mit `import { listReferenceOptions } from '../src/values';`.

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- values mcp-tools`
Expected: FAIL (`listReferenceOptions` fehlt, `setValues` nimmt `ghost` an).

- [ ] **Step 3: Dienst ändern**

In `values.ts` importieren: `import { checkReferenceValues, duplicateReferences, referenceMetaOf, resolveReferenceOptions, type ReferenceOption } from './reference-fields';`

In `setValues` nach `if (!parsed.ok) return parsed;`:

```ts
  // Referenzwerte müssen in der gefilterten Sicht stehen — dieselbe Prüfung
  // für Maske und site_variables_set (Spec 2026-09-13, § 4.4).
  const stale = checkReferenceValues(deps, template.schema, parsed.value as Record<string, unknown>);
  const duplicates = duplicateReferences(template.schema, parsed.value as Record<string, unknown>);
  if (stale.length > 0 || duplicates.length > 0) {
    return invalid([
      ...stale.map((s) => ({ path: s.field, message: 'referenceNotFound' })),
      ...duplicates.map((field) => ({ path: field, message: 'duplicateReference' })),
    ]);
  }
```

Am Ende der Datei:

```ts
/** Die wählbaren Datensätze je Referenzfeld — für die Maske und für `site_variables_options`. */
export async function listReferenceOptions(deps: Deps, ctx: CallContext): Promise<Result<Record<string, ReferenceOption[]>>> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const template = activeTemplate(deps);
  if (!template) return conflict('noTemplate', 'Es ist kein Template eingelesen');
  const out: Record<string, ReferenceOption[]> = {};
  for (const [key, field] of Object.entries(template.schema.variables)) {
    if (referenceMetaOf(field)) out[key] = resolveReferenceOptions(deps, template.schema.uses, field);
  }
  return ok(out);
}
```

In `mcp-tools.ts` den Import aus `./values` um `listReferenceOptions` erweitern und in `FIXED` nach `site_variables_set`:

```ts
  tool('site_variables_options', 'List the selectable records per reference variable (value and label), filtered by the declared condition. Requires site.view.', z.object({}), (deps, ctx) => listReferenceOptions(deps, ctx), listReferenceOptions),
```

- [ ] **Step 4: Sprachdatei**

In `apps/kompass/messages/de.json` unter `errors.fields` ergänzen:

```json
      "referenceNotFound": "Dieser Datensatz steht nicht (mehr) zur Auswahl. Bitte leeren oder neu wählen.",
      "duplicateReference": "Derselbe Datensatz ist zweimal gewählt."
```

und unter `errors.conflict`:

```json
      "unknownView": "Das Template verweist auf eine Sicht, die es nicht gibt: {detail}",
      "unknownViewField": "Das Template nennt ein Feld, das die Sicht nicht hat: {detail}"
```

Prüfe an einem Nachbarn (`moduleDependencyInactive`), ob `{detail}` die Meldung des `conflict` einsetzt; `errorMessage` in `apps/kompass/src/lib/actions.ts` zeigt es.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test && pnpm --filter @kompass/app test -- mcp-tools message-keys && pnpm typecheck`
Expected: PASS. Der App-Test `every service has a tool` sieht `listReferenceOptions` als Dienst und findet das Werkzeug dazu.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/site/src/values.ts packages/modules/site/src/mcp-tools.ts packages/modules/site/tests/values.test.ts packages/modules/site/tests/mcp-tools.test.ts apps/kompass/messages/de.json
git commit -m "feat(site): saving checks reference values, and an agent can list the options"
```

---

### Task 6: Export meldet veraltete Verweise und schreibt `null`

**Files:**
- Modify: `packages/modules/site/src/export.ts` (`ExportChecks`, `exportSiteContent`)
- Modify: `packages/modules/site/src/pipeline/jobs.ts` (`PreviewResult`, `runPreview`, `exportAndBuild`)
- Modify: `packages/modules/site/src/mcp-tools.ts` (`site_export_check` liefert `stale`)
- Test: `packages/modules/site/tests/export.test.ts`

**Interfaces:**
- Produces: `ExportChecks.stale: { path: string; value: string }[]` mit `path` als `variables.<feld>`; `PreviewResult.stale` gleichen Typs.

- [ ] **Step 1: Test schreiben**

In `packages/modules/site/tests/export.test.ts` anhängen (nutzt `templateDir`, `manage`, `publish`, `tmp` aus dem Dateikopf):

```ts
describe('reference variables in the export', () => {
  const REFS = `
import { defineTemplate, reference, references } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: {
    dog: reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund' }),
    dogs: references({ view: 'animals', max: 2, label: 'Hunde' }),
  },
  collections: {},
  uses: ['animals'],
});`;

  const setup = async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const admin = ctxWith(['site.manage', 'modules.manage', 'animals.manage', 'animals.view']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: true }));
    const dog = async (slug: string) => {
      const a = unwrap(await createAnimal(deps, admin, { slug, name: slug, sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
      unwrap(await setAnimalPublished(deps, admin, { id: a.id, isPublished: true }));
      return a;
    };
    const bruno = await dog('bruno');
    await dog('rex');
    const dir = templateDir(REFS);
    unwrap(await applyTemplateSync(deps, manage, { dir, confirm: true }));
    unwrap(await setValues(deps, manage, { values: { dog: 'bruno', dogs: ['bruno', 'rex'] } }));
    return { deps, dir, bruno, admin };
  };

  it('writes chosen references as they are when they still hold', async () => {
    const { deps, dir } = await setup();
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    const content = JSON.parse(readFileSync(out.contentPath, 'utf8')) as { variables: Record<string, unknown> };
    expect(content.variables).toMatchObject({ dog: 'bruno', dogs: ['bruno', 'rex'] });
    expect(out.stale).toEqual([]);
  });

  it('writes null for a reference that no longer holds, drops it from a list, and reports it as stale', async () => {
    const { deps, dir, bruno, admin } = await setup();
    unwrap(await setAnimalStatus(deps, admin, { id: bruno.id, status: 'adopted', adoptedYear: 2026 }));
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    const content = JSON.parse(readFileSync(out.contentPath, 'utf8')) as { variables: Record<string, unknown> };
    expect(content.variables.dog).toBe(null);
    expect(content.variables.dogs).toEqual(['bruno', 'rex']);
    expect(out.stale).toEqual([{ path: 'variables.dog', value: 'bruno' }]);
    expect(out.violations).toEqual([]);
  });
});
```

Der zweite Fall: `dogs` hat kein `where`, ein vermittelter Hund bleibt in der Sicht, deshalb bleibt er in der Liste. Ergänze einen dritten Fall, in dem `rex` zurückgezogen wird (`setAnimalPublished … false`) und `dogs` danach `['bruno']` ist mit `stale` `[{ path: 'variables.dogs', value: 'rex' }]`.

Importe: `animalsModule, createAnimal, setAnimalPublished, setAnimalStatus` aus `@kompass/module-animals`.

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- export`
Expected: FAIL (`stale` fehlt, `dog` bleibt `bruno`).

- [ ] **Step 3: Export ändern**

In `export.ts`:

```ts
export interface ExportChecks {
  gaps: { path: string; locale: string }[];
  violations: { path: string; term: string; excerpt: string }[];
  /** Referenzwerte, die nicht mehr in der gefilterten Sicht stehen; im Export durch null ersetzt bzw. aus der Liste genommen. */
  stale: { path: string; value: string }[];
}
```

Import: `import { checkReferenceValues } from './reference-fields';`

Nach `const variables = pruneLocales(readValues(deps), locales) as Record<string, unknown>;`:

```ts
  // Ein Verweis, der nicht mehr trägt, hält keinen Publish an, verschwindet
  // aber auch nicht still: null im Export, ein Befund im Ergebnis (Spec § 4.6).
  const stale = checkReferenceValues(deps, template.schema, variables).map((s) => ({ path: `variables.${s.field}`, value: s.value }));
  for (const s of checkReferenceValues(deps, template.schema, variables)) {
    const current = variables[s.field];
    variables[s.field] = Array.isArray(current) ? current.filter((v) => v !== s.value) : null;
  }
```

(Zwei Aufrufe sind unnötig; berechne `const staleRaw = checkReferenceValues(…)` einmal und leite `stale` und die Schleife daraus ab.)

Im `return ok({ … })` am Ende `stale` ergänzen.

In `pipeline/jobs.ts`: `PreviewResult` um `stale: SiteContentExport['stale'];` erweitern; in `runPreview` `stale: built.value.exported.stale,` ergänzen; in `exportAndBuild` direkt nach `if (!exported.ok) return exported;`:

```ts
    for (const s of exported.value.stale) console.log(`[site] veralteter Verweis: ${s.path} = ${s.value}`);
```

In `mcp-tools.ts` bei `site_export_check` im Rückgabewert `stale: result.value.stale` ergänzen.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test && pnpm typecheck`
Expected: PASS. `pipeline.test.ts` und `mcp-tools.test.ts` prüfen Ergebnisformen; passe Erwartungen dort an, wo sie `gaps` und `violations` vollständig aufzählen.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/export.ts packages/modules/site/src/pipeline/jobs.ts packages/modules/site/src/mcp-tools.ts packages/modules/site/tests
git commit -m "feat(site): the export writes null for a stale reference and reports it instead of blocking"
```

---

### Task 7: Resync stuft `text → reference` als verlustfrei ein

**Files:**
- Modify: `packages/modules/site/src/resync/plan.ts` (`LOSSLESS`)
- Modify: `packages/modules/site/src/resync/apply.ts` (`emptyOf`, `recast`)
- Test: `packages/modules/site/tests/resync-plan.test.ts`, `packages/modules/site/tests/resync-apply.test.ts`

- [ ] **Step 1: Tests schreiben**

In `resync-plan.test.ts` anhängen (lies den Kopf der Datei für `of(kind, findings)` und die Form von `planResync`-Aufrufen):

```ts
  it('text to reference is lossless: a slug carries over', () => {
    const before = { variables: { dog: { widget: 'text', label: 'Hund' } } };
    const after = { variables: { dog: { widget: 'reference', view: 'animals', key: 'slug', labelField: 'name', label: 'Hund' } } };
    const findings = planResync(before, after, { variables: { dog: 'chiara' } });
    expect(of('retyped', findings)).toEqual([{ kind: 'retyped', path: 'variables.dog', label: 'Hund', from: 'text', to: 'reference', filled: 1, lossless: true }]);
  });
```

In `resync-apply.test.ts` innerhalb `describe('applyFindings', …)` anhängen (Muster: der Test `converts a lossless retype and clears a lossy one`):

```ts
  it('keeps a slug when text becomes reference; auto stays and is reported later, not recast', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'dog', value: 'chiara', updatedAt: 't' }).run();
    deps.db.insert(siteValues).values({ key: 'story', value: 'auto', updatedAt: 't' }).run();
    deps.db.insert(siteValues).values({ key: 'blank', value: '', updatedAt: 't' }).run();
    const findings: Finding[] = [
      { kind: 'retyped', path: 'variables.dog', from: 'text', to: 'reference', filled: 1, lossless: true, label: 'Hund' },
      { kind: 'retyped', path: 'variables.story', from: 'text', to: 'reference', filled: 1, lossless: true, label: 'Geschichte' },
      { kind: 'retyped', path: 'variables.blank', from: 'text', to: 'reference', filled: 0, lossless: true, label: 'Leer' },
    ];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'dog')).get()?.value).toBe('chiara');
    // „auto“ ist kein Referenzwert; der Resync rechnet nicht um, Maske und Export melden ihn (Spec § 4.7).
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'story')).get()?.value).toBe('auto');
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'blank')).get()?.value).toBe(null);
  });

  it('a lossy retype into reference clears to null, into references to an empty list', () => {
    const deps = createTestDeps();
    deps.db.insert(siteValues).values({ key: 'one', value: ['a', 'b'], updatedAt: 't' }).run();
    deps.db.insert(siteValues).values({ key: 'many', value: 'x', updatedAt: 't' }).run();
    const findings: Finding[] = [
      { kind: 'retyped', path: 'variables.one', from: 'list', to: 'reference', filled: 1, lossless: false, label: 'Eins' },
      { kind: 'retyped', path: 'variables.many', from: 'text', to: 'references', filled: 1, lossless: false, label: 'Viele' },
    ];
    deps.db.transaction((tx) => applyFindings(tx, deps, findings, schemaAfter()));
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'one')).get()?.value).toBe(null);
    expect(deps.db.select().from(siteValues).where(eq(siteValues.key, 'many')).get()?.value).toEqual([]);
  });
```

Speichert `setVariable` in `apply.ts` ein `null` als Löschung der Zeile (wie `setValues` es tut), ist die Erwartung für `blank` und `one` `toBeUndefined()` auf `.get()` statt `.value` `null`; lies `setVariable` in `apply.ts` und richte die Erwartung danach.

- [ ] **Step 2: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-site test -- resync`
Expected: FAIL (`lossless: false` für `text → reference`; `emptyOf('reference')` gibt `''`).

- [ ] **Step 3: Resync ändern**

In `plan.ts`:

```ts
const LOSSLESS: Record<string, string[]> = { text: ['list', 'markdown', 'reference'], number: ['text'], select: ['text'], markdown: ['text'] };
```

In `apply.ts` in `emptyOf`:

```ts
    case 'asset':
    case 'reference':
      return null;
    case 'list':
    case 'references':
      return [];
```

In `recast`:

```ts
  if (from === 'text' && to === 'reference') return value === undefined || value === null || value === '' ? null : value;
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test -- resync rename-roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/site/src/resync packages/modules/site/tests/resync-plan.test.ts packages/modules/site/tests/resync-apply.test.ts
git commit -m "feat(site): a text variable becomes a reference without losing its slug"
```

---

### Task 8: Auswahl in der Variablenmaske, Befund unter Prüfen

**Files:**
- Modify: `apps/kompass/src/components/schema-form/index.tsx` (`options`-Prop)
- Modify: `apps/kompass/src/components/schema-form/field.tsx` (`ReferenceField`, `ReferencesField`)
- Modify: `apps/kompass/src/app/(shell)/site/variables/page.tsx`, `variables-form.tsx`
- Modify: `apps/kompass/src/app/(shell)/site/publish/export-findings.tsx`, `check-card.tsx`, `preview-card.tsx`, `actions.ts`
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/tests/schema-form.test.ts` (Leerwerte), E2E in Task 9

**Interfaces:**
- Consumes: `listReferenceOptions` aus Task 5, `ReferenceOption` aus Task 3, `stale` aus Task 6.
- Produces: `SchemaFormProps.options?: Record<string, ReferenceOption[]>`; `FieldProps.options?: ReferenceOption[]`; `ExportFindings` nimmt `stale`.

- [ ] **Step 1: Leerwert-Test**

In `apps/kompass/tests/schema-form.test.ts` bei `blankFor` ergänzen:

```ts
  it('gives a reference null and a references list an empty array', () => {
    expect(blankFor({ widget: 'reference', view: 'animals', key: 'slug', labelField: 'name' })).toBe(null);
    expect(blankFor({ widget: 'references', view: 'projects', key: 'slug', labelField: 'name', maxItems: 2 })).toEqual([]);
  });
```

Run: `pnpm --filter @kompass/app test -- schema-form` — muss nach Task 2 bereits bestehen; er hält den Vertrag fest.

- [ ] **Step 2: Sprachdatei**

Unter `site.form` ergänzen:

```json
      "noChoice": "Keine Auswahl – das Template entscheidet",
      "slot": "Platz {n}",
      "staleReference": "„{value}“ steht nicht mehr zur Auswahl.",
      "clearReference": "Leeren"
```

Unter `site.publish.check` ergänzen:

```json
        "staleTitle": "Veraltete Verweise",
        "noStale": "Alle Verweise gültig.",
        "staleHint": "Wird im Export leer ausgeliefert; das Template zeigt dann seine Automatik."
```

Der Gedankenstrich in `noChoice` ist ein Halbgeviertstrich (`–`); `german-quotes.test.ts` prüft nur die Anführungszeichen.

- [ ] **Step 3: SchemaForm und Felder**

`index.tsx`: `SchemaFormProps` um `options?: Record<string, { value: string; label: string }[]>` erweitern, in `SchemaForm` destrukturieren und an `SchemaField` als `options={options?.[key]}` reichen.

`field.tsx`: `FieldProps` um `options?: { value: string; label: string }[]` erweitern. In `SchemaField` vor `const simple`:

```tsx
  if (widget === 'reference') return <ReferenceField {...props} />;
  if (widget === 'references') return <ReferencesField {...props} />;
```

Am Ende der Datei:

```tsx
function StaleNote({ value, onClear }: { value: string; onClear: () => void }) {
  const t = useTranslations('site.form');
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-[12px] text-warning">
      <span>{t('staleReference', { value })}</span>
      <button type="button" onClick={onClear} className="rounded-sm bg-badge px-2 py-0.5 text-[11px] text-badge-ink">{t('clearReference')}</button>
    </p>
  );
}

function ReferenceSelect({ id, name, value, options, stale, onChange }: { id: string; name: string; value: string; options: { value: string; label: string }[]; stale: boolean; onChange: (next: string) => void }) {
  const t = useTranslations('site.form');
  return (
    <Select id={id} name={name} value={stale ? '' : value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('noChoice')}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}

/** Ein Verweis auf einen Datensatz einer Sicht; die Optionen liefert die Seite. */
function ReferenceField({ path, field, value, errors, onChange, options = [] }: FieldProps) {
  const current = typeof value === 'string' ? value : '';
  const stale = current !== '' && !options.some((o) => o.value === current);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={path} className="text-[13px] font-semibold text-ink-2">{labelOf(field, path)}</label>
      <ReferenceSelect id={path} name={path} value={current} options={options} stale={stale} onChange={(next) => onChange(next === '' ? null : next)} />
      {stale ? <StaleNote value={current} onClear={() => onChange(null)} /> : null}
      <FieldError id={`${path}-error`} message={errors[path]} />
    </div>
  );
}

/** Feste Plätze in Reihenfolge; leere Plätze fallen aus dem Wert heraus. */
function ReferencesField({ path, field, value, errors, onChange, options = [] }: FieldProps) {
  const t = useTranslations('site.form');
  const max = typeof field.maxItems === 'number' ? field.maxItems : 1;
  const list = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  const slots = Array.from({ length: max }, (_, i) => list[i] ?? '');
  const set = (index: number, next: string) => {
    const copy = [...slots];
    copy[index] = next;
    onChange(copy.filter((v) => v !== ''));
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[13px] font-semibold text-ink-2">{labelOf(field, path)}</legend>
      {slots.map((current, index) => {
        const id = `${path}.${index}`;
        const stale = current !== '' && !options.some((o) => o.value === current);
        return (
          <div key={index} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-[11px] font-semibold text-muted-ink">{t('slot', { n: index + 1 })}</label>
            <ReferenceSelect id={id} name={id} value={current} options={options} stale={stale} onChange={(next) => set(index, next)} />
            {stale ? <StaleNote value={current} onClear={() => set(index, '')} /> : null}
          </div>
        );
      })}
      <FieldError id={`${path}-error`} message={errors[path]} />
    </fieldset>
  );
}
```

`Select` und `FieldError` sind in der Datei bereits importiert.

- [ ] **Step 4: Variablenseite**

`page.tsx`: `listReferenceOptions` aus `@kompass/module-site` importieren und nach `const template = activeTemplate(deps);`:

```ts
  const options = template ? await listReferenceOptions(deps, ctx) : null;
```

und `VariablesForm` das Prop `options={options?.ok ? options.value : {}}` geben. `variables-form.tsx`: Prop `options: Record<string, { value: string; label: string }[]>` aufnehmen und an `SchemaForm` durchreichen.

- [ ] **Step 5: Befundkarte**

`export-findings.tsx`: `Findings` um `stale: { path: string; value: string }[]` erweitern; nach der `gaps`-Disclosure:

```tsx
      <Disclosure label={t('staleTitle')} count={stale.length} tone={stale.length > 0 ? 'warning' : 'neutral'} defaultOpen={stale.length > 0} empty={t('noStale')}>
        <p className="text-[12px] text-muted-ink">{t('staleHint')}</p>
        <ul className="flex flex-col gap-1">
          {stale.map((s, i) => (
            <li key={i}>
              <span className="font-mono">{s.path}</span> · <span className="text-ink-2">{s.value}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
```

`check-card.tsx`: Typ `Check` um `stale` erweitern, `<ExportFindings … stale={check.stale} />`. `preview-card.tsx`: dasselbe für `data.stale` (der Typ dort um `stale` erweitern; `PreviewResult` liefert es seit Task 6). `publish/actions.ts`, `runCheckAction`: `stale: result.value.stale` in `data` aufnehmen.

- [ ] **Step 6: Typecheck und App-Tests**

Run: `pnpm typecheck && pnpm --filter @kompass/app test`
Expected: PASS, insbesondere `no-hardcoded-ui-text`, `message-keys`, `site-preview`.

- [ ] **Step 7: Commit**

```bash
git add apps/kompass/src/components/schema-form "apps/kompass/src/app/(shell)/site" apps/kompass/messages/de.json apps/kompass/tests/schema-form.test.ts
git commit -m "feat(site): reference variables are a choice in the mask, and stale ones show under checks"
```

---

### Task 9: Basis-Template mit Projekt-Teaser, E2E

**Files:**
- Modify: `templates/verein-basis/kompass.template.ts`
- Modify: `templates/verein-basis/fixtures/example/content.json` (Variable `featuredProject`)
- Modify: `templates/verein-basis/README.md` (ein Absatz)
- Test: `templates/verein-basis/tests/content-type.test.ts`, `apps/kompass/e2e/site-template.spec.ts`, `apps/kompass/e2e/site-publish.spec.ts`

- [ ] **Step 1: Typtest**

In `templates/verein-basis/tests/content-type.test.ts` ergänzen:

```ts
    expectTypeOf<SiteContent['variables']['featuredProject']>().toEqualTypeOf<string | null | undefined>();
```

Run: `pnpm --filter verein-basis test` — muss scheitern (`featuredProject` unbekannt).

- [ ] **Step 2: Deklaration**

In `templates/verein-basis/kompass.template.ts` den Import um `reference` erweitern, unter `variables` ergänzen:

```ts
    /**
     * Ein Datensatz aus einem Modul als Variable: Die Auswahl in Kompass zeigt
     * die veröffentlichten Projekte, gespeichert wird der Slug. Leer heißt: das
     * Template zeigt das erste Projekt nach Sortierung.
     */
    featuredProject: reference({ view: 'projects', label: 'Projekt auf der Startseite' }),
```

und nach `collections`:

```ts
  /** Die Projekte aus dem Projektmodul; ohne aktives Modul verweigert der Export. */
  uses: ['projects'],
```

In `fixtures/example/content.json` unter `variables` (die Datei beginnt mit `assets`; `variables` steht weiter unten) `"featuredProject": null` ergänzen. Baut das Basis-Template die Startseite aus `views.projects`? Prüfe `grep -rn "projects" templates/verein-basis/src`. Tut es das nicht, bleibt der Astro-Code unverändert: Die Variable ist deklariert und pflegbar, gerendert wird sie erst, wenn das Template Projekte zeigt. Schreibe das als Satz in `README.md` unter die Beschreibung der Variablen.

Run: `pnpm --filter verein-basis test && pnpm --filter verein-basis typecheck`
Expected: PASS.

- [ ] **Step 3: E2E der Maske**

In `apps/kompass/e2e/site-template.spec.ts` einen Test anhängen. Der Seed veröffentlicht das Projekt „Winterhilfe für Streuner" (Slug `winterhilfe`); die Projektliste hat je Zeile einen Schalter (siehe `projects.spec.ts`, Zeile mit `getByRole('switch')`).

```ts
test('a reference variable is a choice, and a withdrawn record shows as stale until cleared', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);

  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  const choice = page.getByLabel('Projekt auf der Startseite');
  await expect(choice.locator('option')).toContainText(['Keine Auswahl', 'Winterhilfe für Streuner']);
  await choice.selectOption('winterhilfe');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Projekt auf der Startseite')).toHaveValue('winterhilfe');

  await page.goto('/projects');
  const row = page.getByRole('row', { name: /Winterhilfe/ });
  await row.getByRole('switch').click();
  await expect(row).not.toContainText('Veröffentlicht');

  await page.goto('/site/variables');
  await expect(page.getByText('„winterhilfe“ steht nicht mehr zur Auswahl.')).toBeVisible();
  await page.getByRole('button', { name: 'Leeren' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Projekt auf der Startseite')).toHaveValue('');
});
```

Passe die Zeilenerwartung nach dem Klick auf den Schalter dem an, was `projects.spec.ts` für den umgekehrten Fall prüft (dort `toContainText('Veröffentlicht')`); wenn die Zeile im zurückgezogenen Zustand „Entwurf" zeigt, prüfe darauf.

- [ ] **Step 4: E2E des Befunds**

In `apps/kompass/e2e/site-publish.spec.ts` einen Test anhängen:

```ts
test('the check reports a stale reference as a warning, not as a block', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/site/template');
  await page.getByRole('button', { name: 'Template einlesen' }).click();
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByRole('status')).toContainText('eingelesen');

  await page.goto('/site/variables');
  await page.getByLabel('Projekt auf der Startseite').selectOption('winterhilfe');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/projects');
  await page.getByRole('row', { name: /Winterhilfe/ }).getByRole('switch').click();

  await page.goto('/site/publish');
  await page.getByRole('button', { name: 'Prüfen' }).click();
  const stale = page.getByRole('region', { name: 'Veraltete Verweise' });
  await expect(stale).toContainText('variables.featuredProject');
  await expect(stale).toContainText('winterhilfe');
  await expect(page.getByRole('region', { name: 'Sperrworttreffer' })).toContainText('Keine Treffer');
});
```

Run: `pnpm --filter @kompass/app e2e -- site-template.spec site-publish.spec`
Expected: PASS. Der `Disclosure`-Baustein muss die Region mit ihrem Label benennen; prüfe in `apps/kompass/src/components/ui/disclosure.tsx`, dass `role="region"` und `aria-label` gesetzt sind (die bestehenden Tests finden „Sperrworttreffer" so).

- [ ] **Step 5: Voller Prüflauf**

Run: `pnpm verify`
Expected: alle drei Ringe grün (Typecheck, Tests, E2E kalt, Image-Build, E2E gegen den Container). Das Image liefert das Basis-Template mit; `uses: ['projects']` verlangt das aktive Projektmodul, das der Seed einschaltet.

- [ ] **Step 6: Commit**

```bash
git add templates/verein-basis apps/kompass/e2e/site-template.spec.ts apps/kompass/e2e/site-publish.spec.ts
git commit -m "feat(verein-basis): a project teaser shows how a template references a record"
```

---

### Task 10: Dokumentation

**Files:**
- Modify: `docs/superpowers/specs/2026-09-07-site-template-design.md` (§ 2)
- Modify: `docs/backlog.md` (Abschnitt `## 17.` entfernen)
- Modify: `docs/nordstern.md` (Schritt 2)

- [ ] **Step 1: Site-Template-Spec**

In § 2 den Satz `Die Helfer (\`text\`, \`markdown\`, \`number\`, \`asset\`, \`select\`, \`list\`) erzeugen …` um `reference`, `references` erweitern und danach einen Absatz einfügen:

```markdown
`reference({ view, where?, key?, labelField? })` und `references({ …, max })`
verweisen auf Datensätze einer veröffentlichten Sicht (Kern oder Modul aus
`uses`). Gespeichert wird `key` (Vorgabe `slug`), gezeigt `labelField`
(Vorgabe `name`); `where` kennt Gleichheit und `{ present: true }`. Leer
heißt: das Template entscheidet. Ein Wert, der die Bedingung nicht mehr
erfüllt, wird beim Export `null` und als Befund gemeldet. Design und
Begründung: `2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md`.
```

- [ ] **Step 2: Backlog und Nordstern**

`docs/backlog.md`: Abschnitt `## 17.` löschen. `docs/nordstern.md`, Schritt 2, als weiteren Punkt: `- Erledigt am <Datum>: Referenzfelder in der Deklaration; Startseitenplätze sind Template-Variablen mit Auswahl, nicht Kennzeichen am Tier.` — Datum ist der Tag, an dem Plan 3 fertig wurde.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-07-site-template-design.md docs/backlog.md docs/nordstern.md
git commit -m "docs(site): reference fields in the template contract, and backlog 17 is built"
```

---

## Selbstprüfung gegen die Spec

- § 3 Helfer, Metadaten, Prüfung in `defineTemplate`: Task 1. Prüfung gegen die Registry beim Einlesen: Task 3 (`checkReferenceFields`) und Task 4.
- § 4.1 Schema-Ableitung: Task 2. § 4.2 Auflösung: Task 3. § 4.3 Maske: Task 8. § 4.4 Dienst: Task 5. § 4.5 Einlesen: Task 4. § 4.6 Export mit `stale`, Befundkarte, Job-Protokoll: Tasks 6 und 8. § 4.7 Resync: Task 7. § 4.8 MCP `site_variables_options`: Task 5.
- § 5 Basis-Template mit Projekt-Teaser: Task 9. Aluna-Template: Plan 4.
- § 9 Tests: je Task; Playwright in Task 9.
- § 10 Backlog 17, Nordstern, Site-Template-Spec: Task 10.
