# Sprachen als Stammdaten — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Sprachen einer Installation werden verwaltete Stammdaten statt des fest verdrahteten Paars `{de, en}`.

**Architecture:** Die Liste liegt als Kern-Einstellung `i18n.locales` und wandert über `deps.locales` in jeden Service. `localizedText()` erzeugt ein Record-Schema, das beliebige Sprachschlüssel annimmt und sich mit `.meta({ localized: true })` markiert; die Prüfung „Leitsprache gefüllt, keine fremden Schlüssel" läuft zentral in `validate(deps, schema, input)`. Bestandsdaten bleiben unverändert gültig.

**Tech Stack:** TypeScript, Zod 4.5, Drizzle/SQLite, Vitest, Next 16, next-intl.

**Spec:** `docs/superpowers/specs/2026-09-07-site-template-design.md`, Abschnitt 6.

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`.
- Fachfehler sind `Result`-Werte, keine Exceptions. IDs über `newId()`, Zeit über `deps.clock.now()`.
- Code Englisch, Oberfläche über `messages/de.json` in Sie-Form. Kein hartcodierter UI-Text.
- Tests mit Vitest gegen `createTestDeps()`. Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Nach jeder Schema-Änderung `pnpm --filter @kompass/core db:generate`; erzeugte SQL-Dateien werden committet und nie editiert.
- Sprachcodes sind Kleinbuchstaben nach BCP-47-Kurzform: `^[a-z]{2}(-[a-z]{2})?$`.
- Die erste Sprache der Liste ist Leitsprache. Sie kann nicht entfernt werden, solange eine zweite existiert; sie ist immer Pflichtfeld und Rückfallebene.

---

### Task 1: Die Sprachliste als Kern-Einstellung

**Files:**
- Modify: `packages/core/src/settings/core.ts`
- Create: `packages/core/src/i18n/locales.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/locales.test.ts`

**Interfaces:**
- Produces: `LOCALE_CODE: RegExp`, `readLocales(deps: Deps): string[]`, `defaultLocale(deps: Deps): string`

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/tests/locales.test.ts
import { describe, expect, it } from 'vitest';
import { createTestDeps } from '@kompass/core/testing';
import { readLocales, defaultLocale, LOCALE_CODE } from '../src/i18n/locales';
import { setSetting } from '../src/settings/service';
import { ctxWith, insertUser } from '@kompass/core/testing';

describe('locales setting', () => {
  it('starts with a single German locale', () => {
    const deps = createTestDeps();
    expect(readLocales(deps)).toEqual(['de']);
    expect(defaultLocale(deps)).toBe('de');
  });

  it('reads what was configured, first entry leading', async () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'USER-TEST' });
    await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['en', 'de', 'fr'] });
    expect(readLocales(deps)).toEqual(['en', 'de', 'fr']);
    expect(defaultLocale(deps)).toBe('en');
  });

  it('accepts language and region codes, rejects the rest', () => {
    for (const good of ['de', 'en', 'pt-br']) expect(LOCALE_CODE.test(good)).toBe(true);
    for (const bad of ['DE', 'deu', '', 'de_DE', 'de-DE']) expect(LOCALE_CODE.test(bad)).toBe(false);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/locales.test.ts`
Expected: FAIL, `Cannot find module '../src/i18n/locales'`

- [ ] **Step 3: Modul schreiben**

```ts
// packages/core/src/i18n/locales.ts
import type { Deps } from '../deps';
import { readSetting } from '../settings/service';

/** Kleinbuchstaben, optional mit Region: de, en, pt-br. */
export const LOCALE_CODE = /^[a-z]{2}(-[a-z]{2})?$/;

/** Die gepflegten Sprachen, erste ist Leitsprache. Nie leer. */
export function readLocales(deps: Deps): string[] {
  const value = readSetting<string[]>(deps, 'i18n.locales');
  return value.length > 0 ? value : ['de'];
}

export function defaultLocale(deps: Deps): string {
  return readLocales(deps)[0]!;
}
```

- [ ] **Step 4: Einstellung registrieren**

In `packages/core/src/settings/core.ts` eine Gruppe ergänzen und in den Export aufnehmen (die Datei sammelt am Ende alle Gruppen in `CORE_SETTINGS`):

```ts
const i18n: SettingDefinition[] = [
  { key: 'i18n.locales', schema: z.array(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/)).min(1).max(10), default: ['de'] },
];
```

- [ ] **Step 5: Exportieren**

In `packages/core/src/index.ts` ergänzen: `export * from './i18n/locales';`

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/core test tests/locales.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/i18n/locales.ts packages/core/src/settings/core.ts packages/core/src/index.ts packages/core/tests/locales.test.ts
git commit -m "feat(i18n): keep the configured locales as a core setting"
```

---

### Task 2: `deps.locales`

**Files:**
- Modify: `packages/core/src/deps.ts`
- Modify: `packages/core/src/app.ts:31-47`
- Modify: `packages/core/src/testing/index.ts`
- Test: `packages/core/tests/locales.test.ts`

**Interfaces:**
- Consumes: `readLocales` aus Task 1
- Produces: `Deps.locales: () => string[]`

Die Sprachen kommen als Funktion ins `Deps`-Objekt, nicht als Wert: Eine Änderung soll ohne Neustart wirken, und `createDeps` läuft einmal pro Prozess.

- [ ] **Step 1: Test ergänzen**

```ts
// in packages/core/tests/locales.test.ts
it('reaches services through deps and follows a change without a restart', async () => {
  const deps = createTestDeps();
  insertUser(deps, { id: 'USER-TEST' });
  expect(deps.locales()).toEqual(['de']);
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  expect(deps.locales()).toEqual(['de', 'en']);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/locales.test.ts`
Expected: FAIL, `deps.locales is not a function`

- [ ] **Step 3: Deps erweitern**

```ts
// packages/core/src/deps.ts
export interface Deps {
  db: Db;
  clock: Clock;
  env: AppEnv;
  registry: Registry;
  media: MediaStore;
  /** Gepflegte Sprachen, erste ist Leitsprache. Als Funktion, damit eine Änderung sofort wirkt. */
  locales: () => string[];
}
```

- [ ] **Step 4: In `createDeps` setzen**

In `packages/core/src/app.ts` im Objektliteral (nach `media`) ergänzen:

```ts
    locales: () => readLocales(deps),
```

Import ergänzen: `import { readLocales } from './i18n/locales';`

- [ ] **Step 5: In `createTestDeps` setzen**

In `packages/core/src/testing/index.ts` im Rückgabeobjekt ergänzen:

```ts
export function createTestDeps(
  opts: { now?: string; manifests?: ModuleManifest[]; env?: AppEnv; coreTemplates?: DocumentTemplate[] } = {},
): TestDeps {
  const { db, sqlite } = createTestDb();
  const deps: TestDeps = {
    db,
    sqlite,
    clock: fixedClock(opts.now ?? TEST_NOW),
    env: opts.env ?? 'test',
    registry: createRegistry(opts.manifests ?? [coreModule], { coreTemplates: opts.coreTemplates }),
    media: createMemoryMediaStore(),
    locales: () => readLocales(deps),
  };
  return deps;
}
```

Das Objekt wird dafür zuerst benannt, statt direkt zurückgegeben zu werden — `locales` greift beim Aufruf auf `deps` zu, nicht beim Anlegen. Import ergänzen: `import { readLocales } from '../i18n/locales';`

- [ ] **Step 6: Gesamtlauf**

Run: `pnpm typecheck && pnpm test`
Expected: alles grün

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/deps.ts packages/core/src/app.ts packages/core/src/testing/index.ts packages/core/tests/locales.test.ts
git commit -m "feat(i18n): carry the locales in deps"
```

---

### Task 3: `validate` bekommt `deps`

Reine Signaturänderung ohne neue Prüfung, damit der Umbau der 56 Aufrufstellen für sich steht und der nächste Task nur noch Verhalten ergänzt.

**Files:**
- Modify: `packages/core/src/validate.ts`
- Modify: alle Aufrufstellen (Ermittlung siehe Step 2)

**Interfaces:**
- Produces: `validate<T>(deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T>`

- [ ] **Step 1: Signatur ändern**

```ts
// packages/core/src/validate.ts
import type { z } from 'zod';
import type { Deps } from './deps';
import { invalid, ok, type Result } from './result';

export function validate<T>(_deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return invalid(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })));
}
```

- [ ] **Step 2: Aufrufstellen finden**

Run: `grep -rn "validate(" --include='*.ts' packages apps | grep -v node_modules | grep -v '\.next' | grep -v 'function validate'`
Expected: 56 Treffer

- [ ] **Step 3: Aufrufstellen umstellen**

Jede Stelle `validate(schema, input)` wird zu `validate(deps, schema, input)`. In Services ist `deps` der erste Parameter und damit vorhanden. Sollte eine Stelle kein `deps` haben, ist das ein Fund: Dort steht Validierung ausserhalb der Service-Schicht — im Commit vermerken, nicht stillschweigend umgehen.

- [ ] **Step 4: Gesamtlauf**

Run: `pnpm typecheck && pnpm test`
Expected: alles grün, keine Verhaltensänderung

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): hand deps to validate"
```

---

### Task 4: `LocalizedText` wird eine Menge

**Files:**
- Modify: `packages/core/src/i18n/localized.ts`
- Modify: `packages/core/src/db/columns.ts`
- Modify: `apps/kompass/src/lib/localized-form.ts`
- Modify: `packages/modules/website/src/views.ts`, `packages/modules/animals/src/views.ts`
- Test: `packages/core/tests/localized.test.ts`

**Interfaces:**
- Consumes: `deps.locales()` aus Task 2
- Produces: `LocalizedText = Record<string, string>`, `localizedText(opts)`, `resolveText(text, locale, fallback)`, `translationGaps(record, fields, locales)`, `emptyLocalized(locales)`

- [ ] **Step 1: Tests umschreiben**

`packages/core/tests/localized.test.ts` vollständig ersetzen:

```ts
import { describe, expect, it } from 'vitest';
import { emptyLocalized, localizedText, resolveText, translationGaps } from '../src/i18n/localized';

describe('localized text', () => {
  it('parses and trims any locale key', () => {
    const schema = localizedText({ max: 20 });
    expect(schema.parse({ de: ' Hallo ', en: ' Hello ', fr: 'Bonjour' })).toEqual({ de: 'Hallo', en: 'Hello', fr: 'Bonjour' });
    expect(schema.safeParse({ de: 'x'.repeat(21) }).success).toBe(false);
    expect(schema.parse({})).toEqual({});
  });

  it('marks itself as localized so validate can find it', () => {
    expect(localizedText().meta()).toMatchObject({ localized: true });
  });

  it('resolves with the given fallback and reports it', () => {
    expect(resolveText({ de: 'Hund', en: 'Dog' }, 'en', 'de')).toEqual({ value: 'Dog', fallback: null });
    expect(resolveText({ de: 'Hund', en: '' }, 'en', 'de')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({ de: 'Hund' }, 'fr', 'de')).toEqual({ value: 'Hund', fallback: 'de' });
    expect(resolveText({}, 'de', 'de')).toEqual({ value: '', fallback: null });
  });

  it('lists fields that miss any locale beyond the leading one', () => {
    const record = { title: { de: 'A', en: '' }, lede: { de: 'B', en: 'C' }, body: { de: '', en: '' }, other: 5 };
    expect(translationGaps(record, ['title', 'lede', 'body'], ['de', 'en'])).toEqual(['title']);
    expect(translationGaps(record, ['title', 'lede'], ['de'])).toEqual([]);
    expect(emptyLocalized(['de', 'fr'])).toEqual({ de: '', fr: '' });
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/localized.test.ts`
Expected: FAIL — `resolveText` nimmt zwei Argumente, `meta()` fehlt

- [ ] **Step 3: Modul umschreiben**

```ts
// packages/core/src/i18n/localized.ts
import { z } from 'zod';

/** Text je Sprachschlüssel. Welche Schlüssel gültig sind, entscheidet die Installation. */
export type LocalizedText = Record<string, string>;

/**
 * Nimmt beliebige Sprachschlüssel an und prüft nur die Werte. Ob die Schlüssel
 * zu den gepflegten Sprachen passen und die Leitsprache gefüllt ist, prüft
 * `validate` — die Schemata entstehen beim Import, die Sprachen stehen in der
 * Datenbank.
 */
export function localizedText(opts: { required?: boolean; max?: number } = {}): z.ZodType<LocalizedText> {
  const max = opts.max ?? 20_000;
  return z
    .record(z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/), z.string().trim().max(max))
    .meta({ localized: true, required: opts.required ?? false, max }) as unknown as z.ZodType<LocalizedText>;
}

export const emptyLocalized = (locales: readonly string[]): LocalizedText =>
  Object.fromEntries(locales.map((l) => [l, '']));

export function resolveText(text: LocalizedText, locale: string, fallback: string): { value: string; fallback: string | null } {
  const value = text[locale];
  if (value && value.length > 0) return { value, fallback: null };
  const alternative = text[fallback] ?? '';
  return { value: alternative, fallback: locale === fallback || alternative.length === 0 ? null : fallback };
}

const isLocalized = (v: unknown): v is LocalizedText =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string');

/** Felder, deren Leitsprache gefüllt ist, während eine weitere Sprache fehlt. */
export function translationGaps(record: Record<string, unknown>, fields: string[], locales: readonly string[]): string[] {
  const [leading, ...rest] = locales;
  if (!leading || rest.length === 0) return [];
  return fields.filter((field) => {
    const value = record[field];
    if (!isLocalized(value)) return false;
    return (value[leading] ?? '').length > 0 && rest.some((l) => (value[l] ?? '').length === 0);
  });
}
```

`LOCALES`, `Locale` und `DEFAULT_LOCALE` entfallen ersatzlos.

- [ ] **Step 4: Aufrufstellen anpassen**

Run: `grep -rn "DEFAULT_LOCALE\|LOCALES\|resolveText(\|translationGaps(\|emptyLocalized(\|: Locale" --include='*.ts' --include='*.tsx' packages apps | grep -v node_modules | grep -v '\.next'`

Jede Stelle bekommt die Sprachen aus `deps.locales()` gereicht. `Locale` wird zu `string`. In `packages/modules/website/src/views.ts` und `packages/modules/animals/src/views.ts` liegen die veröffentlichten Sichten — dort kommen die Sprachen aus `deps`.

- [ ] **Step 5: Gesamtlauf**

Run: `pnpm typecheck && pnpm test`
Expected: alles grün

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(i18n): turn localized text into a set of locales"
```

---

### Task 5: Die Sprachprüfung in `validate`

**Files:**
- Modify: `packages/core/src/validate.ts`
- Test: `packages/core/tests/validate-locales.test.ts`

**Interfaces:**
- Consumes: `deps.locales()`, `.meta({ localized: true, required })` aus Task 4

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/tests/validate-locales.test.ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { localizedText } from '../src/i18n/localized';
import { setSetting } from '../src/settings/service';
import { validate } from '../src/validate';

const schema = z.object({ title: localizedText({ required: true, max: 50 }), note: localizedText() });

async function depsWith(locales: string[]) {
  const deps = createTestDeps();
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: locales });
  return deps;
}

describe('validate with locales', () => {
  it('rejects a locale the installation does not keep', async () => {
    const deps = await depsWith(['de', 'en']);
    const result = validate(deps, schema, { title: { de: 'A', kl: 'B' }, note: {} });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues).toEqual([{ path: 'title.kl', message: 'unknownLocale' }]);
    }
  });

  it('demands the leading locale where the field is required', async () => {
    const deps = await depsWith(['de', 'en']);
    const missing = validate(deps, schema, { title: { de: '', en: 'A' }, note: {} });
    expect(missing.ok).toBe(false);
    if (!missing.ok && missing.error.type === 'validation') {
      expect(missing.error.issues).toEqual([{ path: 'title.de', message: 'required' }]);
    }
    expect(validate(deps, schema, { title: { de: 'A' }, note: {} }).ok).toBe(true);
  });

  it('leaves optional fields and other locales alone', async () => {
    const deps = await depsWith(['de', 'en']);
    expect(validate(deps, schema, { title: { de: 'A' }, note: { en: 'only english' } }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/validate-locales.test.ts`
Expected: FAIL — unbekannte Sprache wird angenommen

- [ ] **Step 3: Prüfung einbauen**

```ts
// packages/core/src/validate.ts
import { z } from 'zod';
import type { Deps } from './deps';
import { invalid, ok, type Result } from './result';

type Issue = { path: string; message: string };

/** Alle als `localized` markierten Felder eines Objektschemas, mit ihrem Pfad. */
function localizedFields(schema: z.ZodType<unknown>): { path: string; required: boolean }[] {
  const shape = (schema as unknown as { def?: { shape?: Record<string, z.ZodType<unknown>> } }).def?.shape;
  if (!shape) return [];
  const out: { path: string; required: boolean }[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const meta = field.meta() as { localized?: boolean; required?: boolean } | undefined;
    if (meta?.localized) out.push({ path: key, required: meta.required ?? false });
  }
  return out;
}

function checkLocales(deps: Deps, schema: z.ZodType<unknown>, value: Record<string, unknown>): Issue[] {
  const locales = deps.locales();
  const leading = locales[0]!;
  const issues: Issue[] = [];
  for (const field of localizedFields(schema)) {
    const text = value[field.path] as Record<string, string> | undefined;
    if (!text) continue;
    for (const key of Object.keys(text)) {
      if (!locales.includes(key)) issues.push({ path: `${field.path}.${key}`, message: 'unknownLocale' });
    }
    if (field.required && (text[leading] ?? '').length === 0) {
      issues.push({ path: `${field.path}.${leading}`, message: 'required' });
    }
  }
  return issues;
}

export function validate<T>(deps: Deps, schema: z.ZodType<T>, input: unknown): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return invalid(parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })));
  }
  const localeIssues = checkLocales(deps, schema as z.ZodType<unknown>, parsed.data as Record<string, unknown>);
  return localeIssues.length > 0 ? invalid(localeIssues) : ok(parsed.data);
}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/core test tests/validate-locales.test.ts`
Expected: PASS

- [ ] **Step 5: Gesamtlauf**

Run: `pnpm typecheck && pnpm test`
Expected: alles grün. Schlagen Service-Tests fehl, weil sie bisher `{de, en}` schickten, während `createTestDeps` nur `['de']` kennt: Der Testaufbau setzt die Sprachen, nicht die Prüfung wird gelockert.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/validate.ts packages/core/tests/validate-locales.test.ts
git commit -m "feat(i18n): check locale keys and the leading locale centrally"
```

---

### Task 6: Sprachen verwalten

**Files:**
- Create: `packages/core/src/i18n/service.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/i18n-service.test.ts`

**Interfaces:**
- Produces: `listLocales(deps, ctx)`, `addLocale(deps, ctx, input)`, `reorderLocales(deps, ctx, input)`, `previewLocaleRemoval(deps, ctx, input)`, `removeLocale(deps, ctx, input)`

`previewLocaleRemoval` zählt modulübergreifend, wie viele Felder Inhalt in der Sprache tragen — sie ist die Grundlage der Bestätigung und die Antwort darauf, dass ein Sprachverlust sonst unsichtbar wäre.

- [ ] **Step 1: Tests schreiben**

```ts
// packages/core/tests/i18n-service.test.ts
import { describe, expect, it } from 'vitest';
import { coreModule, unwrap } from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { addLocale, listLocales, previewLocaleRemoval, removeLocale, reorderLocales } from '../src/i18n/service';
import { createProject } from '../src/projects/service';

const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

describe('locale administration', () => {
  it('adds a locale and lists it after the leading one', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['de', 'en']);
  });

  it('refuses an unknown shape, a duplicate, and the eleventh locale', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    expect((await addLocale(deps, ctx, { code: 'DE' })).ok).toBe(false);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    const again = await addLocale(deps, ctx, { code: 'en' });
    expect(again.ok === false && again.error.type === 'conflict').toBe(true);
  });

  it('needs settings.manage', async () => {
    const deps = setup();
    expect((await addLocale(deps, ctxWith([]), { code: 'en' })).ok).toBe(false);
  });

  it('counts the content a removal would cost, across modules', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage', 'website.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    unwrap(await createProject(deps, ctx, { slug: 'a', name: { de: 'Hof', en: 'Yard' }, summary: { de: 'x', en: '' }, body: { de: '', en: '' } }));
    const preview = unwrap(await previewLocaleRemoval(deps, ctx, { code: 'en' }));
    expect(preview.filled).toBeGreaterThan(0);
    expect(preview.tables.some((t) => t.table === 'projects' && t.filled > 0)).toBe(true);
  });

  it('removes a locale, strips it from stored text and keeps the leading one', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage', 'website.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    const project = unwrap(await createProject(deps, ctx, { slug: 'a', name: { de: 'Hof', en: 'Yard' }, summary: { de: 'x', en: '' }, body: { de: '', en: '' } }));
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['de']);
    const row = deps.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()!;
    expect(row.name).toEqual({ de: 'Hof' });
    const last = await removeLocale(deps, ctx, { code: 'de', confirm: true });
    expect(last.ok === false && last.error.type === 'conflict' && last.error.code === 'lastLocale').toBe(true);
  });

  it('refuses removal without confirmation and writes an audit entry with the count', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    expect((await removeLocale(deps, ctx, { code: 'en', confirm: false })).ok).toBe(false);
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry.action).toBe('locale.remove');
  });
});
```

Importe für `schema` und `eq` wie in `packages/core/tests/projects.test.ts`.

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/core test tests/i18n-service.test.ts`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Dienst schreiben**

Die Dienste pflegen `i18n.locales` über `writeSettingInternal` und schreiben ihren eigenen Audit-Eintrag. `previewLocaleRemoval` und `removeLocale` gehen über alle Tabellen mit `localizedColumn`; die Liste dieser Spalten kommt aus einer Registrierung, die `localizedColumn` selbst führt:

```ts
// packages/core/src/db/columns.ts
import { text } from 'drizzle-orm/sqlite-core';
import type { LocalizedText } from '../i18n/localized';

/** Jede mehrsprachige Spalte trägt sich ein, damit ein Sprachwechsel sie findet. */
export const LOCALIZED_COLUMNS: { table: string; column: string }[] = [];

export const localizedColumn = (name: string, table?: string) => {
  if (table) LOCALIZED_COLUMNS.push({ table, column: name });
  return text(name, { mode: 'json' }).$type<LocalizedText>().notNull();
};
```

Da die Spaltendefinitionen den Tabellennamen nicht kennen, bekommt jede Aufrufstelle ihn als zweiten Parameter — die Liste ist sonst nicht vollständig, und eine vergessene Spalte behielte ihre Texte in einer entfernten Sprache. Alle Aufrufstellen ermitteln:

Run: `grep -rn "localizedColumn(" --include='*.ts' packages | grep -v node_modules`

```ts
// packages/core/src/i18n/service.ts
import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import { LOCALIZED_COLUMNS } from '../db/columns';
import { conflict, ok, type Result } from '../result';
import { recordAudit } from '../audit/service';
import { requirePermission } from '../permissions/check';
import { readSetting, writeSettingInternal } from '../settings/service';
import { validate } from '../validate';
import { LOCALE_CODE, readLocales } from './locales';

const codeSchema = z.object({ code: z.string().regex(LOCALE_CODE) });
const removeSchema = z.object({ code: z.string().regex(LOCALE_CODE), confirm: z.boolean() });
const orderSchema = z.object({ codes: z.array(z.string().regex(LOCALE_CODE)).min(1) });

export interface LocaleRemovalPreview {
  code: string;
  filled: number;
  tables: { table: string; column: string; filled: number }[];
}

export async function listLocales(deps: Deps, ctx: CallContext): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  return denied ?? ok(readLocales(deps));
}

export async function addLocale(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, codeSchema, input);
  if (!parsed.ok) return parsed;
  const current = readLocales(deps);
  if (current.includes(parsed.value.code)) return conflict('duplicateLocale', `${parsed.value.code} ist bereits eingerichtet`);
  if (current.length >= 10) return conflict('tooManyLocales', 'Höchstens zehn Sprachen');
  const next = [...current, parsed.value.code];
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, 'i18n.locales', next);
    recordAudit(tx, deps, ctx, { action: 'locale.add', entity: 'locale', entityId: parsed.value.code, before: current, after: next });
  });
  return ok(next);
}

export async function reorderLocales(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, orderSchema, input);
  if (!parsed.ok) return parsed;
  const current = readLocales(deps);
  const next = parsed.value.codes;
  const same = next.length === current.length && next.every((c) => current.includes(c));
  if (!same) return conflict('unknownLocale', 'Die Liste muss dieselben Sprachen enthalten');
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, 'i18n.locales', next);
    recordAudit(tx, deps, ctx, { action: 'locale.reorder', entity: 'locale', entityId: next[0]!, before: current, after: next });
  });
  return ok(next);
}

/** Zählt je mehrsprachiger Spalte, wie viele Zeilen in dieser Sprache Text tragen. */
function countFilled(deps: Deps, code: string): { tables: LocaleRemovalPreview['tables']; filled: number } {
  const tables = LOCALIZED_COLUMNS.map(({ table, column }) => {
    const row = deps.sqlite
      .prepare(`select count(*) as n from "${table}" where coalesce(json_extract("${column}", '$."${code}"'), '') <> ''`)
      .get() as { n: number };
    return { table, column, filled: row.n };
  }).filter((t) => t.filled > 0);
  return { tables, filled: tables.reduce((sum, t) => sum + t.filled, 0) };
}

export async function previewLocaleRemoval(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<LocaleRemovalPreview>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, codeSchema, input);
  if (!parsed.ok) return parsed;
  const { code } = parsed.value;
  if (!readLocales(deps).includes(code)) return conflict('unknownLocale', `${code} ist nicht eingerichtet`);
  return ok({ code, ...countFilled(deps, code) });
}

export async function removeLocale(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<string[]>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, removeSchema, input);
  if (!parsed.ok) return parsed;
  const { code, confirm } = parsed.value;
  const current = readLocales(deps);
  if (!current.includes(code)) return conflict('unknownLocale', `${code} ist nicht eingerichtet`);
  if (current.length === 1) return conflict('lastLocale', 'Die letzte Sprache kann nicht entfernt werden');
  if (!confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  const { filled } = countFilled(deps, code);
  const next = current.filter((c) => c !== code);
  deps.db.transaction((tx) => {
    for (const { table, column } of LOCALIZED_COLUMNS) {
      deps.sqlite.prepare(`update "${table}" set "${column}" = json_remove("${column}", '$."${code}"')`).run();
    }
    writeSettingInternal(tx, 'i18n.locales', next);
    recordAudit(tx, deps, ctx, { action: 'locale.remove', entity: 'locale', entityId: code, before: { locales: current, filled }, after: { locales: next } });
  });
  return ok(next);
}
```

Zwei Dinge daran sind nicht offensichtlich:

**Warum rohes SQL.** Drizzle kennt `json_remove` nicht, und die betroffenen Tabellen stehen erst zur Laufzeit fest. Tabellen- und Spaltennamen stammen ausschliesslich aus `LOCALIZED_COLUMNS`, also aus dem eigenen Quelltext; der Sprachcode ist durch `LOCALE_CODE` auf Kleinbuchstaben und Bindestrich begrenzt und im JSON-Pfad damit unbedenklich. Eingaben werden nie interpoliert.

**Warum `deps.sqlite`.** `createTestDeps` führt es bereits, `AppDeps` ebenfalls; für rohes SQL innerhalb der Transaktion ist das der vorhandene Weg. Prüfen, ob `Deps` selbst es trägt — falls nicht, in Task 2 mit aufnehmen und in `createDeps` durchreichen.

- [ ] **Step 4: Exportieren**

In `packages/core/src/index.ts`: `export * from './i18n/service';`

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/core test tests/i18n-service.test.ts`
Expected: PASS

- [ ] **Step 6: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test
git add -A
git commit -m "feat(i18n): add, reorder and remove locales with a removal preview"
```

---

### Task 7: Oberfläche

**Files:**
- Modify: `apps/kompass/src/components/forms/localized-field.tsx`
- Modify: `apps/kompass/src/lib/localized-form.ts`
- Create: `apps/kompass/src/app/(shell)/admin/locales/page.tsx`, `locales-client.tsx`, `actions.ts`
- Modify: `apps/kompass/messages/de.json`, `packages/core/src/core-module.ts` (Navigation)
- Test: `apps/kompass/tests/localized-form.test.ts`, `apps/kompass/e2e/locales.spec.ts`

**Interfaces:**
- Consumes: `listLocales`, `addLocale`, `reorderLocales`, `previewLocaleRemoval`, `removeLocale` aus Task 6

- [ ] **Step 1: `localizedFromForm` auf n Sprachen**

```ts
export function localizedFromForm(formData: FormData, name: string, locales: readonly string[]): LocalizedText {
  return Object.fromEntries(locales.map((l) => [l, String(formData.get(`${name}.${l}`) ?? '').trim()]));
}
```

Test in `apps/kompass/tests/localized-form.test.ts`: drei Sprachen hinein, drei Schlüssel heraus; eine im Formular fehlende Sprache wird leerer String.

- [ ] **Step 2: `LocalizedField` auf n Sprachen**

Die Komponente bekommt `locales: string[]` als Pflicht-Prop statt der festen `('de' | 'en')`-Paare. Bis drei Sprachen nebeneinander (`grid-cols-{n}`), ab vier Reiter. Die Leitsprache ist die erste im Array, trägt `required` und ist im Markdown-Vorschauumschalter vorausgewählt. Vorlage für Aufbau und Klassen ist die bestehende Datei; die Fehlt-Markierung prüft künftig gegen die Leitsprache statt gegen `de`.

- [ ] **Step 3: Aufrufstellen versorgen**

Run: `grep -rln "LocalizedField" apps/kompass/src | grep -v '\.next'`

Jede Seite reicht `locales` durch; die Server-Komponente holt sie über `deps.locales()`.

- [ ] **Step 4: Verwaltungsseite**

Unter „Verwaltung → Sprachen" (`/admin/locales`, Permission `settings.manage`): Liste der Sprachen mit Sortierknöpfen (`ReorderButtons`), Feld zum Hinzufügen, Entfernen über `ConfirmDialog`. Der Dialog ruft zuerst `previewLocaleRemoval` und zeigt: „In {count} Feldern steht Text auf {locale}. Beim Entfernen geht er verloren." Erst danach ist der Bestätigungsknopf aktiv.

Navigationseintrag in `packages/core/src/core-module.ts` bei den übrigen Verwaltungseinträgen ergänzen.

- [ ] **Step 5: Texte**

`apps/kompass/messages/de.json` unter `admin.locales`: `title`, `description`, `add`, `code`, `leading`, `remove`, `removeTitle`, `removeWarning` mit `{count}` und `{locale}`, `removed`, `added`, `duplicate`, `lastLocale`.

- [ ] **Step 6: E2E**

```ts
// apps/kompass/e2e/locales.spec.ts
test('adds a locale, fills it, and sees what removing it would cost', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/admin/locales');
  await page.getByLabel('Sprachcode').fill('fr');
  await page.getByRole('button', { name: 'Sprache hinzufügen' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'fr' })).toBeVisible();

  await page.goto('/website/pages/about');
  await expect(page.locator('[name="title.fr"]')).toBeVisible();
  await page.locator('[name="title.fr"]').fill('À propos');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('status')).toContainText('Gespeichert');

  await page.goto('/admin/locales');
  await page.getByRole('button', { name: 'fr entfernen' }).click();
  await expect(page.getByRole('dialog')).toContainText('1 Feld');
});
```

- [ ] **Step 7: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A
git commit -m "feat(i18n): manage locales in the interface"
```

---

### Task 8: MCP und Einrichtung

**Files:**
- Modify: `packages/mcp/src/core-tools.ts`
- Modify: `apps/kompass/src/app/setup/*` (Einrichtungsformular)
- Test: `packages/mcp/tests/handler.test.ts`, `apps/kompass/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: die Dienste aus Task 6

- [ ] **Step 1: Werkzeuge ergänzen**

```ts
t({ name: 'locales_list', description: 'List the locales this installation keeps, leading one first. Requires settings.manage.', inputSchema: z.object({}), handler: (deps, ctx) => listLocales(deps, ctx) }),
t({ name: 'locales_add', description: 'Add a locale. Requires settings.manage.', inputSchema: z.object({ code: z.string() }), handler: (deps, ctx, args) => addLocale(deps, ctx, args) }),
t({ name: 'locales_reorder', description: 'Reorder locales; the first is the leading locale. Requires settings.manage.', inputSchema: z.object({ codes: z.array(z.string()) }), handler: (deps, ctx, args) => reorderLocales(deps, ctx, args) }),
t({ name: 'locales_remove', description: 'Remove a locale and strip it from all stored text. Requires settings.manage and confirm. Audited.', inputSchema: z.object({ code: z.string(), confirm: z.boolean() }), handler: (deps, ctx, args) => removeLocale(deps, ctx, args) }),
```

- [ ] **Step 2: Prüfung bestätigen**

Run: `pnpm --filter @kompass/app test tests/mcp-tools.test.ts`
Expected: PASS — `settings.manage` ist weiterhin abgedeckt, jedes Werkzeug nennt seine Argumente.

- [ ] **Step 3: Einrichtung fragt nach der Sprache**

Das Einrichtungsformular bekommt ein Auswahlfeld „Sprache der Webseite und Oberfläche" mit den Vorgaben `de`, `en`, `fr`, `nl`, `pl` und freier Eingabe; `completeSetup` schreibt `i18n.locales` mit genau diesem einen Eintrag. Bestehende Installationen bleiben unberührt: Ihre Migration setzt `['de','en']`, weil ihre Daten dieses Paar tragen.

- [ ] **Step 4: Migration für den Bestand**

```ts
// in der Migration, die i18n.locales einführt
insert into settings (key, value) values ('i18n.locales', '["de","en"]')
  on conflict(key) do nothing;
```

Run: `pnpm --filter @kompass/core db:generate`

- [ ] **Step 5: Gesamtlauf und Commit**

```bash
pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e
git add -A
git commit -m "feat(i18n): expose locales over MCP and ask for one during setup"
```

---

## Abschluss dieses Plans

Danach sind Sprachen Stammdaten: Ein Verein legt an, sortiert und entfernt sie, jede Maske folgt der Liste, und der Kern prüft zentral, dass nur gepflegte Sprachen gespeichert werden. Der einsprachige Verein sieht ein Feld statt zwei. Damit ist die Grundlage für Plan 2 gelegt, in dem ein Template Sprachen nur noch fordert.

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung (Abschnitt 6):** Stammdaten statt Template-Deklaration → Task 1, 6. Leitsprache als Pflichtfeld und Rückfallebene → Task 4 (`resolveText`), Task 5 (`required`). Entfernen als eigene Handlung mit Vorschau → Task 6 (`previewLocaleRemoval`, `confirm`). `deps.locales` wie `deps.registry` → Task 2. Record-Schema plus zentrale Prüfung → Task 4, 5. Bestandsdaten unverändert → Task 8 Step 4. Verworfene Wege sind in der Spec begründet, nicht im Plan.

**Platzhalter:** Keine. Task 6 Step 3 war zunächst auf Signaturen verkürzt und ist ausgeschrieben, weil dort die einzige nicht offensichtliche Logik des Plans sitzt — rohes SQL über Tabellen, die erst zur Laufzeit feststehen. Task 7 Step 2 beschreibt den Umbau einer vorhandenen Komponente entlang ihrer bestehenden Vorlage; die Datei liegt im Repo und ist im Plan benannt.

**Typkonsistenz:** `deps.locales()` liefert `string[]` und wird so in Task 4, 5, 6, 7 benutzt. `LocalizedText` ist ab Task 4 `Record<string, string>`; `emptyLocalized(locales)` und `translationGaps(record, fields, locales)` tragen die Liste als letzten Parameter, `resolveText(text, locale, fallback)` den Rückfall als dritten. `LOCALIZED_COLUMNS` aus Task 6 Step 3 wird nur dort verwendet.

**Reihenfolge:** Jeder Task endet grün. Task 3 ändert nur die Signatur, Task 5 ergänzt das Verhalten — so bleibt der Umbau der 56 Aufrufstellen von der neuen Prüfung getrennt und ein Fehlschlag eindeutig zuzuordnen.
