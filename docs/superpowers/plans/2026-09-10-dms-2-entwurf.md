# DMS 2 — Entwurf, Vorschau und Festschreiben (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Brief entsteht als Entwurf, wird als gekennzeichnete Vorschau gelesen und mit dem Festschreiben unveränderlich — mit Nummer, PDF und Prüfsumme.

**Architecture:** Der Entwurf ist eine Zeile ohne Nummer und ohne Datei; sein Text lebt in `draftBody` und verschwindet beim Festschreiben (Entscheidung 4). `fileDocument` ist der einzige Übergang nach `issued`: Nummer aus dem Präfix der Dokumentart, Rendern über die Kern-Pipeline, Ablage in der Mediathek, Snapshot mit Basis-Prüfsumme. Der freie Brief ist eine Dokumentart des Moduls, deren `build` rein bleibt — die Empfängerauflösung geschieht vorher im Service (Entscheidung 7).

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-dokumente-und-korrespondenz-design.md` (§ 6.1 Ausgang, § 6.4 Nummernvergabe)

## Global Constraints

- Code Englisch, Oberflächentexte über i18n. Kein hartcodierter UI-Text (`AGENTS.md`, Prinzip 7).
- IDs über `newId()` (ULID). Zeit über `deps.clock.now()` bzw. `isoNow(deps.clock)` — nie `new Date()` in Fachcode.
- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok`.
- Fachfehler sind `Result`-Werte, nie Exceptions. Pro Service mindestens vier Tests: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- `build(data, ctx)` bleibt rein: keine Uhr, kein Zufall, keine I/O. Determinismus hängt daran.
- Keine Löschfunktion ohne Eintrag in `DELETION_POLICY` (`packages/core/src/deletion-policy.ts`).
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** Plan 1 (`2026-09-10-dms-1-umzug.md`) ist abgeschlossen.

## Lehren aus Plan 1 (2026-09-10)

Plan 1 ist ausgeführt; diese Punkte kosteten dort Zeit oder gingen erst in `pnpm verify` auf. Sie gelten für jeden Task dieses Plans.

- **Die echten Testhelfer** heißen `createTestDeps({ manifests })`, `ctxWith(permissions, userId?)`, `insertUser(deps, {...})`, `insertRole(deps, {...})` und `TEST_NOW` — alle aus `@kompass/core` (`packages/core/src/testing/`). Frühere Planentwürfe nannten `deps.testing.adminContext()` und `contextWithout(...)`; **die gibt es nicht**. Ein fehlendes Recht prüft man mit `ctxWith(['dms.view'])` statt mit einem Kontext, dem man etwas wegnimmt.
- **`createTestDeps` rendert keine echten PDFs.** Es setzt `fakeDocumentEngine()` ein, deren `render` schlicht `%PDF-fake <baseId> <title>` zurückgibt. Deshalb: Modultests prüfen **was in die Engine hineingeht**, nicht wie das PDF aussieht — über `createTestDeps({ documents: fakeDocumentEngine({ render: async (args) => { calls.push(args); return bytes; } }) })`. Echte Typst-Prüfungen (Wasserzeichen, Byte-Gleichheit) gehören nach `packages/documents/tests/`, wo Typst wirklich läuft.
- **Neue Rechte ohne Beschriftung brechen die Rollenseite.** Jedes Recht braucht `permissions.keys.<bereich>.<verb>.label` und `.description` in `apps/kompass/messages/de.json`, jede Gruppe `permissions.groups.<key>`. `apps/kompass/tests/permission-labels.test.ts` erzwingt das in Millisekunden — dort zuerst rot sehen, statt es in zwei Minuten E2E zu suchen. Derselbe Test verbietet, in `apps/kompass/src` ein Recht zu nennen, das die Registry nicht kennt.
- **Migrationen:** `0013`–`0017` sind vergeben, die nächste freie Nummer ist `0018`. Wenn eine Schemaänderung nötig wird, **nie neue Spalten und einen Tabellenneubau in derselben Migration** — drizzle-kit 0.31.10 erzeugt dann SQL, das beim Tabellenneubau Spalten aus der alten Tabelle liest, die es dort noch nicht gibt. Trennen: erst Constraints lockern und Tabellen anlegen, dann `ALTER TABLE ADD COLUMN`, dann Werte füllen, dann verriegeln.
- **Einen E2E-Test nie entkernen, um ihn grün zu bekommen.** Wenn ein Test an einem Label oder Recht hängt, das sich geändert hat, wird der fachlich richtige Ersatz eingesetzt — nicht die Zusicherung gestrichen.


---

### Task 1: Dokumentarten lesen

Vor dem Entwurf braucht das Modul die Art — sie liefert Präfix und Fristklasse. Die Verwaltung der Arten kommt in Plan 3; hier nur Lesen und ein Startsatz.

**Files:**
- Create: `packages/modules/dms/src/catalog.ts`
- Test: `packages/modules/dms/tests/catalog.test.ts`

**Interfaces:**
- Consumes: `documentTypes`, `DocumentTypeRow` (Plan 1)
- Produces:
  - `documentTypeFor(db: DbOrTx, key: string): DocumentTypeRow | null`
  - `listDocumentTypes(deps, ctx, input?) → Result<DocumentTypeRow[]>` (Recht `dms.view`, nur aktive, wenn `includeInactive` nicht gesetzt)
  - `DEFAULT_DOCUMENT_TYPES: readonly Omit<DocumentTypeRow, 'sortOrder'>[]` — der generische Startsatz aus § 10 der Spec. **Achtung:** Migration `0016_dms_links.sql` legt bei einer Installation **mit Bestand** bereits eine Art `letter` (Präfix `BRF`, `statutory6Y`) an. `DEFAULT_DOCUMENT_TYPES` muss dazu passen — gleicher Schlüssel, gleiches Präfix — und jedes Einfügen muss vorhandene Schlüssel überspringen statt zu überschreiben.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/catalog.test.ts`:

```ts
import { coreModule, createTestDeps, ctxWith, insertUser } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { DEFAULT_DOCUMENT_TYPES, documentTypeFor, listDocumentTypes } from '../src/catalog';
import { documentTypes } from '../src/schema';

const ALL_DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

function setup(permissions: readonly string[] = ALL_DMS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  return { deps, ctx: ctxWith(permissions, insertUser(deps, { name: 'Test', email: 'test@kompass.local' })) };
}

describe('document types', () => {
  it('liefert Präfix und Fristklasse zu einem Schlüssel', () => {
    const { deps } = setup();
    deps.db.insert(documentTypes).values({ key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y' }).run();
    expect(documentTypeFor(deps.db, 'letter')?.prefix).toBe('BRF');
    expect(documentTypeFor(deps.db, 'gibtsnicht')).toBeNull();
  });

  it('verlangt dms.view', async () => {
    const { deps } = setup();
    const denied = await listDocumentTypes(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.view')), {});
    expect(denied.ok).toBe(false);
  });

  it('hat für jede Vorgabeart ein dreistelliges Präfix', () => {
    for (const type of DEFAULT_DOCUMENT_TYPES) expect(type.prefix).toMatch(/^[A-Z]{3}$/);
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- catalog`
Expected: FAIL — `src/catalog.ts` existiert nicht.

- [ ] **Step 3: Katalog schreiben**

`packages/modules/dms/src/catalog.ts`:

```ts
import { ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentTypes, type DocumentTypeRow } from './schema';

/**
 * Generischer Startsatz. Bewusst klein und ohne Vereinsspezifika (Prinzip 1) —
 * ein Verein legt seine eigenen Arten an.
 */
export const DEFAULT_DOCUMENT_TYPES = [
  { key: 'letter', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory6Y', defaultFolder: null, isActive: true },
  { key: 'authority', label: 'Behördenschreiben', prefix: 'BEH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'contract', label: 'Vertrag', prefix: 'VER', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'invoice', label: 'Rechnung', prefix: 'RCH', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true },
  { key: 'minutes', label: 'Protokoll', prefix: 'PRT', defaultDirection: 'outgoing', retentionClass: 'permanent', defaultFolder: null, isActive: true },
] as const;

export function documentTypeFor(db: DbOrTx, key: string): DocumentTypeRow | null {
  return db.select().from(documentTypes).where(eq(documentTypes.key, key)).get() ?? null;
}

export const documentTypeListSchema = z.object({ includeInactive: z.boolean().default(false) });

export async function listDocumentTypes(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentTypeRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentTypeListSchema, input);
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(documentTypes).orderBy(asc(documentTypes.sortOrder), asc(documentTypes.key)).all();
  return ok(parsed.value.includeInactive ? rows : rows.filter((row) => row.isActive));
}
```

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- catalog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): document types carry prefix and retention class"
```

---

### Task 2: Entwurf anlegen, ändern, wegwerfen

**Files:**
- Create: `packages/modules/dms/src/drafts.ts`
- Modify: `packages/core/src/deletion-policy.ts`
- Test: `packages/modules/dms/tests/drafts.test.ts`, `packages/core/tests/deletion-policy.test.ts`

**Interfaces:**
- Consumes: `documentTypeFor` (Task 1), `documents`, `documentLinks` (Plan 1)
- Produces:
  - `draftCreateSchema` = `{ typeKey, subject, body, documentDate?, folder?, links? }` mit `links: { entityType, entityId, role }[]`
  - `draftUpdateSchema` = `{ id, subject?, body?, documentDate?, folder? }`
  - `createDraft(deps, ctx, input) → Result<DocumentRecord>` (Recht `dms.create`)
  - `updateDraft(deps, ctx, input) → Result<DocumentRecord>` (Recht `dms.create`)
  - `deleteDraft(deps, ctx, input) → Result<null>` (Recht `dms.deleteDraft`)

- [ ] **Step 1: Failing Tests schreiben**

`packages/modules/dms/tests/drafts.test.ts`:

```ts
describe('createDraft', () => {
  it('legt einen Entwurf ohne Nummer und ohne Datei an', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung\n\nHallo.' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.phase).toBe('draft');
    expect(created.value.number).toBeNull();
    expect(created.value.assetId).toBeNull();
    expect(created.value.draftBody).toContain('Einladung');
  });

  it('lehnt eine unbekannte Dokumentart ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await createDraft(deps, ctx, { typeKey: 'gibtsnicht', subject: 'x', body: 'y' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('notFound');
  });

  it('verlangt dms.create', async () => {
    const { deps } = setupWithTypes();
    const denied = await createDraft(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.create')), { typeKey: 'letter', subject: 'x', body: 'y' });
    expect(denied.ok).toBe(false);
  });

  it('verlangt einen Betreff', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await createDraft(deps, ctx, { typeKey: 'letter', subject: '', body: 'y' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'x' });
    expect(auditActions(deps)).toContain('dms.draft.create');
  });
});

describe('updateDraft', () => {
  it('ändert den Text eines Entwurfs', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Alt', body: 'alt' });
    if (!created.ok) throw new Error('setup');
    const updated = await updateDraft(deps, ctx, { id: created.value.id, subject: 'Neu', body: 'neu' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.subject).toBe('Neu');
  });
});

describe('deleteDraft', () => {
  it('wirft einen Entwurf weg', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Weg', body: 'x' });
    if (!created.ok) throw new Error('setup');
    const deleted = await deleteDraft(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.draft.delete');
  });

  it('verlangt dms.deleteDraft', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Weg', body: 'x' });
    if (!created.ok) throw new Error('setup');
    const denied = await deleteDraft(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.deleteDraft')), { id: created.value.id });
    expect(denied.ok).toBe(false);
  });
});
```

Die Helfer gehören in eine eigene Datei, weil Task 4, 6 und 7 sowie die Pläne 3 und 4 sie mitbenutzen — `packages/modules/dms/tests/helpers.ts`:

```ts
import { coreModule, createTestDeps } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '../src/manifest';
import { DEFAULT_DOCUMENT_TYPES } from '../src/catalog';
import { documentTypes } from '../src/schema';

/** `deps` und `ctx` mit installiertem dms-Modul und dem Startsatz an Dokumentarten. */
export const ALL_DMS = ['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'];

export function setupWithTypes(permissions: readonly string[] = ALL_DMS) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  for (const [index, type] of DEFAULT_DOCUMENT_TYPES.entries()) {
    deps.db.insert(documentTypes).values({ ...type, sortOrder: index }).run();
  }
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith([...permissions, 'media.upload'], userId) };
}

/** Ein minimales, gültiges PDF für Eingangstests. */
export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

/** Ein festgeschriebener Brief, wie ihn mehrere Tests als Ausgangslage brauchen. */
export async function fileFixture(deps: Deps, ctx: CallContext) {
  const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Fixture', body: 'Text' });
  if (!draft.ok) throw new Error('fixture: draft');
  const filed = await fileDocument(deps, ctx, { id: draft.value.id });
  if (!filed.ok) throw new Error('fixture: filing');
  return filed.value;
}
```

`fileFixture` entsteht erst mit Task 6 — bis dahin bleibt sie auskommentiert oder wird dort ergänzt. `createTestDeps`, `ctxWith` und `insertUser` kommen aus `@kompass/core`; `insertUser` ist nötig, weil `documents.createdByUserId` einen echten Nutzer braucht. `auditActions(deps)` heißt im Repo möglicherweise anders — den in `packages/modules/contacts/tests/service.test.ts` verwendeten Weg zur Audit-Prüfung übernehmen.

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- drafts`
Expected: FAIL — `src/drafts.ts` existiert nicht.

- [ ] **Step 3: Entwurfsservices schreiben**

`packages/modules/dms/src/drafts.ts` mit `createDraft`, `updateDraft`, `deleteDraft`. Kernpunkte:

```ts
export const draftCreateSchema = z.object({
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(100_000).default(''),
  documentDate: z.string().date().optional(),
  folder: z.string().trim().min(1).nullable().optional(),
  links: z.array(z.object({
    entityType: z.string().trim().min(1).max(60),
    entityId: z.string().trim().min(1),
    role: z.enum(['sender', 'recipient', 'about']),
  })).default([]),
});
```

- `documentDate` fehlt beim Entwurf meist; dann `isoNow(deps.clock).slice(0, 10)`.
- Unbekannte Art ⇒ `notFound('documentType', typeKey)`.
- `direction` kommt aus `defaultDirection` der Art, `folder` aus `defaultFolder`, wenn nichts angegeben ist.
- `updateDraft` lehnt mit `conflict('documentIsFiled', …)` ab, wenn `phase !== 'draft'` — ein festgeschriebenes Dokument ändert sich nie.
- `deleteDraft` lehnt mit demselben `conflict` ab, wenn `phase === 'issued'`; Löschen erst über Plan 3.
- Alle drei schreiben in derselben Transaktion `recordAudit` mit `dms.draft.create` / `dms.draft.update` / `dms.draft.delete`, `entityType: 'documentDraft'`.

- [ ] **Step 4: Löschpolitik ergänzen**

In `packages/core/src/deletion-policy.ts` unter „Arbeitsmaterial":

```ts
  {
    entity: 'documentDraft',
    deletable: true,
    reason:
      'Ein Entwurf ist Arbeitsmaterial: keine Nummer, keine Datei, kein Nachweis. Erst das Festschreiben macht ihn rechenschaftsrelevant.',
    guard: 'nur solange phase = draft',
    auditAction: 'dms.draft.delete',
  },
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- drafts && pnpm --filter @kompass/core test -- deletion`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms packages/core/src/deletion-policy.ts
git commit -m "feat(dms): drafts are working material — create, change, throw away"
```

---

### Task 3: Der freie Brief als Dokumentart des Moduls

**Files:**
- Create: `packages/modules/dms/src/templates.ts`
- Modify: `packages/modules/dms/src/manifest.ts`
- Modify: `packages/documents/src/templates.ts` (`letterhead` entfällt)
- Test: `packages/modules/dms/tests/templates.test.ts`

**Interfaces:**
- Consumes: `DocumentTemplate` aus `@kompass/core`
- Produces: `letterTemplate: DocumentTemplate<LetterData>` mit `key: 'letter'`, `type: 'letter'`, `base: 'a4-mit-briefkopf'`; `LetterData = { subject: string; body: string; recipient: string }`

- [ ] **Step 1: Failing Test schreiben**

```ts
it('setzt Empfänger und Betreff in die Slots', () => {
  const built = letterTemplate.build(
    { subject: 'Einladung', body: '# Hallo', recipient: 'Familie Muster\nWeg 1\n12345 Stadt' },
    renderContext(),
  );
  expect(built.slots.kind).toBe('letter');
  expect(built.slots.recipient).toContain('Familie Muster');
  expect(built.slots.subject).toBe('Einladung');
  expect(built.body).toEqual({ markdown: '# Hallo' });
});

it('bleibt rein — zweimal gebaut ist zweimal gleich', () => {
  const data = { subject: 'A', body: 'B', recipient: 'C' };
  expect(letterTemplate.build(data, renderContext())).toEqual(letterTemplate.build(data, renderContext()));
});
```

`renderContext()` baut einen `DocumentRenderContext` mit festen Werten (Nummer, `issuedAt`, `organization`, `theme`, `logo: null`).

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- templates`
Expected: FAIL

- [ ] **Step 3: Vorlage schreiben**

```ts
export const letterSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(100_000),
  /** Fertiger, mehrzeiliger Anschriftsblock — im Service aufgelöst, nicht hier (Entscheidung 7). */
  recipient: z.string().max(500).default(''),
});

export const letterTemplate: DocumentTemplate<z.infer<typeof letterSchema>> = {
  key: 'letter',
  type: 'letter',
  schema: letterSchema,
  base: 'a4-mit-briefkopf',
  build: (data) => ({
    slots: { kind: 'letter', subject: data.subject, title: data.subject, recipient: data.recipient },
    body: { markdown: data.body },
  }),
};
```

Im Manifest `documentTemplates: [letterTemplate]` ergänzen. In `packages/documents/src/templates.ts` `letterhead` samt Schema entfernen, sodass `coreDocumentTemplates()` nur noch den Auszug führt; die Tests dort entsprechend anpassen.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/documents test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms packages/documents
git commit -m "feat(dms): the free letter moves from the core into the module"
```

---

### Task 4: Vorschau eines Entwurfs

**Files:**
- Modify: `packages/modules/dms/src/drafts.ts`
- Test: `packages/modules/dms/tests/drafts.test.ts`

**Interfaces:**
- Consumes: `prepare`, `buildContext` aus `@kompass/core` (in Plan 1 exportiert), `DocumentSlots.draft` (Plan 1, Task 2)
- Produces: `previewDraft(deps, ctx, input) → Result<{ bytes: Uint8Array; filename: string; mimeType: string }>` (Recht `dms.view`)

- [ ] **Step 1: Failing Test schreiben**

Die Vorschau unterscheidet sich vom Original genau durch `slots.draft`. Weil die Testumgebung mit `fakeDocumentEngine` rendert, wird dieses Flag am Aufruf geprüft, nicht am PDF:

```ts
it('rendert mit Entwurfskennzeichnung', async () => {
  const calls: { slots: { draft?: boolean } }[] = [];
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    documents: fakeDocumentEngine({ render: async (args) => { calls.push(args as { slots: { draft?: boolean } }); return new TextEncoder().encode('%PDF-fake'); } }),
  });
  seedTypes(deps);
  const ctx = ctxWith(ALL_DMS, insertUser(deps, { name: 'T', email: 't@kompass.local' }));
  const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'Hallo' });
  if (!draft.ok) throw new Error('setup');
  await previewDraft(deps, ctx, { id: draft.value.id });
  expect(calls[0].slots.draft).toBe(true);
});

it('rendert eine Vorschau, ohne etwas abzulegen', async () => {
  const { deps, ctx } = setupWithTypes();
  const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'Hallo' });
  if (!draft.ok) throw new Error('setup');
  const before = deps.db.select().from(mediaAssets).all().length;
  const preview = await previewDraft(deps, ctx, { id: draft.value.id });
  expect(preview.ok).toBe(true);
  if (!preview.ok) return;
  expect(preview.value.mimeType).toBe('application/pdf');
  expect(preview.value.bytes.byteLength).toBeGreaterThan(0);
  expect(deps.db.select().from(mediaAssets).all().length).toBe(before);
  expect(deps.db.select().from(documents).get()?.number).toBeNull();
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- drafts`
Expected: FAIL — `previewDraft` fehlt.

- [ ] **Step 3: Vorschau schreiben**

`previewDraft` lädt den Entwurf, löst die Empfängeranschrift auf (siehe Task 5), ruft `prepare`/`buildContext` mit leerer Nummer, setzt `slots.draft = true` und gibt die Bytes zurück. Kein `insert`, kein `storeMediaInternal`. Audit-Eintrag `dms.draft.preview` mit `entityType: 'documentDraft'` — gezogen wird schließlich ein PDF.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- drafts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): watermarked preview that files nothing"
```

---

### Task 5: Empfängeranschrift auflösen

**Files:**
- Create: `packages/modules/dms/src/recipients.ts`
- Test: `packages/modules/dms/tests/recipients.test.ts`

**Interfaces:**
- Consumes: `formatPostalAddress` aus `@kompass/module-contacts`, `documentLinks`
- Produces: `resolveRecipient(deps: Deps, documentId: string): string` — mehrzeiliger Anschriftsblock des ersten `recipient`-Links, leer wenn keiner da ist

- [ ] **Step 1: Failing Test schreiben**

```ts
it('macht aus dem recipient-Link einen Anschriftsblock', async () => {
  const { deps, ctx } = setupWithTypes();
  const contact = await createContact(deps, ctx, { kind: 'person', lastName: 'Muster', firstName: 'Erika', street: 'Weg 1', postalCode: '12345', city: 'Stadt' });
  if (!contact.ok) throw new Error('setup');
  const draft = await createDraft(deps, ctx, {
    typeKey: 'letter', subject: 'Test', body: 'x',
    links: [{ entityType: 'contact', entityId: contact.value.id, role: 'recipient' }],
  });
  if (!draft.ok) throw new Error('setup');
  const block = resolveRecipient(deps, draft.value.id);
  expect(block).toContain('Erika Muster');
  expect(block).toContain('12345 Stadt');
});

it('bleibt leer, wenn kein Empfänger verknüpft ist', async () => {
  const { deps, ctx } = setupWithTypes();
  const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Test', body: 'x' });
  if (!draft.ok) throw new Error('setup');
  expect(resolveRecipient(deps, draft.value.id)).toBe('');
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- recipients`
Expected: FAIL

- [ ] **Step 3: Auflösung schreiben**

`resolveRecipient` sucht den ersten `recipient`-Link mit `entityType === 'contact'`, lädt den Kontakt und gibt `formatPostalAddress(...)` zurück. Andere `entityType`-Werte liefern `''` — das Modul kennt keine fremden Entitäten außer Kontakten, und dafür ist `dependsOn: ['contacts']` da. Die Funktion ist unrein (liest die Datenbank) und läuft deshalb im Service, nie in `build` (Entscheidung 7).

- [ ] **Step 4: Vorschau anschließen**

`previewDraft` aus Task 4 ruft `resolveRecipient` und reicht das Ergebnis als `recipient` in die Vorlagendaten.

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): resolve the recipient address before rendering, not inside it"
```

---

### Task 6: Festschreiben

Der eine Übergang, der zählt.

**Files:**
- Modify: `packages/modules/dms/src/drafts.ts`
- Test: `packages/modules/dms/tests/filing.test.ts`

**Interfaces:**
- Consumes: `nextDocumentNumber` (Plan 1), `storeMediaInternal` aus `@kompass/core`, `resolveRecipient` (Task 5)
- Produces: `fileDocument(deps, ctx, input: { id: string }) → Result<DocumentRecord>` (Recht `dms.file`)

- [ ] **Step 1: Failing Tests schreiben**

`packages/modules/dms/tests/filing.test.ts`:

```ts
describe('fileDocument', () => {
  it('vergibt die Nummer, legt das PDF ab und leert den Entwurfstext', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung' });
    if (!draft.ok) throw new Error('setup');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    expect(filed.ok).toBe(true);
    if (!filed.ok) return;
    expect(filed.value.phase).toBe('issued');
    expect(filed.value.number).toMatch(/^BRF-\d{4}-\d{3}$/);
    expect(filed.value.assetId).not.toBeNull();
    expect(filed.value.draftBody).toBeNull();
  });

  it('hält die Prüfsumme der abgelegten Datei fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const asset = deps.db.select().from(mediaAssets).where(eq(mediaAssets.id, filed.assetId as string)).get();
    const bytes = await deps.media.read(asset!.filename);
    expect(asset?.checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('lehnt das zweite Festschreiben ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const filed = await fileFixture(deps, ctx);
    const again = await fileDocument(deps, ctx, { id: filed.id });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.kind).toBe('conflict');
  });

  it('vergibt lückenlose Nummern je Präfix und Jahr', async () => {
    const { deps, ctx } = setupWithTypes();
    const first = await fileFixture(deps, ctx);
    const second = await fileFixture(deps, ctx);
    expect(first.number).toMatch(/-001$/);
    expect(second.number).toMatch(/-002$/);
  });

  it('verlangt dms.file', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('setup');
    const denied = await fileDocument(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.file')), { id: draft.value.id });
    expect(denied.ok).toBe(false);
  });

  it('reicht Basis, Slots und Nummer unverändert an die Engine', async () => {
    // Die Testumgebung rendert mit `fakeDocumentEngine` — echte Byte-Gleichheit
    // prüft `packages/documents/tests/bases-render.test.ts` gegen echtes Typst.
    // Hier zählt, was in die Pipeline hineingeht.
    const calls: unknown[] = [];
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      documents: fakeDocumentEngine({ render: async (args) => { calls.push(args); return new TextEncoder().encode('%PDF-fake'); } }),
    });
    seedTypes(deps);
    const ctx = ctxWith(ALL_DMS.concat('media.upload'), insertUser(deps, { name: 'T', email: 't@kompass.local' }));
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: '# Einladung' });
    if (!draft.ok) throw new Error('setup');
    await fileDocument(deps, ctx, { id: draft.value.id });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { baseId: string; slots: { subject?: string; draft?: boolean }; context: { number: string } };
    expect(call.baseId).toBe('a4-mit-briefkopf');
    expect(call.slots.subject).toBe('Einladung');
    expect(call.slots.draft).toBeFalsy(); // kein Wasserzeichen auf dem Original
    expect(call.context.number).toMatch(/^BRF-\d{4}-\d{3}$/);
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await fileFixture(deps, ctx);
    expect(auditActions(deps)).toContain('dms.file');
  });
});
```

`seedTypes(deps)` ist der Teil von `setupWithTypes`, der nur die Dokumentarten einfügt — beim Bauen von Task 2 gleich so herausziehen, damit dieser Test eine eigene Engine übergeben kann.

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- filing`
Expected: FAIL — `fileDocument` fehlt.

- [ ] **Step 3: Festschreiben schreiben**

Ablauf in `fileDocument`, eng am alten `renderDocument` (Plan 1 hat es aus dem Kern entfernt — die Schleife mit der Nummernreservierung von dort übernehmen):

1. `requirePermission(ctx, 'dms.file')`
2. Entwurf laden; `notFound` wenn weg, `conflict('documentIsFiled')` wenn `phase === 'issued'`
3. Dokumentart laden ⇒ Präfix
4. Vorlage über `templateKey` (Vorgabe `letter`) aus dem Manifest holen, Daten aus `subject`, `draftBody`, `resolveRecipient(...)` bauen
5. Nummer ziehen, mit Nummer rendern, `storeMediaInternal(..., { folder: DOCUMENT_FOLDER })`
6. In einer Transaktion: `phase: 'issued'`, `number`, `assetId`, `inputSnapshot` (Daten, Slots, Basis, Basis-Prüfsumme), `draftBody: null`, `updatedAt`, dazu `recordAudit` mit `dms.file`
7. Bei `UNIQUE constraint failed: documents.number` erneut versuchen, höchstens dreimal, sonst `conflict('documentNumberContention', …)`

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): filing assigns the number, stores the pdf and drops the draft text"
```

---

### Task 7: Unveränderlichkeit absichern

**Files:**
- Test: `packages/modules/dms/tests/filing.test.ts`
- Modify: `packages/modules/dms/src/drafts.ts`, `packages/modules/dms/src/service.ts` (falls Lücken auffallen)

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('lässt ein festgeschriebenes Dokument nicht mehr ändern', async () => {
  const { deps, ctx } = setupWithTypes();
  const filed = await fileFixture(deps, ctx);
  const changed = await updateDraft(deps, ctx, { id: filed.id, subject: 'Anders', body: 'anders' });
  expect(changed.ok).toBe(false);
  if (changed.ok) return;
  expect(changed.error.kind).toBe('conflict');
});

it('lässt ein festgeschriebenes Dokument nicht als Entwurf löschen', async () => {
  const { deps, ctx } = setupWithTypes();
  const filed = await fileFixture(deps, ctx);
  const deleted = await deleteDraft(deps, ctx, { id: filed.id });
  expect(deleted.ok).toBe(false);
});

it('storniert statt zu ändern', async () => {
  const { deps, ctx } = setupWithTypes();
  const filed = await fileFixture(deps, ctx);
  const voided = await voidDocument(deps, ctx, { id: filed.id, reason: 'Falscher Empfänger' });
  expect(voided.ok).toBe(true);
  if (!voided.ok) return;
  expect(voided.value.status).toBe('voided');
  expect(voided.value.number).toBe(filed.number); // die Nummer bleibt vergeben
});
```

- [ ] **Step 2: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- filing`
Expected: Die ersten beiden sollten bereits PASS sein (Task 2 und 6 haben die Wächter eingebaut); der dritte prüft den in Plan 1 umgezogenen `voidDocument`. Was rot ist, jetzt schließen.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/dms
git commit -m "test(dms): a filed document changes only through a void"
```

---

## Abschluss

- [ ] `pnpm typecheck && pnpm test`
- [ ] Plan 3 (`2026-09-10-dms-3-eingang.md`) beginnen
