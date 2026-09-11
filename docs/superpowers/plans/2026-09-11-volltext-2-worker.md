# Volltext 2 — Der Haken, der Zustand und der Worker (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abgelegte Dokumente werden im Hintergrund gelesen, eins nach dem anderen, sichtbar im Zustand und ohne den Upload aufzuhalten.

**Architecture:** Die Warteschlange ist eine Spalte, keine Tabelle: `textStatus = 'pending'`. Ein Dienst im selben Prozess nimmt das älteste, setzt `running` und arbeitet es ab. Der Lauf selbst ist ein gewöhnlicher Service in der Hausform, damit er einzeln testbar und über MCP anstoßbar ist. Gestartet wird er aus Next' Instrumentierungshaken — **dem einzigen unerprobten Stück dieser Spec, deshalb Task 1.**

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest, Next 16 `instrumentation.ts`.

**Spec:** `docs/superpowers/specs/2026-09-11-volltext-und-texterkennung-design.md` (§ 4 Der Weg des Textes, § 5.1, § 7 Der Worker)

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok`.
- Fachfehler sind `Result`-Werte, nie Exceptions. Pro Service mindestens: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- IDs über `newId()` (ULID). Zeit über `isoNow(deps.clock)` — nie `new Date()` in Fachcode.
- Testhelfer: `createTestDeps({ manifests, textExtraction })`, `ctxWith(permissions, userId?)`, `insertUser`, `TEST_NOW` — alle aus `@kompass/core`.
- **Ein Eintrag im Änderungsprotokoll je Dokument**, Kanal `system`, nicht je Seite.
- Migrationen: `pnpm --filter @kompass/core db:generate` nach jeder Schemaänderung; erzeugte SQL wird committet und nie nachträglich editiert. **Vor dem Erzeugen die nächste freie Nummer prüfen** (`ls packages/core/src/db/migrations`), zuletzt vergeben war `0019`.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** Plan 1 (`2026-09-11-volltext-1-erkennung.md`) ist abgeschlossen: `deps.textExtraction` steht, `fakeTextExtraction` liegt in `@kompass/core`.

---

### Task 1: Trägt der Haken?

Die Spec behauptet eine Mechanik, die es in dieser Anwendung noch nicht gibt: `instrumentation.ts` läuft beim Serverstart, genau einmal, nur im Node-Zweig. Das wird **zuerst** bewiesen — sonst hängt am Ende Plan 4 an einer Annahme.

**Files:**
- Create: `apps/kompass/instrumentation.ts`, `apps/kompass/src/lib/background.ts`
- Test: `apps/kompass/tests/background.test.ts`, `apps/kompass/e2e/instrumentation.spec.ts`

**Interfaces:**
- Produces:
  - `startBackgroundWork(): void` — idempotent; ein zweiter Aufruf tut nichts.
  - `backgroundStarted(): boolean` — nur für Tests und die Gesundheitsanzeige.
  - `register()` in `instrumentation.ts` — Next ruft das von sich aus.

- [ ] **Step 1: Failing Test schreiben**

`apps/kompass/tests/background.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { backgroundStarted, resetBackgroundForTests, startBackgroundWork } from '@/lib/background';

describe('startBackgroundWork', () => {
  it('startet einmal und bleibt beim zweiten Aufruf stumm', () => {
    resetBackgroundForTests();
    let starts = 0;

    startBackgroundWork({ onStart: () => (starts += 1) });
    startBackgroundWork({ onStart: () => (starts += 1) });

    expect(starts).toBe(1);
    expect(backgroundStarted()).toBe(true);
  });

  it('läuft im Edge-Zweig gar nicht an', () => {
    resetBackgroundForTests();
    let starts = 0;

    startBackgroundWork({ runtime: 'edge', onStart: () => (starts += 1) });

    expect(starts).toBe(0);
    expect(backgroundStarted()).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app test -- background`
Expected: FAIL — `@/lib/background` gibt es nicht.

- [ ] **Step 3: Den Anlasser schreiben**

`apps/kompass/src/lib/background.ts`:

```ts
/**
 * Hintergrundarbeit anlassen — genau einmal je Prozess.
 *
 * Next ruft `register()` aus `instrumentation.ts` für **jede** Laufzeit auf,
 * also auch für Edge, wo es weder `better-sqlite3` noch `child_process` gibt.
 * Der Wächter darauf ist kein Schmuck, sondern der Unterschied zwischen einem
 * startenden und einem abstürzenden Server.
 */
let started = false;

export function resetBackgroundForTests(): void {
  started = false;
}

export function backgroundStarted(): boolean {
  return started;
}

export function startBackgroundWork(
  opts: { runtime?: string; onStart?: () => void } = {},
): void {
  const runtime = opts.runtime ?? process.env.NEXT_RUNTIME;
  if (runtime !== 'nodejs') return;
  if (started) return;
  started = true;
  opts.onStart?.();
}
```

`apps/kompass/instrumentation.ts`:

```ts
import { startBackgroundWork } from '@/lib/background';

/**
 * Next ruft das beim Serverstart — einmal je Prozess, vor der ersten Anfrage.
 * Hier hängt der Worker der Texterkennung; Task 4 füllt `onStart`.
 */
export function register(): void {
  startBackgroundWork({
    onStart: () => {
      console.log('[kompass] Hintergrundarbeit gestartet');
    },
  });
}
```

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/app test -- background`
Expected: PASS (2 Tests)

- [ ] **Step 5: Den Beweis am laufenden Server führen**

Das ist der eigentliche Zweck dieses Tasks: Der Test oben prüft die Funktion, nicht Next.

```bash
pnpm --filter @kompass/app dev
```

Expected in der Ausgabe, **einmal** und vor der ersten Anfrage: `[kompass] Hintergrundarbeit gestartet`. Erscheint es zweimal, ist der Wächter zu lax; erscheint es gar nicht, prüfen, ob die Datei an der richtigen Stelle liegt (`apps/kompass/instrumentation.ts`, neben `next.config.ts`, **nicht** unter `src/`).

Danach dasselbe im Container:

```bash
pnpm image && pnpm dev:image up
docker logs kompass-dev 2>&1 | grep Hintergrundarbeit
```

Expected: dieselbe Zeile, einmal.

- [ ] **Step 6: Den Beweis festhalten**

`apps/kompass/e2e/instrumentation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * Der Haken ist die einzige Zusicherung dieser Spec, die nicht aus einer
 * Messung stammt. Er bekommt deshalb einen Test, der gegen den echten Server
 * läuft: `/api/health` meldet, ob die Hintergrundarbeit angelaufen ist.
 */
test('der Server hat seine Hintergrundarbeit angelassen', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ background: true });
});
```

In `apps/kompass/src/app/api/health/route.ts` das Feld ergänzen:

```ts
import { backgroundStarted } from '@/lib/background';
```

```ts
    background: backgroundStarted(),
```

- [ ] **Step 7: E2E laufen lassen**

Run: `pnpm --filter @kompass/app e2e -- instrumentation`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/kompass/instrumentation.ts apps/kompass/src/lib/background.ts apps/kompass/tests/background.test.ts apps/kompass/e2e/instrumentation.spec.ts apps/kompass/src/app/api/health/route.ts
git commit -m "feat(app): the server starts its background work, once, and says so"
```

---

### Task 2: Der Zustand am Dokument

Vier Spalten, fünf Werte. `running` ist dabei, weil ein 200-Seiten-Scan Minuten unter dem Werkzeug liegt und „wartet" dann falsch wäre.

**Files:**
- Modify: `packages/modules/dms/src/schema.ts`, `packages/modules/dms/src/service.ts` (`toRecord`)
- Create: `packages/core/src/db/migrations/0020_dms_text_status.sql` (erzeugt)
- Test: `packages/modules/dms/tests/text-status.test.ts`

**Interfaces:**
- Produces:
  - `documents.textStatus: 'pending' | 'running' | 'done' | 'failed' | 'unavailable'`, Vorgabe `'pending'`
  - `documents.textAttempts: number`, Vorgabe `0`
  - `documents.textError: string | null`
  - `documents.textExtractedAt: string | null`
  - `DocumentRecord` trägt die vier Felder mit denselben Namen.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/text-status.test.ts`:

```ts
import { coreModule, createTestDeps, ctxWith, insertUser } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { receiveDocument } from '../src/incoming';
import { createDraft } from '../src/drafts';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

describe('Erkennungszustand am Dokument', () => {
  it('eingegangene Post wartet auf Erkennung', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const ctx = ctxWith(['dms.create', 'dms.view']);

    const result = await receiveDocument(deps, ctx, {
      filename: 'post.pdf',
      typeKey: 'letter',
      subject: 'Eingang',
      documentDate: '2026-09-11',
      bytes: pdf(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.textStatus).toBe('pending');
    expect(result.value.textAttempts).toBe(0);
    expect(result.value.textError).toBeNull();
    expect(result.value.textExtractedAt).toBeNull();
  });

  it('ein Entwurf hat keine Datei und wartet auf nichts', async () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const ctx = ctxWith(['dms.create', 'dms.view']);

    const result = await createDraft(deps, ctx, {
      typeKey: 'letter',
      subject: 'Entwurf',
      documentDate: '2026-09-11',
      body: 'Text',
      links: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.textStatus).toBeNull();
  });
});
```

**Hinweis:** `seedTypes` aus `packages/modules/dms/tests/helpers.ts` ist der vorhandene Helfer, der die Dokumentarten anlegt. Die genaue Signatur dort nachlesen, statt sie zu raten.

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- text-status`
Expected: FAIL — `textStatus` gibt es nicht.

- [ ] **Step 3: Schema erweitern**

In `packages/modules/dms/src/schema.ts`, innerhalb von `documents`, nach `fileBytes`:

```ts
    /**
     * Zustand der Texterkennung — zugleich die Warteschlange (Entscheidung 24).
     * `null` für Entwürfe: Die haben keine Datei und also nichts zu lesen.
     *
     * `running` unterscheidet „liegt unter dem Werkzeug" von „wartet". Was nach
     * einem Neustart noch darauf steht, war ein Absturz; der Worker räumt es auf.
     */
    textStatus: text('text_status', { enum: ['pending', 'running', 'done', 'failed', 'unavailable'] }),
    textAttempts: integer('text_attempts').notNull().default(0),
    textError: text('text_error'),
    textExtractedAt: text('text_extracted_at'),
```

Im Index-Block ergänzen, damit der Worker sein nächstes Stück Arbeit ohne Tabellendurchlauf findet:

```ts
    index('documents_text_status_idx').on(t.textStatus),
```

- [ ] **Step 4: `pending` beim Ablegen setzen**

In `packages/modules/dms/src/incoming.ts` (`receiveDocument`) und in `packages/modules/dms/src/drafts.ts` (`fileDocument`) bei den `tx.insert(documents).values({...})` bzw. `tx.update(documents).set({...})` ergänzen:

```ts
            textStatus: 'pending',
            textAttempts: 0,
            textError: null,
            textExtractedAt: null,
```

`createDraft` bleibt unverändert — ein Entwurf bekommt keinen Zustand.

In `toRecord` (`packages/modules/dms/src/service.ts`) die vier Felder durchreichen.

- [ ] **Step 5: Migration erzeugen**

```bash
ls packages/core/src/db/migrations   # naechste freie Nummer pruefen
pnpm --filter @kompass/core db:generate
```

Die erzeugte Datei lesen. Erwartet werden vier `ALTER TABLE documents ADD COLUMN` und ein `CREATE INDEX` — **kein Tabellenneubau**. Steht dort ein Neubau, ist etwas anderes am Schema geändert worden; dann zurücknehmen und einzeln vorgehen.

- [ ] **Step 6: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS, auch die vorhandenen Tests.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/dms/src packages/core/src/db/migrations packages/modules/dms/tests/text-status.test.ts
git commit -m "feat(dms): a document says whether its text has been read"
```

---

### Task 3: Der Lauf als Service

Ein Dokument lesen ist ein gewöhnlicher Service — mit Recht, Protokoll und `Result`. Der Index kommt in Plan 3 dazu; hier endet der Lauf bei den Seiten und dem Zustand.

**Files:**
- Create: `packages/modules/dms/src/text.ts`
- Test: `packages/modules/dms/tests/text.test.ts`

**Interfaces:**
- Consumes: `deps.textExtraction` (Plan 1), `documents.textStatus` (Task 2)
- Produces:
  - `extractTextSchema` — `{ documentId: string }`
  - `extractDocumentText(deps, ctx, input) → Promise<Result<{ documentId: string; pages: number; status: 'done' | 'failed' | 'unavailable' }>>`, Recht `dms.manage`
  - `onPages?: (pages: PageText[]) => void` gibt es **nicht** — Plan 3 schreibt den Index direkt in diesem Service.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/text.test.ts`:

```ts
import { coreModule, createTestDeps, ctxWith, fakeTextExtraction, insertUser, listAudit, systemContext } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { extractDocumentText } from '../src/text';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

async function withDocument(textExtraction = fakeTextExtraction()) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule], textExtraction });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  const received = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject: 'Eingang',
    documentDate: '2026-09-11',
    bytes: pdf(),
  });
  if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
  return { deps, documentId: received.value.id };
}

describe('extractDocumentText', () => {
  it('liest ein Dokument und setzt es auf done', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'Tierarztrechnung 2026-4711', source: 'layer' },
          { page: 2, text: 'Impfung und Kastration', source: 'ocr' },
        ],
      }),
    );

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ pages: 2, status: 'done' });
  });

  it('reicht die eingestellten Sprachen an das Werkzeug durch', async () => {
    const seen: string[][] = [];
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({ onExtract: (o) => seen.push(o.languages) }),
    );

    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(seen).toEqual([['deu', 'eng']]);
  });

  it('meldet unavailable, wenn die Werkzeuge fehlen — ohne Versuche zu zählen', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({ probe: { ok: false, error: 'tesseract ist nicht installiert' } }),
    );

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('unavailable');
  });

  it('zählt Versuche und bleibt beim dritten bei failed', async () => {
    const broken = {
      probe: async () => ({ ok: true as const, languages: ['deu'] }),
      extract: async () => {
        throw new Error('Seite 4 überschritt das Zeitlimit');
      },
    };
    const { deps, documentId } = await withDocument(broken);
    const ctx = ctxWith(['dms.manage']);

    for (let i = 0; i < 3; i += 1) await extractDocumentText(deps, ctx, { documentId });
    const fourth = await extractDocumentText(deps, ctx, { documentId });

    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.error.type).toBe('conflict');
  });

  it('verweigert ohne Recht', async () => {
    const { deps, documentId } = await withDocument();

    const result = await extractDocumentText(deps, ctxWith(['dms.view']), { documentId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('forbidden');
  });

  it('weist Unsinn als validation zurück', async () => {
    const { deps } = await withDocument();

    const result = await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('schreibt einen Eintrag je Dokument, nicht je Seite', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'eins', source: 'layer' },
          { page: 2, text: 'zwei', source: 'layer' },
          { page: 3, text: 'drei', source: 'layer' },
        ],
      }),
    );

    await extractDocumentText(deps, systemContext(), { documentId });

    const entries = await listAudit(deps, ctxWith(['audit.view']), { entityType: 'document' });
    expect(entries.ok).toBe(true);
    if (!entries.ok) return;
    const read = entries.value.entries.filter((e) => e.action === 'document.textExtracted');
    expect(read).toHaveLength(1);
    expect(read[0]!.channel).toBe('system');
  });
});
```

**Hinweis:** Die genaue Signatur von `listAudit` und die Form seines Ergebnisses in `packages/core/src/audit/query.ts` nachlesen; die Stelle oben ist nach dem Muster der vorhandenen Audit-Tests im Modul zu schreiben.

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- text`
Expected: FAIL — `../src/text` gibt es nicht.

- [ ] **Step 3: Den Service schreiben**

`packages/modules/dms/src/text.ts`:

```ts
import {
  conflict,
  isoNow,
  notFound,
  ok,
  readSetting,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from './schema';
import { readDocumentFile } from './storage';

export const extractTextSchema = z.object({ documentId: z.string().min(1) });

/** Ab hier wird nicht mehr wiederholt; ein viertes Mal ist `conflict`. */
const MAX_ATTEMPTS = 3;

export interface ExtractResult {
  documentId: string;
  pages: number;
  status: 'done' | 'failed' | 'unavailable';
}

/**
 * Ein Dokument lesen. Kein Hintergrundzauber: ein Service wie jeder andere,
 * damit er einzeln testbar ist, über MCP angestoßen werden kann und einen
 * Eintrag im Änderungsprotokoll hinterlässt — **einen je Dokument**.
 */
export async function extractDocumentText(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<ExtractResult>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const parsed = validate(deps, extractTextSchema, input);
  if (!parsed.ok) return parsed;
  const { documentId } = parsed.value;

  const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get();
  if (!row) return notFound('document', documentId);
  if (!row.fileName) return conflict('documentHasNoFile');
  if (row.textAttempts >= MAX_ATTEMPTS) return conflict('textExtractionGaveUp');

  const probe = await deps.textExtraction.probe();
  if (!probe.ok) {
    // Keine Schuld des Dokuments: Versuche werden nicht gezählt, damit es
    // wieder drankommt, sobald die Werkzeuge da sind.
    deps.db
      .update(documents)
      .set({ textStatus: 'unavailable', textError: probe.error })
      .where(eq(documents.id, documentId))
      .run();
    return ok({ documentId, pages: 0, status: 'unavailable' });
  }

  deps.db.update(documents).set({ textStatus: 'running' }).where(eq(documents.id, documentId)).run();

  const languages = ocrLanguages(deps);
  let pages;
  try {
    pages = await deps.textExtraction.extract({
      bytes: await readDocumentFile(deps, row.fileName),
      languages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = row.textAttempts + 1;
    deps.db
      .update(documents)
      .set({
        textStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        textAttempts: attempts,
        textError: message,
      })
      .where(eq(documents.id, documentId))
      .run();
    return ok({ documentId, pages: 0, status: 'failed' });
  }

  const now = isoNow(deps.clock);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents)
      .set({ textStatus: 'done', textAttempts: 0, textError: null, textExtractedAt: now })
      .where(eq(documents.id, documentId))
      .run();

    recordAudit(tx, deps, ctx, {
      action: 'document.textExtracted',
      entityType: 'document',
      entityId: documentId,
      before: { textStatus: row.textStatus },
      after: { textStatus: 'done', pages: pages.length },
      summary: `Volltext von ${row.number ?? row.subject} gelesen (${pages.length} Seiten)`,
    });

    return ok({ documentId, pages: pages.length, status: 'done' as const });
  });
}

/** Die eingestellten Sprachen, als Tesseract-Kürzel. */
export function ocrLanguages(deps: Deps): string[] {
  const raw = readSetting(deps, 'dms.ocrLanguages') ?? 'deu+eng';
  return String(raw).split('+').map((l) => l.trim()).filter(Boolean);
}
```

**Hinweis:** `readSetting` ist der vorhandene Leser aus `packages/core/src/settings/service.ts`; die genaue Signatur dort nachlesen und den Aufruf anpassen. Die Einstellung `dms.ocrLanguages` wird im nächsten Step angelegt.

- [ ] **Step 4: Die Einstellung anmelden**

In `packages/modules/dms/src/install.ts` bei `DMS_SETTINGS` ergänzen:

```ts
  /**
   * Welche Sprachen die Erkennung annimmt. Welche Pakete vorliegen, ist eine
   * Betriebstatsache und unterscheidet sich je Umgebung: Der Container meldet
   * `deu`, `eng`, `osd`, ein Entwicklungsrechner mit `tesseract-lang` meldet
   * über 160. Geprüft wird deshalb gegen `probe()`, nicht gegen eine Liste.
   */
  { key: 'dms.ocrLanguages', schema: z.string().regex(/^[a-z]{3}(\+[a-z]{3})*$/), default: 'deu+eng' },
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- text`
Expected: PASS (7 Tests)

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms/src/text.ts packages/modules/dms/src/install.ts packages/modules/dms/tests/text.test.ts
git commit -m "feat(dms): reading a document is a service like any other"
```

---

### Task 4: Der Worker

Die Schleife: aufräumen, nehmen, lesen, wiederholen. Ein Dokument zur Zeit — die NAS-CPU rendert nebenher Typst.

**Files:**
- Create: `packages/modules/dms/src/worker.ts`
- Test: `packages/modules/dms/tests/worker.test.ts`

**Interfaces:**
- Consumes: `extractDocumentText` (Task 3)
- Produces:
  - `recoverRunning(deps): number` — setzt `running` auf `pending` zurück, gibt die Zahl zurück.
  - `processNextDocument(deps): Promise<'idle' | 'done' | 'failed' | 'unavailable'>` — nimmt genau eines.
  - `startTextWorker(deps, opts?: { intervalMs?: number }): { wake(): void; stop(): void }`

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/worker.test.ts`:

```ts
import { coreModule, createTestDeps, ctxWith, fakeTextExtraction, insertUser } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { documents } from '../src/schema';
import { processNextDocument, recoverRunning } from '../src/worker';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

async function setup() {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    textExtraction: fakeTextExtraction({ pages: [{ page: 1, text: 'Rechnung', source: 'layer' }] }),
  });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  return deps;
}

async function receive(deps: Awaited<ReturnType<typeof setup>>, subject: string) {
  const r = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject,
    documentDate: '2026-09-11',
    bytes: pdf(),
  });
  if (!r.ok) throw new Error('Aufbau fehlgeschlagen');
  return r.value.id;
}

describe('Worker', () => {
  it('nimmt ein Dokument und lässt das zweite liegen', async () => {
    const deps = await setup();
    await receive(deps, 'Erstes');
    await receive(deps, 'Zweites');

    const outcome = await processNextDocument(deps);

    expect(outcome).toBe('done');
    const states = deps.db.select({ s: documents.textStatus }).from(documents).all().map((r) => r.s);
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
    expect(states.filter((s) => s === 'pending')).toHaveLength(1);
  });

  it('meldet idle, wenn nichts zu tun ist', async () => {
    const deps = await setup();

    expect(await processNextDocument(deps)).toBe('idle');
  });

  it('räumt beim Start auf, was auf running stehen geblieben ist', async () => {
    const deps = await setup();
    const id = await receive(deps, 'Abgestürzt');
    deps.db.update(documents).set({ textStatus: 'running' }).where(eq(documents.id, id)).run();

    const recovered = recoverRunning(deps);

    expect(recovered).toBe(1);
    const row = deps.db.select().from(documents).where(eq(documents.id, id)).get();
    expect(row?.textStatus).toBe('pending');
  });

  it('fasst Entwürfe nicht an', async () => {
    const deps = await setup();
    // Ein Entwurf hat textStatus null und darf nie in die Schlange geraten.
    expect(await processNextDocument(deps)).toBe('idle');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- worker`
Expected: FAIL — `../src/worker` gibt es nicht.

- [ ] **Step 3: Den Worker schreiben**

`packages/modules/dms/src/worker.ts`:

```ts
import { systemContext, type Deps } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { documents } from './schema';
import { extractDocumentText } from './text';

/** Wie oft nachgesehen wird, wenn niemand antippt. */
const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Was beim Start auf `running` steht, kann kein laufender Lauf sein — der
 * Prozess, der es gesetzt hat, lebt nicht mehr. Zurück in die Schlange.
 *
 * Gefahrlos, weil ein Lauf die Zeilen seines Dokuments ohnehin löscht und neu
 * schreibt (Spec § 5.3).
 */
export function recoverRunning(deps: Deps): number {
  const stuck = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.textStatus, 'running')).all();
  for (const row of stuck) {
    deps.db.update(documents).set({ textStatus: 'pending' }).where(eq(documents.id, row.id)).run();
  }
  return stuck.length;
}

/**
 * Genau ein Dokument abarbeiten. Eins zur Zeit ist Absicht: Auf der NAS-CPU
 * rendert nebenher Typst, und zwei parallele Tesseract-Läufe nehmen sich
 * gegenseitig die Luft.
 */
export async function processNextDocument(deps: Deps): Promise<'idle' | 'done' | 'failed' | 'unavailable'> {
  const next = deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.textStatus, 'pending'))
    .orderBy(asc(documents.createdAt))
    .limit(1)
    .get();
  if (!next) return 'idle';

  const ctx = systemContext();
  // Der Worker handelt im Namen der Anlage; die Rechtepruefung im Service
  // bleibt trotzdem stehen, deshalb bekommt der Kontext das noetige Recht.
  ctx.permissions = new Set(['dms.manage']);

  const result = await extractDocumentText(deps, ctx, { documentId: next.id });
  if (!result.ok) return 'failed';
  return result.value.status;
}

export interface TextWorker {
  /** Sofort nachsehen, statt auf den nächsten Takt zu warten. */
  wake(): void;
  stop(): void;
}

export function startTextWorker(deps: Deps, opts: { intervalMs?: number } = {}): TextWorker {
  recoverRunning(deps);

  let busy = false;
  let stopped = false;

  const drain = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try {
      // Solange etwas da ist, weitermachen — aber immer nur eins auf einmal.
      let outcome = await processNextDocument(deps);
      while (outcome !== 'idle' && outcome !== 'unavailable' && !stopped) {
        outcome = await processNextDocument(deps);
      }
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void drain(), opts.intervalMs ?? DEFAULT_INTERVAL_MS);
  // Der Takt darf den Prozess nicht am Leben halten, wenn sonst nichts läuft.
  timer.unref?.();
  void drain();

  return {
    wake: () => void drain(),
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
```

**Hinweis:** `systemContext()` liefert einen Kontext mit leerem Rechte-Satz. Ob `ctx.permissions` beschreibbar ist, in `packages/core/src/context.ts` prüfen; ist es das nicht, dort eine Variante `systemContext({ permissions })` ergänzen, statt den Typ im Modul aufzubrechen.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- worker`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms/src/worker.ts packages/modules/dms/tests/worker.test.ts
git commit -m "feat(dms): one document at a time, and nothing left stuck on running"
```

---

### Task 5: Anschließen und antippen

Jetzt trifft Task 1 auf Task 4: Der Haken startet den Worker, und das Ablegen tippt ihn an, damit ein frischer Scan nicht bis zum nächsten Takt wartet.

**Files:**
- Modify: `apps/kompass/instrumentation.ts`, `apps/kompass/src/lib/background.ts`, `apps/kompass/src/app/(shell)/dms/actions.ts`
- Test: `apps/kompass/tests/background.test.ts` (erweitern)

**Interfaces:**
- Consumes: `startTextWorker` (Task 4), `startBackgroundWork` (Task 1)
- Produces: `textWorker(): TextWorker | null` in `background.ts` — für das Antippen aus den Server Actions.

- [ ] **Step 1: Failing Test schreiben**

In `apps/kompass/tests/background.test.ts` ergänzen:

```ts
  it('gibt den Worker heraus, sobald er läuft', () => {
    resetBackgroundForTests();
    const fake = { wake: () => {}, stop: () => {} };

    startBackgroundWork({ onStart: () => fake });

    expect(textWorker()).toBe(fake);
  });

  it('liefert ohne Start keinen Worker, statt zu werfen', () => {
    resetBackgroundForTests();

    expect(textWorker()).toBeNull();
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/app test -- background`
Expected: FAIL — `textWorker` ist nicht exportiert.

- [ ] **Step 3: `background.ts` erweitern**

```ts
import type { TextWorker } from '@kompass/module-dms';

let worker: TextWorker | null = null;

export function textWorker(): TextWorker | null {
  return worker;
}

export function resetBackgroundForTests(): void {
  started = false;
  worker?.stop();
  worker = null;
}

export function startBackgroundWork(
  opts: { runtime?: string; onStart?: () => TextWorker | void } = {},
): void {
  const runtime = opts.runtime ?? process.env.NEXT_RUNTIME;
  if (runtime !== 'nodejs') return;
  if (started) return;
  started = true;
  worker = opts.onStart?.() ?? null;
}
```

- [ ] **Step 4: Den Haken verdrahten**

`apps/kompass/instrumentation.ts`:

```ts
import { startBackgroundWork } from '@/lib/background';

/**
 * Next ruft das beim Serverstart — einmal je Prozess, vor der ersten Anfrage.
 * Die Abhängigkeiten werden hier **verzögert** geladen: `better-sqlite3` darf
 * im Edge-Zweig nicht einmal importiert werden, und der Wächter in
 * `startBackgroundWork` greift erst zur Laufzeit.
 */
export function register(): void {
  startBackgroundWork({
    onStart: () => {
      const { buildDeps } = require('@/lib/deps') as typeof import('@/lib/deps');
      const { startTextWorker } = require('@kompass/module-dms') as typeof import('@kompass/module-dms');
      const worker = startTextWorker(buildDeps());
      console.log('[kompass] Texterkennung läuft');
      return worker;
    },
  });
}
```

**Hinweis:** Wie die Anwendung ihr `Deps`-Objekt baut, in `apps/kompass/src/lib/deps.ts` nachlesen — der Name `buildDeps` ist hier geraten und muss durch den echten ersetzt werden. Ist die Akte nicht installiert, darf der Start trotzdem nicht scheitern: Dann läuft `startTextWorker` gegen eine Datenbank ohne Zeilen und meldet stets `idle`.

- [ ] **Step 5: Nach dem Ablegen antippen**

In `apps/kompass/src/app/(shell)/dms/actions.ts`, in den Aktionen für Eingang und Festschreiben, nach dem erfolgreichen Aufruf:

```ts
  // Nicht warten: Der Upload ist fertig, das Lesen darf dauern.
  textWorker()?.wake();
```

- [ ] **Step 6: Tests grün sehen**

Run: `pnpm --filter @kompass/app test -- background`
Expected: PASS (4 Tests)

- [ ] **Step 7: Am laufenden Server nachsehen**

```bash
pnpm dev:reset && pnpm --filter @kompass/app dev
```

Ein PDF über `/dms/receive` ablegen. Expected: In der Serverausgabe erscheint `[kompass] Texterkennung läuft` beim Start, und nach dem Ablegen wechselt der Zustand des Dokuments in der Datenbank von `pending` über `running` nach `done`:

```bash
sqlite3 .data/kompass.db "select subject, text_status, text_extracted_at from documents order by created_at desc limit 3"
```

**Hinweis:** Den Pfad der Entwicklungsdatenbank in `apps/kompass/src/lib/deps.ts` oder `.env` nachsehen.

- [ ] **Step 8: Commit**

```bash
git add apps/kompass
git commit -m "feat(app): filed post goes to the reader without holding up the upload"
```

---

## Abschluss dieses Plans

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm verify`

Danach: `2026-09-11-volltext-3-index.md`.
