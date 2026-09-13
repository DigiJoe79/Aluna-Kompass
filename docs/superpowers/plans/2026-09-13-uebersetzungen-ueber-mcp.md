# Übersetzungen über MCP — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein MCP-Client holt mit `translations_list_gaps` alle fehlenden Übersetzungen samt deutschem Ausgangstext und schreibt mit `translations_set` die abgestimmten Texte zurück, je Datensatz ein Update und ein Audit-Eintrag, ohne andere Sprachen anzufassen.

**Architecture:** Zwei Kernservices in `packages/core/src/i18n/translations.ts` fragen die eingeschalteten Module über zwei neue Manifest-Haken (`translatables`, `setTranslations`) nach dem Muster von `followUpTargets`. Tiere, Projekte und Site implementieren die Haken in je einer Datei `translations.ts` und schreiben über ihre bestehenden Update-Services (Rechte, Validierung, Audit bleiben dort). Zwei Werkzeuge in `packages/mcp/src/core-tools.ts` rufen die Kernservices. Vorweg ein kleiner Schnitt aus dem Backlog (19): `setValues` prüft Referenzwerte nur, wenn sie sich ändern.

**Tech Stack:** TypeScript, Zod 4, Drizzle auf SQLite, Vitest, MCP-Werkzeugdefinitionen aus `@kompass/core`.

**Spec:** `docs/superpowers/specs/2026-09-13-uebersetzungen-ueber-mcp-design.md` — der Plan setzt sie ganz um; § 8 dort nennt die Reihenfolge nach den Startseiten-Plänen, die inzwischen gebaut sind.

## Global Constraints

- AGENTS.md, Coding-Regeln: Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`, Ablauf `requirePermission` → `validate` → Transaktion → `recordAudit`. Fachfehler als `Result`, nie Exceptions. Zeit über `deps.clock`, nie `new Date()`.
- Prinzip 8: Die Werkzeuge rufen die Kernservices, die Haken rufen die Update-Services der Module. Keine Fachlogik in `core-tools.ts`, kein direktes Schreiben in Tabellen aus einem Haken.
- Werkzeugbeschreibungen sind Englisch und nennen die Rechte; `apps/kompass/tests/mcp-tools.test.ts` prüft das. Kein neuer Permission-Key.
- Die Haken haben die Signatur `(deps, ctx, …)` und werden **nicht** aus `index.ts` eines Modulpakets exportiert (Spec § 4, letzter Absatz); sonst hält der Test „every service has a tool" sie für Services ohne Werkzeug.
- Lücke heißt: Leitsprache (erste in `i18n.locales`) gefüllt, Zielsprache leer. Bei Listen: mindestens ein Eintrag gegen leere Liste. Entwürfe zählen mit. Lücken nur in der Schnittmenge aus `Translatable.locales` (falls gesetzt) und Sprachen der Installation.
- Seed-Texte sind frei erfunden (`no-association-content.test.ts`).
- Commit je Task, kein Push (Joe pusht). Vor jedem Commit: `pnpm typecheck` und die Tests der berührten Pakete grün. Am Ende `pnpm test` komplett.
- Im Arbeitsbaum liegen unversionierte Dateien anderer Arbeit (`docs/design_handoff_akte_ablegen_entwurf/`). Nur die eigenen Dateien stagen, nie `git add -A`.

---

### Task 1: `setValues` prüft nur geänderte Referenzwerte (Backlog 19)

**Files:**
- Modify: `packages/modules/site/src/values.ts` (Block „Referenzwerte müssen in der gefilterten Sicht stehen", etwa Zeile 60–70)
- Modify: `docs/backlog.md` (Abschnitt „## 19." entfernen)
- Test: `packages/modules/site/tests/values.test.ts` (describe `reference values`)

**Interfaces:**
- Consumes: `checkReferenceValues(deps, schema, values)`, `duplicateReferences(schema, values)` aus `packages/modules/site/src/reference-fields.ts`; `readValues(deps)` aus `values.ts`.
- Produces: unverändertes API von `setValues(deps, ctx, { values })`; neues Verhalten: ein Referenzwert, der gleich dem gespeicherten ist, wird nicht mehr geprüft.

- [x] **Step 1: Test schreiben**

In `packages/modules/site/tests/values.test.ts` innerhalb von `describe('reference values', …)` nach dem Test `saves a value that is among the options and rejects one that is not` einfügen. `siteValues` zusätzlich aus `../src/schema` importieren (die Datei importiert dort bisher nur `siteTemplateState`).

```ts
  it('leaves an unchanged stale reference alone so other variables can still be saved (Backlog 19)', async () => {
    const deps = await withAnimals();
    const manage = ctxWith(['site.manage']);
    // Bruno wurde gewählt und später vermittelt: Der gespeicherte Wert trägt nicht mehr.
    deps.db.insert(siteValues).values({ key: 'dog', value: 'ghost', updatedAt: 't' }).run();
    // Die Maske schickt immer alle Werte — der veraltete kommt unverändert mit.
    const saved = await setValues(deps, manage, { values: { dog: 'ghost', dogs: ['bruno'] } });
    expect(saved.ok).toBe(true);
    expect(readValues(deps)).toMatchObject({ dog: 'ghost', dogs: ['bruno'] });
    // Wer den Wert anfasst, muss einen gültigen wählen.
    const changed = await setValues(deps, manage, { values: { dog: 'akiko' } });
    expect(changed.ok === false && changed.error.type === 'validation' && changed.error.issues).toEqual([{ path: 'dog', message: 'referenceNotFound' }]);
  });
```

- [x] **Step 2: Test laufen lassen, er muss rot sein**

Run: `pnpm --filter @kompass/module-site test -- values`
Expected: FAIL — `saved.ok` ist `false`, weil `checkReferenceValues` den unveränderten `ghost` meldet.

- [x] **Step 3: Nur geänderte Referenzwerte prüfen**

In `packages/modules/site/src/values.ts` den Block ab dem Kommentar „Referenzwerte müssen in der gefilterten Sicht stehen" ersetzen. `before` wandert dabei vor die Prüfung (es wird unten für den Audit-Eintrag ohnehin gelesen; die Zeile `const before = readValues(deps);` weiter unten entfällt).

```ts
  // Referenzwerte müssen in der gefilterten Sicht stehen — dieselbe Prüfung
  // für Maske und site_variables_set (Spec 2026-09-13, § 4.4). Geprüft wird
  // nur, was sich ändert: Ein gespeicherter Wert, der inzwischen nicht mehr
  // trägt (Hund vermittelt), bleibt stehen und wird im Export-Prüflauf zum
  // Befund; er darf nicht das Speichern aller anderen Variablen blockieren
  // (Backlog 19).
  const before = readValues(deps);
  const changed = Object.fromEntries(
    Object.entries(parsed.value as Record<string, unknown>).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])),
  );
  const stale = checkReferenceValues(deps, template.schema, changed);
  const duplicates = duplicateReferences(template.schema, parsed.value as Record<string, unknown>);
  if (stale.length > 0 || duplicates.length > 0) {
    return invalid([
      ...stale.map((s) => ({ path: s.field, message: 'referenceNotFound' })),
      ...duplicates.map((field) => ({ path: field, message: 'duplicateReference' })),
    ]);
  }

  const now = isoNow(deps.clock);
```

- [x] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test -- values`
Expected: PASS, auch die bestehenden Referenz-Tests (ein geänderter `ghost` bleibt `referenceNotFound`).

- [x] **Step 5: Backlog-Punkt 19 entfernen**

In `docs/backlog.md` den gesamten Abschnitt von `## 19. Veraltete Referenz blockiert das Speichern der Variablen` bis zum Dateiende löschen (Erledigtes wird gelöscht, nicht abgehakt — steht im Kopf der Datei). Die Datei endet danach mit dem letzten Absatz von Punkt 18.

- [x] **Step 6: Commit**

```bash
pnpm typecheck
git add packages/modules/site/src/values.ts packages/modules/site/tests/values.test.ts docs/backlog.md
git commit -m "fix(site): an unchanged stale reference no longer blocks saving the other variables (backlog 19)"
```

---

### Task 2: Pfadhelfer im Kern (`readPath`, `writePath`)

**Files:**
- Create: `packages/core/src/i18n/paths.ts`
- Modify: `packages/core/src/index.ts` (Zeile nach `export * from './i18n/service';`)
- Test: `packages/core/tests/i18n-paths.test.ts`

**Interfaces:**
- Produces: `splitPath(path: string): (string | number)[]`, `readPath(root: unknown, path: string): unknown`, `writePath<T>(root: T, path: string, value: unknown): T | undefined`. Pfadform: Punktnotation mit Index in eckigen Klammern (`faq[2].answer`, `story.quote`, `summary`). `writePath` kopiert (der Eingabewert bleibt unverändert) und liefert `undefined`, wenn ein Zwischenknoten oder der letzte Schlüssel fehlt.

- [ ] **Step 1: Test schreiben**

```ts
// packages/core/tests/i18n-paths.test.ts
import { describe, expect, it } from 'vitest';
import { readPath, splitPath, writePath } from '../src/i18n/paths';

describe('localized field paths', () => {
  it('splits dotted paths with indexes', () => {
    expect(splitPath('summary')).toEqual(['summary']);
    expect(splitPath('story.quote')).toEqual(['story', 'quote']);
    expect(splitPath('faq[2].answer')).toEqual(['faq', 2, 'answer']);
  });

  it('reads through objects and arrays, undefined when missing', () => {
    const root = { faq: [{ q: { de: 'A' } }, { q: { de: 'B' } }], story: null };
    expect(readPath(root, 'faq[1].q')).toEqual({ de: 'B' });
    expect(readPath(root, 'faq[5].q')).toBeUndefined();
    expect(readPath(root, 'story.quote')).toBeUndefined();
    expect(readPath(root, 'nope')).toBeUndefined();
  });

  it('writes a copy and leaves the input alone', () => {
    const root = { faq: [{ q: { de: 'A', en: '' } }], claim: { de: 'x' } };
    const next = writePath(root, 'faq[0].q', { de: 'A', en: 'A!' });
    expect(next).toEqual({ faq: [{ q: { de: 'A', en: 'A!' } }], claim: { de: 'x' } });
    expect(root.faq[0]!.q).toEqual({ de: 'A', en: '' });
    expect(next!.claim).toBe(root.claim);
  });

  it('refuses to invent nodes', () => {
    expect(writePath({ faq: [] }, 'faq[0].q', {})).toBeUndefined();
    expect(writePath({ a: 1 }, 'b', {})).toBeUndefined();
    expect(writePath({ a: { b: 1 } }, 'a.c', {})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/core test -- i18n-paths`
Expected: FAIL — Modul `../src/i18n/paths` fehlt.

- [ ] **Step 3: Helfer schreiben**

```ts
// packages/core/src/i18n/paths.ts
/**
 * Pfade zu mehrsprachigen Feldern: `summary`, `story.quote`, `faq[2].answer`.
 * Der Kern behandelt sie als undurchsichtige Schlüssel; Module lösen sie mit
 * diesen Helfern auf, wo Text in Bausteinen oder Listen steckt.
 */
export function splitPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]!);
  return out;
}

export function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of splitPath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Kopiert entlang des Pfads und setzt den Wert; `undefined`, wenn der Pfad nicht existiert. */
export function writePath<T>(root: T, path: string, value: unknown): T | undefined {
  const segs = splitPath(path);
  const step = (node: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    if (node === null || typeof node !== 'object') return undefined;
    const seg = segs[i]!;
    if (Array.isArray(node)) {
      if (typeof seg !== 'number' || seg >= node.length) return undefined;
      const child = step(node[seg], i + 1);
      if (child === undefined) return undefined;
      const copy = [...node];
      copy[seg] = child;
      return copy;
    }
    if (!(String(seg) in node)) return undefined;
    const child = step((node as Record<string, unknown>)[String(seg)], i + 1);
    if (child === undefined) return undefined;
    return { ...(node as Record<string, unknown>), [String(seg)]: child };
  };
  return step(root, 0) as T | undefined;
}
```

In `packages/core/src/index.ts` nach `export * from './i18n/service';` einfügen: `export * from './i18n/paths';`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- i18n-paths`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add packages/core/src/i18n/paths.ts packages/core/src/index.ts packages/core/tests/i18n-paths.test.ts
git commit -m "feat(core): path helpers for localized fields in nested content"
```

---

### Task 3: Manifest-Haken und Kernservices `listTranslationGaps`, `setTranslations`

**Files:**
- Modify: `packages/core/src/modules/manifest.ts` (Typen vor `ModuleManifest`; zwei Haken im Interface nach `followUpTargets`)
- Create: `packages/core/src/i18n/translations.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/translations.test.ts`

**Interfaces:**
- Consumes: `enabledManifests(deps)` aus `packages/core/src/modules/service.ts`; `readLocales(deps)`, `LOCALE_CODE` aus `./locales`; `validate(deps, schema, input)`; `invalid`, `notFound`, `ok` aus `../result`.
- Produces (Manifest):
  ```ts
  export type LocalizedValue = string | string[];
  export interface Translatable { entityType: string; id: string; label: string; href: string; fields: Record<string, Record<string, LocalizedValue>>; locales?: readonly string[] }
  export interface TranslationWrite { entityType: string; id: string; items: { field: string; locale: string; text: LocalizedValue }[] }
  translatables?: (deps: Deps, ctx: CallContext) => Result<Translatable[]>;
  setTranslations?: (deps: Deps, ctx: CallContext, input: TranslationWrite) => Promise<Result<unknown>> | null;
  ```
- Produces (Services):
  ```ts
  export interface TranslationGap { entityType: string; id: string; label: string; href: string; field: string; locale: string; source: { locale: string; text: LocalizedValue } }
  export interface TranslationGapList { gaps: TranslationGap[]; omitted: string[] }
  export interface TranslationWriteReport { applied: number; failed: { index: number; error: ServiceError }[] }
  export const translationGapsFilterSchema: z.ZodObject  // { locale?: string; entityType?: string }
  export const translationsSetSchema: z.ZodObject        // { items: TranslationInput[] } (1..500)
  export async function listTranslationGaps(deps, ctx, input?: unknown): Promise<Result<TranslationGapList>>
  export async function setTranslations(deps, ctx, input: unknown): Promise<Result<TranslationWriteReport>>
  ```

- [ ] **Step 1: Haken-Typen ins Manifest**

In `packages/core/src/modules/manifest.ts` vor `export interface ModuleManifest {` einfügen:

```ts
/** Text je Sprache oder Liste kurzer Begriffe je Sprache — die zwei Formen von `localizedText` und `localizedList`. */
export type LocalizedValue = string | string[];

/** Ein Datensatz mit seinen mehrsprachigen Feldern, wie ein Modul ihn dem Kern für die Übersetzungsliste meldet. */
export interface Translatable {
  entityType: string;
  id: string;
  /** Tiername, Projektname, Slug — für die Liste, die ein Client dem Menschen zeigt. */
  label: string;
  /** Der Weg zur Maske, z. B. `/animals/<id>`. */
  href: string;
  /** Feldpfad (`summary`, `story.quote`, `faq[2].answer`) → Wert je Sprache. */
  fields: Record<string, Record<string, LocalizedValue>>;
  /** Sprachen, in denen dieser Datensatz ausgespielt wird. Fehlt die Angabe, gelten die der Installation. */
  locales?: readonly string[];
}

/** Alle Übersetzungen eines Datensatzes, die der Kern in einem Aufruf an das Modul gibt. */
export interface TranslationWrite {
  entityType: string;
  id: string;
  items: { field: string; locale: string; text: LocalizedValue }[];
}
```

Im Interface `ModuleManifest` nach `followUpTargets?: …;` einfügen:

```ts
  /**
   * Die mehrsprachigen Datensätze dieses Moduls, Entwürfe eingeschlossen.
   * Richtung Kern → Modul wie `followUpTargets`. Prüft das Ansichtsrecht des
   * Moduls selbst und antwortet `forbidden`, wenn es fehlt — der Kern nennt das
   * Modul dann unter `omitted`, statt die ganze Liste zu verweigern.
   */
  translatables?: (deps: Deps, ctx: CallContext) => Result<Translatable[]>;
  /**
   * Schreibt Übersetzungen eines Datensatzes über den eigenen Update-Service:
   * eine Transaktion, ein Audit-Eintrag, nur die genannten Sprachschlüssel
   * ersetzt. `null` heißt: nicht mein `entityType`.
   */
  setTranslations?: (deps: Deps, ctx: CallContext, input: TranslationWrite) => Promise<Result<unknown>> | null;
```

- [ ] **Step 2: Test für die Services schreiben**

```ts
// packages/core/tests/translations.test.ts
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { listTranslationGaps, setTranslations } from '../src/i18n/translations';
import { defineModule, type Translatable, type TranslationWrite } from '../src/modules/manifest';
import { forbidden, notFound, ok, type Result } from '../src/result';
import { createTestDeps, ctxWith } from '../src/testing';

/** Ein erfundenes Modul mit zwei Datensätzen; `store` hält, was geschrieben wurde. */
function fakeModule(opts: { key: string; permission: string; rows: Translatable[]; store: TranslationWrite[] }) {
  return defineModule({
    key: opts.key,
    version: '0',
    permissions: [opts.permission],
    translatables: (_deps, ctx) => (ctx.permissions.has(opts.permission) ? ok(opts.rows) : forbidden(opts.permission)),
    setTranslations: (_deps, ctx, input) => {
      if (!input.entityType.startsWith(opts.key)) return null;
      return (async (): Promise<Result<unknown>> => {
        if (!ctx.permissions.has(opts.permission)) return forbidden(opts.permission);
        if (!opts.rows.some((r) => r.id === input.id)) return notFound(input.entityType, input.id);
        opts.store.push(input);
        return ok(null);
      })();
    },
  });
}

const rows: Translatable[] = [
  { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', fields: { summary: { de: 'Sanfter Rüde', en: '' }, traits: { de: ['ruhig'], en: [] }, body: { de: '', en: '' } } },
  { entityType: 'pets.pet', id: 'P2', label: 'Akiko', href: '/pets/P2', fields: { summary: { de: 'Wirbelwind', en: 'Whirlwind' } } },
];
const pages: Translatable[] = [
  { entityType: 'web.page', id: 'home', label: 'Start', href: '/web', fields: { claim: { de: 'Willkommen', en: '' } }, locales: ['de'] },
  { entityType: 'web.page', id: 'about', label: 'Über uns', href: '/web/about', fields: { claim: { de: 'Wer wir sind', en: '', fr: '' } }, locales: ['de', 'en'] },
];

function setup(locales = ['de', 'en']) {
  const petStore: TranslationWrite[] = [];
  const webStore: TranslationWrite[] = [];
  const pets = fakeModule({ key: 'pets', permission: 'pets.manage', rows, store: petStore });
  const web = fakeModule({ key: 'web', permission: 'web.manage', rows: pages, store: webStore });
  const deps = createTestDeps({ manifests: [coreModule, pets, web], locales });
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(['pets', 'web']), updatedAt: 'now' }).run();
  return { deps, petStore, webStore };
}

describe('listTranslationGaps', () => {
  it('lists leading-filled, target-empty fields with the source text, lists included', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['pets.manage', 'web.manage']));
    expect(result.ok && result.value.omitted).toEqual([]);
    expect(result.ok && result.value.gaps).toEqual([
      { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'summary', locale: 'en', source: { locale: 'de', text: 'Sanfter Rüde' } },
      { entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'traits', locale: 'en', source: { locale: 'de', text: ['ruhig'] } },
      { entityType: 'web.page', id: 'about', label: 'Über uns', href: '/web/about', field: 'claim', locale: 'en', source: { locale: 'de', text: 'Wer wir sind' } },
    ]);
  });

  it('respects the locales a record is rendered in and never reports locales the installation lacks', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['web.manage']), { entityType: 'web.page' });
    // `home` wird nur in `de` ausgespielt: keine Lücke. `about` kennt `fr`, die Installation nicht: keine Lücke.
    expect(result.ok && result.value.gaps.map((g) => `${g.id}:${g.locale}`)).toEqual(['about:en']);
  });

  it('filters by locale and rejects one the installation does not keep', async () => {
    const { deps } = setup(['de', 'en', 'pt']);
    const pt = await listTranslationGaps(deps, ctxWith(['pets.manage']), { locale: 'pt' });
    expect(pt.ok && pt.value.gaps.map((g) => `${g.id}.${g.field}`)).toEqual(['P1.summary', 'P1.traits', 'P2.summary']);
    const bad = await listTranslationGaps(deps, ctxWith(['pets.manage']), { locale: 'fr' });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues).toEqual([{ path: 'locale', message: 'unknownLocale' }]);
  });

  it('names modules the caller may not read under omitted and keeps the rest', async () => {
    const { deps } = setup();
    const result = await listTranslationGaps(deps, ctxWith(['web.manage']));
    expect(result.ok && result.value.omitted).toEqual(['pets']);
    expect(result.ok && result.value.gaps.map((g) => g.entityType)).toEqual(['web.page']);
    const nothing = await listTranslationGaps(deps, ctxWith([]));
    expect(nothing.ok && nothing.value).toEqual({ gaps: [], omitted: ['pets', 'web'] });
  });

  it('is empty with a single locale', async () => {
    const { deps } = setup(['de']);
    const result = await listTranslationGaps(deps, ctxWith(['pets.manage', 'web.manage']));
    expect(result.ok && result.value.gaps).toEqual([]);
  });
});

describe('setTranslations', () => {
  it('groups items per record and hands each group to its module once', async () => {
    const { deps, petStore, webStore } = setup();
    const result = await setTranslations(deps, ctxWith(['pets.manage', 'web.manage']), {
      items: [
        { entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'Gentle boy' },
        { entityType: 'web.page', id: 'about', field: 'claim', locale: 'en', text: 'Who we are' },
        { entityType: 'pets.pet', id: 'P1', field: 'traits', locale: 'en', text: ['calm'] },
      ],
    });
    expect(result.ok && result.value).toEqual({ applied: 3, failed: [] });
    expect(petStore).toEqual([{ entityType: 'pets.pet', id: 'P1', items: [{ field: 'summary', locale: 'en', text: 'Gentle boy' }, { field: 'traits', locale: 'en', text: ['calm'] }] }]);
    expect(webStore).toEqual([{ entityType: 'web.page', id: 'about', items: [{ field: 'claim', locale: 'en', text: 'Who we are' }] }]);
  });

  it('reports a failed group with all its indexes and still writes the others', async () => {
    const { deps, petStore } = setup();
    const result = await setTranslations(deps, ctxWith(['pets.manage', 'web.manage']), {
      items: [
        { entityType: 'pets.pet', id: 'P9', field: 'summary', locale: 'en', text: 'a' },
        { entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'b' },
        { entityType: 'pets.pet', id: 'P9', field: 'body', locale: 'en', text: 'c' },
        { entityType: 'cars.car', id: 'C1', field: 'name', locale: 'en', text: 'd' },
      ],
    });
    expect(result.ok && result.value.applied).toBe(1);
    expect(result.ok && result.value.failed).toEqual([
      { index: 0, error: { type: 'notFound', entity: 'pets.pet', id: 'P9' } },
      { index: 2, error: { type: 'notFound', entity: 'pets.pet', id: 'P9' } },
      { index: 3, error: { type: 'notFound', entity: 'cars.car', id: 'C1' } },
    ]);
    expect(petStore.map((w) => w.id)).toEqual(['P1']);
  });

  it('passes forbidden through per group', async () => {
    const { deps, petStore } = setup();
    const result = await setTranslations(deps, ctxWith(['web.manage']), { items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'x' }] });
    expect(result.ok && result.value.failed).toEqual([{ index: 0, error: { type: 'forbidden', permission: 'pets.manage' } }]);
    expect(petStore).toEqual([]);
  });

  it('rejects the whole call for an unknown locale or an empty list before writing anything', async () => {
    const { deps, petStore } = setup();
    const bad = await setTranslations(deps, ctxWith(['pets.manage']), {
      items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'x' }, { entityType: 'pets.pet', id: 'P1', field: 'body', locale: 'fr', text: 'y' }],
    });
    expect(bad.ok === false && bad.error.type === 'validation' && bad.error.issues).toEqual([{ path: 'items.1.locale', message: 'unknownLocale' }]);
    expect(petStore).toEqual([]);
    expect((await setTranslations(deps, ctxWith(['pets.manage']), { items: [] })).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/core test -- translations`
Expected: FAIL — `../src/i18n/translations` fehlt.

- [ ] **Step 4: Services schreiben**

```ts
// packages/core/src/i18n/translations.ts
import { z } from 'zod';
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { LocalizedValue, Translatable } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { invalid, notFound, ok, type Result, type ServiceError } from '../result';
import { validate } from '../validate';
import { LOCALE_CODE, readLocales } from './locales';

export interface TranslationGap {
  entityType: string;
  id: string;
  label: string;
  href: string;
  field: string;
  /** Die fehlende Sprache. */
  locale: string;
  /** Der Ausgangstext in der Leitsprache — das, was der Client übersetzt. */
  source: { locale: string; text: LocalizedValue };
}

export interface TranslationGapList {
  gaps: TranslationGap[];
  /** Module, deren Inhalte der Aufrufer nicht lesen darf. */
  omitted: string[];
}

export interface TranslationWriteReport {
  applied: number;
  failed: { index: number; error: ServiceError }[];
}

export const translationGapsFilterSchema = z.object({
  locale: z.string().regex(LOCALE_CODE).optional(),
  entityType: z.string().min(1).optional(),
});

const itemSchema = z.object({
  entityType: z.string().min(1),
  id: z.string().min(1),
  field: z.string().min(1),
  locale: z.string().regex(LOCALE_CODE),
  text: z.union([z.string(), z.array(z.string())]),
});
export const translationsSetSchema = z.object({ items: z.array(itemSchema).min(1).max(500) });

const filled = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) && value.length > 0;

/**
 * Alle Lücken über die eingeschalteten Module: Leitsprache gefüllt, Zielsprache
 * leer, Entwürfe eingeschlossen. Kein eigenes Recht — jedes Modul prüft sein
 * Ansichtsrecht im Haken; wer ein Modul nicht lesen darf, sieht es unter
 * `omitted`, damit „keine Lücken" nicht wie „alles übersetzt" aussieht.
 */
export async function listTranslationGaps(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<TranslationGapList>> {
  const parsed = validate(deps, translationGapsFilterSchema, input);
  if (!parsed.ok) return parsed;
  const locales = readLocales(deps);
  const leading = locales[0]!;
  const { locale: onlyLocale, entityType: onlyType } = parsed.value;
  if (onlyLocale && !locales.includes(onlyLocale)) return invalid([{ path: 'locale', message: 'unknownLocale' }]);

  const gaps: TranslationGap[] = [];
  const omitted: string[] = [];
  for (const manifest of enabledManifests(deps)) {
    if (!manifest.translatables) continue;
    const found = manifest.translatables(deps, ctx);
    if (!found.ok) {
      if (found.error.type === 'forbidden') {
        omitted.push(manifest.key);
        continue;
      }
      throw new Error(`translatables of ${manifest.key} failed: ${JSON.stringify(found.error)}`);
    }
    for (const record of found.value) {
      if (onlyType && record.entityType !== onlyType) continue;
      gaps.push(...gapsOf(record, locales, leading, onlyLocale));
    }
  }
  return ok({ gaps, omitted });
}

function gapsOf(record: Translatable, locales: readonly string[], leading: string, onlyLocale: string | undefined): TranslationGap[] {
  const targets = (record.locales ?? locales).filter((l) => l !== leading && locales.includes(l) && (!onlyLocale || l === onlyLocale));
  const out: TranslationGap[] = [];
  for (const [field, value] of Object.entries(record.fields)) {
    const source = value[leading];
    if (!filled(source)) continue;
    for (const locale of targets) {
      if (filled(value[locale])) continue;
      out.push({ entityType: record.entityType, id: record.id, label: record.label, href: record.href, field, locale, source: { locale: leading, text: source! } });
    }
  }
  return out;
}

/**
 * Schreibt Übersetzungen, nach Datensatz gebündelt: je Gruppe ein Aufruf des
 * zuständigen Moduls, das über seinen Update-Service schreibt (Recht,
 * Validierung, ein Audit-Eintrag). Kein Alles-oder-nichts über Datensätze
 * hinweg — eine gescheiterte Gruppe steht mit allen ihren Indizes in `failed`.
 */
export async function setTranslations(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<TranslationWriteReport>> {
  const parsed = validate(deps, translationsSetSchema, input);
  if (!parsed.ok) return parsed;
  const locales = readLocales(deps);
  const unknown = parsed.value.items.flatMap((item, i) => (locales.includes(item.locale) ? [] : [{ path: `items.${i}.locale`, message: 'unknownLocale' }]));
  if (unknown.length > 0) return invalid(unknown);

  const groups = new Map<string, { entityType: string; id: string; indexes: number[] }>();
  parsed.value.items.forEach((item, i) => {
    const key = `${item.entityType} ${item.id}`;
    const group = groups.get(key) ?? { entityType: item.entityType, id: item.id, indexes: [] };
    group.indexes.push(i);
    groups.set(key, group);
  });

  const writers = enabledManifests(deps).filter((m) => m.setTranslations);
  let applied = 0;
  const failed: TranslationWriteReport['failed'] = [];
  for (const group of groups.values()) {
    const items = group.indexes.map((i) => {
      const { field, locale, text } = parsed.value.items[i]!;
      return { field, locale, text };
    });
    let outcome: Result<unknown> | null = null;
    for (const manifest of writers) {
      const pending = manifest.setTranslations!(deps, ctx, { entityType: group.entityType, id: group.id, items });
      if (pending) {
        outcome = await pending;
        break;
      }
    }
    const result = outcome ?? notFound(group.entityType, group.id);
    if (result.ok) applied += items.length;
    else for (const index of group.indexes) failed.push({ index, error: result.error });
  }
  return ok({ applied, failed });
}
```

In `packages/core/src/index.ts` nach `export * from './i18n/paths';` einfügen: `export * from './i18n/translations';`

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- translations`
Expected: PASS. Fällt `groups items per record` an der Reihenfolge, prüfe, dass `Map` die Einfügereihenfolge hält (tut sie) und dass `forEach` die Indizes in Eingabereihenfolge sammelt.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck
git add packages/core/src/modules/manifest.ts packages/core/src/i18n/translations.ts packages/core/src/index.ts packages/core/tests/translations.test.ts
git commit -m "feat(core): translation gaps and per-locale writes over module hooks"
```

---

### Task 4: Werkzeuge `translations_list_gaps` und `translations_set`

**Files:**
- Modify: `packages/mcp/src/core-tools.ts` (Import-Block; neuer Eintrag nach `locales_remove`, Zeile ≈ 46)
- Test: `packages/mcp/tests/translation-tools.test.ts`

**Interfaces:**
- Consumes: `listTranslationGaps`, `setTranslations`, `translationGapsFilterSchema`, `translationsSetSchema`, `defineModule`, `type Translatable` aus `@kompass/core` (Task 3).
- Produces: Werkzeuge `translations_list_gaps` (`{ locale?, entityType? }`) und `translations_set` (`{ items: [...] }`), beide mit `service` auf den Kernservice.

- [ ] **Step 1: Test schreiben**

```ts
// packages/mcp/tests/translation-tools.test.ts
import { coreModule, defineModule, listTranslationGaps, ok, schema, setTranslations, type Translatable, type TranslationWrite } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

const rows: Translatable[] = [{ entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', fields: { summary: { de: 'Sanft', en: '' } } }];

function setup() {
  const store: TranslationWrite[] = [];
  const pets = defineModule({
    key: 'pets',
    version: '0',
    permissions: ['pets.manage'],
    translatables: () => ok(rows),
    setTranslations: (_deps, _ctx, input) => (input.entityType === 'pets.pet' ? Promise.resolve((store.push(input), ok(null))) : null),
  });
  const deps = createTestDeps({ manifests: [coreModule, pets], locales: ['de', 'en'] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db.insert(schema.settings).values({ key: 'modules.enabled', value: JSON.stringify(['pets']), updatedAt: 'now' }).run();
  return { deps, store };
}

describe('translation tools', () => {
  it('are registered, name their services and the module rights', () => {
    expect(tool('translations_list_gaps').service).toBe(listTranslationGaps);
    expect(tool('translations_set').service).toBe(setTranslations);
    for (const right of ['animals.view', 'projects.view', 'site.view']) expect(tool('translations_list_gaps').description).toContain(right);
    for (const right of ['animals.manage', 'projects.manage', 'site.manage']) expect(tool('translations_set').description).toContain(right);
  });

  it('list the gaps with the source text and write a translation back', async () => {
    const { deps, store } = setup();
    const ctx = ctxWith(['pets.manage']);
    const gaps = await tool('translations_list_gaps').handler(deps, ctx, {});
    expect(gaps.ok && gaps.value).toEqual({ gaps: [{ entityType: 'pets.pet', id: 'P1', label: 'Bruno', href: '/pets/P1', field: 'summary', locale: 'en', source: { locale: 'de', text: 'Sanft' } }], omitted: [] });
    const written = await tool('translations_set').handler(deps, ctx, { items: [{ entityType: 'pets.pet', id: 'P1', field: 'summary', locale: 'en', text: 'Gentle' }] });
    expect(written.ok && written.value).toEqual({ applied: 1, failed: [] });
    expect(store).toEqual([{ entityType: 'pets.pet', id: 'P1', items: [{ field: 'summary', locale: 'en', text: 'Gentle' }] }]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/mcp test -- translation-tools`
Expected: FAIL — `kein Werkzeug translations_list_gaps`.

- [ ] **Step 3: Werkzeuge eintragen**

Im Import-Block von `packages/mcp/src/core-tools.ts` ergänzen: `listTranslationGaps, setTranslations, translationGapsFilterSchema, translationsSetSchema,`. Nach dem Eintrag `locales_remove` einfügen:

```ts
  // Übersetzungen (Spec 2026-09-13-uebersetzungen-ueber-mcp). Kein eigenes
  // Recht: Die Module prüfen ihres im Haken, deshalb nennt die Beschreibung
  // die Rechte der Module.
  t({ name: 'translations_list_gaps', description: 'List missing translations across all enabled modules with the source text in the leading locale: every record whose leading-locale text is filled while another locale is empty, drafts included. Optional filters: locale, entityType. Requires the view right of each module (animals.view, projects.view, site.view); modules you may not read are named under omitted.', inputSchema: translationGapsFilterSchema, handler: (deps, ctx, args) => listTranslationGaps(deps, ctx, args), service: listTranslationGaps }),
  t({ name: 'translations_set', description: 'Write translations for single locales without touching the other locales. Items for the same record (entityType + id) are written together through the module update service and need its manage right (animals.manage, projects.manage, site.manage). Audited once per record. Returns the applied count and the failed items by index; a failed record does not stop the others.', inputSchema: translationsSetSchema, handler: (deps, ctx, args) => setTranslations(deps, ctx, args), service: setTranslations }),
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/mcp test` und `pnpm --filter @kompass/app test -- mcp-tools`
Expected: PASS. Die App-Regeln (benannte Argumente, keine zusätzlichen, Englisch) greifen für beide Werkzeuge.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add packages/mcp/src/core-tools.ts packages/mcp/tests/translation-tools.test.ts
git commit -m "feat(mcp): translations_list_gaps and translations_set"
```

---

### Task 5: Tiermodul meldet und schreibt Übersetzungen

**Files:**
- Create: `packages/modules/animals/src/translations.ts`
- Modify: `packages/modules/animals/src/manifest.ts`
- Test: `packages/modules/animals/tests/translations.test.ts`

**Interfaces:**
- Consumes: `loadAnimal(db, id)`, `updateAnimal`, `setAnimalStory`, `type AnimalRecord` aus `./service`; `animals` aus `./schema`; `requirePermission`, `notFound`, `ok`, `type Translatable`, `type TranslationWrite`, `type LocalizedValue` aus `@kompass/core`.
- Produces: `animalsTranslatables(deps, ctx)`, `animalsSetTranslations(deps, ctx, input)` — im Manifest eingetragen, **nicht** aus `index.ts` exportiert. `entityType` `animal`; Felder `birthText`, `sizeText`, `traits`, `summary`, `body`, mit Geschichte `story.quote`, `story.beforeCaption`, `story.afterCaption`; `href` `/animals/<id>`.

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/animals/tests/translations.test.ts
import { coreModule, schema, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { animalsModule } from '../src/manifest';
import { createAnimal, getAnimal, setAnimalStatus, setAnimalStory } from '../src/service';
import { animalsSetTranslations, animalsTranslatables } from '../src/translations';

const manage = ctxWith(['animals.manage', 'animals.view']);
const view = ctxWith(['animals.view']);
const bruno = { slug: 'bruno', name: 'Bruno', sex: 'male' as const, birthText: { de: 'März 2020', en: '' }, sizeCm: 55, sizeText: { de: 'ca. 55 cm', en: 'approx. 55 cm' }, location: 'shelter' as const, isEmergency: false, isSponsorable: false, traits: { de: ['ruhig'], en: [] }, externalProfileUrl: '', summary: { de: 'Sanfter Rüde.', en: '' }, body: { de: '', en: '' } };

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, animalsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const a = unwrap(await createAnimal(deps, manage, bruno));
  return { deps, id: a.id };
};

describe('animals translations', () => {
  it('lists every animal, drafts included, with its localized fields and the story fields once a story exists', async () => {
    const { deps, id } = await setup();
    const before = unwrap(animalsTranslatables(deps, view));
    expect(before).toEqual([{ entityType: 'animal', id, label: 'Bruno', href: `/animals/${id}`, fields: { birthText: bruno.birthText, sizeText: bruno.sizeText, traits: bruno.traits, summary: bruno.summary, body: bruno.body } }]);
    unwrap(await setAnimalStatus(deps, manage, { id, status: 'adopted', adoptedYear: 2025 }));
    unwrap(await setAnimalStory(deps, manage, { id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Endlich daheim.', en: '' }, family: 'Familie M.', adoptedYear: 2025 }));
    const after = unwrap(animalsTranslatables(deps, view))[0]!;
    expect(Object.keys(after.fields)).toEqual(['birthText', 'sizeText', 'traits', 'summary', 'body', 'story.quote', 'story.beforeCaption', 'story.afterCaption']);
    expect(after.fields['story.quote']).toEqual({ de: 'Endlich daheim.', en: '' });
  });

  it('is forbidden without animals.view and ignores foreign entity types', async () => {
    const { deps, id } = await setup();
    const denied = animalsTranslatables(deps, ctxWith([]));
    expect(denied.ok === false && denied.error.type).toBe('forbidden');
    expect(animalsSetTranslations(deps, manage, { entityType: 'project', id, items: [] })).toBeNull();
  });

  it('writes only the named locales, in one update with one audit entry', async () => {
    const { deps, id } = await setup();
    const auditBefore = deps.db.select().from(schema.auditLog).all().length;
    const result = await animalsSetTranslations(deps, manage, {
      entityType: 'animal',
      id,
      items: [
        { field: 'summary', locale: 'en', text: 'Gentle boy.' },
        { field: 'traits', locale: 'en', text: ['calm'] },
        { field: 'birthText', locale: 'en', text: 'March 2020' },
      ],
    });
    expect(result && (await result).ok).toBe(true);
    const a = unwrap(await getAnimal(deps, view, id));
    expect(a.summary).toEqual({ de: 'Sanfter Rüde.', en: 'Gentle boy.' });
    expect(a.traits).toEqual({ de: ['ruhig'], en: ['calm'] });
    expect(a.birthText).toEqual({ de: 'März 2020', en: 'March 2020' });
    const audits = deps.db.select().from(schema.auditLog).all().slice(auditBefore);
    expect(audits.map((e) => e.action)).toEqual(['animals.update']);
  });

  it('writes story fields through setAnimalStory', async () => {
    const { deps, id } = await setup();
    unwrap(await setAnimalStatus(deps, manage, { id, status: 'adopted', adoptedYear: 2025 }));
    unwrap(await setAnimalStory(deps, manage, { id, beforeAssetId: null, afterAssetId: null, quote: { de: 'Endlich daheim.', en: '' }, family: 'Familie M.', adoptedYear: 2025 }));
    const result = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'story.quote', locale: 'en', text: 'Home at last.' }] });
    expect(result && (await result).ok).toBe(true);
    expect(unwrap(await getAnimal(deps, view, id)).story?.quote).toEqual({ de: 'Endlich daheim.', en: 'Home at last.' });
    expect(deps.db.select().from(schema.auditLog).all().at(-1)?.action).toBe('animals.setStory');
  });

  it('is forbidden without animals.manage, notFound for a foreign id, an unknown field, or a story field without a story', async () => {
    const { deps, id } = await setup();
    const denied = await animalsSetTranslations(deps, view, { entityType: 'animal', id, items: [{ field: 'summary', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await animalsSetTranslations(deps, manage, { entityType: 'animal', id: 'nope', items: [{ field: 'summary', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'animal', id: 'nope' });
    const field = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(field && !field.ok && field.error).toEqual({ type: 'notFound', entity: 'field', id: 'name' });
    const story = await animalsSetTranslations(deps, manage, { entityType: 'animal', id, items: [{ field: 'story.quote', locale: 'en', text: 'x' }] });
    expect(story && !story.ok && story.error).toEqual({ type: 'notFound', entity: 'field', id: 'story.quote' });
  });

  it('is wired into the manifest', () => {
    expect(animalsModule.translatables).toBe(animalsTranslatables);
    expect(animalsModule.setTranslations).toBe(animalsSetTranslations);
  });
});
```

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/module-animals test -- translations`
Expected: FAIL — `../src/translations` fehlt.

- [ ] **Step 3: Haken schreiben**

```ts
// packages/modules/animals/src/translations.ts
import { notFound, ok, requirePermission, type CallContext, type Deps, type LocalizedValue, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc } from 'drizzle-orm';
import { animals } from './schema';
import { loadAnimal, setAnimalStory, updateAnimal, type AnimalRecord } from './service';

const PROFILE_FIELDS = ['birthText', 'sizeText', 'traits', 'summary', 'body'] as const;
const STORY_FIELDS = ['quote', 'beforeCaption', 'afterCaption'] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];
type StoryField = (typeof STORY_FIELDS)[number];

const isProfileField = (f: string): f is ProfileField => (PROFILE_FIELDS as readonly string[]).includes(f);
const storyFieldOf = (f: string): StoryField | null => {
  const name = f.startsWith('story.') ? f.slice('story.'.length) : '';
  return (STORY_FIELDS as readonly string[]).includes(name) ? (name as StoryField) : null;
};

function fieldsOf(a: AnimalRecord): Translatable['fields'] {
  const fields: Translatable['fields'] = {};
  for (const f of PROFILE_FIELDS) fields[f] = a[f] as Record<string, LocalizedValue>;
  if (a.story) for (const f of STORY_FIELDS) fields[`story.${f}`] = a.story[f];
  return fields;
}

/** Alle Tiere, auch unveröffentlichte — die Lückenliste ist eine Verwaltungssicht. */
export function animalsTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'animals.view');
  if (denied) return denied;
  const rows = deps.db.select({ id: animals.id }).from(animals).orderBy(asc(animals.name)).all().map((r) => loadAnimal(deps.db, r.id)!);
  return ok(rows.map((a) => ({ entityType: 'animal', id: a.id, label: a.name, href: `/animals/${a.id}`, fields: fieldsOf(a) })));
}

/**
 * Profilfelder über `updateAnimal`, Geschichte über `setAnimalStory` — zwei
 * Services, also bis zu zwei Aufrufe je Tier; innerhalb jedes Aufrufs nur die
 * genannten Sprachschlüssel ersetzt.
 */
export function animalsSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'animal') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'animals.manage');
    if (denied) return denied;
    const before = loadAnimal(deps.db, input.id);
    if (!before) return notFound('animal', input.id);

    const profile: Partial<Record<ProfileField, Record<string, LocalizedValue>>> = {};
    const story: Partial<Record<StoryField, Record<string, string>>> = {};
    for (const item of input.items) {
      if (isProfileField(item.field)) {
        const current = profile[item.field] ?? (before[item.field] as Record<string, LocalizedValue>);
        profile[item.field] = { ...current, [item.locale]: item.text };
        continue;
      }
      const storyField = storyFieldOf(item.field);
      if (!storyField || !before.story || typeof item.text !== 'string') return notFound('field', item.field);
      const current = story[storyField] ?? before.story[storyField];
      story[storyField] = { ...current, [item.locale]: item.text };
    }

    if (Object.keys(profile).length > 0) {
      const updated = await updateAnimal(deps, ctx, { id: input.id, ...profile });
      if (!updated.ok) return updated;
    }
    if (Object.keys(story).length > 0 && before.story) {
      const { beforeAssetId, afterAssetId, quote, family, adoptedYear, beforeCaption, afterCaption } = before.story;
      const written = await setAnimalStory(deps, ctx, { id: input.id, beforeAssetId, afterAssetId, family, adoptedYear, quote, beforeCaption, afterCaption, ...story });
      if (!written.ok) return written;
    }
    return ok(null);
  })();
}
```

In `packages/modules/animals/src/manifest.ts`: `import { animalsSetTranslations, animalsTranslatables } from './translations';` und im `defineModule({ … })` nach `mediaReferences: animalsMediaReferences,` die Zeilen `translatables: animalsTranslatables,` und `setTranslations: animalsSetTranslations,`.

**Nicht** in `packages/modules/animals/src/index.ts` exportieren (Global Constraints).

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-animals test`
Expected: PASS. Schlägt der Typ von `profile[item.field]` fehl, weil `traits` `Record<string, string[]>` ist und die anderen `Record<string, string>`: `updateAnimal` validiert mit Zod, der Typ `Record<string, LocalizedValue>` ist für den Aufruf als `unknown` unkritisch — notfalls `{ id: input.id, ...profile } as unknown` übergeben; `updateAnimal` nimmt `input: unknown`.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add packages/modules/animals/src/translations.ts packages/modules/animals/src/manifest.ts packages/modules/animals/tests/translations.test.ts
git commit -m "feat(animals): translation hooks — list localized fields, write single locales through the services"
```

---

### Task 6: Projektmodul meldet und schreibt Übersetzungen

**Files:**
- Create: `packages/modules/projects/src/translations.ts`
- Modify: `packages/modules/projects/src/manifest.ts`
- Test: `packages/modules/projects/tests/translations.test.ts`

**Interfaces:**
- Consumes: `updateProject`, `type ProjectRecord` aus `./service`; `projects` aus `./schema`; `readLocales` (für die Beschriftung in der Leitsprache) und die Typen aus `@kompass/core`.
- Produces: `projectsTranslatables`, `projectsSetTranslations`; `entityType` `project`; Felder `name`, `summary`, `body`; `label` = Leitsprachen-`name`, sonst Slug; `href` `/projects/<id>`.

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/projects/tests/translations.test.ts
import { coreModule, schema as core, setSetting, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { projectsModule } from '../src/manifest';
import { createProject, getProject } from '../src/service';
import { projectsSetTranslations, projectsTranslatables } from '../src/translations';

const manage = ctxWith(['projects.manage', 'projects.view']);
const view = ctxWith(['projects.view']);
const base = { slug: 'grundversorgung', name: { de: 'Grundversorgung des Heims', en: '' }, type: 'ongoing' as const, summary: { de: 'Futter und Wärme', en: 'Food and warmth' }, body: { de: 'Text', en: '' } };

const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule] });
  insertUser(deps, { id: 'USER-TEST' });
  await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['de', 'en'] });
  const p = unwrap(await createProject(deps, manage, base));
  return { deps, id: p.id };
};

describe('projects translations', () => {
  it('lists every project, drafts included, labelled by its leading-locale name', async () => {
    const { deps, id } = await setup();
    expect(unwrap(projectsTranslatables(deps, view))).toEqual([
      { entityType: 'project', id, label: 'Grundversorgung des Heims', href: `/projects/${id}`, fields: { name: base.name, summary: base.summary, body: base.body } },
    ]);
    expect(projectsTranslatables(deps, ctxWith([])).ok).toBe(false);
  });

  it('writes only the named locales in one audited update', async () => {
    const { deps, id } = await setup();
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await projectsSetTranslations(deps, manage, { entityType: 'project', id, items: [{ field: 'name', locale: 'en', text: 'Basic care for the shelter' }, { field: 'body', locale: 'en', text: 'Text (en)' }] });
    expect(result && (await result).ok).toBe(true);
    const p = unwrap(await getProject(deps, view, id));
    expect(p.name).toEqual({ de: 'Grundversorgung des Heims', en: 'Basic care for the shelter' });
    expect(p.body).toEqual({ de: 'Text', en: 'Text (en)' });
    expect(p.summary).toEqual(base.summary);
    expect(deps.db.select().from(core.auditLog).all().slice(auditBefore).map((e) => e.action)).toEqual(['projects.update']);
  });

  it('is null for foreign types, forbidden without manage, notFound for a foreign id or field', async () => {
    const { deps, id } = await setup();
    expect(projectsSetTranslations(deps, manage, { entityType: 'animal', id, items: [] })).toBeNull();
    const denied = await projectsSetTranslations(deps, view, { entityType: 'project', id, items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await projectsSetTranslations(deps, manage, { entityType: 'project', id: 'nope', items: [{ field: 'name', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'project', id: 'nope' });
    const field = await projectsSetTranslations(deps, manage, { entityType: 'project', id, items: [{ field: 'slug', locale: 'en', text: 'x' }] });
    expect(field && !field.ok && field.error).toEqual({ type: 'notFound', entity: 'field', id: 'slug' });
  });

  it('is wired into the manifest', () => {
    expect(projectsModule.translatables).toBe(projectsTranslatables);
    expect(projectsModule.setTranslations).toBe(projectsSetTranslations);
  });
});
```

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/module-projects test -- translations`
Expected: FAIL — `../src/translations` fehlt.

- [ ] **Step 3: Haken schreiben**

```ts
// packages/modules/projects/src/translations.ts
import { notFound, ok, readLocales, requirePermission, type CallContext, type Deps, type LocalizedText, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { projects } from './schema';
import { updateProject, type ProjectRecord } from './service';

const FIELDS = ['name', 'summary', 'body'] as const;
type Field = (typeof FIELDS)[number];
const isField = (f: string): f is Field => (FIELDS as readonly string[]).includes(f);

const labelOf = (p: ProjectRecord, leading: string): string => (p.name as LocalizedText)[leading] || p.slug;

/** Alle Projekte, auch unveröffentlichte. */
export function projectsTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'projects.view');
  if (denied) return denied;
  const leading = readLocales(deps)[0]!;
  const rows = deps.db.select().from(projects).orderBy(asc(projects.sortOrder)).all();
  return ok(
    rows.map((p) => ({
      entityType: 'project',
      id: p.id,
      label: labelOf(p, leading),
      href: `/projects/${p.id}`,
      fields: { name: p.name as LocalizedText, summary: p.summary as LocalizedText, body: p.body as LocalizedText },
    })),
  );
}

/** Ein `updateProject` je Projekt; nur die genannten Sprachschlüssel ersetzt. */
export function projectsSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'project') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'projects.manage');
    if (denied) return denied;
    const before = deps.db.select().from(projects).where(eq(projects.id, input.id)).get();
    if (!before) return notFound('project', input.id);
    const changes: Partial<Record<Field, LocalizedText>> = {};
    for (const item of input.items) {
      if (!isField(item.field) || typeof item.text !== 'string') return notFound('field', item.field);
      const current = changes[item.field] ?? (before[item.field] as LocalizedText);
      changes[item.field] = { ...current, [item.locale]: item.text };
    }
    return updateProject(deps, ctx, { id: input.id, ...changes });
  })();
}
```

In `packages/modules/projects/src/manifest.ts`: `import { projectsSetTranslations, projectsTranslatables } from './translations';` und im `defineModule({ … })` nach `mediaReferences: projectsMediaReferences,` die Zeilen `translatables: projectsTranslatables,` und `setTranslations: projectsSetTranslations,`. Nicht aus `index.ts` exportieren.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-projects test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add packages/modules/projects/src/translations.ts packages/modules/projects/src/manifest.ts packages/modules/projects/tests/translations.test.ts
git commit -m "feat(projects): translation hooks"
```

---

### Task 7: Site-Modul — `entryLabel`, `localizedPaths`, Haken für Variablen und Einträge

**Files:**
- Create: `packages/modules/site/src/translations.ts`
- Modify: `packages/modules/site/src/manifest.ts`
- Modify: `packages/modules/site/src/index.ts` (nur `entryLabel` und `localizedPaths` exportieren — **nicht** die Haken)
- Modify: `apps/kompass/src/app/(shell)/site/c/[collection]/page.tsx` (Zeilen 27–37)
- Test: `packages/modules/site/tests/translations.test.ts`

**Interfaces:**
- Consumes: `activeTemplate(deps)` aus `./service` (liefert `{ schema: TemplateSchema } | null`), `readValues`, `setValues` aus `./values`, `updateEntry` aus `./entries`, `widgetOf` aus `./field-schema`, `siteEntries` aus `./schema`, `readPath`, `writePath` aus `@kompass/core` (Task 2), Typen `FieldSchema`, `CollectionSchema` aus `./types`.
- Produces:
  - `entryLabel(col: CollectionSchema, entry: { id: string; slug: string | null; data: unknown }, leading: string): string` — erstes Feld vom Widget `text`, `localized` oder `markdown` in der Leitsprache, sonst Slug, sonst ID (die Regel der Listenseite).
  - `localizedPaths(fields: Record<string, FieldSchema>, value: Record<string, unknown>, prefix?: string): Record<string, Record<string, LocalizedValue>>` — jede `localized`-Stelle, auch in `objectList`, als Pfad `faq[2].answer`.
  - `siteTranslatables(deps, ctx)`, `siteSetTranslations(deps, ctx, input)` mit `entityType` `site.variables` (`id: 'variables'`, `href: '/site/variables'`, `label`: Template-Name) und `site.entry` (`href: /site/c/<collection>/<id>`), beide mit `locales: template.schema.locales`.

- [ ] **Step 1: Test schreiben**

```ts
// packages/modules/site/tests/translations.test.ts
import { schema as core, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asset, markdown, objectList, text } from '@kompass/site-template';
import { createEntry, getEntry } from '../src/entries';
import type { FieldSchema, TemplateSchema } from '../src/load';
import { siteModule } from '../src/manifest';
import { siteTemplateState } from '../src/schema';
import { entryLabel, localizedPaths, siteSetTranslations, siteTranslatables } from '../src/translations';
import { readValues, setValues } from '../src/values';

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

const faq: TemplateSchema['collections'][string] = {
  label: 'Fragen',
  slug: false,
  sortable: true,
  publishable: false,
  fields: { question: asJson(text({ localized: true, label: 'Frage' })), answer: asJson(markdown({ localized: true, label: 'Antwort' })), icon: asJson(asset({ label: 'Icon' })) },
};
const team: TemplateSchema['collections'][string] = {
  label: 'Team',
  slug: true,
  sortable: false,
  publishable: true,
  fields: { name: asJson(text({ label: 'Name' })), role: asJson(text({ localized: true, label: 'Aufgabe' })) },
};
const variables: Record<string, FieldSchema> = {
  claim: asJson(text({ localized: true, max: 120, label: 'Claim' })),
  pct: asJson(z.number()),
  steps: asJson(objectList({ label: 'Schritte', fields: { title: text({ localized: true, label: 'Titel' }), count: z.number() } })),
};

const manage = ctxWith(['site.manage', 'site.view']);
const view = ctxWith(['site.view']);

const setup = (templateLocales = ['de', 'en'], installation = ['de', 'en']) => {
  const deps = createTestDeps({ locales: installation });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'Verein Basis', schemaJson: { name: 'Verein Basis', locales: templateLocales, uses: [], variables, collections: { faq, team } }, checksum: 'a'.repeat(64), readAt: 't', readByUserId: null })
    .run();
  return deps;
};

describe('entryLabel and localizedPaths', () => {
  it('labels like the list page: first text-like field in the leading locale, then slug, then id', () => {
    expect(entryLabel(faq, { id: 'E1', slug: null, data: { question: { de: 'Wie spende ich?', en: '' } } }, 'de')).toBe('Wie spende ich?');
    expect(entryLabel(team, { id: 'E2', slug: 'anna', data: { name: 'Anna', role: { de: 'Kasse' } } }, 'de')).toBe('Anna');
    expect(entryLabel(team, { id: 'E3', slug: 'x', data: { name: '', role: {} } }, 'de')).toBe('x');
    expect(entryLabel(faq, { id: 'E4', slug: null, data: {} }, 'de')).toBe('E4');
  });

  it('finds localized values at top level and inside object lists, markdown included', () => {
    const value = { claim: { de: 'Willkommen', en: '' }, pct: 3, steps: [{ title: { de: 'Eins', en: 'One' }, count: 1 }, { title: { de: 'Zwei', en: '' }, count: 2 }] };
    expect(localizedPaths(variables, value)).toEqual({ claim: { de: 'Willkommen', en: '' }, 'steps[0].title': { de: 'Eins', en: 'One' }, 'steps[1].title': { de: 'Zwei', en: '' } });
    expect(localizedPaths(faq.fields, { question: { de: 'F' }, answer: { de: 'A' }, icon: null })).toEqual({ question: { de: 'F' }, answer: { de: 'A' } });
  });
});

describe('siteTranslatables', () => {
  it('reports the variables as one record and every entry, drafts included, all bound to the template locales', async () => {
    const deps = setup(['de'], ['de', 'en']);
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Willkommen', en: '' }, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }] } }));
    const q = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } }));
    const t = unwrap(await createEntry(deps, manage, { collection: 'team', slug: 'anna', data: { name: 'Anna', role: { de: 'Kasse', en: '' } } }));
    const rows = unwrap(siteTranslatables(deps, view));
    expect(rows).toEqual([
      { entityType: 'site.variables', id: 'variables', label: 'Verein Basis', href: '/site/variables', locales: ['de'], fields: { claim: { de: 'Willkommen', en: '' }, 'steps[0].title': { de: 'Eins', en: '' } } },
      { entityType: 'site.entry', id: q.id, label: 'Wie?', href: `/site/c/faq/${q.id}`, locales: ['de'], fields: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } },
      { entityType: 'site.entry', id: t.id, label: 'Anna', href: `/site/c/team/${t.id}`, locales: ['de'], fields: { role: { de: 'Kasse', en: '' } } },
    ]);
  });

  it('is empty without a template and forbidden without site.view', () => {
    const bare = createTestDeps({ locales: ['de', 'en'] });
    expect(unwrap(siteTranslatables(bare, view))).toEqual([]);
    expect(siteTranslatables(setup(), ctxWith([])).ok).toBe(false);
  });
});

describe('siteSetTranslations', () => {
  it('writes a nested variable through setValues, touching only that top-level variable and one locale', async () => {
    const deps = setup();
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Willkommen', en: '' }, pct: 7, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }, { title: { de: 'Zwei', en: '' }, count: 2 }] } }));
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'steps[1].title', locale: 'en', text: 'Two' }, { field: 'claim', locale: 'en', text: 'Welcome' }] });
    expect(result && (await result).ok).toBe(true);
    expect(readValues(deps)).toEqual({ claim: { de: 'Willkommen', en: 'Welcome' }, pct: 7, steps: [{ title: { de: 'Eins', en: '' }, count: 1 }, { title: { de: 'Zwei', en: 'Two' }, count: 2 }] });
    const audits = deps.db.select().from(core.auditLog).all().slice(auditBefore);
    expect(audits.map((e) => e.action)).toEqual(['site.values.update']);
    expect(audits[0]?.summary).toContain('steps');
  });

  it('writes an entry field through updateEntry with one audit entry', async () => {
    const deps = setup();
    const q = unwrap(await createEntry(deps, manage, { collection: 'faq', data: { question: { de: 'Wie?', en: '' }, answer: { de: 'So.', en: '' } } }));
    const auditBefore = deps.db.select().from(core.auditLog).all().length;
    const result = await siteSetTranslations(deps, manage, { entityType: 'site.entry', id: q.id, items: [{ field: 'question', locale: 'en', text: 'How?' }, { field: 'answer', locale: 'en', text: 'Like this.' }] });
    expect(result && (await result).ok).toBe(true);
    expect(unwrap(await getEntry(deps, view, q.id)).data).toEqual({ question: { de: 'Wie?', en: 'How?' }, answer: { de: 'So.', en: 'Like this.' } });
    expect(deps.db.select().from(core.auditLog).all().slice(auditBefore).map((e) => e.action)).toEqual(['site.entry.update']);
  });

  it('is null for foreign types, forbidden without manage, notFound for unknown ids and paths', async () => {
    const deps = setup();
    expect(siteSetTranslations(deps, manage, { entityType: 'animal', id: 'x', items: [] })).toBeNull();
    const denied = await siteSetTranslations(deps, view, { entityType: 'site.variables', id: 'variables', items: [{ field: 'claim', locale: 'en', text: 'x' }] });
    expect(denied && !denied.ok && denied.error.type).toBe('forbidden');
    const missing = await siteSetTranslations(deps, manage, { entityType: 'site.entry', id: 'nope', items: [{ field: 'question', locale: 'en', text: 'x' }] });
    expect(missing && !missing.ok && missing.error).toEqual({ type: 'notFound', entity: 'siteEntry', id: 'nope' });
    const path = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'steps[4].title', locale: 'en', text: 'x' }] });
    expect(path && !path.ok && path.error).toEqual({ type: 'notFound', entity: 'field', id: 'steps[4].title' });
    const notLocalized = await siteSetTranslations(deps, manage, { entityType: 'site.variables', id: 'variables', items: [{ field: 'pct', locale: 'en', text: 'x' }] });
    expect(notLocalized && !notLocalized.ok && notLocalized.error).toEqual({ type: 'notFound', entity: 'field', id: 'pct' });
  });

  it('is wired into the manifest', () => {
    expect(siteModule.translatables).toBe(siteTranslatables);
    expect(siteModule.setTranslations).toBe(siteSetTranslations);
  });
});
```

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/module-site test -- translations`
Expected: FAIL — `../src/translations` fehlt.

- [ ] **Step 3: Helfer und Haken schreiben**

```ts
// packages/modules/site/src/translations.ts
import { notFound, ok, readLocales, readPath, requirePermission, writePath, type CallContext, type Deps, type LocalizedValue, type Result, type Translatable, type TranslationWrite } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { updateEntry } from './entries';
import { widgetOf } from './field-schema';
import { siteEntries } from './schema';
import { activeTemplate } from './service';
import type { CollectionSchema, FieldSchema } from './types';
import { readValues, setValues } from './values';

const LABEL_WIDGETS = ['text', 'localized', 'markdown'];

/**
 * Wie die Listenseite einen Eintrag beschriftet: erstes textartiges Feld in
 * der Leitsprache, sonst Slug, sonst ID. Eine Regel für Maske und MCP.
 */
export function entryLabel(col: CollectionSchema, entry: { id: string; slug: string | null; data: unknown }, leading: string): string {
  const labelField = Object.entries(col.fields).find(([, f]) => LABEL_WIDGETS.includes(widgetOf(f)))?.[0];
  const data = (entry.data ?? {}) as Record<string, unknown>;
  const raw = labelField ? data[labelField] : undefined;
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String((raw as Record<string, string>)[leading] ?? '') : '';
  return text || entry.slug || entry.id;
}

const isLocalizedMap = (v: unknown): v is Record<string, LocalizedValue> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Jede `localized`-Stelle eines Wertes, auch in `objectList`, als Pfad → Sprachmap. */
export function localizedPaths(fields: Record<string, FieldSchema>, value: Record<string, unknown>, prefix = ''): Record<string, Record<string, LocalizedValue>> {
  const out: Record<string, Record<string, LocalizedValue>> = {};
  for (const [key, field] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const v = value[key];
    const widget = widgetOf(field);
    if (widget === 'localized' && isLocalizedMap(v)) out[path] = v;
    if (widget === 'objectList' && Array.isArray(v)) {
      const props = (field as { items?: { properties?: Record<string, FieldSchema> } }).items?.properties ?? {};
      v.forEach((item, i) => {
        if (item && typeof item === 'object') Object.assign(out, localizedPaths(props, item as Record<string, unknown>, `${path}[${i}]`));
      });
    }
  }
  return out;
}

/** Variablen als ein Datensatz, dazu jeder Eintrag jeder Sammlung — alle nur in den Sprachen des Templates. */
export function siteTranslatables(deps: Deps, ctx: CallContext): Result<Translatable[]> {
  const denied = requirePermission(ctx, 'site.view');
  if (denied) return denied;
  const template = activeTemplate(deps);
  if (!template) return ok([]);
  const leading = readLocales(deps)[0]!;
  const locales = template.schema.locales;
  const out: Translatable[] = [
    { entityType: 'site.variables', id: 'variables', label: template.schema.name, href: '/site/variables', locales, fields: localizedPaths(template.schema.variables, readValues(deps)) },
  ];
  for (const [key, col] of Object.entries(template.schema.collections)) {
    const rows = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, key)).orderBy(asc(siteEntries.sortOrder)).all();
    for (const row of rows) {
      out.push({ entityType: 'site.entry', id: row.id, label: entryLabel(col, row, leading), href: `/site/c/${key}/${row.id}`, locales, fields: localizedPaths(col.fields, row.data as Record<string, unknown>) });
    }
  }
  return ok(out);
}

/** Setzt je Position den einen Sprachschlüssel; liefert die geänderten Top-Level-Schlüssel oder den ersten fehlenden Pfad. */
function patch(root: Record<string, unknown>, items: TranslationWrite['items']): { next: Record<string, unknown>; touched: string[] } | { missing: string } {
  let next = root;
  const touched = new Set<string>();
  for (const item of items) {
    const current = readPath(next, item.field);
    if (!isLocalizedMap(current)) return { missing: item.field };
    const written = writePath(next, item.field, { ...current, [item.locale]: item.text });
    if (!written) return { missing: item.field };
    next = written;
    touched.add(item.field.split(/[.[]/)[0]!);
  }
  return { next, touched: [...touched] };
}

const pick = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

/** Variablen über `setValues` (nur die berührten Variablen), Einträge über `updateEntry` (nur die berührten Felder). */
export function siteSetTranslations(deps: Deps, ctx: CallContext, input: TranslationWrite): Promise<Result<unknown>> | null {
  if (input.entityType !== 'site.variables' && input.entityType !== 'site.entry') return null;
  return (async () => {
    const denied = requirePermission(ctx, 'site.manage');
    if (denied) return denied;
    if (input.entityType === 'site.variables') {
      const patched = patch(readValues(deps), input.items);
      if ('missing' in patched) return notFound('field', patched.missing);
      return setValues(deps, ctx, { values: pick(patched.next, patched.touched) });
    }
    const row = deps.db.select().from(siteEntries).where(eq(siteEntries.id, input.id)).get();
    if (!row) return notFound('siteEntry', input.id);
    const patched = patch(row.data as Record<string, unknown>, input.items);
    if ('missing' in patched) return notFound('field', patched.missing);
    return updateEntry(deps, ctx, { id: input.id, data: pick(patched.next, patched.touched) });
  })();
}
```

Manifest: in `packages/modules/site/src/manifest.ts` `import { siteSetTranslations, siteTranslatables } from './translations';` und im `defineModule({ … })` nach `mediaReferences: siteMediaReferences,` die Zeilen `translatables: siteTranslatables,` und `setTranslations: siteSetTranslations,`.

Index: in `packages/modules/site/src/index.ts` ergänzen: `export { entryLabel, localizedPaths } from './translations';` — nur die zwei Helfer, nicht die Haken.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-site test`
Expected: PASS. `markdown({ localized: true })` setzt im Template-Paket `widget: 'localized'` mit `markdown: true` daneben (`packages/site-template/src/index.ts`, Funktion `wrap`), landet also im selben Zweig wie `text({ localized: true })`.

- [ ] **Step 5: Listenseite auf `entryLabel` umstellen**

In `apps/kompass/src/app/(shell)/site/c/[collection]/page.tsx` den Import `widgetOf` durch `entryLabel` ersetzen (`import { activeTemplate, entryLabel, listEntries } from '@kompass/module-site';`) und die Zeilen von `const labelField = …` bis zum Ende von `const rows = …` ersetzen durch:

```ts
  const rows = result.value.map((entry) => ({ id: entry.id, label: entryLabel(col, entry, leading), isPublished: entry.isPublished }));
```

Run: `pnpm typecheck` und `pnpm --filter @kompass/app test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/site/src/translations.ts packages/modules/site/src/manifest.ts packages/modules/site/src/index.ts packages/modules/site/tests/translations.test.ts "apps/kompass/src/app/(shell)/site/c/[collection]/page.tsx"
git commit -m "feat(site): translation hooks for variables and entries; entryLabel shared with the list page"
```

---

### Task 8: Pflicht-Haken-Test und Hinweise in den Update-Werkzeugen

**Files:**
- Modify: `apps/kompass/tests/mcp-tools.test.ts` (Fixture in `siteToolsWithTemplate`, neuer Test im `describe('registered mcp tools')`)
- Modify: `packages/modules/animals/src/mcp-tools.ts` (Zeilen 11, 14)
- Modify: `packages/modules/projects/src/mcp-tools.ts` (Zeile 12)
- Modify: `packages/modules/site/src/mcp-tools.ts` (`site_${key}_update`, `site_variables_set`)

**Interfaces:**
- Consumes: `installedModules`, `moduleMcpTools`, `siteToolsWithTemplate()` aus der Testdatei.
- Produces: eine Regel — jedes Modul, dessen Werkzeug-Eingabeschemata `localized: true` tragen, hat `translatables` und `setTranslations`.

- [ ] **Step 1: Test schreiben**

In `apps/kompass/tests/mcp-tools.test.ts` in `siteToolsWithTemplate()` das Fixture-Feld `body: { type: 'string' }` ersetzen durch `body: { widget: 'localized', type: 'object' }` — so trägt das Sammlungswerkzeug ein mehrsprachiges Feld. Dann im `describe('registered mcp tools', …)` nach dem Test `names a module that brings a permission without a tool` einfügen:

```ts
  /**
   * Wer mehrsprachige Felder anbietet, muss sie auch übersetzen lassen: Die
   * Werkzeuge tragen die echten Zod-Schemata der Services, und `localizedText`
   * hinterlässt darin `localized: true`. Ein Modul mit Treffer ohne beide Haken
   * fiele aus `translations_list_gaps` still heraus.
   */
  const carriesLocalized = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if ((node as { localized?: unknown }).localized === true) return true;
    return Object.values(node as Record<string, unknown>).some(carriesLocalized);
  };
  const toolsOf = (m: ModuleManifest): readonly McpToolDefinition[] =>
    m.key === 'site' ? siteToolsWithTemplate().filter((t) => t.name.startsWith('site_')) : moduleMcpTools(deps, m);

  it('every module whose tools carry localized fields offers both translation hooks', () => {
    const localized = installedModules.filter((m) => toolsOf(m).some((tool) => carriesLocalized(z.toJSONSchema(tool.inputSchema, { io: 'input' }))));
    expect(localized.map((m) => m.key).sort()).toEqual(['animals', 'projects', 'site']);
    const missing = localized.filter((m) => !m.translatables || !m.setTranslations).map((m) => m.key);
    expect(missing).toEqual([]);
  });

  it('every update tool with localized fields points at translations_set for single locales', () => {
    const updaters = registeredTools.concat(siteToolsWithTemplate()).filter((tool) => /_update$|^site_variables_set$|^animals_set_story$/.test(tool.name));
    const withLocalized = updaters.filter((tool) => carriesLocalized(z.toJSONSchema(tool.inputSchema, { io: 'input' })));
    expect(withLocalized.map((t) => t.name)).toEqual(expect.arrayContaining(['animals_update', 'animals_set_story', 'project_update', 'site_variables_set', 'site_notes_update']));
    const silent = withLocalized.filter((tool) => !tool.description.includes('translations_set')).map((t) => t.name);
    expect(silent).toEqual([]);
  });
```

`siteToolsWithTemplate` steht weiter unten in der Datei als Funktionsdeklaration — Hoisting macht sie im oberen `describe` verfügbar. Die Konstante `deps` ist oben definiert.

- [ ] **Step 2: Test laufen lassen, rot**

Run: `pnpm --filter @kompass/app test -- mcp-tools`
Expected: FAIL im zweiten neuen Test — die Beschreibungen nennen `translations_set` noch nicht. Der erste neue Test ist grün, wenn Tasks 5–7 durch sind; ist er rot mit einer leeren Liste, überträgt `z.toJSONSchema` die Metadaten nicht — dann `console.log(JSON.stringify(z.toJSONSchema(animalUpdateSchema, { io: 'input' })))` ansehen und `carriesLocalized` auf den tatsächlichen Schlüssel anpassen.

- [ ] **Step 3: Hinweise ergänzen**

Der Satz, überall gleich: ` Localized fields are replaced as a whole map; to change one locale use translations_set.`

- `packages/modules/animals/src/mcp-tools.ts`: `'Update an animal profile. Requires animals.manage. Localized fields are replaced as a whole map; to change one locale use translations_set.'` und `'Set adoption success story of an adopted animal. Requires animals.manage. Localized fields are replaced as a whole map; to change one locale use translations_set.'`
- `packages/modules/projects/src/mcp-tools.ts`: `'Update a project. Requires projects.manage. Audited. Localized fields are replaced as a whole map; to change one locale use translations_set.'`
- `packages/modules/site/src/mcp-tools.ts`: in `collectionTools` bei `site_${key}_update`: `` `Update an entry in „${col.label}“. Requires site.manage. Localized fields are replaced as a whole map; to change one locale use translations_set.` `` und bei `site_variables_set`: `'Write template variable values, checked against the template schema. Requires site.manage. Localized fields are replaced as a whole map; to change one locale use translations_set.'`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/app test -- mcp-tools` und `pnpm --filter @kompass/module-site test -- mcp-tools`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add apps/kompass/tests/mcp-tools.test.ts packages/modules/animals/src/mcp-tools.ts packages/modules/projects/src/mcp-tools.ts packages/modules/site/src/mcp-tools.ts
git commit -m "test(app): modules with localized fields must offer the translation hooks; update tools point at translations_set"
```

---

### Task 9: Seed mit Übersetzungslücken

**Files:**
- Modify: `packages/modules/animals/src/seed.ts` (Eintrag `frida`, Zeilen ≈ 59–60)
- Modify: `packages/modules/projects/src/seed.ts` (Eintrag `auslauf-am-heim`, Zeile ≈ 36)
- Test: `packages/modules/animals/tests/seed.test.ts`, `packages/modules/projects/tests/seed.test.ts`

**Interfaces:**
- Consumes: `seedDevelopment` (Tiere), `seedProjects` (Projekte) — unverändert.
- Produces: Frida ohne englische `summary` und `body`; „Auslauf am Heim" ohne englische `summary`. Damit zeigt `translations_list_gaps` in `development` drei Lücken.

- [ ] **Step 1: Tests schreiben**

In `packages/modules/animals/tests/seed.test.ts` am Ende des `describe`:

```ts
  it('leaves one animal untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ manifests: [coreModule, animalsModule], env: 'development' });
    await seedDevelopment(deps);
    const rows = deps.db.select().from(animals).all();
    const gap = rows.filter((a) => (a.summary as Record<string, string>).de.length > 0 && !(a.summary as Record<string, string>).en);
    expect(gap.map((a) => a.slug)).toEqual(['frida']);
    expect(rows.filter((a) => (a.summary as Record<string, string>).en?.length > 0).length).toBeGreaterThanOrEqual(2);
  });
```

In `packages/modules/projects/tests/seed.test.ts` am Ende des `describe`:

```ts
  it('leaves one project summary untranslated so translations_list_gaps has something to show', async () => {
    const deps = createTestDeps({ locales: ['de', 'en'] });
    const ctx = ctxWith(['projects.manage', 'projects.view'], insertUser(deps, {}));
    await seedProjects(deps, ctx);
    const rows = deps.db.select().from(projects).all();
    const gap = rows.filter((p) => (p.summary as Record<string, string>).de.length > 0 && !(p.summary as Record<string, string>).en);
    expect(gap.map((p) => p.slug)).toEqual(['auslauf-am-heim']);
  });
```

- [ ] **Step 2: Tests laufen lassen, rot**

Run: `pnpm --filter @kompass/module-animals test -- seed` und `pnpm --filter @kompass/module-projects test -- seed`
Expected: FAIL — beide Listen sind leer.

- [ ] **Step 3: Seeds ändern**

`packages/modules/animals/src/seed.ts`, Eintrag `frida`:

```ts
    // Bewusst ohne englische Fassung: die eine Lücke, die `translations_list_gaps` in der Entwicklung zeigt.
    summary: { de: 'Sanfte Hündin für ein ruhiges Zuhause.', en: '' },
    body: { de: 'Frida lebt bereits in einer Pflegestelle in Deutschland.', en: '' },
```

`packages/modules/projects/src/seed.ts`, Eintrag `auslauf-am-heim`:

```ts
    // Bewusst ohne englische Fassung, siehe Tiere-Seed.
    summary: { de: 'Ein eingezäunter Auslauf für die Hunde, 2025 fertiggestellt.', en: '' },
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-animals test` und `pnpm --filter @kompass/module-projects test`
Expected: PASS. Schlägt ein anderer Seed-Test an, weil er eine englische Frida erwartet (`grep -rn "Gentle girl" packages apps`), passe dort die Erwartung an.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add packages/modules/animals/src/seed.ts packages/modules/projects/src/seed.ts packages/modules/animals/tests/seed.test.ts packages/modules/projects/tests/seed.test.ts
git commit -m "chore(seed): one animal and one project keep a translation gap for translations_list_gaps"
```

---

### Task 10: Gesamtlauf und Ende-zu-Ende über die Werkzeuge

**Files:**
- Test: `apps/kompass/tests/translations-roundtrip.test.ts`

**Interfaces:**
- Consumes: `installedModules`, `coreMcpTools`, `seedDevelopment`, alles Vorige.

- [ ] **Step 1: Rundlauf-Test schreiben**

```ts
// apps/kompass/tests/translations-roundtrip.test.ts
import { coreModule, schema, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { coreMcpTools } from '@kompass/mcp';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

const tool = (name: string) => coreMcpTools.find((t) => t.name === name)!;

describe('translations over MCP, end to end', () => {
  it('lists the seeded gaps of every module and closes them one record at a time', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const all = ctxWith(['animals.view', 'animals.manage', 'projects.view', 'projects.manage', 'site.view', 'site.manage']);

    const listed = unwrap(await tool('translations_list_gaps').handler(deps, all, {}));
    const byType = Object.groupBy(listed.gaps, (g) => g.entityType);
    expect(Object.keys(byType).sort()).toEqual(['animal', 'project']);
    expect(byType.animal!.map((g) => g.field).sort()).toEqual(['body', 'summary']);
    expect(byType.project!.map((g) => g.field)).toEqual(['summary']);
    expect(listed.gaps.every((g) => g.source.locale === 'de' && String(g.source.text).length > 0 && g.href.startsWith('/'))).toBe(true);

    const auditBefore = deps.db.select().from(schema.auditLog).all().length;
    const written = unwrap(await tool('translations_set').handler(deps, all, { items: listed.gaps.map((g) => ({ entityType: g.entityType, id: g.id, field: g.field, locale: g.locale, text: `EN: ${g.source.text}` })) }));
    expect(written).toEqual({ applied: 3, failed: [] });
    // Zwei Datensätze, zwei Audit-Einträge — die zwei Felder des Tiers gehen in einem Update.
    expect(deps.db.select().from(schema.auditLog).all().length - auditBefore).toBe(2);
    expect(unwrap(await tool('translations_list_gaps').handler(deps, all, {})).gaps).toEqual([]);
  });

  it('names the modules a caller may not read', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules], env: 'development' });
    await seedDevelopment(deps);
    const onlyProjects = unwrap(await tool('translations_list_gaps').handler(deps, ctxWith(['projects.view']), {}));
    expect(onlyProjects.omitted.sort()).toEqual(['animals', 'site']);
    expect(onlyProjects.gaps.map((g) => g.entityType)).toEqual(['project']);
  });
});
```

`seedDevelopment` schaltet alle installierten Module ein (`packages/core/src/seed/seed.ts`, Einstellung `modules.enabled`) und führt `['de', 'en']`. `Object.groupBy` gibt es ab Node 21; das Repo läuft auf Node 26.

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm --filter @kompass/app test -- translations-roundtrip`
Expected: PASS. Meldet der erste Test mehr Lücken als drei, hat der Site-Seed oder ein anderer Seed-Datensatz eine leere englische Fassung — dann entweder die Erwartung um den Fund erweitern oder den Seed füllen; die Spec verlangt mindestens eine Lücke je Tiere und Projekte, nicht genau eine.

- [ ] **Step 3: Alles**

Run: `pnpm typecheck && pnpm test`
Expected: grün. `pnpm verify` läuft vor dem Push (Joe), nicht hier.

- [ ] **Step 4: Commit**

```bash
git add apps/kompass/tests/translations-roundtrip.test.ts
git commit -m "test(app): translations round trip over the MCP tools against the development seed"
```

---

## Selbstprüfung gegen die Spec

| Spec | Task |
|---|---|
| § 3 `listTranslationGaps` mit `gaps`, `omitted`, Filter, `unknownLocale`, Ausgangstext, Listenfelder | 3 |
| § 3 `setTranslations`: Gruppierung je Datensatz, `failed` mit Indizes, `unknownLocale` vor dem Schreiben, leerer Text erlaubt | 3 (leerer Text: `z.string()` ohne `min`, `z.array` ohne `min`) |
| § 4 Haken-Typen, `locales` je Datensatz, kein Export aus `index.ts` | 3, 5, 6, 7 |
| § 4 Tiere: Profilfelder + `story.*` über zwei Services | 5 |
| § 4 Projekte | 6 |
| § 4 Site: Variablen, Einträge, `objectList`, `entryLabel` geteilt mit der Listenseite | 7 |
| § 5 Werkzeuge und Hinweise in den Update-Werkzeugen | 4, 8 |
| § 6 Tests Kern, Module, Pflicht-Haken-Test | 3, 5–8 |
| § 7 Seed | 9 |
| § 8 Backlog 19 | 1 |
| § 9 Nicht-Ziele | keine Oberfläche, kein Übersetzer-Recht, Export unverändert — nichts zu tun |
