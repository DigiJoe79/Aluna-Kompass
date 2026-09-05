# Webseite Teil 1: Module und Markdown — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Fachlogik der Stufe 2 bauen: zweisprachiger Texttyp und Migrationskette für Module im Kern, das Markdown-Paket mit den drei Konventionen, das Webseiten-Modul (Seiten, Artikel, Team, FAQ, Downloads, Projekte, Site-Fakten, Sichten, Export mit Sperrwort- und Übersetzungsprüfung) und das Tiermodul in der Minimalstufe — alles testgetrieben, ohne Oberfläche und ohne Astro (Teil 2 und Teil 3).

**Architecture:** Module sind Pakete unter `packages/modules/*`, die per `defineModule` ein Manifest liefern (Rechte, Settings, Navigation, Sichten, MCP-Tools) und ihre Drizzle-Tabellen in einer eigenen `schema.ts` definieren. drizzle-kit im Kern liest Kern- und Modul-Schemas zusammen und erzeugt eine lineare Migrationskette; Tabellen existieren unabhängig vom Modulschalter. Services folgen dem Kern-Muster `fn(deps, ctx, input) → Promise<Result<T>>` mit Rechteprüfung, Zod, Transaktion und Audit. Veröffentlichte Sichten sind reine Lesefunktionen mit Zod-Strip. `packages/markdown` rendert Markdown zu sanitisiertem HTML und ist der einzige Renderer für Vorschau und Build.

**Tech Stack:** wie Fundament (TypeScript 6, Drizzle 0.45, Zod 4, Vitest 5) · unified 11, remark-parse 11, remark-gfm 4, remark-directive 4, remark-rehype 11, rehype-sanitize 6, rehype-stringify 10, unist-util-visit 5.

**Spec:** `docs/superpowers/specs/2026-09-05-webseite-design.md` — Abschnitte 2 (Inhaltsmodell), 3 (Pakete, Rechte, Markdown-Paket, Export/Prüfung, MCP-Tools). Build, Diff, Publish und die Site folgen in `webseite-3-site-und-publish`; die Oberfläche in `webseite-2-oberflaeche`.

**Voraussetzung:** Fundament (Pläne 1–3) umgesetzt; `pnpm test` grün.

## Global Constraints

- Alle Regeln aus `AGENTS.md` (Code Englisch, kein Löschen von Rechenschaftsdaten, ein Weg zu den Daten, TDD). Inhalte werden nie gelöscht, sondern auf „nicht veröffentlicht" gesetzt; Ausnahme: Fotos eines Hundes dürfen aus der Zuordnung entfernt werden (das Asset bleibt).
- **Zweisprachig:** Jedes übersetzbare Feld ist `LocalizedText = { de: string; en: string }`; `de` ist Pflicht, wo das Feld Pflicht ist; `en` darf leer sein. Fehlende `en` ⇒ Fallback auf `de` mit Markierung, nie stillschweigend.
- **Sperrwortliste** (`website.blockedTerms`) ist Daten; der Hilfetext im Code nennt nie den Namen. Prüfung läuft über alle Textfelder aller Sprachen und über Dateinamen, case-insensitiv.
- **Modulregeln:** Tabellen mit Präfix `website_`, Tiermodul `animals`/`animal_*`; Fremdschlüssel nur in Richtung Kern (`media_assets`, `users`), nie zwischen `website_*` und `animals`. `projects` liegt im Kern.
- **Slugs:** `^[a-z0-9][a-z0-9-]{0,80}$`, sprachneutral, eindeutig je Tabelle.
- **Migrationen:** eine Kette in `packages/core/src/db/migrations`; drizzle-kit liest `./src/db/schema.ts` und `../modules/*/src/schema.ts`. Erzeugte SQL-Dateien werden committet und nie nachträglich editiert.
- **Versionen** (Stand 2026-09-05): `unified ^11.0.5`, `remark-parse ^11.0.0`, `remark-gfm ^4.0.1`, `remark-directive ^4.0.0`, `remark-rehype ^11.1.2`, `rehype-sanitize ^6.0.0`, `rehype-stringify ^10.0.1`, `unist-util-visit ^5.1.0`, `mdast-util-to-string ^4.0.0`.

---

## Dateistruktur (Ergebnis dieses Plans)

```
packages/core/src/i18n/localized.ts          LOCALES, LocalizedText, localizedText(), resolveText, translationGaps
packages/core/src/db/schema.ts               + projects
packages/core/drizzle.config.ts              schema-Glob für Module
packages/core/src/projects/service.ts        Projekte (öffentliche Felder)
packages/markdown/
  package.json  src/index.ts  src/render.ts  src/directives.ts  src/sanitize.ts  tests/render.test.ts
packages/modules/website/
  package.json  src/index.ts  src/manifest.ts  src/schema.ts  src/settings.ts  src/page-keys.ts
  src/services/pages.ts  articles.ts  team.ts  faqs.ts  downloads.ts
  src/views.ts  src/blocked-terms.ts  src/export.ts  src/mcp-tools.ts
  tests/*.test.ts
packages/modules/animals/
  package.json  src/index.ts  src/manifest.ts  src/schema.ts  src/service.ts  src/views.ts  src/mcp-tools.ts
  tests/*.test.ts
apps/kompass/src/modules.ts                  installierte Module → createDeps
```

---

### Task 1: Zweisprachiger Texttyp im Kern

**Files:**
- Create: `packages/core/src/i18n/localized.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/localized.test.ts`

**Interfaces:**
- Produces:
  - `LOCALES = ['de', 'en'] as const`, `type Locale`, `DEFAULT_LOCALE = 'de'`.
  - `interface LocalizedText { de: string; en: string }`.
  - `localizedText(opts?: { required?: boolean; max?: number }) → z.ZodType<LocalizedText>` (trimmt; `required` ⇒ `de` min 1; `en` immer optional, fehlend ⇒ `''`).
  - `resolveText(text, locale) → { value: string; fallback: Locale | null }`.
  - `translationGaps(record: Record<string, unknown>, fields: string[]) → string[]` — Felder, deren `en` leer ist, obwohl `de` gefüllt.
  - `emptyLocalized() → { de: '', en: '' }`.

- [ ] **Step 1: Test schreiben**

`packages/core/tests/localized.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { emptyLocalized, LOCALES, localizedText, resolveText, translationGaps } from '../src/i18n/localized';

describe('localized text', () => {
  it('defines de and en with de as default', () => {
    expect(LOCALES).toEqual(['de', 'en']);
  });

  it('parses, trims and fills missing en with an empty string', () => {
    const schema = localizedText({ required: true, max: 20 });
    expect(schema.parse({ de: ' Hallo ', en: ' Hello ' })).toEqual({ de: 'Hallo', en: 'Hello' });
    expect(schema.parse({ de: 'Hallo' })).toEqual({ de: 'Hallo', en: '' });
    expect(schema.safeParse({ de: '', en: 'x' }).success).toBe(false);
    expect(schema.safeParse({ de: 'x'.repeat(21), en: '' }).success).toBe(false);
    expect(localizedText().safeParse({ de: '', en: '' }).success).toBe(true);
  });

  it('resolves with fallback marker', () => {
    expect(resolveText({ de: 'Hund', en: 'Dog' }, 'en')).toEqual({ value: 'Dog', fallback: null });
    expect(resolveText({ de: 'Hund', en: '' }, 'en')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({ de: 'Hund', en: '' }, 'de')).toEqual({ value: 'Hund', fallback: null });
  });

  it('lists fields whose en is missing while de is filled', () => {
    const record = { title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' }, other: 5 };
    expect(translationGaps(record, ['title', 'lede', 'body'])).toEqual(['title']);
    expect(emptyLocalized()).toEqual({ de: '', en: '' });
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/localized.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Implementieren**

`packages/core/src/i18n/localized.ts`:
```ts
import { z } from 'zod';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

export interface LocalizedText {
  de: string;
  en: string;
}

export function localizedText(opts: { required?: boolean; max?: number } = {}): z.ZodType<LocalizedText> {
  const max = opts.max ?? 20_000;
  const de = opts.required ? z.string().trim().min(1).max(max) : z.string().trim().max(max).default('');
  const en = z.string().trim().max(max).default('');
  return z.object({ de, en }) as unknown as z.ZodType<LocalizedText>;
}

export const emptyLocalized = (): LocalizedText => ({ de: '', en: '' });

export function resolveText(text: LocalizedText, locale: Locale): { value: string; fallback: Locale | null } {
  const value = text[locale];
  if (value && value.length > 0) return { value, fallback: null };
  return { value: text[DEFAULT_LOCALE], fallback: locale === DEFAULT_LOCALE ? null : DEFAULT_LOCALE };
}

const isLocalized = (v: unknown): v is LocalizedText => typeof v === 'object' && v !== null && 'de' in v && 'en' in v;

export function translationGaps(record: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => {
    const value = record[field];
    return isLocalized(value) && value.de.length > 0 && value.en.length === 0;
  });
}
```
In `packages/core/src/index.ts`: `export * from './i18n/localized';`.

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): localized text type with fallback resolution and gap detection"
```

---

### Task 2: Projekte im Kern und Migrationskette für Module

**Files:**
- Modify: `packages/core/src/db/schema.ts` (`projects`), `packages/core/drizzle.config.ts` (Schema-Glob), `packages/core/src/index.ts`
- Create: `packages/core/src/projects/service.ts`
- Generated: `packages/core/src/db/migrations/0002_projects.sql`
- Test: `packages/core/tests/projects.test.ts`, `packages/core/tests/db.test.ts` (Tabellenliste)

**Interfaces:**
- Produces:
  - Tabelle `projects`: `id, slug (unique), name (LocalizedText JSON), type ('ongoing'|'shortTerm'), status ('active'|'completed'), summary (L), body (L, Markdown), imageAssetId (→ media_assets, nullable), betterplaceProjectId (text, ''), isPublished, sortOrder, createdAt, updatedAt`.
  - `interface ProjectRecord` (= `$inferSelect` mit typisierten L-Feldern).
  - `createProject(deps, ctx, input) → Result<ProjectRecord>`, `updateProject(deps, ctx, { id, ...fields })`, `setProjectPublished(deps, ctx, { id, isPublished })`, `reorderProjects(deps, ctx, { ids })`, `listProjects(deps, ctx)`, `getProject(deps, ctx, id)` — Rechte: `website.manage` zum Schreiben, `website.view` zum Lesen (die Keys registriert Task 4; die Services verlangen sie per String).
  - Codes: `slugTaken` (conflict).

- [ ] **Step 1: Tests schreiben**

`packages/core/tests/projects.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema';
import { createProject, getProject, listProjects, reorderProjects, setProjectPublished, updateProject } from '../src/projects/service';
import { unwrap } from '../src/result';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const manage = () => ctxWith(['website.manage', 'website.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung des Shelters', en: '' }, type: 'ongoing', summary: { de: 'Futter und Wärme', en: 'Food and warmth' }, body: { de: 'Text', en: '' }, betterplaceProjectId: '000001' };

describe('projects service', () => {
  it('creates a project unpublished with audit and sort order at the end', async () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'USER-TEST' });
    const a = unwrap(await createProject(deps, manage(), base));
    const b = unwrap(await createProject(deps, manage(), { ...base, slug: 'op-fonds', type: 'shortTerm' }));
    expect(a).toMatchObject({ slug: 'grundversorgung', isPublished: false, sortOrder: 1, status: 'active', name: { de: 'Grundversorgung des Shelters', en: '' } });
    expect(b.sortOrder).toBe(2);
    expect(deps.db.select().from(auditLog).all().at(-1)).toMatchObject({ action: 'projects.create', entityType: 'project', entityId: b.id });
  });

  it('rejects duplicate and invalid slugs, missing permission', async () => {
    const deps = createTestDeps();
    unwrap(await createProject(deps, manage(), base));
    const dup = await createProject(deps, manage(), base);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    const bad = await createProject(deps, manage(), { ...base, slug: 'Grund Versorgung' });
    expect(bad.ok === false && bad.error.type === 'validation').toBe(true);
    const denied = await createProject(deps, ctxWith(['website.view']), { ...base, slug: 'x' });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('updates fields, toggles publication and reorders', async () => {
    const deps = createTestDeps();
    const a = unwrap(await createProject(deps, manage(), base));
    const b = unwrap(await createProject(deps, manage(), { ...base, slug: 'b' }));
    const updated = unwrap(await updateProject(deps, manage(), { id: a.id, name: { de: 'Neu', en: 'New' }, status: 'completed' }));
    expect(updated).toMatchObject({ name: { de: 'Neu', en: 'New' }, status: 'completed', slug: 'grundversorgung' });
    expect(unwrap(await setProjectPublished(deps, manage(), { id: a.id, isPublished: true })).isPublished).toBe(true);
    unwrap(await reorderProjects(deps, manage(), { ids: [b.id, a.id] }));
    expect(unwrap(await listProjects(deps, ctxWith(['website.view']))).map((p) => p.slug)).toEqual(['b', 'grundversorgung']);
    expect(unwrap(await getProject(deps, ctxWith(['website.view']), a.id)).sortOrder).toBe(2);
    expect((await listProjects(deps, ctxWith([]))).ok).toBe(false);
  });
});
```

In `packages/core/tests/db.test.ts` die erwartete Tabellenliste um `'projects'` ergänzen (alphabetisch zwischen `media_assets` und `role_permissions`).

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/projects.test.ts tests/db.test.ts`
Expected: FAIL.

- [ ] **Step 3: Schema, Migration, drizzle-Glob**

In `packages/core/src/db/schema.ts` ergänzen:
```ts
import type { LocalizedText } from '../i18n/localized';

const localized = (name: string) => text(name, { mode: 'json' }).$type<LocalizedText>().notNull();

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: localized('name'),
    type: text('type', { enum: ['ongoing', 'shortTerm'] }).notNull(),
    status: text('status', { enum: ['active', 'completed'] }).notNull().default('active'),
    summary: localized('summary'),
    body: localized('body'),
    imageAssetId: text('image_asset_id').references(() => mediaAssets.id),
    betterplaceProjectId: text('betterplace_project_id').notNull().default(''),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('projects_sort_idx').on(t.sortOrder)],
);
```
(`localized` als exportierten Helfer `localizedColumn` in `packages/core/src/db/columns.ts` ablegen, damit die Module ihn wiederverwenden: `export const localizedColumn = (name: string) => text(name, { mode: 'json' }).$type<LocalizedText>().notNull();`.)

`packages/core/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', '../modules/*/src/schema.ts'],
  out: './src/db/migrations',
});
```

Run: `pnpm --filter @kompass/core db:generate --name projects`
Expected: `0002_projects.sql` mit `CREATE TABLE projects` und Index.

- [ ] **Step 4: Service**

`packages/core/src/projects/service.ts`:
```ts
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { mediaAssets, projects } from '../db/schema';
import type { Deps } from '../deps';
import { localizedText } from '../i18n/localized';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { validate } from '../validate';

export type ProjectRecord = typeof projects.$inferSelect;

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

const projectFields = {
  slug: z.string().regex(SLUG),
  name: localizedText({ required: true, max: 120 }),
  type: z.enum(['ongoing', 'shortTerm']),
  status: z.enum(['active', 'completed']).default('active'),
  summary: localizedText({ max: 400 }),
  body: localizedText({ max: 20_000 }),
  imageAssetId: z.string().nullable().default(null),
  betterplaceProjectId: z.string().trim().max(40).default(''),
};
const createSchema = z.object(projectFields);
const updateSchema = z.object({ id: z.string().min(1), ...Object.fromEntries(Object.entries(projectFields).map(([k, v]) => [k, v.optional()])) });

function load(db: DbOrTx, id: string): ProjectRecord | null {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

function slugTaken(db: DbOrTx, slug: string, exceptId?: string): boolean {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get();
  return !!row && row.id !== exceptId;
}

function assetExists(db: DbOrTx, id: string | null): boolean {
  return id === null || !!db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.id, id)).get();
}

export async function createProject(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (slugTaken(deps.db, v.slug)) return conflict('slugTaken', `Slug ${v.slug} ist bereits vergeben`);
  if (!assetExists(deps.db, v.imageAssetId)) return notFound('mediaAsset', v.imageAssetId ?? '');
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    const max = tx.select({ n: sql<number>`coalesce(max(${projects.sortOrder}), 0)` }).from(projects).get()?.n ?? 0;
    tx.insert(projects).values({ id, ...v, sortOrder: max + 1, isPublished: false, createdAt: now, updatedAt: now }).run();
    const record = load(tx, id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: 'projects.create', entityType: 'project', entityId: id, after: record, summary: `Projekt ${v.slug} angelegt` });
    return ok(record);
  });
}

export async function updateProject(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value as { id: string } & Partial<z.infer<typeof createSchema>>;
  const before = load(deps.db, id);
  if (!before) return notFound('project', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  if (changes.imageAssetId !== undefined && !assetExists(deps.db, changes.imageAssetId)) return notFound('mediaAsset', changes.imageAssetId ?? '');
  return deps.db.transaction((tx) => {
    tx.update(projects).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(projects.id, id)).run();
    const after = load(tx, id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: 'projects.update', entityType: 'project', entityId: id, before, after, summary: `Projekt ${after.slug} geändert` });
    return ok(after);
  });
}

const publishSchema = z.object({ id: z.string().min(1), isPublished: z.boolean() });

export async function setProjectPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(publishSchema, input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('project', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(projects).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(projects.id, before.id)).run();
    const after = load(tx, before.id) as ProjectRecord;
    recordAudit(tx, deps, ctx, { action: parsed.value.isPublished ? 'projects.publish' : 'projects.unpublish', entityType: 'project', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `Projekt ${after.slug} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1) });

export async function reorderProjects(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(reorderSchema, input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(projects).set({ sortOrder: index + 1 }).where(eq(projects.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'projects.reorder', entityType: 'project', entityId: null, after: parsed.value.ids, summary: 'Projektreihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listProjects(deps: Deps, ctx: CallContext): Promise<Result<ProjectRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(projects).orderBy(asc(projects.sortOrder)).all());
}

export async function getProject(deps: Deps, ctx: CallContext, id: string): Promise<Result<ProjectRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('project', id);
}
```
In `index.ts`: `export * from './projects/service'; export { localizedColumn } from './db/columns';`.

Hinweis zur Typisierung von `updateSchema`: `Object.fromEntries` verliert die Typen; beim Umsetzen die optionalen Felder explizit ausschreiben (`slug: projectFields.slug.optional(), …`), damit `parsed.value` korrekt typisiert ist und der `as`-Cast entfällt.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test && pnpm --filter @kompass/core typecheck`
Expected: grün (auch `db.test.ts` mit `projects` in der Liste).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): projects with public fields, localized columns and module-aware migration config"
```

---

### Task 3: Markdown-Paket mit drei Konventionen

**Files:**
- Create: `packages/markdown/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/render.ts`, `src/directives.ts`, `src/sanitize.ts`
- Test: `packages/markdown/tests/render.test.ts`

**Interfaces:**
- Produces: `renderMarkdown(markdown: string): Promise<string>` — HTML-String, sanitisiert. Konventionen: (1) `*Wort*` in Überschriften ⇒ `<em>` bleibt (Betonung; Template stylt `h1 em, h2 em`); (2) Zitatblock `>` ⇒ `<aside class="note">…</aside>`; (3) `:::karten` … `:::` mit `### Titel` je Karte ⇒ `<div class="cards"><article class="card"><h3>…</h3>…</article>…</div>`. Rohes HTML wird entfernt; Links bekommen `rel="noopener"` bei externen Zielen. `renderMarkdownSync` gibt es nicht (unified ist async-fähig; Aufrufer awaiten).

- [ ] **Step 1: Test schreiben**

`packages/markdown/tests/render.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src';

describe('renderMarkdown', () => {
  it('renders paragraphs, headings with emphasis, lists and links', async () => {
    const html = await renderMarkdown('# Jeder Hund verdient ein *Zuhause.*\n\nErster Absatz mit **fett**.\n\n- eins\n- zwei\n\n[Satzung](/satzung/) und [extern](https://hundeblicke.net)');
    expect(html).toContain('<h1>Jeder Hund verdient ein <em>Zuhause.</em></h1>');
    expect(html).toContain('<strong>fett</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<a href="/satzung/">Satzung</a>');
    expect(html).toContain('<a href="https://hundeblicke.net" rel="noopener">extern</a>');
  });

  it('turns blockquotes into note boxes', async () => {
    const html = await renderMarkdown('> Für den Auslandstierschutz ist eine Erlaubnis nötig.');
    expect(html).toContain('<aside class="note"><p>Für den Auslandstierschutz ist eine Erlaubnis nötig.</p></aside>');
    expect(html).not.toContain('<blockquote>');
  });

  it('turns :::karten containers into a card grid', async () => {
    const md = ':::karten\n### Schritt 1\nMelde dich bei uns.\n\n### Schritt 2\nSelbstauskunft ausfüllen.\n:::';
    const html = await renderMarkdown(md);
    expect(html).toContain('<div class="cards">');
    expect((html.match(/<article class="card">/g) ?? []).length).toBe(2);
    expect(html).toContain('<h3>Schritt 1</h3>');
    expect(html).toContain('<p>Selbstauskunft ausfüllen.</p>');
  });

  it('strips raw html and scripts but keeps text', async () => {
    const html = await renderMarkdown('Hallo <script>alert(1)</script><img src=x onerror=alert(1)> <b>fett</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(html).toContain('Hallo');
  });

  it('is deterministic and handles empty input', async () => {
    expect(await renderMarkdown('')).toBe('');
    const a = await renderMarkdown('Text');
    expect(await renderMarkdown('Text')).toBe(a);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

`packages/markdown/package.json`:
```json
{
  "name": "@kompass/markdown",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "hast-util-sanitize": "^5.0.2",
    "rehype-sanitize": "^6.0.0",
    "rehype-stringify": "^10.0.1",
    "remark-directive": "^4.0.0",
    "remark-gfm": "^4.0.1",
    "remark-parse": "^11.0.0",
    "remark-rehype": "^11.1.2",
    "unified": "^11.0.5",
    "unist-util-visit": "^5.1.0"
  },
  "devDependencies": { "@types/node": "^26.4.1", "typescript": "^6.0.3", "vitest": "^5.0.0" }
}
```
`tsconfig.json`/`vitest.config.ts` wie in `packages/core`. Run: `pnpm install && pnpm --filter @kompass/markdown test`
Expected: FAIL — `../src` fehlt.

- [ ] **Step 3: Implementieren**

`packages/markdown/src/directives.ts`:
```ts
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * remark-Plugin: `:::karten` → Kartenraster; jede `###`-Überschrift eröffnet eine Karte.
 * Blockquotes → Hinweiskasten. Beides über hast-Daten, damit rehype die Elemente setzt.
 */
export function kompassConventions() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (node.type === 'containerDirective' && node.name === 'karten') {
        const cards: { type: 'card'; children: unknown[] }[] = [];
        for (const child of node.children) {
          if (child.type === 'heading' && child.depth === 3) cards.push({ type: 'card', children: [child] });
          else if (cards.length > 0) cards[cards.length - 1]!.children.push(child);
        }
        node.data = { hName: 'div', hProperties: { className: ['cards'] } };
        node.children = cards.map((card) => ({
          type: 'containerDirective',
          name: 'card',
          data: { hName: 'article', hProperties: { className: ['card'] } },
          children: card.children,
        })) as typeof node.children;
      }
      if (node.type === 'blockquote') {
        node.data = { hName: 'aside', hProperties: { className: ['note'] } };
      }
    });
  };
}
```

`packages/markdown/src/sanitize.ts`:
```ts
import { defaultSchema, type Schema } from 'hast-util-sanitize';

export const schema: Schema = {
  ...defaultSchema,
  tagNames: ['h1', 'h2', 'h3', 'h4', 'p', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'br', 'hr', 'aside', 'div', 'article', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'del'],
  attributes: {
    a: ['href', 'rel'],
    aside: ['className'],
    div: ['className'],
    article: ['className'],
    th: ['align'],
    td: ['align'],
  },
  protocols: { href: ['http', 'https', 'mailto', 'tel'] },
  clobberPrefix: '',
  strip: ['script', 'style', 'img', 'iframe'],
};
```

`packages/markdown/src/render.ts`:
```ts
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root as HastRoot, Element } from 'hast';
import { kompassConventions } from './directives';
import { schema } from './sanitize';

function externalLinks() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string' && /^https?:\/\//.test(node.properties.href)) {
        node.properties.rel = 'noopener';
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(kompassConventions)
  .use(remarkRehype)
  .use(externalLinks)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string): Promise<string> {
  if (markdown.trim().length === 0) return '';
  const file = await processor.process(markdown);
  return String(file).trim();
}
```
`packages/markdown/src/index.ts`: `export { renderMarkdown } from './render';`. Typen `mdast`/`hast` kommen als `@types/mdast`, `@types/hast` (devDependencies ergänzen: `"@types/hast": "^3.0.4"`, `"@types/mdast": "^4.0.4"`).

Hinweis: `rehype-sanitize` läuft **nach** `externalLinks`, deshalb muss `rel` in `attributes.a` erlaubt sein (ist es). Klassen für `aside/div/article` sind explizit freigegeben; alles andere entfernt der Sanitizer, inklusive `img` (Bilder kommen aus den strukturierten Feldern, nie aus Markdown).

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/markdown test && pnpm --filter @kompass/markdown typecheck`
Expected: grün. Wenn `<p>` innerhalb `aside` anders verschachtelt ist als erwartet, den Test-String an die tatsächliche (korrekte) Ausgabe angleichen — entscheidend ist `aside.note` statt `blockquote`.

- [ ] **Step 5: Commit**

```bash
git add packages/markdown pnpm-lock.yaml
git commit -m "feat(markdown): shared renderer with emphasis, note and card conventions"
```

---

### Task 4: Webseiten-Modul — Paket, Manifest, Schema, Site-Fakten

**Files:**
- Create: `packages/modules/website/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/manifest.ts`, `src/schema.ts`, `src/settings.ts`, `src/page-keys.ts`
- Generated: `packages/core/src/db/migrations/0003_website.sql`
- Test: `packages/modules/website/tests/manifest.test.ts`

**Interfaces:**
- Produces:
  - `WEBSITE_PAGE_KEYS = ['home', 'help', 'donate', 'sponsor', 'membership', 'about', 'partners', 'contact', 'imprint', 'privacy', 'statutes', 'adoption-process'] as const`; `WEBSITE_DOWNLOAD_KEYS = ['sponsorship-form', 'membership-form', 'self-disclosure-form', 'statutes-pdf'] as const`.
  - `WEBSITE_PERMISSIONS = ['website.view', 'website.manage', 'website.publish']`.
  - Settings `website.claim` (L), `website.forwardingPercent` (number 0–100, Default 97.2), `website.shelterDogCount` (int ≥ 0, Default 0), `website.donationBoxLocations` (string[]), `website.section11Status` (`pending`|`granted`, Default `pending`), `website.section11Date` (ISO-Datum oder ''), `website.socialLinks` (`{ label, href }[]`), `website.betterplaceMetaProjectId` (string), `website.betterplaceDefaultAmount` (int, Default 50), `website.blockedTerms` (string[]), `website.featuredAnimalSlug` (`'auto'` | slug), `website.featuredStorySlug` (`'auto'` | slug).
  - Tabellen `website_pages` (`key` PK, `title`, `lede`, `body`, `metaDescription` (alle L), `blocks` JSON, `updatedAt`), `website_articles` (`id, slug unique, title, lede, body (L), publishedAt, sortOrder, isPublished, createdAt, updatedAt`), `website_team` (`id, name, position (L), photoAssetId, petPhotoAssetId, sortOrder, isPublished, createdAt, updatedAt`), `website_faqs` (`id, category (L), question (L), answer (L), sortOrder, isPublished, createdAt, updatedAt`), `website_downloads` (`key` PK, `title` (L), `assetId` nullable, `updatedAt`), `website_publishes` (`id, environment, startedAt, finishedAt, status ('success'|'failed'|'aborted'), contentHash, pagesChanged, pagesAdded, pagesRemoved, summary, triggeredByUserId, log`).
  - `interface PageBlock { id: string; title: LocalizedText; text: LocalizedText; imageAssetId: string | null; href: string; label: LocalizedText }`; `pageBlockSchema`.
  - `websiteModule: ModuleManifest` (Sichten und MCP-Tools werden in Task 6/8 ergänzt).

- [ ] **Step 1: Test schreiben**

`packages/modules/website/tests/manifest.test.ts`:
```ts
import { coreModule, createRegistry, readSetting } from '@kompass/core';
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { WEBSITE_PAGE_KEYS, websiteModule } from '../src';

describe('website module manifest', () => {
  it('registers permissions, settings and navigation without clashing with core', () => {
    const registry = createRegistry([coreModule, websiteModule]);
    expect([...registry.permissionKeys]).toEqual(expect.arrayContaining(['website.view', 'website.manage', 'website.publish']));
    expect(registry.settingDefinitions.get('website.forwardingPercent')?.default).toBe(97.2);
    expect(registry.settingDefinitions.get('website.blockedTerms')?.default).toEqual([]);
    expect(websiteModule.navigation?.map((n) => n.key)).toEqual(['website.pages', 'website.articles', 'website.team', 'website.faqs', 'website.projects', 'website.downloads', 'website.facts', 'website.publish']);
  });

  it('creates its tables through the core migration chain', () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    const tables = (deps.sqlite.prepare("select name from sqlite_master where type='table' and name like 'website_%' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['website_articles', 'website_downloads', 'website_faqs', 'website_pages', 'website_publishes', 'website_team']);
    expect(readSetting(deps, 'website.section11Status')).toBe('pending');
    expect(WEBSITE_PAGE_KEYS).toHaveLength(12);
  });

  it('validates settings values', () => {
    const registry = createRegistry([coreModule, websiteModule]);
    expect(registry.settingDefinitions.get('website.forwardingPercent')!.schema.safeParse(101).success).toBe(false);
    expect(registry.settingDefinitions.get('website.socialLinks')!.schema.safeParse([{ label: 'Instagram', href: 'https://instagram.com/aluna' }]).success).toBe(true);
    expect(registry.settingDefinitions.get('website.socialLinks')!.schema.safeParse([{ label: 'x', href: 'javascript:alert(1)' }]).success).toBe(false);
    expect(registry.settingDefinitions.get('website.featuredAnimalSlug')!.schema.safeParse('auto').success).toBe(true);
  });
});
```

- [ ] **Step 2: Paket anlegen, Test ausführen, Fehlschlag prüfen**

`packages/modules/website/package.json`:
```json
{
  "name": "@kompass/module-website",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@kompass/core": "workspace:*", "@kompass/markdown": "workspace:*", "drizzle-orm": "^0.45.2", "zod": "^4.5.4" },
  "devDependencies": { "@types/node": "^26.4.1", "typescript": "^6.0.3", "vitest": "^5.0.0" }
}
```
`tsconfig.json`/`vitest.config.ts` wie in `packages/core`. Run: `pnpm install && pnpm --filter @kompass/module-website test`
Expected: FAIL.

- [ ] **Step 3: Schema und Konstanten**

`packages/modules/website/src/page-keys.ts`:
```ts
export const WEBSITE_PAGE_KEYS = ['home', 'help', 'donate', 'sponsor', 'membership', 'about', 'partners', 'contact', 'imprint', 'privacy', 'statutes', 'adoption-process'] as const;
export type WebsitePageKey = (typeof WEBSITE_PAGE_KEYS)[number];

export const WEBSITE_DOWNLOAD_KEYS = ['sponsorship-form', 'membership-form', 'self-disclosure-form', 'statutes-pdf'] as const;
export type WebsiteDownloadKey = (typeof WEBSITE_DOWNLOAD_KEYS)[number];

export const WEBSITE_PERMISSIONS = ['website.view', 'website.manage', 'website.publish'] as const;
```

`packages/modules/website/src/schema.ts`:
```ts
import { localizedColumn, schema as core, type LocalizedText } from '@kompass/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export interface PageBlock {
  id: string;
  title: LocalizedText;
  text: LocalizedText;
  imageAssetId: string | null;
  href: string;
  label: LocalizedText;
}

export const websitePages = sqliteTable('website_pages', {
  key: text('key').primaryKey(),
  title: localizedColumn('title'),
  lede: localizedColumn('lede'),
  body: localizedColumn('body'),
  metaDescription: localizedColumn('meta_description'),
  blocks: text('blocks', { mode: 'json' }).$type<PageBlock[]>().notNull().default([]),
  updatedAt: text('updated_at').notNull(),
});

export const websiteArticles = sqliteTable(
  'website_articles',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    title: localizedColumn('title'),
    lede: localizedColumn('lede'),
    body: localizedColumn('body'),
    publishedAt: text('published_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('website_articles_sort_idx').on(t.sortOrder)],
);

export const websiteTeam = sqliteTable('website_team', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: localizedColumn('position'),
  photoAssetId: text('photo_asset_id').references(() => core.mediaAssets.id),
  petPhotoAssetId: text('pet_photo_asset_id').references(() => core.mediaAssets.id),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const websiteFaqs = sqliteTable('website_faqs', {
  id: text('id').primaryKey(),
  category: localizedColumn('category'),
  question: localizedColumn('question'),
  answer: localizedColumn('answer'),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const websiteDownloads = sqliteTable('website_downloads', {
  key: text('key').primaryKey(),
  title: localizedColumn('title'),
  assetId: text('asset_id').references(() => core.mediaAssets.id),
  updatedAt: text('updated_at').notNull(),
});

export const websitePublishes = sqliteTable('website_publishes', {
  id: text('id').primaryKey(),
  environment: text('environment').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['success', 'failed', 'aborted'] }).notNull(),
  contentHash: text('content_hash').notNull().default(''),
  pagesChanged: integer('pages_changed').notNull().default(0),
  pagesAdded: integer('pages_added').notNull().default(0),
  pagesRemoved: integer('pages_removed').notNull().default(0),
  summary: text('summary').notNull().default(''),
  triggeredByUserId: text('triggered_by_user_id').references(() => core.users.id),
  log: text('log').notNull().default(''),
});
```
Hinweis: `schema as core` — der Kern exportiert `export * as schema from './db/schema'`; die Modul-Tabellen referenzieren Kern-Tabellen darüber.

Run: `pnpm --filter @kompass/core db:generate --name website`
Expected: `0003_website.sql` mit sechs `CREATE TABLE website_*`.

- [ ] **Step 4: Settings und Manifest**

`packages/modules/website/src/settings.ts`:
```ts
import { localizedText, type SettingDefinition } from '@kompass/core';
import { z } from 'zod';

const slugOrAuto = z.union([z.literal('auto'), z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/)]);
const httpUrl = z.url().refine((u) => /^https?:\/\//.test(u), 'httpOnly');

export const WEBSITE_SETTINGS: SettingDefinition[] = [
  { key: 'website.claim', schema: localizedText({ max: 120 }), default: { de: '', en: '' } },
  { key: 'website.forwardingPercent', schema: z.number().min(0).max(100), default: 97.2 },
  { key: 'website.shelterDogCount', schema: z.number().int().min(0), default: 0 },
  { key: 'website.donationBoxLocations', schema: z.array(z.string().trim().min(1).max(80)).max(20), default: [] },
  { key: 'website.section11Status', schema: z.enum(['pending', 'granted']), default: 'pending' },
  { key: 'website.section11Date', schema: z.union([z.literal(''), z.iso.date()]), default: '' },
  { key: 'website.socialLinks', schema: z.array(z.object({ label: z.string().trim().min(1).max(40), href: httpUrl })).max(10), default: [] },
  { key: 'website.betterplaceMetaProjectId', schema: z.string().trim().max(40), default: '' },
  { key: 'website.betterplaceDefaultAmount', schema: z.number().int().min(1).max(10_000), default: 50 },
  { key: 'website.blockedTerms', schema: z.array(z.string().trim().min(2).max(80)).max(50), default: [] },
  { key: 'website.featuredAnimalSlug', schema: slugOrAuto, default: 'auto' },
  { key: 'website.featuredStorySlug', schema: slugOrAuto, default: 'auto' },
];
```

`packages/modules/website/src/manifest.ts`:
```ts
import { defineModule, type ModuleManifest } from '@kompass/core';
import { WEBSITE_PERMISSIONS } from './page-keys';
import { WEBSITE_SETTINGS } from './settings';

const nav = (key: string, href: string, icon: string, permission: string) => ({ key: `website.${key}`, href, icon, group: 'website', permission });

export const websiteModule: ModuleManifest = defineModule({
  key: 'website',
  version: '0.1.0',
  permissions: WEBSITE_PERMISSIONS,
  settings: WEBSITE_SETTINGS,
  navigation: [
    nav('pages', '/website/pages', 'file-text', 'website.view'),
    nav('articles', '/website/articles', 'newspaper', 'website.view'),
    nav('team', '/website/team', 'users', 'website.view'),
    nav('faqs', '/website/faqs', 'help-circle', 'website.view'),
    nav('projects', '/website/projects', 'folder', 'website.view'),
    nav('downloads', '/website/downloads', 'download', 'website.view'),
    nav('facts', '/website/facts', 'sliders', 'website.manage'),
    nav('publish', '/website/publish', 'upload', 'website.publish'),
  ],
});
```
`src/index.ts`: `export * from './page-keys'; export * from './schema'; export * from './settings'; export { websiteModule } from './manifest';`.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/module-website test && pnpm --filter @kompass/module-website typecheck && pnpm --filter @kompass/core test`
Expected: grün (Kern-Tests bleiben grün; `db.test.ts` listet nur Kern-Tabellen, weil es `website_%` nicht erwartet — falls der Test alle Tabellen auflistet, die sechs `website_*`-Tabellen dort ergänzen).

- [ ] **Step 6: Commit**

```bash
git add packages/modules/website packages/core pnpm-lock.yaml
git commit -m "feat(website): module manifest, schema, site-fact settings and migration"
```

---

### Task 5: Webseiten-Modul — Services für Seiten, Artikel, Team, FAQ, Downloads

**Files:**
- Create: `packages/modules/website/src/services/pages.ts`, `articles.ts`, `team.ts`, `faqs.ts`, `downloads.ts`, `src/services/common.ts`
- Modify: `src/index.ts`
- Test: `packages/modules/website/tests/pages.test.ts`, `tests/lists.test.ts`

**Interfaces:**
- Produces (alle `website.manage` zum Schreiben, `website.view` zum Lesen; jede Änderung mit Audit `website.<entity>.<action>`):
  - Seiten: `ensurePages(deps) → void` (legt fehlende Schlüssel mit leeren Texten an, ohne Audit — Systemschritt beim ersten `listPages`), `listPages(deps, ctx) → Result<PageRecord[]>`, `getPage(deps, ctx, key) → Result<PageRecord>`, `updatePage(deps, ctx, { key, title?, lede?, body?, metaDescription?, blocks? }) → Result<PageRecord>`.
  - Artikel: `createArticle(deps, ctx, { slug, title, lede, body, publishedAt? })`, `updateArticle(deps, ctx, { id, … })`, `setArticlePublished(deps, ctx, { id, isPublished })`, `reorderArticles(deps, ctx, { ids })`, `listArticles(deps, ctx)`, `getArticle(deps, ctx, id)`.
  - Team: `createTeamMember(deps, ctx, { name, position, photoAssetId?, petPhotoAssetId? })`, `updateTeamMember`, `setTeamMemberPublished`, `reorderTeam`, `listTeam`.
  - FAQ: `createFaq(deps, ctx, { category, question, answer })`, `updateFaq`, `setFaqPublished`, `reorderFaqs`, `listFaqs`.
  - Downloads: `listDownloads(deps, ctx)`, `setDownload(deps, ctx, { key, title, assetId })` — Asset muss `application/pdf` sein (Code `downloadNotPdf`).
  - Gemeinsam (`common.ts`): `SLUG`, `withTimestamps`, `nextSortOrder(tx, table)`, `assertAsset(db, id, mimePrefix?)`, `reorder(tx, table, ids)`.

- [ ] **Step 1: Tests schreiben**

`packages/modules/website/tests/pages.test.ts`:
```ts
import { coreModule, schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getPage, listPages, updatePage, WEBSITE_PAGE_KEYS, websiteModule } from '../src';

const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view']);

describe('pages', () => {
  it('materialises all declared page keys on first list, empty and without audit noise', async () => {
    const d = deps();
    const pages = unwrap(await listPages(d, ctxWith(['website.view'])));
    expect(pages.map((p) => p.key)).toEqual([...WEBSITE_PAGE_KEYS]);
    expect(pages[0]).toMatchObject({ title: { de: '', en: '' }, blocks: [] });
    expect(d.db.select().from(schema.auditLog).all()).toHaveLength(0);
  });

  it('updates texts and blocks with validation and audit', async () => {
    const d = deps();
    const updated = unwrap(await updatePage(d, manage, {
      key: 'help',
      title: { de: 'Es gibt viele Wege, ein Leben zu *verändern.*', en: 'Many ways to *change* a life.' },
      lede: { de: 'Ob Spende oder Patenschaft.', en: '' },
      blocks: [{ id: 'donate', title: { de: 'Spenden', en: 'Donate' }, text: { de: 'Schon kleine Beträge helfen.', en: '' }, imageAssetId: null, href: '/spenden/', label: { de: 'Jetzt spenden', en: 'Donate now' } }],
    }));
    expect(updated.blocks).toHaveLength(1);
    expect(unwrap(await getPage(d, ctxWith(['website.view']), 'help')).title.en).toBe('Many ways to *change* a life.');
    const entry = d.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry).toMatchObject({ action: 'website.pages.update', entityType: 'websitePage', entityId: 'help' });
    const unknown = await updatePage(d, manage, { key: 'nope', title: { de: 'x', en: '' } });
    expect(unknown.ok === false && unknown.error.type === 'notFound').toBe(true);
    const badBlock = await updatePage(d, manage, { key: 'help', blocks: [{ id: 'x', title: { de: 'T', en: '' }, text: { de: '', en: '' }, imageAssetId: 'missing', href: '/x/', label: { de: 'L', en: '' } }] });
    expect(badBlock.ok === false && badBlock.error.type === 'notFound').toBe(true);
    expect((await updatePage(d, ctxWith(['website.view']), { key: 'help', lede: { de: 'x', en: '' } })).ok).toBe(false);
  });
});
```

`packages/modules/website/tests/lists.test.ts`:
```ts
import { coreModule, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createArticle, createFaq, createTeamMember, listArticles, listDownloads, listFaqs, listTeam, reorderArticles, setArticlePublished, setDownload, updateArticle, updateTeamMember, websiteModule } from '../src';

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'media.upload']);

describe('articles', () => {
  it('creates unpublished, updates, publishes, reorders, never deletes', async () => {
    const d = deps();
    const a = unwrap(await createArticle(d, manage, { slug: 'ablauf-der-adoption', title: { de: 'Ablauf der Adoption', en: '' }, lede: { de: 'L', en: '' }, body: { de: '# Schritt 1', en: '' } }));
    const b = unwrap(await createArticle(d, manage, { slug: 'transport', title: { de: 'Transport', en: 'Transport' }, lede: { de: '', en: '' }, body: { de: 'x', en: 'x' } }));
    expect(a).toMatchObject({ isPublished: false, sortOrder: 1, publishedAt: null });
    expect(unwrap(await updateArticle(d, manage, { id: a.id, publishedAt: '2026-09-05' })).publishedAt).toBe('2026-09-05');
    expect(unwrap(await setArticlePublished(d, manage, { id: a.id, isPublished: true })).isPublished).toBe(true);
    unwrap(await reorderArticles(d, manage, { ids: [b.id, a.id] }));
    expect(unwrap(await listArticles(d, ctxWith(['website.view']))).map((x) => x.slug)).toEqual(['transport', 'ablauf-der-adoption']);
    const dup = await createArticle(d, manage, { slug: 'transport', title: { de: 'T', en: '' }, lede: { de: '', en: '' }, body: { de: '', en: '' } });
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    expect(d.db.select().from(schema.auditLog).all().map((e) => e.action)).toEqual(['website.articles.create', 'website.articles.create', 'website.articles.update', 'website.articles.publish', 'website.articles.reorder']);
  });
});

describe('team and faqs', () => {
  it('manages team members with photo assets and faqs with categories', async () => {
    const d = deps();
    const photo = unwrap(await storeMediaAsset(d, manage, { originalName: 'nicole.png', bytes: PNG }));
    const m = unwrap(await createTeamMember(d, manage, { name: 'Nicole Wießner', position: { de: 'Erste Vorsitzende & Fundraising', en: 'Chairwoman & Fundraising' }, photoAssetId: photo.id }));
    expect(m.photoAssetId).toBe(photo.id);
    const missing = await updateTeamMember(d, manage, { id: m.id, petPhotoAssetId: 'nope' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
    expect(unwrap(await listTeam(d, ctxWith(['website.view'])))).toHaveLength(1);
    const f = unwrap(await createFaq(d, manage, { category: { de: 'Spenden', en: 'Donations' }, question: { de: 'Wohin geht meine Spende?', en: '' }, answer: { de: '97,2 % …', en: '' } }));
    expect(f.isPublished).toBe(false);
    expect(unwrap(await listFaqs(d, ctxWith(['website.view'])))[0]?.category.de).toBe('Spenden');
  });
});

describe('downloads', () => {
  it('lists all declared keys and accepts only PDF assets', async () => {
    const d = deps();
    expect(unwrap(await listDownloads(d, ctxWith(['website.view']))).map((x) => x.key)).toEqual(['sponsorship-form', 'membership-form', 'self-disclosure-form', 'statutes-pdf']);
    const pdf = unwrap(await storeMediaAsset(d, manage, { originalName: 'antrag.pdf', bytes: PDF, declaredMimeType: 'application/pdf' }));
    const png = unwrap(await storeMediaAsset(d, manage, { originalName: 'x.png', bytes: PNG }));
    expect(unwrap(await setDownload(d, manage, { key: 'sponsorship-form', title: { de: 'Patenschaftsantrag', en: 'Sponsorship form' }, assetId: pdf.id })).assetId).toBe(pdf.id);
    const wrong = await setDownload(d, manage, { key: 'sponsorship-form', title: { de: 'x', en: '' }, assetId: png.id });
    expect(wrong.ok === false && wrong.error.type === 'validation' && wrong.error.issues[0]?.message === 'downloadNotPdf').toBe(true);
  });
});
```
Hinweis: Der Mini-PDF-Puffer beginnt mit `%PDF-`, damit `file-type` ihn als PDF erkennt.

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website test`
Expected: FAIL.

- [ ] **Step 3: Gemeinsame Helfer**

`packages/modules/website/src/services/common.ts`:
```ts
import { schema as core, type DbOrTx } from '@kompass/core';
import { eq, sql, type SQLiteTable } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function nextSortOrder(db: DbOrTx, table: SQLiteTable, column: SQLiteColumn): number {
  const row = db.select({ n: sql<number>`coalesce(max(${column}), 0)` }).from(table).get();
  return (row?.n ?? 0) + 1;
}

export function reorderRows(tx: DbOrTx, table: SQLiteTable, idColumn: SQLiteColumn, sortColumn: SQLiteColumn, ids: string[]): void {
  ids.forEach((id, index) => tx.update(table).set({ [sortColumn.name]: index + 1 } as Record<string, number>).where(eq(idColumn, id)).run());
}

export function assetMime(db: DbOrTx, id: string | null | undefined): string | null | undefined {
  if (id === null || id === undefined) return id;
  return db.select({ mime: core.mediaAssets.mimeType }).from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get()?.mime ?? null;
}
```
Hinweis: `SQLiteTable` kommt aus `drizzle-orm/sqlite-core`, nicht aus `drizzle-orm` — Import beim Umsetzen entsprechend setzen. `set({ [sortColumn.name]: … })` verwendet den TypeScript-Property-Namen; da alle Sortierspalten `sortOrder` heißen, ist `set({ sortOrder: index + 1 })` mit einem Typ-Cast auf die konkrete Tabelle die einfachere Form — beim Umsetzen je Service direkt `tx.update(websiteArticles).set({ sortOrder })` schreiben und `reorderRows` nur als Muster nutzen, wenn die generische Typisierung Ärger macht.

- [ ] **Step 4: Seiten-Service**

`packages/modules/website/src/services/pages.ts`:
```ts
import { isoNow, localizedText, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { WEBSITE_PAGE_KEYS } from '../page-keys';
import { websitePages, type PageBlock } from '../schema';
import { assetMime } from './common';

export type PageRecord = typeof websitePages.$inferSelect;

export const pageBlockSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  title: localizedText({ max: 120 }),
  text: localizedText({ max: 1000 }),
  imageAssetId: z.string().nullable().default(null),
  href: z.string().max(300).default(''),
  label: localizedText({ max: 60 }),
});

export function ensurePages(deps: Deps): void {
  const existing = new Set(deps.db.select({ key: websitePages.key }).from(websitePages).all().map((r) => r.key));
  const empty = { de: '', en: '' };
  const now = isoNow(deps.clock);
  for (const key of WEBSITE_PAGE_KEYS) {
    if (!existing.has(key)) deps.db.insert(websitePages).values({ key, title: empty, lede: empty, body: empty, metaDescription: empty, blocks: [], updatedAt: now }).run();
  }
}

export async function listPages(deps: Deps, ctx: CallContext): Promise<Result<PageRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensurePages(deps);
  const rows = deps.db.select().from(websitePages).all();
  const order = new Map(WEBSITE_PAGE_KEYS.map((k, i) => [k, i]));
  return ok(rows.sort((a, b) => (order.get(a.key as never) ?? 99) - (order.get(b.key as never) ?? 99)));
}

export async function getPage(deps: Deps, ctx: CallContext, key: string): Promise<Result<PageRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensurePages(deps);
  const row = deps.db.select().from(websitePages).where(eq(websitePages.key, key)).get();
  return row ? ok(row) : notFound('websitePage', key);
}

const updateSchema = z.object({
  key: z.enum(WEBSITE_PAGE_KEYS),
  title: localizedText({ max: 160 }).optional(),
  lede: localizedText({ max: 600 }).optional(),
  body: localizedText({ max: 40_000 }).optional(),
  metaDescription: localizedText({ max: 200 }).optional(),
  blocks: z.array(pageBlockSchema).max(12).optional(),
});

export async function updatePage(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PageRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) {
    // unbekannter key ⇒ notFound statt validation, damit die UI 404 zeigen kann
    const key = (input as { key?: unknown })?.key;
    if (typeof key === 'string' && !(WEBSITE_PAGE_KEYS as readonly string[]).includes(key)) return notFound('websitePage', key);
    return parsed;
  }
  ensurePages(deps);
  const { key, ...changes } = parsed.value;
  for (const block of changes.blocks ?? []) {
    if (block.imageAssetId && assetMime(deps.db, block.imageAssetId) === null) return notFound('mediaAsset', block.imageAssetId);
  }
  const before = deps.db.select().from(websitePages).where(eq(websitePages.key, key)).get()!;
  return deps.db.transaction((tx) => {
    tx.update(websitePages).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websitePages.key, key)).run();
    const after = tx.select().from(websitePages).where(eq(websitePages.key, key)).get()!;
    recordAudit(tx, deps, ctx, { action: 'website.pages.update', entityType: 'websitePage', entityId: key, before, after, summary: `Seite ${key} geändert` });
    return ok(after);
  });
}

export type { PageBlock };
```

- [ ] **Step 5: Listen-Services**

`packages/modules/website/src/services/articles.ts`:
```ts
import { conflict, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { websiteArticles } from '../schema';
import { nextSortOrder, SLUG } from './common';

export type ArticleRecord = typeof websiteArticles.$inferSelect;

const fields = {
  slug: z.string().regex(SLUG),
  title: localizedText({ required: true, max: 160 }),
  lede: localizedText({ max: 600 }),
  body: localizedText({ max: 40_000 }),
  publishedAt: z.union([z.null(), z.iso.date()]).default(null),
};
const createSchema = z.object(fields);
const updateSchema = z.object({ id: z.string().min(1), slug: fields.slug.optional(), title: fields.title.optional(), lede: fields.lede.optional(), body: fields.body.optional(), publishedAt: fields.publishedAt.optional() });

const load = (db: Deps['db'], id: string) => db.select().from(websiteArticles).where(eq(websiteArticles.id, id)).get() ?? null;
const slugTaken = (db: Deps['db'], slug: string, exceptId?: string) => { const r = db.select({ id: websiteArticles.id }).from(websiteArticles).where(eq(websiteArticles.slug, slug)).get(); return !!r && r.id !== exceptId; };

export async function createArticle(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  if (slugTaken(deps.db, parsed.value.slug)) return conflict('slugTaken', `Slug ${parsed.value.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(websiteArticles).values({ id, ...parsed.value, sortOrder: nextSortOrder(tx, websiteArticles, websiteArticles.sortOrder), isPublished: false, createdAt: now, updatedAt: now }).run();
    const record = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.articles.create', entityType: 'websiteArticle', entityId: id, after: record, summary: `Artikel ${record.slug} angelegt` });
    return ok(record);
  });
}

export async function updateArticle(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('websiteArticle', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(websiteArticles).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(websiteArticles.id, id)).run();
    const after = load(tx as Deps['db'], id)!;
    recordAudit(tx, deps, ctx, { action: 'website.articles.update', entityType: 'websiteArticle', entityId: id, before, after, summary: `Artikel ${after.slug} geändert` });
    return ok(after);
  });
}

export async function setArticlePublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = load(deps.db, parsed.value.id);
  if (!before) return notFound('websiteArticle', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(websiteArticles).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(websiteArticles.id, before.id)).run();
    const after = load(tx as Deps['db'], before.id)!;
    recordAudit(tx, deps, ctx, { action: parsed.value.isPublished ? 'website.articles.publish' : 'website.articles.unpublish', entityType: 'websiteArticle', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `Artikel ${after.slug} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

export async function reorderArticles(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<void>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ ids: z.array(z.string().min(1)).min(1) }), input);
  if (!parsed.ok) return parsed;
  return deps.db.transaction((tx) => {
    parsed.value.ids.forEach((id, index) => tx.update(websiteArticles).set({ sortOrder: index + 1 }).where(eq(websiteArticles.id, id)).run());
    recordAudit(tx, deps, ctx, { action: 'website.articles.reorder', entityType: 'websiteArticle', entityId: null, after: parsed.value.ids, summary: 'Artikelreihenfolge geändert' });
    return ok(undefined);
  });
}

export async function listArticles(deps: Deps, ctx: CallContext): Promise<Result<ArticleRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  return ok(deps.db.select().from(websiteArticles).orderBy(asc(websiteArticles.sortOrder)).all());
}

export async function getArticle(deps: Deps, ctx: CallContext, id: string): Promise<Result<ArticleRecord>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  const record = load(deps.db, id);
  return record ? ok(record) : notFound('websiteArticle', id);
}
```

`packages/modules/website/src/services/team.ts` — gleiches Muster mit `websiteTeam`, Aktionen `website.team.create|update|publish|unpublish|reorder`, Felder `name: z.string().trim().min(1).max(120)`, `position: localizedText({ required: true, max: 120 })`, `photoAssetId`/`petPhotoAssetId: z.string().nullable().default(null)`; vor dem Schreiben `assetMime(db, id)` prüfen: `null` ⇒ `notFound('mediaAsset', id)`, Wert ohne Präfix `image/` ⇒ `invalid([{ path: 'photoAssetId', message: 'notAnImage' }])`. Exporte: `createTeamMember`, `updateTeamMember`, `setTeamMemberPublished`, `reorderTeam`, `listTeam`, `getTeamMember`, `TeamMemberRecord`.

`packages/modules/website/src/services/faqs.ts` — gleiches Muster mit `websiteFaqs`, Aktionen `website.faqs.*`, Felder `category: localizedText({ required: true, max: 60 })`, `question: localizedText({ required: true, max: 200 })`, `answer: localizedText({ required: true, max: 2000 })`. Exporte: `createFaq`, `updateFaq`, `setFaqPublished`, `reorderFaqs`, `listFaqs`, `getFaq`, `FaqRecord`.

`packages/modules/website/src/services/downloads.ts`:
```ts
import { invalid, isoNow, localizedText, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { WEBSITE_DOWNLOAD_KEYS } from '../page-keys';
import { websiteDownloads } from '../schema';
import { assetMime } from './common';

export type DownloadRecord = typeof websiteDownloads.$inferSelect;

function ensureDownloads(deps: Deps): void {
  const existing = new Set(deps.db.select({ key: websiteDownloads.key }).from(websiteDownloads).all().map((r) => r.key));
  for (const key of WEBSITE_DOWNLOAD_KEYS) {
    if (!existing.has(key)) deps.db.insert(websiteDownloads).values({ key, title: { de: '', en: '' }, assetId: null, updatedAt: isoNow(deps.clock) }).run();
  }
}

export async function listDownloads(deps: Deps, ctx: CallContext): Promise<Result<DownloadRecord[]>> {
  const denied = requirePermission(ctx, 'website.view');
  if (denied) return denied;
  ensureDownloads(deps);
  const rows = deps.db.select().from(websiteDownloads).all();
  const order = new Map(WEBSITE_DOWNLOAD_KEYS.map((k, i) => [k, i]));
  return ok(rows.sort((a, b) => (order.get(a.key as never) ?? 99) - (order.get(b.key as never) ?? 99)));
}

const setSchema = z.object({ key: z.enum(WEBSITE_DOWNLOAD_KEYS), title: localizedText({ required: true, max: 120 }), assetId: z.string().min(1).nullable() });

export async function setDownload(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DownloadRecord>> {
  const denied = requirePermission(ctx, 'website.manage');
  if (denied) return denied;
  const parsed = validate(setSchema, input);
  if (!parsed.ok) return parsed;
  ensureDownloads(deps);
  const { key, title, assetId } = parsed.value;
  if (assetId) {
    const mime = assetMime(deps.db, assetId);
    if (mime === null) return notFound('mediaAsset', assetId);
    if (mime !== 'application/pdf') return invalid([{ path: 'assetId', message: 'downloadNotPdf' }]);
  }
  const before = deps.db.select().from(websiteDownloads).where(eq(websiteDownloads.key, key)).get()!;
  return deps.db.transaction((tx) => {
    tx.update(websiteDownloads).set({ title, assetId, updatedAt: isoNow(deps.clock) }).where(eq(websiteDownloads.key, key)).run();
    const after = tx.select().from(websiteDownloads).where(eq(websiteDownloads.key, key)).get()!;
    recordAudit(tx, deps, ctx, { action: 'website.downloads.set', entityType: 'websiteDownload', entityId: key, before, after, summary: `Download ${key} gesetzt` });
    return ok(after);
  });
}
```
`src/index.ts` um `export * from './services/pages'; … './services/downloads';` ergänzen.

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/module-website test && pnpm --filter @kompass/module-website typecheck`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/website
git commit -m "feat(website): page, article, team, faq and download services with audit"
```

---

### Task 6: Veröffentlichte Sichten, Sperrwortprüfung, Übersetzungslücken, Export

**Files:**
- Create: `packages/modules/website/src/views.ts`, `src/blocked-terms.ts`, `src/translation-gaps.ts`, `src/export.ts`
- Modify: `src/manifest.ts` (`publishedViews`), `src/index.ts`
- Test: `packages/modules/website/tests/views.test.ts`, `tests/blocked-terms.test.ts`, `tests/export.test.ts`

**Interfaces:**
- Produces:
  - Sichten (`definePublishedView`): `publishedSiteFacts` (ein Datensatz: alle `website.*`-Fakten plus `organization` mit `name, street, postalCode, city, email, phone, iban, bic, bankName, registerCourt, registerNumber`), `publishedPages` (`key, title, lede, body, metaDescription, blocks`), `publishedArticles` (`slug, title, lede, body, publishedAt, sortOrder`, nur veröffentlichte), `publishedTeam` (`name, position, photoAssetId, petPhotoAssetId, sortOrder`), `publishedFaqs` (`category, question, answer, sortOrder`), `publishedProjects` (`slug, name, type, status, summary, body, imageAssetId, betterplaceProjectId, sortOrder`), `publishedDownloads` (`key, title, assetId`, nur mit Asset).
  - `findBlockedTerms(content: unknown, terms: string[], filenames?: string[]) → BlockedTermHit[]` mit `{ path: string; term: string; excerpt: string }`.
  - `collectTranslationGaps(content: Record<string, unknown[]>) → TranslationGap[]` mit `{ collection: string; id: string; field: string }` (id = `key` oder `slug` oder `id`).
  - `exportSiteContent(deps, ctx, { jobDir }) → Promise<Result<SiteExport>>` mit `SiteExport = { contentHash: string; contentPath: string; assets: ExportedAsset[]; gaps: TranslationGap[]; violations: BlockedTermHit[] }`; `ExportedAsset = { id; filename; mimeType; width; height }`. Schreibt `content.json` (kanonisch sortiert) und `assets/<filename>`; sammelt alle Sichten aller aktiven Module generisch (auch `animals`). Recht `website.publish`.

- [ ] **Step 1: Tests schreiben**

`packages/modules/website/tests/blocked-terms.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { collectTranslationGaps, findBlockedTerms } from '../src';

describe('findBlockedTerms', () => {
  it('finds terms case-insensitively in nested values and filenames with a path', () => {
    const content = { pages: [{ key: 'partners', body: { de: 'Der Shelter von Maria Popescu.', en: '' } }], team: [{ name: 'Nicole' }] };
    const hits = findBlockedTerms(content, ['maria popescu', 'geheim'], ['foto-Maria-Popescu-1.jpg', 'hund.jpg']);
    expect(hits).toEqual([
      { path: 'pages[0].body.de', term: 'maria popescu', excerpt: expect.stringContaining('Maria Popescu') },
      { path: 'files/foto-Maria-Popescu-1.jpg', term: 'maria popescu', excerpt: 'foto-Maria-Popescu-1.jpg' },
    ]);
    expect(findBlockedTerms(content, [])).toEqual([]);
  });
});

describe('collectTranslationGaps', () => {
  it('reports localized fields with de but no en, identified by key/slug/id', () => {
    const content = {
      pages: [{ key: 'help', title: { de: 'Helfen', en: '' }, lede: { de: 'x', en: 'y' } }],
      articles: [{ slug: 'transport', body: { de: 'x', en: '' }, title: { de: '', en: '' } }],
      team: [{ id: 'T1', position: { de: 'Vorsitz', en: '' }, name: 'N' }],
    };
    expect(collectTranslationGaps(content)).toEqual([
      { collection: 'pages', id: 'help', field: 'title' },
      { collection: 'articles', id: 'transport', field: 'body' },
      { collection: 'team', id: 'T1', field: 'position' },
    ]);
  });
});
```

`packages/modules/website/tests/views.test.ts`:
```ts
import { coreModule, createProject, setProjectPublished, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createArticle, publishedArticles, publishedPages, publishedProjects, publishedSiteFacts, setArticlePublished, updatePage, websiteModule } from '../src';

const deps = () => { const d = createTestDeps({ manifests: [coreModule, websiteModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'settings.manage']);

describe('published views', () => {
  it('expose only published records and only declared fields', async () => {
    const d = deps();
    const a = unwrap(await createArticle(d, manage, { slug: 'a', title: { de: 'A', en: '' }, lede: { de: '', en: '' }, body: { de: 'x', en: '' } }));
    unwrap(await createArticle(d, manage, { slug: 'b', title: { de: 'B', en: '' }, lede: { de: '', en: '' }, body: { de: 'x', en: '' } }));
    unwrap(await setArticlePublished(d, manage, { id: a.id, isPublished: true }));
    const rows = publishedArticles.load(d);
    expect(rows.map((r) => r.slug)).toEqual(['a']);
    expect(Object.keys(rows[0]!).sort()).toEqual(['body', 'lede', 'publishedAt', 'slug', 'sortOrder', 'title']);
  });

  it('pages view lists all declared pages; projects only published; facts merge settings and organization', async () => {
    const d = deps();
    unwrap(await updatePage(d, manage, { key: 'about', title: { de: 'Über uns', en: 'About' } }));
    expect(publishedPages.load(d).find((p) => p.key === 'about')?.title.en).toBe('About');
    const p = unwrap(await createProject(d, manage, { slug: 'p', name: { de: 'P', en: '' }, type: 'ongoing', summary: { de: '', en: '' }, body: { de: '', en: '' } }));
    expect(publishedProjects.load(d)).toEqual([]);
    unwrap(await setProjectPublished(d, manage, { id: p.id, isPublished: true }));
    expect(publishedProjects.load(d).map((x) => x.slug)).toEqual(['p']);
    unwrap(await setSetting(d, manage, { key: 'website.shelterDogCount', value: 150 }));
    unwrap(await setSetting(d, manage, { key: 'organization.name', value: 'Aluna Tierhilfe e.V.' }));
    const facts = publishedSiteFacts.load(d)[0]!;
    expect(facts).toMatchObject({ shelterDogCount: 150, forwardingPercent: 97.2, organization: { name: 'Aluna Tierhilfe e.V.' } });
    expect('blockedTerms' in facts).toBe(false);
  });
});
```

`packages/modules/website/tests/export.test.ts`:
```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, setSetting, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createTeamMember, exportSiteContent, setTeamMemberPublished, updatePage, websiteModule } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const job = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-site-')); dirs.push(d); return d; };
const manage = ctxWith(['website.manage', 'website.view', 'website.publish', 'settings.manage', 'media.upload']);

describe('exportSiteContent', () => {
  it('writes canonical content.json with all published views, copies referenced assets and hashes deterministically', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const photo = unwrap(await storeMediaAsset(deps, manage, { originalName: 'nicole.png', bytes: PNG }));
    const m = unwrap(await createTeamMember(deps, manage, { name: 'Nicole', position: { de: 'Vorsitz', en: '' }, photoAssetId: photo.id }));
    unwrap(await setTeamMemberPublished(deps, manage, { id: m.id, isPublished: true }));
    const a = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    const b = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    expect(a.contentHash).toBe(b.contentHash);
    const content = JSON.parse(readFileSync(a.contentPath, 'utf8'));
    expect(Object.keys(content).sort()).toEqual(['articles', 'assets', 'downloads', 'facts', 'faqs', 'pages', 'projects', 'team']);
    expect(content.team[0].photoAssetId).toBe(photo.id);
    expect(a.assets.map((x) => x.id)).toEqual([photo.id]);
    expect(readFileSync(path.join(path.dirname(a.contentPath), 'assets', photo.filename)).byteLength).toBe(PNG.byteLength);
    expect(a.gaps).toEqual([{ collection: 'team', id: m.id, field: 'position' }]);
    expect(a.violations).toEqual([]);
  });

  it('reports blocked terms from settings and requires website.publish', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setSetting(deps, manage, { key: 'website.blockedTerms', value: ['Popescu'] }));
    unwrap(await updatePage(deps, manage, { key: 'partners', body: { de: 'Frau Popescu betreibt den Shelter.', en: '' } }));
    const result = unwrap(await exportSiteContent(deps, manage, { jobDir: job() }));
    expect(result.violations).toEqual([{ path: 'pages[?].body.de', term: 'popescu', excerpt: expect.any(String) }].map((v) => ({ ...v, path: expect.stringMatching(/^pages\[\d+\]\.body\.de$/) })));
    expect((await exportSiteContent(deps, ctxWith(['website.manage']), { jobDir: job() })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website test`
Expected: FAIL.

- [ ] **Step 3: Prüfungen**

`packages/modules/website/src/blocked-terms.ts`:
```ts
export interface BlockedTermHit {
  path: string;
  term: string;
  excerpt: string;
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function findBlockedTerms(content: unknown, terms: string[], filenames: string[] = []): BlockedTermHit[] {
  const needles = terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
  if (needles.length === 0) return [];
  const hits: BlockedTermHit[] = [];
  const check = (value: string, path: string) => {
    const lower = value.toLowerCase();
    for (const term of needles) {
      const index = lower.indexOf(term);
      if (index >= 0) hits.push({ path, term, excerpt: excerptAround(value, index, term.length) });
    }
  };
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') check(node, path);
    else if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(content, '');
  for (const name of filenames) check(name, `files/${name}`);
  return hits;
}
```

`packages/modules/website/src/translation-gaps.ts`:
```ts
import { translationGaps } from '@kompass/core';

export interface TranslationGap {
  collection: string;
  id: string;
  field: string;
}

const idOf = (record: Record<string, unknown>): string => String(record.key ?? record.slug ?? record.id ?? '?');

export function collectTranslationGaps(content: Record<string, unknown>): TranslationGap[] {
  const gaps: TranslationGap[] = [];
  for (const [collection, rows] of Object.entries(content)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      for (const field of translationGaps(record, Object.keys(record))) gaps.push({ collection, id: idOf(record), field });
    }
  }
  return gaps;
}
```

- [ ] **Step 4: Sichten**

`packages/modules/website/src/views.ts`:
```ts
import { definePublishedView, localizedText, readAllSettings, schema as core, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { pageBlockSchema } from './services/pages';
import { ensurePages } from './services/pages';
import { websiteArticles, websiteDownloads, websiteFaqs, websitePages, websiteTeam } from './schema';

const L = localizedText();

export const publishedSiteFacts = definePublishedView({
  name: 'facts',
  schema: z.object({
    claim: L, forwardingPercent: z.number(), shelterDogCount: z.number(), donationBoxLocations: z.array(z.string()),
    section11Status: z.enum(['pending', 'granted']), section11Date: z.string(), socialLinks: z.array(z.object({ label: z.string(), href: z.string() })),
    betterplaceMetaProjectId: z.string(), betterplaceDefaultAmount: z.number(), featuredAnimalSlug: z.string(), featuredStorySlug: z.string(),
    organization: z.object({ name: z.string(), street: z.string(), postalCode: z.string(), city: z.string(), email: z.string(), phone: z.string(), iban: z.string(), bic: z.string(), bankName: z.string(), registerCourt: z.string(), registerNumber: z.string() }),
  }),
  load: (deps: Deps) => {
    const all = readAllSettings(deps);
    const w = (k: string) => all[`website.${k}`];
    const o = (k: string) => String(all[`organization.${k}`] ?? '');
    return [{
      claim: w('claim'), forwardingPercent: w('forwardingPercent'), shelterDogCount: w('shelterDogCount'), donationBoxLocations: w('donationBoxLocations'),
      section11Status: w('section11Status'), section11Date: w('section11Date'), socialLinks: w('socialLinks'),
      betterplaceMetaProjectId: w('betterplaceMetaProjectId'), betterplaceDefaultAmount: w('betterplaceDefaultAmount'), featuredAnimalSlug: w('featuredAnimalSlug'), featuredStorySlug: w('featuredStorySlug'),
      organization: { name: o('name'), street: o('street'), postalCode: o('postalCode'), city: o('city'), email: o('email'), phone: o('phone'), iban: o('iban'), bic: o('bic'), bankName: o('bankName'), registerCourt: o('registerCourt'), registerNumber: o('registerNumber') },
    }];
  },
});

export const publishedPages = definePublishedView({
  name: 'pages',
  schema: z.object({ key: z.string(), title: L, lede: L, body: L, metaDescription: L, blocks: z.array(pageBlockSchema) }),
  load: (deps) => { ensurePages(deps); return deps.db.select().from(websitePages).all(); },
});

export const publishedArticles = definePublishedView({
  name: 'articles',
  schema: z.object({ slug: z.string(), title: L, lede: L, body: L, publishedAt: z.string().nullable(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteArticles).where(eq(websiteArticles.isPublished, true)).orderBy(asc(websiteArticles.sortOrder)).all(),
});

export const publishedTeam = definePublishedView({
  name: 'team',
  schema: z.object({ name: z.string(), position: L, photoAssetId: z.string().nullable(), petPhotoAssetId: z.string().nullable(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteTeam).where(eq(websiteTeam.isPublished, true)).orderBy(asc(websiteTeam.sortOrder)).all(),
});

export const publishedFaqs = definePublishedView({
  name: 'faqs',
  schema: z.object({ category: L, question: L, answer: L, sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(websiteFaqs).where(eq(websiteFaqs.isPublished, true)).orderBy(asc(websiteFaqs.sortOrder)).all(),
});

export const publishedProjects = definePublishedView({
  name: 'projects',
  schema: z.object({ slug: z.string(), name: L, type: z.enum(['ongoing', 'shortTerm']), status: z.enum(['active', 'completed']), summary: L, body: L, imageAssetId: z.string().nullable(), betterplaceProjectId: z.string(), sortOrder: z.number() }),
  load: (deps) => deps.db.select().from(core.projects).where(eq(core.projects.isPublished, true)).orderBy(asc(core.projects.sortOrder)).all(),
});

export const publishedDownloads = definePublishedView({
  name: 'downloads',
  schema: z.object({ key: z.string(), title: L, assetId: z.string() }),
  load: (deps) => deps.db.select().from(websiteDownloads).all().filter((d) => d.assetId !== null),
});

export const WEBSITE_VIEWS = [publishedSiteFacts, publishedPages, publishedArticles, publishedTeam, publishedFaqs, publishedProjects, publishedDownloads];
```
Im Manifest `publishedViews: WEBSITE_VIEWS` ergänzen (zirkulären Import vermeiden: `views.ts` importiert nicht aus `manifest.ts`).

- [ ] **Step 5: Export**

`packages/modules/website/src/export.ts`:
```ts
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { enabledManifests, ok, readSetting, requirePermission, schema as core, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { findBlockedTerms, type BlockedTermHit } from './blocked-terms';
import { collectTranslationGaps, type TranslationGap } from './translation-gaps';

export interface ExportedAsset { id: string; filename: string; mimeType: string; width: number | null; height: number | null }
export interface SiteExport { contentHash: string; contentPath: string; assets: ExportedAsset[]; gaps: TranslationGap[]; violations: BlockedTermHit[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}

function collectAssetIds(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) node.forEach((n) => collectAssetIds(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/assetId$/i.test(k) && typeof v === 'string' && v) out.add(v);
      else collectAssetIds(v, out);
    }
  }
}

const inputSchema = z.object({ jobDir: z.string().min(1) });

export async function exportSiteContent(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<SiteExport>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { type: 'validation', issues: [{ path: 'jobDir', message: 'required' }] } };
  const { jobDir } = parsed.data;

  const content: Record<string, unknown> = {};
  for (const manifest of enabledManifests(deps)) {
    for (const view of manifest.publishedViews ?? []) content[view.name] = view.load(deps);
  }
  const ids = new Set<string>();
  collectAssetIds(content, ids);
  const assets: ExportedAsset[] = [];
  await mkdir(path.join(jobDir, 'assets'), { recursive: true });
  for (const id of [...ids].sort()) {
    const row = deps.db.select().from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get();
    if (!row) continue;
    assets.push({ id: row.id, filename: row.filename, mimeType: row.mimeType, width: row.width, height: row.height });
    await writeFile(path.join(jobDir, 'assets', row.filename), await deps.media.read(row.filename));
  }
  content.assets = assets;

  const json = JSON.stringify(canonical(content), null, 2);
  const contentPath = path.join(jobDir, 'content.json');
  await writeFile(contentPath, json);
  const contentHash = createHash('sha256').update(json).digest('hex');
  const terms = readSetting<string[]>(deps, 'website.blockedTerms');
  const violations = findBlockedTerms(content, terms, assets.map((a) => a.filename));
  const gaps = collectTranslationGaps(content as Record<string, unknown[]>);
  return ok({ contentHash, contentPath, assets, gaps, violations });
}
```
Hinweis: `facts` ist ein Array mit einem Element (Sichten liefern Listen); die Site liest `content.facts[0]`. `assets` wird nach der Sperrwortprüfung nicht mehr verändert; Dateinamen sind Teil der Prüfung.

`src/index.ts` um `views`, `blocked-terms`, `translation-gaps`, `export` ergänzen.

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/module-website test && pnpm --filter @kompass/module-website typecheck`
Expected: grün. Im Export-Test enthält `Object.keys(content)` genau die sieben Sichten plus `assets`; das Tiermodul ist in diesem Test nicht installiert.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/website
git commit -m "feat(website): published views, blocked-term and translation checks, content export"
```

---

### Task 7: Tiermodul in der Minimalstufe

**Files:**
- Create: `packages/modules/animals/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/manifest.ts`, `src/schema.ts`, `src/service.ts`, `src/views.ts`
- Generated: `packages/core/src/db/migrations/0004_animals.sql`
- Test: `packages/modules/animals/tests/animals.test.ts`

**Interfaces:**
- Produces:
  - Manifest `animalsModule` (key `animals`, Rechte `animals.view`, `animals.manage`, Navigation `animals.list` → `/animals`, Gruppe `animals`, Sicht `publishedAnimals`).
  - Tabellen `animals` (`id, slug unique, name, species ('dog'), sex ('female'|'male'), birthText (L), sizeCm int, sizeText (L), location ('shelter'|'germany'), status ('lookingForHome'|'reserved'|'adopted'), isEmergency, isSponsorable, traits (L-Liste als JSON `{ de: string[]; en: string[] }`), externalProfileUrl, summary (L), body (L), isPublished, createdAt, updatedAt`), `animal_photos` (`animalId, assetId, sortOrder, isPrimary`, PK `(animalId, assetId)`), `animal_stories` (`animalId` PK, `beforeAssetId, afterAssetId, quote (L), family, adoptedYear`).
  - Services (`animals.manage` schreiben, `animals.view` lesen; Audit `animals.*`): `createAnimal`, `updateAnimal`, `setAnimalStatus({ id, status, adoptedYear? })` (bei `adopted` ist `adoptedYear` Pflicht; legt leere Story an), `setAnimalPhotos({ id, photos: { assetId, isPrimary }[] })` (ersetzt die Zuordnung vollständig; Bilder müssen `image/*` sein), `setAnimalStory({ id, beforeAssetId, afterAssetId, quote, family, adoptedYear })` (nur bei `adopted`, sonst Code `animalNotAdopted`), `setAnimalPublished`, `listAnimals`, `getAnimal` (mit `photos` und `story`).
  - Sicht `publishedAnimals`: `slug, name, sex, birthText, sizeCm, sizeText, location, status, isEmergency, isSponsorable, traits, externalProfileUrl, summary, body, photos: { assetId, sortOrder, isPrimary }[], story: { beforeAssetId, afterAssetId, quote, family, adoptedYear } | null`.

- [ ] **Step 1: Test schreiben**

`packages/modules/animals/tests/animals.test.ts`:
```ts
import { coreModule, schema, storeMediaAsset, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, getAnimal, listAnimals, publishedAnimals, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory, updateAnimal } from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const deps = () => { const d = createTestDeps({ manifests: [coreModule, animalsModule] }); insertUser(d, { id: 'USER-TEST' }); return d; };
const manage = ctxWith(['animals.manage', 'animals.view', 'media.upload']);
const chiara = { slug: 'chiara', name: 'Chiara', sex: 'female', birthText: { de: '16.02.2021', en: '16 Feb 2021' }, sizeCm: 45, sizeText: { de: '45–50 cm', en: '45–50 cm' }, location: 'shelter', isEmergency: false, isSponsorable: true, traits: { de: ['ruhig', 'verträglich'], en: ['calm', 'sociable'] }, externalProfileUrl: 'https://www.hundeblicke.net/chiara', summary: { de: 'Sanfte Hündin.', en: '' }, body: { de: 'Text', en: '' } };

describe('animals module', () => {
  it('creates tables via the core chain and registers the view', () => {
    const d = deps();
    const tables = (d.sqlite.prepare("select name from sqlite_master where type='table' and name like 'animal%' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(['animal_photos', 'animal_stories', 'animals']);
    expect(animalsModule.publishedViews?.map((v) => v.name)).toEqual(['animals']);
  });

  it('creates an animal looking for a home, unpublished, and audits', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    expect(a).toMatchObject({ slug: 'chiara', status: 'lookingForHome', isPublished: false, species: 'dog', photos: [], story: null });
    expect(d.db.select().from(schema.auditLog).all().at(-1)).toMatchObject({ action: 'animals.create', entityType: 'animal', entityId: a.id });
    const dup = await createAnimal(d, manage, chiara);
    expect(dup.ok === false && dup.error.type === 'conflict' && dup.error.code === 'slugTaken').toBe(true);
    expect((await createAnimal(d, ctxWith(['animals.view']), { ...chiara, slug: 'x' })).ok).toBe(false);
  });

  it('manages photos with a primary image and rejects non-images', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const p1 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-1.png', bytes: PNG }));
    const p2 = unwrap(await storeMediaAsset(d, manage, { originalName: 'chiara-2.png', bytes: new Uint8Array([...PNG, 0]) }));
    const pdf = unwrap(await storeMediaAsset(d, manage, { originalName: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4\n%%EOF'), declaredMimeType: 'application/pdf' }));
    const withPhotos = unwrap(await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p2.id, isPrimary: false }, { assetId: p1.id, isPrimary: true }] }));
    expect(withPhotos.photos.map((p) => [p.assetId, p.sortOrder, p.isPrimary])).toEqual([[p2.id, 1, false], [p1.id, 2, true]]);
    const bad = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: pdf.id, isPrimary: true }] });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues[0]?.message === 'notAnImage').toBe(true);
    const twoPrimary = await setAnimalPhotos(d, manage, { id: a.id, photos: [{ assetId: p1.id, isPrimary: true }, { assetId: p2.id, isPrimary: true }] });
    expect(twoPrimary.ok === false && twoPrimary.error.type === 'validation').toBe(true);
  });

  it('status changes: adopted requires a year and enables the story; story rejected otherwise', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    const before = unwrap(await storeMediaAsset(d, manage, { originalName: 'vorher.png', bytes: PNG }));
    const notYet = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 });
    expect(notYet.ok === false && notYet.error.type === 'conflict' && notYet.error.code === 'animalNotAdopted').toBe(true);
    const missingYear = await setAnimalStatus(d, manage, { id: a.id, status: 'adopted' });
    expect(missingYear.ok === false && missingYear.error.type === 'validation').toBe(true);
    const adopted = unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    expect(adopted.story).toMatchObject({ adoptedYear: 2026, family: '' });
    const withStory = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: before.id, afterAssetId: before.id, quote: { de: 'Endlich zuhause.', en: 'Home at last.' }, family: 'Familie M.', adoptedYear: 2026 }));
    expect(withStory.story?.quote.en).toBe('Home at last.');
    expect(unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'reserved' })).status).toBe('reserved');
  });

  it('publishes and exposes only published animals with photos and story in the view', async () => {
    const d = deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await createAnimal(d, manage, { ...chiara, slug: 'bruno', name: 'Bruno', sex: 'male', location: 'germany', isEmergency: true }));
    expect(publishedAnimals.load(d)).toEqual([]);
    unwrap(await updateAnimal(d, manage, { id: a.id, summary: { de: 'Sanfte Hündin.', en: 'Gentle girl.' } }));
    unwrap(await setAnimalPublished(d, manage, { id: a.id, isPublished: true }));
    const rows = publishedAnimals.load(d);
    expect(rows.map((r) => r.slug)).toEqual(['chiara']);
    expect(rows[0]).toMatchObject({ summary: { en: 'Gentle girl.' }, photos: [], story: null });
    expect('isPublished' in rows[0]!).toBe(false);
    expect(unwrap(await listAnimals(d, ctxWith(['animals.view'])))).toHaveLength(2);
    expect(unwrap(await getAnimal(d, ctxWith(['animals.view']), a.id)).slug).toBe('chiara');
  });
});
```

- [ ] **Step 2: Paket anlegen, Test ausführen, Fehlschlag prüfen**

`packages/modules/animals/package.json` wie das Webseiten-Modul mit Name `@kompass/module-animals` (ohne `@kompass/markdown`). Run: `pnpm install && pnpm --filter @kompass/module-animals test`
Expected: FAIL.

- [ ] **Step 3: Schema, Migration, Manifest**

`packages/modules/animals/src/schema.ts`:
```ts
import { localizedColumn, schema as core } from '@kompass/core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export interface LocalizedList { de: string[]; en: string[] }

export const animals = sqliteTable(
  'animals',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    species: text('species').notNull().default('dog'),
    sex: text('sex', { enum: ['female', 'male'] }).notNull(),
    birthText: localizedColumn('birth_text'),
    sizeCm: integer('size_cm').notNull().default(0),
    sizeText: localizedColumn('size_text'),
    location: text('location', { enum: ['shelter', 'germany'] }).notNull().default('shelter'),
    status: text('status', { enum: ['lookingForHome', 'reserved', 'adopted'] }).notNull().default('lookingForHome'),
    isEmergency: integer('is_emergency', { mode: 'boolean' }).notNull().default(false),
    isSponsorable: integer('is_sponsorable', { mode: 'boolean' }).notNull().default(false),
    traits: text('traits', { mode: 'json' }).$type<LocalizedList>().notNull().default({ de: [], en: [] }),
    externalProfileUrl: text('external_profile_url').notNull().default(''),
    summary: localizedColumn('summary'),
    body: localizedColumn('body'),
    isPublished: integer('is_published', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('animals_status_idx').on(t.status)],
);

export const animalPhotos = sqliteTable(
  'animal_photos',
  {
    animalId: text('animal_id').notNull().references(() => animals.id),
    assetId: text('asset_id').notNull().references(() => core.mediaAssets.id),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.animalId, t.assetId] })],
);

export const animalStories = sqliteTable('animal_stories', {
  animalId: text('animal_id').primaryKey().references(() => animals.id),
  beforeAssetId: text('before_asset_id').references(() => core.mediaAssets.id),
  afterAssetId: text('after_asset_id').references(() => core.mediaAssets.id),
  quote: localizedColumn('quote'),
  family: text('family').notNull().default(''),
  adoptedYear: integer('adopted_year').notNull(),
});
```
Run: `pnpm --filter @kompass/core db:generate --name animals` ⇒ `0004_animals.sql`.

`packages/modules/animals/src/manifest.ts`:
```ts
import { defineModule, type ModuleManifest } from '@kompass/core';
import { publishedAnimals } from './views';

export const animalsModule: ModuleManifest = defineModule({
  key: 'animals',
  version: '0.1.0',
  permissions: ['animals.view', 'animals.manage'],
  navigation: [{ key: 'animals.list', href: '/animals', icon: 'paw-print', group: 'animals', permission: 'animals.view' }],
  publishedViews: [publishedAnimals],
});
```

- [ ] **Step 4: Service und Sicht**

`packages/modules/animals/src/service.ts`:
```ts
import { conflict, invalid, isoNow, localizedText, newId, notFound, ok, recordAudit, requirePermission, schema as core, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { animalPhotos, animalStories, animals, type LocalizedList } from './schema';

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const localizedList = z.object({ de: z.array(z.string().trim().min(1).max(40)).max(12), en: z.array(z.string().trim().min(1).max(40)).max(12) });

export interface AnimalPhoto { assetId: string; sortOrder: number; isPrimary: boolean }
export interface AnimalStory { beforeAssetId: string | null; afterAssetId: string | null; quote: { de: string; en: string }; family: string; adoptedYear: number }
export type AnimalRecord = typeof animals.$inferSelect & { photos: AnimalPhoto[]; story: AnimalStory | null };

const fields = {
  slug: z.string().regex(SLUG),
  name: z.string().trim().min(1).max(80),
  sex: z.enum(['female', 'male']),
  birthText: localizedText({ max: 60 }),
  sizeCm: z.number().int().min(0).max(120).default(0),
  sizeText: localizedText({ max: 80 }),
  location: z.enum(['shelter', 'germany']).default('shelter'),
  isEmergency: z.boolean().default(false),
  isSponsorable: z.boolean().default(false),
  traits: localizedList.default({ de: [], en: [] }),
  externalProfileUrl: z.union([z.literal(''), z.url()]).default(''),
  summary: localizedText({ max: 300 }),
  body: localizedText({ max: 20_000 }),
};
const createSchema = z.object(fields);
const updateSchema = z.object({ id: z.string().min(1), slug: fields.slug.optional(), name: fields.name.optional(), sex: fields.sex.optional(), birthText: fields.birthText.optional(), sizeCm: fields.sizeCm.optional(), sizeText: fields.sizeText.optional(), location: fields.location.optional(), isEmergency: fields.isEmergency.optional(), isSponsorable: fields.isSponsorable.optional(), traits: localizedList.optional(), externalProfileUrl: fields.externalProfileUrl.optional(), summary: fields.summary.optional(), body: fields.body.optional() });

export function loadAnimal(db: DbOrTx, id: string): AnimalRecord | null {
  const row = db.select().from(animals).where(eq(animals.id, id)).get();
  if (!row) return null;
  const photos = db.select({ assetId: animalPhotos.assetId, sortOrder: animalPhotos.sortOrder, isPrimary: animalPhotos.isPrimary }).from(animalPhotos).where(eq(animalPhotos.animalId, id)).orderBy(asc(animalPhotos.sortOrder)).all();
  const story = db.select().from(animalStories).where(eq(animalStories.animalId, id)).get();
  return { ...row, traits: row.traits as LocalizedList, photos, story: story ? { beforeAssetId: story.beforeAssetId, afterAssetId: story.afterAssetId, quote: story.quote, family: story.family, adoptedYear: story.adoptedYear } : null };
}

const slugTaken = (db: DbOrTx, slug: string, exceptId?: string) => { const r = db.select({ id: animals.id }).from(animals).where(eq(animals.slug, slug)).get(); return !!r && r.id !== exceptId; };
const imageMime = (db: DbOrTx, id: string): 'missing' | 'notImage' | 'ok' => { const m = db.select({ mime: core.mediaAssets.mimeType }).from(core.mediaAssets).where(eq(core.mediaAssets.id, id)).get()?.mime; return !m ? 'missing' : m.startsWith('image/') ? 'ok' : 'notImage'; };

export async function createAnimal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(createSchema, input);
  if (!parsed.ok) return parsed;
  if (slugTaken(deps.db, parsed.value.slug)) return conflict('slugTaken', `Slug ${parsed.value.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(animals).values({ id, ...parsed.value, species: 'dog', status: 'lookingForHome', isPublished: false, createdAt: now, updatedAt: now }).run();
    const record = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.create', entityType: 'animal', entityId: id, after: record, summary: `Tier ${record.name} angelegt` });
    return ok(record);
  });
}

export async function updateAnimal(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(updateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (changes.slug && slugTaken(deps.db, changes.slug, id)) return conflict('slugTaken', `Slug ${changes.slug} ist bereits vergeben`);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.update', entityType: 'animal', entityId: id, before, after, summary: `Tier ${after.name} geändert` });
    return ok(after);
  });
}

const statusSchema = z.object({ id: z.string().min(1), status: z.enum(['lookingForHome', 'reserved', 'adopted']), adoptedYear: z.number().int().min(2000).max(2100).optional() });

export async function setAnimalStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(statusSchema, input);
  if (!parsed.ok) return parsed;
  const { id, status, adoptedYear } = parsed.value;
  if (status === 'adopted' && adoptedYear === undefined) return invalid([{ path: 'adoptedYear', message: 'required' }]);
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ status, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    if (status === 'adopted' && !before.story) {
      tx.insert(animalStories).values({ animalId: id, beforeAssetId: null, afterAssetId: null, quote: { de: '', en: '' }, family: '', adoptedYear: adoptedYear as number }).run();
    }
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setStatus', entityType: 'animal', entityId: id, before: { status: before.status }, after: { status, adoptedYear: adoptedYear ?? null }, summary: `Status von ${after.name}: ${status}` });
    return ok(after);
  });
}

const photosSchema = z.object({ id: z.string().min(1), photos: z.array(z.object({ assetId: z.string().min(1), isPrimary: z.boolean().default(false) })).max(12) });

export async function setAnimalPhotos(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(photosSchema, input);
  if (!parsed.ok) return parsed;
  const { id, photos } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (photos.filter((p) => p.isPrimary).length > 1) return invalid([{ path: 'photos', message: 'multiplePrimary' }]);
  for (const [i, p] of photos.entries()) {
    const state = imageMime(deps.db, p.assetId);
    if (state === 'missing') return notFound('mediaAsset', p.assetId);
    if (state === 'notImage') return invalid([{ path: `photos.${i}.assetId`, message: 'notAnImage' }]);
  }
  return deps.db.transaction((tx) => {
    tx.delete(animalPhotos).where(eq(animalPhotos.animalId, id)).run(); // Zuordnung, kein Rechenschaftsdatum; Assets bleiben
    photos.forEach((p, i) => tx.insert(animalPhotos).values({ animalId: id, assetId: p.assetId, sortOrder: i + 1, isPrimary: p.isPrimary || (i === 0 && !photos.some((x) => x.isPrimary)) }).run());
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setPhotos', entityType: 'animal', entityId: id, before: before.photos, after: after.photos, summary: `Fotos von ${after.name} geändert` });
    return ok(after);
  });
}

const storySchema = z.object({ id: z.string().min(1), beforeAssetId: z.string().nullable(), afterAssetId: z.string().nullable(), quote: localizedText({ max: 600 }), family: z.string().trim().max(120), adoptedYear: z.number().int().min(2000).max(2100) });

export async function setAnimalStory(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(storySchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...story } = parsed.value;
  const before = loadAnimal(deps.db, id);
  if (!before) return notFound('animal', id);
  if (before.status !== 'adopted') return conflict('animalNotAdopted', 'Eine Erfolgsgeschichte gibt es nur für vermittelte Tiere');
  for (const assetId of [story.beforeAssetId, story.afterAssetId]) {
    if (!assetId) continue;
    const state = imageMime(deps.db, assetId);
    if (state === 'missing') return notFound('mediaAsset', assetId);
    if (state === 'notImage') return invalid([{ path: 'beforeAssetId', message: 'notAnImage' }]);
  }
  return deps.db.transaction((tx) => {
    tx.insert(animalStories).values({ animalId: id, ...story }).onConflictDoUpdate({ target: animalStories.animalId, set: story }).run();
    tx.update(animals).set({ updatedAt: isoNow(deps.clock) }).where(eq(animals.id, id)).run();
    const after = loadAnimal(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'animals.setStory', entityType: 'animal', entityId: id, before: before.story, after: after.story, summary: `Erfolgsgeschichte von ${after.name} geändert` });
    return ok(after);
  });
}

export async function setAnimalPublished(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.manage');
  if (denied) return denied;
  const parsed = validate(z.object({ id: z.string().min(1), isPublished: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = loadAnimal(deps.db, parsed.value.id);
  if (!before) return notFound('animal', parsed.value.id);
  return deps.db.transaction((tx) => {
    tx.update(animals).set({ isPublished: parsed.value.isPublished, updatedAt: isoNow(deps.clock) }).where(eq(animals.id, before.id)).run();
    const after = loadAnimal(tx, before.id)!;
    recordAudit(tx, deps, ctx, { action: after.isPublished ? 'animals.publish' : 'animals.unpublish', entityType: 'animal', entityId: before.id, before: { isPublished: before.isPublished }, after: { isPublished: after.isPublished }, summary: `${after.name} ${after.isPublished ? 'veröffentlicht' : 'zurückgezogen'}` });
    return ok(after);
  });
}

export async function listAnimals(deps: Deps, ctx: CallContext): Promise<Result<AnimalRecord[]>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  return ok(deps.db.select({ id: animals.id }).from(animals).orderBy(asc(animals.name)).all().map((r) => loadAnimal(deps.db, r.id)!));
}

export async function getAnimal(deps: Deps, ctx: CallContext, id: string): Promise<Result<AnimalRecord>> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const record = loadAnimal(deps.db, id);
  return record ? ok(record) : notFound('animal', id);
}

export function findAnimalBySlug(db: DbOrTx, slug: string): AnimalRecord | null {
  const row = db.select({ id: animals.id }).from(animals).where(and(eq(animals.slug, slug))).get();
  return row ? loadAnimal(db, row.id) : null;
}
```

`packages/modules/animals/src/views.ts`:
```ts
import { definePublishedView, localizedText } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { animals } from './schema';
import { loadAnimal } from './service';

const L = localizedText();

export const publishedAnimals = definePublishedView({
  name: 'animals',
  schema: z.object({
    slug: z.string(), name: z.string(), sex: z.enum(['female', 'male']), birthText: L, sizeCm: z.number(), sizeText: L,
    location: z.enum(['shelter', 'germany']), status: z.enum(['lookingForHome', 'reserved', 'adopted']), isEmergency: z.boolean(), isSponsorable: z.boolean(),
    traits: z.object({ de: z.array(z.string()), en: z.array(z.string()) }), externalProfileUrl: z.string(), summary: L, body: L,
    photos: z.array(z.object({ assetId: z.string(), sortOrder: z.number(), isPrimary: z.boolean() })),
    story: z.object({ beforeAssetId: z.string().nullable(), afterAssetId: z.string().nullable(), quote: L, family: z.string(), adoptedYear: z.number() }).nullable(),
  }),
  load: (deps) => deps.db.select({ id: animals.id }).from(animals).where(eq(animals.isPublished, true)).orderBy(asc(animals.name)).all().map((r) => loadAnimal(deps.db, r.id)!),
});
```
`src/index.ts`: `export * from './schema'; export * from './service'; export * from './views'; export { animalsModule } from './manifest';`.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/module-animals test && pnpm --filter @kompass/module-animals typecheck && pnpm --filter @kompass/core test`
Expected: grün. Beim Kern-Test `db.test.ts` erscheinen `animal_*`- und `website_*`-Tabellen nur, wenn er alle Tabellen listet — dann die Erwartung ergänzen.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/animals packages/core pnpm-lock.yaml
git commit -m "feat(animals): minimal animal profiles with photos, status, story and published view"
```

---

### Task 8: MCP-Tools der Module und Verdrahtung in der App

**Files:**
- Create: `packages/modules/website/src/mcp-tools.ts`, `packages/modules/animals/src/mcp-tools.ts`, `apps/kompass/src/modules.ts`
- Modify: beide `manifest.ts` (`mcpTools`), `apps/kompass/src/lib/deps.ts` (`modules`), `apps/kompass/package.json` (Workspace-Abhängigkeiten), `apps/kompass/next.config.ts` (`transpilePackages`), `apps/kompass/messages/de.json` (Navigationslabels), `apps/kompass/tests/core-contract.test.ts`
- Test: `packages/modules/website/tests/mcp-tools.test.ts`, `packages/modules/animals/tests/mcp-tools.test.ts`, `apps/kompass/tests/modules.test.ts`

**Interfaces:**
- Produces:
  - Website-Tools: `website_pages_list`, `website_page_get {key}`, `website_page_update {key, …}`, `website_articles_list`, `website_article_create`, `website_article_update`, `website_article_set_published`, `website_team_list`, `website_team_create`, `website_team_update`, `website_team_set_published`, `website_faqs_list`, `website_faq_create`, `website_faq_update`, `website_faq_set_published`, `website_downloads_list`, `website_download_set`, `website_projects_list`, `website_project_create`, `website_project_update`, `website_project_set_published`, `website_export_check {jobDir}` (liefert `gaps` und `violations`, ohne Dateien zu behalten).
  - Animals-Tools: `animals_list`, `animals_get {id}`, `animals_create`, `animals_update`, `animals_set_status`, `animals_set_photos`, `animals_set_story`, `animals_set_published`.
  - `apps/kompass/src/modules.ts`: `export const installedModules = [websiteModule, animalsModule]`.

- [ ] **Step 1: Tests schreiben**

`packages/modules/website/tests/mcp-tools.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { websiteModule } from '../src';

describe('website mcp tools', () => {
  it('registers one tool per service with underscore names and object schemas', () => {
    const names = (websiteModule.mcpTools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['website_page_get', 'website_page_update', 'website_article_create', 'website_team_set_published', 'website_download_set', 'website_project_update', 'website_export_check']));
    for (const tool of websiteModule.mcpTools ?? []) {
      expect(tool.name).toMatch(/^website_[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.safeParse({}).success || tool.inputSchema.safeParse({ key: 'home' }).success).toBe(true);
    }
  });
});
```
(`inputSchema.safeParse({})` scheitert bei Pflichtfeldern — die zweite Bedingung deckt Tools mit `key` ab; für Tools mit anderen Pflichtfeldern die Prüfung beim Umsetzen auf `typeof tool.inputSchema.safeParse === 'function'` reduzieren. Ziel des Tests ist die Vollständigkeit der Namen und Beschreibungen.)

`packages/modules/animals/tests/mcp-tools.test.ts`:
```ts
import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src';

describe('animals mcp tools', () => {
  it('creates and lists through the tool handlers with the caller context', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const tools = Object.fromEntries((animalsModule.mcpTools ?? []).map((t) => [t.name, t]));
    expect(Object.keys(tools).sort()).toEqual(['animals_create', 'animals_get', 'animals_list', 'animals_set_photos', 'animals_set_published', 'animals_set_status', 'animals_set_story', 'animals_update']);
    const ctx = ctxWith(['animals.manage', 'animals.view']);
    const created = unwrap(await tools.animals_create!.handler(deps, ctx, tools.animals_create!.inputSchema.parse({ slug: 'luna', name: 'Luna', sex: 'female', birthText: { de: '2022', en: '' }, sizeText: { de: '40 cm', en: '' }, summary: { de: 'x', en: '' }, body: { de: 'y', en: '' } }))) as { id: string };
    const listed = unwrap(await tools.animals_list!.handler(deps, ctx, {})) as { id: string }[];
    expect(listed.map((a) => a.id)).toEqual([created.id]);
    const denied = await tools.animals_create!.handler(deps, ctxWith(['animals.view']), { slug: 'x', name: 'X', sex: 'male', birthText: { de: '', en: '' }, sizeText: { de: '', en: '' }, summary: { de: '', en: '' }, body: { de: '', en: '' } });
    expect(denied.ok).toBe(false);
  });
});
```

`apps/kompass/tests/modules.test.ts`:
```ts
import { createRegistry, coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

describe('installed modules', () => {
  it('registers website and animals without clashes', () => {
    const registry = createRegistry([coreModule, ...installedModules]);
    expect(installedModules.map((m) => m.key)).toEqual(['website', 'animals']);
    expect(registry.permissionKeys.has('animals.manage')).toBe(true);
    expect(registry.settingDefinitions.has('website.blockedTerms')).toBe(true);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website test tests/mcp-tools.test.ts; pnpm --filter @kompass/module-animals test tests/mcp-tools.test.ts; pnpm --filter @kompass/app test tests/modules.test.ts`
Expected: FAIL (Tools fehlen, `@/modules` fehlt).

- [ ] **Step 3: Tools**

`packages/modules/website/src/mcp-tools.ts`:
```ts
import { createProject, getProject, listProjects, setProjectPublished, updateProject, type McpToolDefinition } from '@kompass/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { exportSiteContent } from './export';
import { createArticle, listArticles, setArticlePublished, updateArticle } from './services/articles';
import { listDownloads, setDownload } from './services/downloads';
import { createFaq, listFaqs, setFaqPublished, updateFaq } from './services/faqs';
import { getPage, listPages, updatePage } from './services/pages';
import { createTeamMember, listTeam, setTeamMemberPublished, updateTeamMember } from './services/team';

const any = z.object({}).passthrough();
const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({ name, description, inputSchema, handler });

export const WEBSITE_MCP_TOOLS: McpToolDefinition[] = [
  t('website_pages_list', 'List all website pages with their bilingual texts and blocks. Requires website.view.', z.object({}), (deps, ctx) => listPages(deps, ctx)),
  t('website_page_get', 'Read one website page by key (e.g. home, help, about). Requires website.view.', z.object({ key: z.string() }), (deps, ctx, args) => getPage(deps, ctx, (args as { key: string }).key)),
  t('website_page_update', 'Update texts (de/en) and blocks of a page. Requires website.manage. Audited.', any, (deps, ctx, args) => updatePage(deps, ctx, args)),
  t('website_articles_list', 'List articles (Wissenswertes). Requires website.view.', z.object({}), (deps, ctx) => listArticles(deps, ctx)),
  t('website_article_create', 'Create an article (unpublished). Requires website.manage.', any, (deps, ctx, args) => createArticle(deps, ctx, args)),
  t('website_article_update', 'Update an article. Requires website.manage.', any, (deps, ctx, args) => updateArticle(deps, ctx, args)),
  t('website_article_set_published', 'Publish or unpublish an article. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setArticlePublished(deps, ctx, args)),
  t('website_team_list', 'List team members. Requires website.view.', z.object({}), (deps, ctx) => listTeam(deps, ctx)),
  t('website_team_create', 'Create a team member. Requires website.manage.', any, (deps, ctx, args) => createTeamMember(deps, ctx, args)),
  t('website_team_update', 'Update a team member. Requires website.manage.', any, (deps, ctx, args) => updateTeamMember(deps, ctx, args)),
  t('website_team_set_published', 'Publish or unpublish a team member. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setTeamMemberPublished(deps, ctx, args)),
  t('website_faqs_list', 'List FAQ entries. Requires website.view.', z.object({}), (deps, ctx) => listFaqs(deps, ctx)),
  t('website_faq_create', 'Create an FAQ entry. Requires website.manage.', any, (deps, ctx, args) => createFaq(deps, ctx, args)),
  t('website_faq_update', 'Update an FAQ entry. Requires website.manage.', any, (deps, ctx, args) => updateFaq(deps, ctx, args)),
  t('website_faq_set_published', 'Publish or unpublish an FAQ entry. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setFaqPublished(deps, ctx, args)),
  t('website_downloads_list', 'List download slots (PDF forms). Requires website.view.', z.object({}), (deps, ctx) => listDownloads(deps, ctx)),
  t('website_download_set', 'Attach a PDF media asset to a download slot. Requires website.manage.', any, (deps, ctx, args) => setDownload(deps, ctx, args)),
  t('website_projects_list', 'List projects with public fields. Requires website.view.', z.object({}), (deps, ctx) => listProjects(deps, ctx)),
  t('website_project_get', 'Read one project. Requires website.view.', z.object({ id: z.string() }), (deps, ctx, args) => getProject(deps, ctx, (args as { id: string }).id)),
  t('website_project_create', 'Create a project (unpublished). Requires website.manage.', any, (deps, ctx, args) => createProject(deps, ctx, args)),
  t('website_project_update', 'Update a project. Requires website.manage.', any, (deps, ctx, args) => updateProject(deps, ctx, args)),
  t('website_project_set_published', 'Publish or unpublish a project. Requires website.manage.', z.object({ id: z.string(), isPublished: z.boolean() }), (deps, ctx, args) => setProjectPublished(deps, ctx, args)),
  t('website_export_check', 'Run the content export checks (translation gaps, blocked terms) without publishing. Requires website.publish.', z.object({}), async (deps, ctx) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kompass-check-'));
    try {
      const result = await exportSiteContent(deps, ctx, { jobDir: dir });
      return result.ok ? { ok: true, value: { contentHash: result.value.contentHash, gaps: result.value.gaps, violations: result.value.violations } } : result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }),
];
```
Hinweis: `any` (`z.object({}).passthrough()`) lässt die Service-Validierung entscheiden — die Services validieren ohnehin mit ihren eigenen Schemas; MCP-Clients bekommen so die Service-Fehler statt einer doppelten Schema-Pflege. Für die JSON-Schema-Beschreibung im Tool-Listing ist das schwächer; Tools mit wenigen Feldern (`set_published`, `get`) sind explizit typisiert.

`packages/modules/animals/src/mcp-tools.ts` — gleiches Muster mit den acht Namen aus dem Interfaces-Block: `animals_list` → `listAnimals`, `animals_get {id}` → `getAnimal`, `animals_create` → `createAnimal`, `animals_update` → `updateAnimal`, `animals_set_status {id, status, adoptedYear?}` → `setAnimalStatus`, `animals_set_photos` → `setAnimalPhotos`, `animals_set_story` → `setAnimalStory`, `animals_set_published {id, isPublished}` → `setAnimalPublished`. Beschreibungen englisch, mit „Requires animals.view/manage".

In beiden Manifesten `mcpTools: WEBSITE_MCP_TOOLS` bzw. `ANIMALS_MCP_TOOLS` ergänzen (Import aus `./mcp-tools`; zirkuläre Importe vermeiden: `mcp-tools.ts` importiert Services, nicht das Manifest).

- [ ] **Step 4: App-Verdrahtung**

`apps/kompass/src/modules.ts`:
```ts
import { animalsModule } from '@kompass/module-animals';
import { websiteModule } from '@kompass/module-website';
import type { ModuleManifest } from '@kompass/core';

/** Installierte Fachmodule dieser Installation. Aktivierung erfolgt unter Verwaltung → Module. */
export const installedModules: ModuleManifest[] = [websiteModule, animalsModule];
```
`apps/kompass/src/lib/deps.ts`: `createDeps({ …, modules: installedModules })`. `apps/kompass/package.json`: `"@kompass/module-website": "workspace:*"`, `"@kompass/module-animals": "workspace:*"`, `"@kompass/markdown": "workspace:*"`. `next.config.ts`: `transpilePackages` um die drei Pakete ergänzen. `apps/kompass/tests/core-contract.test.ts`: `REQUIRED` um `'localizedText', 'resolveText', 'createProject', 'listProjects'` ergänzen.

`messages/de.json` ergänzen (Navigationslabels, damit die Sidebar keine rohen Keys zeigt):
```json
"nav": {
  "groups": { "website": "Webseite", "animals": "Tiere" },
  "website": { "pages": "Seiten", "articles": "Artikel", "team": "Team", "faqs": "FAQ", "projects": "Projekte", "downloads": "Downloads", "facts": "Site-Fakten", "publish": "Publizieren" },
  "animals": { "list": "Hunde" }
}
```
(`nav.groups.website` und `nav.groups.animals` existieren bereits; die Untergruppen ergänzen. `buildNavigation` bildet `labelKey` als `nav.${item.key}` — `website.pages` ⇒ `nav.website.pages`.)

- [ ] **Step 5: Gesamtlauf**

Run: `pnpm install && pnpm typecheck && pnpm test`
Expected: alle Workspaces grün. Dann `pnpm --filter @kompass/app e2e e2e/modules.spec.ts` — die Modulseite zeigt jetzt Kern, Webseite und Tiere; die Erwartung „1 von 1 aktiv" in `modules.spec.ts` auf „1 von 3 aktiv" anpassen und `shell.spec.ts` prüfen (die deaktivierten Gruppen „Webseite" und „Tiere" erscheinen ausgegraut in der Sidebar).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(modules): MCP tools for website and animals, modules wired into the app"
```

---

## Abschluss dieses Plans

Nach Task 8 sind beide Module installiert, per Schalter aktivierbar, mit Services, Sichten, Export-Prüfungen und MCP-Tools; die Sidebar zeigt die Gruppen. Es fehlen noch: die Oberfläche der Module (`webseite-2-oberflaeche`: Seiten-, Listen-, Hunde-, Fakten- und Publizieren-Seiten mit zweisprachigen Feldern und Markdown-Vorschau) und die Site samt Build, Diff, Publish und Datenübernahme (`webseite-3-site-und-publish`).

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung (Abschnitte 2 und 3, ohne Build/Publish/UI):** Sprachtyp und Fallback-Regel → Task 1; `projects` im Kern → Task 2; Migrationskette mit Modul-Glob → Task 2; `website_*`-Tabellen, `PageBlock`, Site-Fakten inkl. Sperrwortliste und Startseiten-Auswahl → Task 4; Services ohne Löschen → Task 5; Sichten, Sprachregel im Export (Lücken gelistet), Sperrwortprüfung inkl. Dateinamen, `content.json` + Assets → Task 6; `animals`, `animal_photos`, `animal_stories`, Statusregel für die Geschichte, `publishedAnimals` → Task 7; MCP-Tools ohne Publish-Tool, `modules.ts` → Task 8. Rechte-Keys wie Spec Abschnitt 3.

**Placeholder-Scan:** Task 5 beschreibt `team.ts` und `faqs.ts` als Varianten von `articles.ts` mit exakt benannten Feldern, Aktionen und Exporten; Task 8 beschreibt die Animals-Tools als Liste mit Zuordnung zu Services. Beides ist vollständig spezifiziert, aber nicht als Code ausgeschrieben — beim Umsetzen ist `articles.ts` die Vorlage.

**Typkonsistenz:** `localizedText()`/`LocalizedText` (Task 1) in Schema-Helfer `localizedColumn` (Task 2), Services (Tasks 5, 7) und Sichten (Tasks 6, 7); `assetMime` (Task 5) in Seiten/Downloads; `exportSiteContent` (Task 6) in `website_export_check` (Task 8); `loadAnimal` (Task 7) in `publishedAnimals`; `installedModules` (Task 8) in `deps.ts`.
