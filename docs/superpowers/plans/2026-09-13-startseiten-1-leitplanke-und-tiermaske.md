# Startseiten-Referenzen, Plan 1: Leitplanke und Tiermaske

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jede veröffentlichte Sicht verkraftet, was ihr Dienst annimmt (Backlog 15), die Vermittlungsgeschichte trägt Bildunterschriften (Backlog 16), und die Tiermaske erklärt den Profil-Link (Backlog 14).

**Architecture:** Ein Testhelfer `loadAllViews` in `@kompass/core/testing` lädt alle Sichten eines Manifests und benennt bei einer Zod-Exception Sicht und Pfad; je Modul mit Sicht ein Test mit einem minimalen Datensatz. Die Geschichte bekommt zwei mehrsprachige Spalten mit Vorgabe leer, durch Schema, Migration, Dienst, Sicht, Seed, Maske und E2E. Der Hilfetext ist ein Eintrag in `messages/de.json`.

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest, Next 16 (Server Actions, next-intl), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-startseiten-referenzen-und-nacharbeiten-design.md`, § 6 und § 8.

## Global Constraints

- AGENTS.md gilt: Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`, `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`. Fachfehler sind `Result`-Werte.
- Zeit über `deps.clock.now()`, nie `new Date()` im Fachcode. IDs über `newId()`.
- Code Englisch, Oberfläche über `apps/kompass/messages/de.json` (Sie-Form). Kein hartcodierter UI-Text.
- Migrationen mit `pnpm --filter @kompass/core db:generate`; erzeugte SQL-Dateien werden committet, nie editiert. Nächste Nummer: `0029`.
- Tests: Vitest, gegen `createTestDeps()`. Pro Dienständerung: Erfolg, `validation`, Audit.
- Seed-Daten sind erfunden (`no-association-content.test.ts`), idempotent.
- Commit je Task, kein Push (den löst Joe aus). Commit-Nachricht auf Englisch, Betreff im Stil `feat(animals): …`, mit den Attributionszeilen aus der Sitzung.
- Vor jedem Commit: `pnpm typecheck` und die Tests des berührten Pakets grün.

---

### Task 1: `loadAllViews` in `@kompass/core/testing`

**Files:**
- Create: `packages/core/src/testing/views.ts`
- Modify: `packages/core/src/testing/index.ts` (Export ergänzen)
- Test: `packages/core/tests/views-hold.test.ts`

**Interfaces:**
- Produces: `loadAllViews(deps: Deps, manifest: ModuleManifest): Record<string, unknown[]>` — lädt jede Sicht aus `manifest.publishedViews`, wirft `Error` mit Text `view "<name>" rejects its own rows: <pfad>: <meldung>` bei einer `ZodError`. Wird in Task 2, 3 und 4 benutzt.

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/tests/views-hold.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreModule, defineModule, definePublishedView } from '../src';
import { createTestDeps, loadAllViews } from '../src/testing';

describe('loadAllViews', () => {
  it('loads every view of a manifest and returns the rows by view name', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const views = loadAllViews(deps, coreModule);
    expect(Object.keys(views)).toEqual(['organization']);
    expect(views.organization).toHaveLength(1);
  });

  it('names the view and the field when a loader violates its own schema', () => {
    const broken = defineModule({
      key: 'broken',
      version: '0.0.1',
      permissions: [],
      publishedViews: [definePublishedView({ name: 'things', schema: z.object({ name: z.string() }), load: () => [{ name: 42 }] })],
    });
    const deps = createTestDeps({ manifests: [coreModule, broken] });
    expect(() => loadAllViews(deps, broken)).toThrow(/view "things" rejects its own rows: 0\.name/);
  });

  it('the organization view holds against an installation that has set nothing', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    expect(() => loadAllViews(deps, coreModule)).not.toThrow();
  });
});
```

`defineModule` und `definePublishedView` kommen über `export *` aus `packages/core/src/modules/manifest.ts` bzw. `published/view.ts`; `permissions: []` ist erlaubt (`defineModule` prüft nur die Form der Schlüssel).

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `pnpm --filter @kompass/core test -- views-hold`
Expected: FAIL, `loadAllViews` ist kein Export.

- [ ] **Step 3: Helfer schreiben**

```ts
// packages/core/src/testing/views.ts
import { ZodError } from 'zod';
import type { Deps } from '../deps';
import type { ModuleManifest } from '../modules/manifest';

/**
 * Lädt jede veröffentlichte Sicht eines Manifests. Eine Sicht, die ihre
 * eigenen Zeilen ablehnt, ist der Fehler vom 2026-09-13 (`686c843`): Der
 * Dienst nahm ein Teil-Record an, die Sicht verlangte alle Sprachen, und der
 * Export brach. Der Helfer nennt Sicht und Pfad, damit der Test es tut.
 */
export function loadAllViews(deps: Deps, manifest: ModuleManifest): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const view of manifest.publishedViews ?? []) {
    try {
      out[view.name] = view.load(deps);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        const where = first ? `${first.path.map(String).join('.')}: ${first.message}` : 'unknown issue';
        throw new Error(`view "${view.name}" rejects its own rows: ${where}`);
      }
      throw error;
    }
  }
  return out;
}
```

In `packages/core/src/testing/index.ts` ergänzen:

```ts
export { loadAllViews } from './views';
```

Hinweis: `definePublishedView` parst jede Zeile mit `schema.parse(row)`; die Exception darin ist eine `ZodError` aus `zod`. Der Pfad enthält den Zeilenindex nicht, weil `parse` je Zeile läuft; der Test oben erwartet deshalb `0.name` nur, wenn `load` die Zeilen als Ganzes parst. Prüfe in `packages/core/src/published/view.ts`: `def.load(deps).map((row) => def.schema.parse(row))` — je Zeile. Dann lautet die Erwartung im Test `/view "things" rejects its own rows: name/`. Passe den Test an, nicht den Helfer.

- [ ] **Step 4: Test laufen lassen, er muss bestehen**

Run: `pnpm --filter @kompass/core test -- views-hold`
Expected: PASS (3 Tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/views.ts packages/core/src/testing/index.ts packages/core/tests/views-hold.test.ts
git commit -m "test(core): loadAllViews names the view that rejects its own rows"
```

---

### Task 2: Tiersicht hält einem minimalen Datensatz stand

**Files:**
- Test: `packages/modules/animals/tests/views-hold.test.ts`

**Interfaces:**
- Consumes: `loadAllViews` aus Task 1; `createAnimal`, `setAnimalPublished`, `setAnimalStatus`, `setAnimalStory` aus `packages/modules/animals/src/service.ts`.

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/animals/tests/views-hold.test.ts
import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, loadAllViews } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule, createAnimal, setAnimalPublished, setAnimalStatus, setAnimalStory } from '../src';

const manage = ctxWith(['animals.manage', 'animals.view']);

/**
 * Was der Dienst annimmt, muss die Sicht liefern (Spec § 6). Der Datensatz
 * hier trägt nur die Pflichtfelder; jede mehrsprachige Angabe bleibt leer.
 */
describe('animals views hold against what the service accepts', () => {
  it('a minimal published animal with a bare story loads through every view', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });

    const a = unwrap(await createAnimal(deps, manage, { slug: 'minimal', name: 'Minimal', sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
    unwrap(await setAnimalPublished(deps, manage, { id: a.id, isPublished: true }));
    unwrap(await setAnimalStatus(deps, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    unwrap(await setAnimalStory(deps, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026 }));

    const views = loadAllViews(deps, animalsModule);
    expect(views.animals).toEqual([expect.objectContaining({ slug: 'minimal', traits: {}, story: expect.objectContaining({ adoptedYear: 2026 }) })]);
  });
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm --filter @kompass/module-animals test -- views-hold`
Expected: PASS. Sollte er scheitern, ist die Sicht strenger als der Dienst: Lies die Meldung (`view "animals" rejects its own rows: <pfad>`) und lockere das Feld in `packages/modules/animals/src/views.ts` auf das, was `animalCreateSchema` bzw. `animalStorySchema` annimmt. Die Sicht wird gelockert, nie der Dienst verschärft.

Den Paketnamen prüfen: `grep '"name"' packages/modules/animals/package.json`.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/animals/tests/views-hold.test.ts
git commit -m "test(animals): the view holds against a minimal animal and a bare story"
```

---

### Task 3: Projektsicht hält einem minimalen Datensatz stand

**Files:**
- Test: `packages/modules/projects/tests/views-hold.test.ts`

**Interfaces:**
- Consumes: `loadAllViews` aus Task 1; `createProject`, `setProjectPublished` aus `packages/modules/projects/src/service.ts`.

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/projects/tests/views-hold.test.ts
import { coreModule, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, loadAllViews } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, setProjectPublished } from '../src/service';

const manage = ctxWith(['projects.manage', 'projects.view']);

describe('projects views hold against what the service accepts', () => {
  it('a minimal published project without image or links loads through every view', async () => {
    const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });

    const p = unwrap(await createProject(deps, manage, { slug: 'minimal', name: { de: 'Minimal' }, type: 'ongoing', summary: {}, body: {} }));
    unwrap(await setProjectPublished(deps, manage, { id: p.id, isPublished: true }));

    const views = loadAllViews(deps, projectsModule);
    expect(views.projects).toEqual([expect.objectContaining({ slug: 'minimal', imageAssetId: null, externalLinks: [] })]);
  });
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm --filter @kompass/module-projects test -- views-hold`
Expected: PASS. Bei FAIL gilt dasselbe wie in Task 2: Sicht lockern (`packages/modules/projects/src/views.ts`), nicht den Dienst verschärfen.

- [ ] **Step 3: Regel in AGENTS.md**

In `AGENTS.md`, Abschnitt „Coding-Regeln", direkt nach der Zeile, die mit `- Tests: Vitest.` beginnt, eine neue Zeile einfügen:

```markdown
- Sichten nie strenger als ihre Dienste: Ein Modul mit `publishedViews` hat einen Test `tests/views-hold.test.ts`, der einen Datensatz mit nur den Pflichtfeldern über den Dienst anlegt, veröffentlicht und alle Sichten mit `loadAllViews` aus `@kompass/core/testing` lädt. Muster: `packages/modules/animals/tests/views-hold.test.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add packages/modules/projects/tests/views-hold.test.ts AGENTS.md
git commit -m "test(projects): the view holds against a minimal project, and the rule stands in AGENTS.md"
```

---

### Task 4: Bildunterschriften im Schema, in Migration und Dienst

**Files:**
- Modify: `packages/modules/animals/src/schema.ts` (Tabelle `animalStories`)
- Modify: `packages/modules/animals/src/service.ts` (`AnimalStory`, `loadAnimal`, `animalStorySchema`)
- Create (erzeugt): `packages/core/src/db/migrations/0029_*.sql` und `meta/`
- Test: `packages/modules/animals/tests/animals.test.ts`

**Interfaces:**
- Produces: `AnimalStory` erhält `beforeCaption: LocalizedText` und `afterCaption: LocalizedText`; `animalStorySchema` nimmt beide optional mit Vorgabe `{}` (max 200 Zeichen je Sprache). `animals_set_story` (MCP) erbt das über `animalStorySchema`.

- [ ] **Step 1: Test schreiben**

In `packages/modules/animals/tests/animals.test.ts` innerhalb `describe('animals module', …)` ergänzen:

```ts
  it('a story carries captions per image, empty by default, and audits them', async () => {
    const d = await deps();
    const a = unwrap(await createAnimal(d, manage, chiara));
    unwrap(await setAnimalStatus(d, manage, { id: a.id, status: 'adopted', adoptedYear: 2026 }));
    const bare = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026 }));
    expect(bare.story).toMatchObject({ beforeCaption: {}, afterCaption: {} });
    const captioned = unwrap(await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Zitat', en: '' }, family: 'Familie M.', adoptedYear: 2026, beforeCaption: { de: 'Auf der Pflegestelle', en: 'At the foster home' }, afterCaption: { de: 'Zuhause in Köln', en: '' } }));
    expect(captioned.story).toMatchObject({ beforeCaption: { de: 'Auf der Pflegestelle', en: 'At the foster home' }, afterCaption: { de: 'Zuhause in Köln', en: '' } });
    const entry = d.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry.action).toBe('animals.setStory');
    // `after` ist eine JSON-Textspalte (`packages/core/src/db/schema.ts`).
    expect(String(entry.after)).toContain('Auf der Pflegestelle');
    const tooLong = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026, beforeCaption: { de: 'x'.repeat(201) } });
    expect(tooLong.ok === false && tooLong.error.type === 'validation').toBe(true);
    const unknownLocale = await setAnimalStory(d, manage, { id: a.id, beforeAssetId: null, afterAssetId: null, quote: {}, family: '', adoptedYear: 2026, afterCaption: { fr: 'Chez nous' } });
    expect(unknownLocale.ok === false && unknownLocale.error.type === 'validation').toBe(true);
  });
```

- [ ] **Step 2: Test laufen lassen, er muss scheitern**

Run: `pnpm --filter @kompass/module-animals test -- animals.test`
Expected: FAIL, `beforeCaption` ist nicht im Ergebnis.

- [ ] **Step 3: Schema ändern**

In `packages/modules/animals/src/schema.ts` bei `animalStories` zwei Spalten ergänzen. `localizedColumn` hat keine Vorgabe; eine neue `NOT NULL`-Spalte braucht in SQLite eine, sonst scheitert `ALTER TABLE` auf bestehenden Zeilen. Deshalb inline mit `.default({})`, nach dem Muster von `website_publishes.file_manifest` (Migration 0005):

```ts
import type { LocalizedText } from '@kompass/core';
// …
export const animalStories = sqliteTable('animal_stories', {
  animalId: text('animal_id').primaryKey().references(() => animals.id),
  beforeAssetId: text('before_asset_id').references(() => core.mediaAssets.id),
  afterAssetId: text('after_asset_id').references(() => core.mediaAssets.id),
  quote: localizedColumn('quote'),
  family: text('family').notNull().default(''),
  adoptedYear: integer('adopted_year').notNull(),
  /** Unterschrift unter dem Vorher- bzw. Nachher-Bild. Leer heißt: das Template zeigt keine Ortsangabe. */
  beforeCaption: text('before_caption', { mode: 'json' }).$type<LocalizedText>().notNull().default({}),
  afterCaption: text('after_caption', { mode: 'json' }).$type<LocalizedText>().notNull().default({}),
});
```

Prüfe, ob `LocalizedText` aus `@kompass/core` exportiert ist: `grep -n "LocalizedText" packages/core/src/index.ts`.

- [ ] **Step 4: Migration erzeugen und ansehen**

Run: `pnpm --filter @kompass/core db:generate`
Expected: eine neue Datei `packages/core/src/db/migrations/0029_<name>.sql` mit zwei Zeilen der Form

```sql
ALTER TABLE `animal_stories` ADD `before_caption` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `animal_stories` ADD `after_caption` text DEFAULT '{}' NOT NULL;
```

Steht dort kein `DEFAULT '{}'`, fehlt `.default({})` im Schema. Die Datei nie von Hand ändern; lieber löschen, Schema korrigieren, neu erzeugen (auch `meta/_journal.json` und die neue `meta/0029_snapshot.json` mit entfernen). Drizzle wählt den Dateinamen selbst; benenne ihn um in `0029_animal_story_captions.sql` **und** trage denselben `tag` in `meta/_journal.json` ein, wie es die Vorgänger (`0028_projects_drop_betterplace`) zeigen.

- [ ] **Step 5: Dienst ändern**

In `packages/modules/animals/src/service.ts`:

```ts
export interface AnimalStory { beforeAssetId: string | null; afterAssetId: string | null; quote: LocalizedText; family: string; adoptedYear: number; beforeCaption: LocalizedText; afterCaption: LocalizedText }
```

In `loadAnimal` die Zuordnung ergänzen:

```ts
  return { ...row, traits: row.traits as LocalizedList, photos, story: story ? { beforeAssetId: story.beforeAssetId, afterAssetId: story.afterAssetId, quote: story.quote, family: story.family, adoptedYear: story.adoptedYear, beforeCaption: story.beforeCaption, afterCaption: story.afterCaption } : null };
```

`animalStorySchema`:

```ts
export const animalStorySchema = z.object({
  id: z.string().min(1),
  beforeAssetId: z.string().nullable(),
  afterAssetId: z.string().nullable(),
  quote: localizedText({ max: 600 }),
  family: z.string().trim().max(120),
  adoptedYear: z.number().int().min(2000).max(2100),
  // Vorgabe leer: `animals_set_story` und ältere Aufrufer kennen die Felder nicht.
  beforeCaption: localizedText({ max: 200 }).default({}),
  afterCaption: localizedText({ max: 200 }).default({}),
});
```

`setAnimalStory` selbst bleibt unverändert: `const { id, ...story } = parsed.value` trägt die neuen Felder in `insert … onConflictDoUpdate` mit.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-animals test && pnpm --filter @kompass/core test -- db.test`
Expected: PASS. `db.test.ts` listet jede Tabelle beim Namen; ändert sich dort etwas, weil die Migration eine Tabelle neu anlegt statt sie zu ändern, ist die Migration falsch (siehe Step 4).

- [ ] **Step 7: Commit**

```bash
git add packages/modules/animals/src/schema.ts packages/modules/animals/src/service.ts packages/modules/animals/tests/animals.test.ts packages/core/src/db/migrations
git commit -m "feat(animals): the adoption story carries a caption per image"
```

---

### Task 5: Bildunterschriften in Sicht und Seed

**Files:**
- Modify: `packages/modules/animals/src/views.ts`
- Modify: `packages/modules/animals/src/seed.ts`
- Test: `packages/modules/animals/tests/animals.test.ts` (Sicht-Test bei Zeile „publishes and exposes …"), `packages/modules/animals/tests/seed.test.ts`

**Interfaces:**
- Produces: `views.animals[].story` trägt `beforeCaption` und `afterCaption` (mehrsprachig, ggf. leer). Plan 4 (Vereinsrepo) liest sie.

- [ ] **Step 1: Sicht-Test erweitern**

Im Test `publishes and exposes only published animals with photos and story in the view` in `animals.test.ts` die Erwartung an `story` um die Unterschriften ergänzen. Lies die Stelle (`sed -n 63,77p packages/modules/animals/tests/animals.test.ts`) und ergänze dort, wo `setAnimalStory` aufgerufen wird, `beforeCaption: { de: 'Im Shelter', en: 'At the shelter' }`, und in der Erwartung an die Sicht:

```ts
    expect(rows[0]!.story).toMatchObject({ beforeCaption: { de: 'Im Shelter', en: 'At the shelter' }, afterCaption: {} });
```

- [ ] **Step 2: Seed-Test erweitern**

In `packages/modules/animals/tests/seed.test.ts` einen Test ergänzen:

```ts
  it('seeds two adopted animals with a story: one captioned, one without captions', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const stories = deps.db.select().from(animalStories).all();
    expect(stories.length).toBe(2);
    expect(stories.some((s) => Object.values(s.beforeCaption).some((v) => v.length > 0))).toBe(true);
    expect(stories.some((s) => Object.keys(s.beforeCaption).length === 0 && Object.keys(s.afterCaption).length === 0)).toBe(true);
  });
```

Import ergänzen: `import { animalStories, animals } from '../src/schema';`

- [ ] **Step 3: Tests laufen lassen, sie müssen scheitern**

Run: `pnpm --filter @kompass/module-animals test`
Expected: FAIL in beiden neuen Erwartungen (Sicht ohne `beforeCaption`, Seed ohne Geschichten).

- [ ] **Step 4: Sicht ergänzen**

In `packages/modules/animals/src/views.ts` im `story`-Objekt:

```ts
    story: z
      .object({
        beforeAssetId: z.string().nullable(),
        afterAssetId: z.string().nullable(),
        quote: L,
        family: z.string(),
        adoptedYear: z.number(),
        beforeCaption: L,
        afterCaption: L,
      })
      .nullable(),
```

- [ ] **Step 5: Seed ergänzen**

In `packages/modules/animals/src/seed.ts`:

1. Import erweitern: `import { createAnimal, setAnimalPublished, setAnimalStatus, setAnimalStory } from './service';`
2. Dem Eintrag `nala` eine Geschichte geben und einen vierten Hund `juno` anlegen. Typ des Arrays: die Einträge bekommen ein optionales Feld `story`. Ergänze bei `nala` nach `published: false,`:

```ts
    story: {
      quote: { de: 'Nala schläft jetzt auf dem Sofa, als hätte sie nie woanders gelebt.', en: 'Nala now sleeps on the sofa as if she had never lived anywhere else.' },
      family: 'Familie Berger',
      beforeCaption: { de: 'Auf der Pflegestelle in Bonn', en: 'At the foster home in Bonn' },
      afterCaption: { de: 'Zuhause am Rhein', en: 'At home by the Rhine' },
    },
```

und als weiteren Eintrag am Ende von `EXAMPLE_ANIMALS`:

```ts
  {
    slug: 'juno',
    name: 'Juno',
    sex: 'female' as const,
    birthText: { de: '2020', en: '2020' },
    sizeCm: 52,
    sizeText: { de: 'ca. 52 cm', en: 'approx. 52 cm' },
    location: 'germany' as const,
    isEmergency: false,
    isSponsorable: false,
    traits: { de: ['aufmerksam'], en: ['attentive'] },
    summary: { de: 'Hat 2024 ihre Familie gefunden.', en: 'Found her family in 2024.' },
    body: { de: 'Juno ist vermittelt; ihre Geschichte hat keine Bildunterschriften.', en: 'Juno has been adopted; her story carries no captions.' },
    status: 'adopted' as const,
    adoptedYear: 2024,
    published: true,
    story: {
      quote: { de: 'Sie hat uns vom ersten Tag an ausgesucht.', en: 'She chose us from day one.' },
      family: 'Familie Kaya',
      beforeCaption: {},
      afterCaption: {},
    },
  },
```

3. In `seedAnimals` nach dem Statuswechsel:

```ts
    if (a.status === 'adopted' && 'story' in a && a.story) {
      unwrap(await setAnimalStory(deps, ctx, { id: created.id, beforeAssetId: null, afterAssetId: null, quote: a.story.quote, family: a.story.family, adoptedYear: a.adoptedYear!, beforeCaption: a.story.beforeCaption, afterCaption: a.story.afterCaption }));
    }
```

Damit TypeScript `a.story` kennt, deklariere den Typ des Arrays explizit, statt ihn ableiten zu lassen:

```ts
interface ExampleStory { quote: LocalizedText; family: string; beforeCaption: LocalizedText; afterCaption: LocalizedText }
interface ExampleAnimal { slug: string; name: string; sex: 'female' | 'male'; birthText: LocalizedText; sizeCm: number; sizeText: LocalizedText; location: 'shelter' | 'germany'; isEmergency: boolean; isSponsorable: boolean; traits: Record<string, string[]>; summary: LocalizedText; body: LocalizedText; status: 'lookingForHome' | 'reserved' | 'adopted'; adoptedYear?: number; published: boolean; story?: ExampleStory }
const EXAMPLE_ANIMALS: ExampleAnimal[] = [ … ];
```

`LocalizedText` aus `@kompass/core` importieren. Die `as const` an den Einträgen können dann entfallen.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-animals test && pnpm --filter @kompass/core test -- no-association-content seed`
Expected: PASS. `no-association-content.test.ts` prüft, dass keine echten Vereinsinhalte im Seed stehen; die Namen oben sind erfunden.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/animals/src/views.ts packages/modules/animals/src/seed.ts packages/modules/animals/tests
git commit -m "feat(animals): captions reach the published view, and the seed shows a story with and without them"
```

---

### Task 6: Bildunterschriften in der Geschichte-Maske, Hilfetext am Profil-Link

**Files:**
- Modify: `apps/kompass/src/app/(shell)/animals/story-form.tsx`
- Modify: `apps/kompass/src/app/(shell)/animals/actions.ts` (`saveAnimalStoryAction`)
- Modify: `apps/kompass/messages/de.json` (`animals.form.externalHint`, `animals.story.beforeCaption`, `animals.story.afterCaption`, `animals.story.captionHint`)
- Test: `apps/kompass/e2e/animals.spec.ts`

**Interfaces:**
- Consumes: `animalStorySchema` mit `beforeCaption`/`afterCaption` aus Task 4; `localizedFromForm` aus `apps/kompass/src/lib/localized-form.ts`.

- [ ] **Step 1: E2E erweitern**

In `apps/kompass/e2e/animals.spec.ts`, im Test `creates a dog, adds photos, publishes, adopts with a story`, nach der Zeile `await page.getByLabel('Familie').fill('Familie M.');` ergänzen:

```ts
    await page.locator('[name="beforeCaption.de"]').fill('Auf der Pflegestelle');
    await page.locator('[name="afterCaption.de"]').fill('Zuhause in Köln');
```

und nach `await expect(page.getByRole('status')).toContainText('Geschichte gespeichert');`:

```ts
    await page.reload();
    await page.getByRole('tab', { name: 'Geschichte' }).click();
    await expect(page.locator('[name="beforeCaption.de"]')).toHaveValue('Auf der Pflegestelle');
    await expect(page.locator('[name="afterCaption.de"]')).toHaveValue('Zuhause in Köln');
```

Im selben Test, direkt nach `await page.getByLabel('Name').fill('Chiara');` (der Steckbrief ist dort offen), eine Erwartung an den Hilfetext ergänzen:

```ts
    await expect(page.getByText('laufen Anfragen auf der Webseite über den Partner')).toBeVisible();
```

- [ ] **Step 2: Sprachdatei**

In `apps/kompass/messages/de.json`:

- `animals.form.externalHint` ersetzen durch: `"Trägt ein Hund diesen Link, laufen Anfragen auf der Webseite über den Partner statt per E-Mail an den Verein. Ohne Link erscheint das E-Mail-Formular."`
- Unter `animals.story` ergänzen:

```json
      "beforeCaption": "Unterschrift unter dem Vorher-Bild",
      "afterCaption": "Unterschrift unter dem Nachher-Bild",
      "captionHint": "Leer heißt: keine Ortsangabe unter dem Bild."
```

Die Datei ist alphabetisch nicht sortiert; hänge die Schlüssel hinter `"year"` an. Danach `pnpm --filter @kompass/app test -- message-keys`, damit kein verwaister oder fehlender Schlüssel bleibt.

- [ ] **Step 3: Maske**

In `story-form.tsx` nach dem `LocalizedField` für `quote`:

```tsx
      <LocalizedField name="beforeCaption" label={t('beforeCaption')} hint={t('captionHint')} value={story?.beforeCaption ?? {}} locales={locales} />
      <LocalizedField name="afterCaption" label={t('afterCaption')} hint={t('captionHint')} value={story?.afterCaption ?? {}} locales={locales} />
```

`LocalizedField` kennt `hint?: string` (Zeile 29 der Komponente) und zeigt ihn unter dem Feld, solange kein Fehler steht.

- [ ] **Step 4: Action**

In `saveAnimalStoryAction` in `actions.ts` zwei Zeilen ergänzen:

```ts
    beforeCaption: localizedFromForm(formData, 'beforeCaption', deps.locales()),
    afterCaption: localizedFromForm(formData, 'afterCaption', deps.locales()),
```

- [ ] **Step 5: Typecheck und E2E**

Run: `pnpm typecheck`
Expected: keine Fehler.

Run: `pnpm --filter @kompass/app e2e -- animals.spec` (Playwright startet `next dev -p 3100` selbst, siehe `webServer` in `apps/kompass/playwright.config.ts`; ein bereits laufender Server auf 3100 lässt den Lauf scheitern)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/kompass/src/app/(shell)/animals/story-form.tsx" "apps/kompass/src/app/(shell)/animals/actions.ts" apps/kompass/messages/de.json apps/kompass/e2e/animals.spec.ts
git commit -m "feat(animals): captions in the story form, and the profile link says what it does"
```

---

### Task 7: Backlog bereinigen

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Einträge entfernen**

Die Abschnitte `## 11.`, `## 14.`, `## 15.` und `## 16.` samt Text löschen. Erledigtes wird gelöscht, nicht abgehakt (Kopfzeile der Datei). Bei Punkt 11 ist die Begründung: Die Werkzeuge `site_<sammlung>_*` bestehen seit `6952331`. Punkt 17 bleibt, bis Plan 3 durch ist.

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md
git commit -m "docs(backlog): views hold, captions and the profile hint are built; the collection tools already existed"
```

---

## Selbstprüfung gegen die Spec

- § 6 Helfer, Tests je Modul, Kern gegen leere Einstellungen, AGENTS-Regel: Tasks 1 bis 3.
- § 8 Spalten, Migration, Schema, Maske, Sicht, Seed mit und ohne Unterschrift, Tests: Tasks 4 bis 6. Der Template-Teil steht in Plan 4.
- § 8 Hilfetext: Task 6.
- § 10 Backlog: Task 7.
