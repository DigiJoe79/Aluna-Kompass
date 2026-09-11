# Volltext 3 — Index, Suche und MCP (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der gelesene Text wird durchsuchbar — über dasselbe Filterfeld, das die Akte schon hat, mit Fundstelle und Seitenzahl.

**Architecture:** Eine FTS5-Virtualtabelle mit einer Zeile je Seite, Trigramm-Tokenizer wegen der deutschen Komposita. Die Suche ist **keine neue Abfrage**, sondern eine Bedingung mehr in `listDocuments`: `documents.id IN (SELECT … MATCH ?)`. Damit bleiben `limit`, `offset` und `total` unangetastet und die Liste chronologisch (Entscheidung 31). Die Passagen kommen in einem zweiten, kleinen Zugriff — nur für die sichtbare Seite.

**Tech Stack:** SQLite FTS5 (trigram), better-sqlite3, Drizzle, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-volltext-und-texterkennung-design.md` (§ 5.2, § 5.3, § 8 Suche, § 9 MCP)

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → … → `ok`.
- **Kein Test vergleicht erkannten Text auf Gleichheit** (Spec § 11).
- Rohes SQL nur über `deps.sqlite`, und nur dort, wo Drizzle nicht reicht (`MATCH`, `snippet()`, `bm25()`) — gekapselt im Service, nie in der Oberfläche.
- **Jeder Wert, der in eine Abfrage geht, ist ein gebundener Parameter.** Kein String-Zusammenbau mit Nutzereingaben, auch nicht im FTS-Ausdruck.
- Suchbegriffe unter drei Zeichen finden im Volltext nichts — das ist der Preis des Trigramm-Tokenizers und muss als Hinweis heraus, nicht als leere Liste.
- Migrationen: nächste freie Nummer prüfen; virtuelle Tabellen über `drizzle-kit generate --custom`.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** Plan 2 ist abgeschlossen: `extractDocumentText` läuft und setzt `textStatus`.

---

### Task 1: Die Indextabelle

Drizzle kennt keine virtuellen Tabellen. Die Migration entsteht deshalb über `--custom` und wird von Hand gefüllt — eine vom Werkzeug angelegte Datei, kein nachträglich editiertes Erzeugnis.

**Files:**
- Create: `packages/core/src/db/migrations/0021_dms_text.sql` (über `--custom` erzeugt, dann gefüllt)
- Create: `packages/modules/dms/src/index-store.ts`
- Test: `packages/modules/dms/tests/index-store.test.ts`

**Interfaces:**
- Produces:
  - `replaceDocumentText(deps, documentId, pages: { page: number; text: string }[]): void` — löscht die Zeilen des Dokuments und schreibt sie neu.
  - `removeDocumentText(deps, documentId): void`
  - `countDocumentText(deps, documentId): number` — nur für Tests und die Verwaltung.

- [x] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/index-store.test.ts`:

```ts
import { coreModule, createTestDeps } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { countDocumentText, removeDocumentText, replaceDocumentText } from '../src/index-store';
import { dmsModule } from '../src/manifest';

const setup = () => createTestDeps({ manifests: [coreModule, dmsModule] });

describe('Textindex', () => {
  it('schreibt eine Zeile je Seite', () => {
    const deps = setup();

    replaceDocumentText(deps, 'DOC-1', [
      { page: 1, text: 'Tierarztrechnung 2026-4711' },
      { page: 2, text: 'Impfung und Kastration' },
    ]);

    expect(countDocumentText(deps, 'DOC-1')).toBe(2);
  });

  it('ersetzt statt anzuhängen — zweimal lesen ergibt denselben Bestand', () => {
    const deps = setup();
    const pages = [{ page: 1, text: 'Tierarztrechnung' }];

    replaceDocumentText(deps, 'DOC-1', pages);
    replaceDocumentText(deps, 'DOC-1', pages);

    expect(countDocumentText(deps, 'DOC-1')).toBe(1);
  });

  it('räumt die Zeilen eines Dokuments weg, ohne andere anzufassen', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'eins' }]);
    replaceDocumentText(deps, 'DOC-2', [{ page: 1, text: 'zwei' }]);

    removeDocumentText(deps, 'DOC-1');

    expect(countDocumentText(deps, 'DOC-1')).toBe(0);
    expect(countDocumentText(deps, 'DOC-2')).toBe(1);
  });

  it('findet ein Kompositum über seinen zweiten Teil', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'Tierarztrechnung vom 14. Oktober' }]);

    const hit = deps.sqlite
      .prepare(`SELECT document_id FROM document_text WHERE document_text MATCH ?`)
      .get('"rechnung"');

    expect(hit).toMatchObject({ document_id: 'DOC-1' });
  });

  it('faltet Umlaute, damit „katzin“ die „Kätzin“ findet', () => {
    const deps = setup();
    replaceDocumentText(deps, 'DOC-1', [{ page: 1, text: 'Die Kätzin Bärbel' }]);

    const hit = deps.sqlite
      .prepare(`SELECT document_id FROM document_text WHERE document_text MATCH ?`)
      .get('"katzin"');

    expect(hit).toMatchObject({ document_id: 'DOC-1' });
  });
});
```

- [x] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- index-store`
Expected: FAIL — es gibt weder Tabelle noch Modul.

- [x] **Step 3: Die Migration anlegen**

```bash
ls packages/core/src/db/migrations           # naechste freie Nummer pruefen
pnpm --filter @kompass/core exec drizzle-kit generate --custom --name=dms_text
```

Die erzeugte, leere Datei füllen:

```sql
-- Volltextindex der Akte: eine Zeile je Seite.
--
-- Trigramm-Tokenizer, weil deutsche Komposita sonst unauffindbar bleiben —
-- "rechnung" findet "Tierarztrechnung" nur so. `remove_diacritics 1` faltet
-- Umlaute, damit "katzin" die "Kaetzin" trifft. Der Preis: Suchbegriffe unter
-- drei Zeichen finden nichts, und der Index wiegt rund das Dreifache des Texts.
--
-- Der Text liegt IN der Tabelle, nicht bloss sein Index: `snippet()` braucht
-- ihn, um die Fundstelle zu bauen.
--
-- Abgeleitet im Sinne von Prinzip 5: jederzeit aus den PDFs neu baubar, nie
-- Quelle von irgendetwas.
CREATE VIRTUAL TABLE `document_text` USING fts5(
  document_id UNINDEXED,
  page UNINDEXED,
  text,
  tokenize = 'trigram remove_diacritics 1'
);
```

- [x] **Step 4: Den Zugriff schreiben**

`packages/modules/dms/src/index-store.ts`:

```ts
import type { Deps } from '@kompass/core';

/**
 * Der Volltextindex. Drizzle bildet FTS5 nicht ab — weder die virtuelle Tabelle
 * noch `MATCH`, `snippet()` oder `bm25()`. Gelesen und geschrieben wird deshalb
 * über `deps.sqlite`, aber ausschließlich hier: Der Rest des Moduls sieht
 * Funktionen, kein SQL.
 */

/** Seiten eines Dokuments ersetzen. Zweimal aufgerufen ergibt denselben Bestand. */
export function replaceDocumentText(
  deps: Deps,
  documentId: string,
  pages: readonly { page: number; text: string }[],
): void {
  const remove = deps.sqlite.prepare(`DELETE FROM document_text WHERE document_id = ?`);
  const insert = deps.sqlite.prepare(
    `INSERT INTO document_text (document_id, page, text) VALUES (?, ?, ?)`,
  );

  const write = deps.sqlite.transaction((rows: readonly { page: number; text: string }[]) => {
    remove.run(documentId);
    for (const row of rows) insert.run(documentId, row.page, row.text);
  });

  write(pages);
}

export function removeDocumentText(deps: Deps, documentId: string): void {
  deps.sqlite.prepare(`DELETE FROM document_text WHERE document_id = ?`).run(documentId);
}

export function countDocumentText(deps: Deps, documentId: string): number {
  const row = deps.sqlite
    .prepare(`SELECT count(*) AS n FROM document_text WHERE document_id = ?`)
    .get(documentId) as { n: number } | undefined;
  return row?.n ?? 0;
}
```

- [x] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- index-store`
Expected: PASS (5 Tests)

- [x] **Step 6: Commit**

```bash
git add packages/core/src/db/migrations packages/modules/dms/src/index-store.ts packages/modules/dms/tests/index-store.test.ts
git commit -m "feat(dms): an index that finds the second half of a german compound"
```

---

### Task 2: Der Lauf füllt den Index

Jetzt trifft Plan 2 auf Task 1: Was `extractDocumentText` liest, landet im Index. Und was gelöscht wird, verschwindet daraus.

**Files:**
- Modify: `packages/modules/dms/src/text.ts`, `packages/modules/dms/src/service.ts` (Löschen), `packages/modules/dms/src/drafts.ts` (Löschen)
- Test: `packages/modules/dms/tests/text.test.ts` (erweitern)

**Interfaces:**
- Consumes: `replaceDocumentText`, `removeDocumentText`, `countDocumentText` (Task 1)

- [x] **Step 1: Failing Test schreiben**

In `packages/modules/dms/tests/text.test.ts` ergänzen:

```ts
  it('legt die gelesenen Seiten in den Index', async () => {
    const { deps, documentId } = await withDocument(
      fakeTextExtraction({
        pages: [
          { page: 1, text: 'Tierarztrechnung 2026-4711', source: 'layer' },
          { page: 2, text: 'Impfung und Kastration', source: 'ocr' },
        ],
      }),
    );

    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    expect(countDocumentText(deps, documentId)).toBe(2);
  });

  it('ein zweiter Lauf verdoppelt nichts', async () => {
    const { deps, documentId } = await withDocument();
    const ctx = ctxWith(['dms.manage']);

    await extractDocumentText(deps, ctx, { documentId });
    // Nach dem ersten Lauf steht `done`; fuer den zweiten wieder freigeben.
    deps.db.update(documents).set({ textStatus: 'pending' }).where(eq(documents.id, documentId)).run();
    await extractDocumentText(deps, ctx, { documentId });

    expect(countDocumentText(deps, documentId)).toBe(1);
  });

  it('ein gelöschtes Dokument verschwindet aus dem Index', async () => {
    const { deps, documentId } = await withDocument();
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    await deleteDocument(deps, ctxWith(['dms.deleteDraft']), { id: documentId, reason: 'Test' });

    expect(countDocumentText(deps, documentId)).toBe(0);
  });
```

**Hinweis:** Wie die Löschung in diesem Modul heißt und welche Rechte sie verlangt, in `packages/modules/dms/src/service.ts` und `drafts.ts` nachlesen (`DELETION_POLICY` führt `documentDraft` und `document`). Den Test auf die echte Signatur setzen, nicht umgekehrt.

- [x] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- text`
Expected: FAIL — der Index bleibt leer.

- [x] **Step 3: Den Index füllen**

In `packages/modules/dms/src/text.ts`, im Erfolgszweig **vor** der Transaktion (die virtuelle Tabelle wird über `deps.sqlite` geschrieben, nicht über die Drizzle-Transaktion):

```ts
  // Erst der Index, dann der Zustand: Bricht das Schreiben ab, bleibt das
  // Dokument auf `running` und wird beim naechsten Start neu genommen. Andersrum
  // stuende `done` an einem Dokument, das nicht auffindbar ist.
  replaceDocumentText(
    deps,
    documentId,
    pages.map((p) => ({ page: p.page, text: p.text })),
  );
```

- [x] **Step 4: Beim Löschen aufräumen**

In jeder Löschfunktion des Moduls nach dem erfolgreichen Löschen der Zeile:

```ts
  removeDocumentText(deps, id);
```

**Storno nicht anfassen:** Ein storniertes Dokument behält seine Zeilen und bleibt auffindbar (Spec § 5.3).

- [x] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): what was read becomes findable, what was deleted stops being"
```

---

### Task 3: Die Suche

Eine Bedingung mehr, kein zweiter Bauplan. Und der Hinweis für zu kurze Eingaben, damit niemand eine leere Liste für „nichts gefunden“ hält.

**Files:**
- Modify: `packages/modules/dms/src/service.ts` (`documentListSchema`, `listDocuments`)
- Create: `packages/modules/dms/src/search.ts`
- Test: `packages/modules/dms/tests/search.test.ts`

**Interfaces:**
- Consumes: `document_text` (Task 1)
- Produces:
  - `MIN_FULLTEXT_CHARS = 3`
  - `matchExpression(text: string): string | null` — baut den FTS-Ausdruck; `null`, wenn jeder Begriff zu kurz ist.
  - `fulltextDocumentIds(deps, text: string): string[] | null`
  - `listDocuments` liefert zusätzlich `fulltextTooShort: boolean`.

- [x] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/search.test.ts`:

```ts
import { coreModule, createTestDeps, ctxWith, fakeTextExtraction, insertUser } from '@kompass/core';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { dmsModule } from '../src/manifest';
import { matchExpression } from '../src/search';
import { listDocuments } from '../src/service';
import { extractDocumentText } from '../src/text';
import { seedTypes } from './helpers';

const pdf = () => new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));

async function withRead(text: string, subject = 'Ohne sprechenden Betreff') {
  const deps = createTestDeps({
    manifests: [coreModule, contactsModule, dmsModule],
    textExtraction: fakeTextExtraction({ pages: [{ page: 1, text, source: 'layer' }] }),
  });
  insertUser(deps, { id: 'USER-TEST' });
  await seedTypes(deps);
  const received = await receiveDocument(deps, ctxWith(['dms.create']), {
    filename: 'post.pdf',
    typeKey: 'letter',
    subject,
    documentDate: '2026-09-11',
    bytes: pdf(),
  });
  if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
  await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: received.value.id });
  return { deps, documentId: received.value.id };
}

describe('Suche', () => {
  it('findet ein Wort, das nur im Volltext steht', async () => {
    const { deps, documentId } = await withRead('Tierarztrechnung für die Kätzin Bärbel');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.map((d) => d.id)).toEqual([documentId]);
  });

  it('findet weiterhin über den Betreff', async () => {
    const { deps, documentId } = await withRead('Irgendein Inhalt', 'Kündigung Mietvertrag');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'Mietvertrag' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.documents.map((d) => d.id)).toEqual([documentId]);
  });

  it('zählt Volltexttreffer in total mit', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung', limit: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
  });

  it('sagt es, wenn der Begriff zu kurz für den Volltext ist', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'ab' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fulltextTooShort).toBe(true);
    expect(result.value.documents).toEqual([]);
  });

  it('behandelt Anführungszeichen in der Eingabe als Text, nicht als Syntax', async () => {
    const { deps } = await withRead('Tierarztrechnung');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rech"nung' });

    // Darf nicht werfen und nicht die halbe Tabelle liefern.
    expect(result.ok).toBe(true);
  });
});

describe('matchExpression', () => {
  it('macht aus zwei Wörtern eine UND-Verknüpfung von Phrasen', () => {
    expect(matchExpression('praxis sommer')).toBe('"praxis" AND "sommer"');
  });

  it('wirft zu kurze Bestandteile weg', () => {
    expect(matchExpression('dr sommer')).toBe('"sommer"');
  });

  it('gibt null, wenn nichts übrig bleibt', () => {
    expect(matchExpression('dr. x')).toBeNull();
  });

  it('entschärft Anführungszeichen', () => {
    expect(matchExpression('rech"nung')).toBe('"rech""nung"');
  });
});
```

- [x] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- search`
Expected: FAIL — `../src/search` gibt es nicht.

- [x] **Step 3: Den Suchausdruck schreiben**

`packages/modules/dms/src/search.ts`:

```ts
import type { Deps } from '@kompass/core';

/**
 * Kürzer als drei Zeichen findet der Trigramm-Tokenizer nichts — er zerlegt in
 * Dreiergruppen, und für „ab“ gibt es keine. Das ist keine Panne, sondern der
 * Preis dafür, dass „rechnung“ die „Tierarztrechnung“ findet.
 */
export const MIN_FULLTEXT_CHARS = 3;

/**
 * Aus einer Eingabe wird ein FTS5-Ausdruck: jedes Wort eine Phrase, verbunden
 * mit UND. Phrasen, weil Trigramme sonst als Syntax gelesen würden.
 *
 * Anführungszeichen in der Eingabe werden verdoppelt — das ist FTS5' eigene
 * Entschärfung. Ohne sie könnte eine Eingabe den Ausdruck umschreiben.
 */
export function matchExpression(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}"]/gu, ''))
    .filter((t) => t.replace(/"/g, '').length >= MIN_FULLTEXT_CHARS)
    .map((t) => `"${t.replace(/"/g, '""')}"`);

  return terms.length > 0 ? terms.join(' AND ') : null;
}

/**
 * Die Dokumente, in deren Volltext der Ausdruck trifft. `null` heißt: Die
 * Eingabe war zu kurz — der Aufrufer sagt das, statt eine leere Liste zu zeigen.
 */
export function fulltextDocumentIds(deps: Deps, text: string): string[] | null {
  const expression = matchExpression(text);
  if (!expression) return null;

  const rows = deps.sqlite
    .prepare(`SELECT DISTINCT document_id FROM document_text WHERE document_text MATCH ?`)
    .all(expression) as { document_id: string }[];

  return rows.map((r) => r.document_id);
}
```

- [x] **Step 4: `listDocuments` erweitern**

In `packages/modules/dms/src/service.ts` die Textbedingung ersetzen:

```ts
  let fulltextTooShort = false;
  if (q.text) {
    const ids = fulltextDocumentIds(deps, q.text);
    fulltextTooShort = ids === null;
    const byText = or(like(documents.subject, `%${q.text}%`), like(documents.number, `%${q.text}%`));
    // Der Volltext erweitert die Treffermenge, nicht die Reihenfolge
    // (Entscheidung 31): Die Liste bleibt chronologisch, `total`, `limit` und
    // `offset` bleiben, wie sie waren.
    conditions.push(
      (ids && ids.length > 0 ? or(byText, inArray(documents.id, ids)) : byText) as SQL,
    );
  }
```

Und im Rückgabewert:

```ts
  return ok({ documents: rows.map((row) => toRecord(deps, row)), total, fulltextTooShort });
```

- [x] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- search`
Expected: PASS (9 Tests)

- [x] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): the filter field reads what the documents say"
```

---

### Task 4: Die Fundstelle

Ohne Passage ist ein Volltexttreffer eine Behauptung. `snippet()` liefert sie, `bm25()` entscheidet, welche Seite gezeigt wird.

**Files:**
- Modify: `packages/modules/dms/src/search.ts`, `packages/modules/dms/src/service.ts`
- Test: `packages/modules/dms/tests/search.test.ts` (erweitern)

**Interfaces:**
- Produces:
  - `SNIPPET_TOKENS = 64`, `SNIPPET_MARK_START`, `SNIPPET_MARK_END` — zwei Steuerzeichen (U+0001 und U+0002), **kein Markup**.
  - `interface TextHit { documentId: string; page: number; snippet: string }`
  - `fulltextHits(deps, documentIds: readonly string[], text: string): Map<string, TextHit>` — je Dokument die beste Seite.
  - `listDocuments` liefert `hits: Record<string, TextHit>` für die **sichtbare** Seite.

- [x] **Step 1: Failing Test schreiben**

In `packages/modules/dms/tests/search.test.ts` ergänzen:

```ts
  it('liefert Passage und Seitenzahl zum Treffer', async () => {
    const { deps, documentId } = await withRead('Tierarztrechnung vom 14. Oktober 2026 für die Kätzin Bärbel');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.value.hits[documentId];
    expect(hit?.page).toBe(1);
    expect(hit?.snippet).toContain('Oktober');
    // Die Markierung ist da, und zwar als Steuerzeichen — nicht als Markup.
    expect(hit?.snippet).toContain(SNIPPET_MARK_START);
    expect(hit?.snippet).not.toContain('<');
  });

  it('nennt die Seite, auf der es steht — nicht immer die erste', async () => {
    const deps = createTestDeps({
      manifests: [coreModule, contactsModule, dmsModule],
      textExtraction: fakeTextExtraction({
        pages: [
          { page: 1, text: 'Deckblatt ohne den gesuchten Begriff, nur Anschrift und Betreffzeile.', source: 'layer' },
          { page: 2, text: 'Hier steht die Tierarztrechnung mit allen Positionen.', source: 'ocr' },
        ],
      }),
    });
    insertUser(deps, { id: 'USER-TEST' });
    await seedTypes(deps);
    const received = await receiveDocument(deps, ctxWith(['dms.create']), {
      filename: 'post.pdf',
      typeKey: 'letter',
      subject: 'Ohne sprechenden Betreff',
      documentDate: '2026-09-11',
      bytes: pdf(),
    });
    if (!received.ok) throw new Error('Aufbau fehlgeschlagen');
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId: received.value.id });

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'rechnung' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hits[received.value.id]?.page).toBe(2);
  });

  it('hat keine Passage, wenn der Treffer aus dem Betreff kam', async () => {
    const { deps, documentId } = await withRead('Irgendein Inhalt', 'Kündigung Mietvertrag');

    const result = await listDocuments(deps, ctxWith(['dms.view']), { text: 'Mietvertrag' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hits[documentId]).toBeUndefined();
  });
```

Den Import in der Testdatei ergänzen: `import { matchExpression, SNIPPET_MARK_START } from '../src/search';`

- [x] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- search`
Expected: FAIL — `hits` gibt es nicht.

- [x] **Step 3: Die Passagen holen**

In `packages/modules/dms/src/search.ts` ergänzen:

```ts
/**
 * Wie groß das Fenster um den Treffer ist. `snippet()` zählt Token, und Token
 * sind hier Trigramme: Mit einem kleinen Wert liefert es einen Wortfetzen statt
 * eines Satzes. 64 ergibt rund eine Zeile Kontext.
 */
export const SNIPPET_TOKENS = 64;

/**
 * Die Markierung ist bewusst kein `<mark>`: Was hier herauskommt, stammt aus
 * einem PDF, das jemand von außen geschickt hat. Steuerzeichen kann die
 * Oberfläche sicher zerlegen; Markup müsste sie erst wieder entschärfen.
 */
export const SNIPPET_MARK_START = '';
export const SNIPPET_MARK_END = '';

export interface TextHit {
  documentId: string;
  page: number;
  snippet: string;
}

/**
 * Je Dokument die beste Seite. `bm25()` zählt bei Trigrammen
 * Trigramm-Übereinstimmungen — „die Seite, auf der am meisten passt“. Für die
 * Auswahl einer Passage reicht das; für die Reihenfolge der Liste wird es gar
 * nicht erst herangezogen (Entscheidung 31).
 */
export function fulltextHits(
  deps: Deps,
  documentIds: readonly string[],
  text: string,
): Map<string, TextHit> {
  const expression = matchExpression(text);
  const hits = new Map<string, TextHit>();
  if (!expression || documentIds.length === 0) return hits;

  const placeholders = documentIds.map(() => '?').join(', ');
  const rows = deps.sqlite
    .prepare(
      `SELECT document_id, page,
              snippet(document_text, 2, ?, ?, '…', ?) AS snippet,
              bm25(document_text) AS rank
         FROM document_text
        WHERE document_text MATCH ?
          AND document_id IN (${placeholders})
        ORDER BY rank`,
    )
    .all(SNIPPET_MARK_START, SNIPPET_MARK_END, SNIPPET_TOKENS, expression, ...documentIds) as {
    document_id: string;
    page: number;
    snippet: string;
  }[];

  // `ORDER BY rank` sortiert aufsteigend, und bm25 ist umso kleiner, je besser
  // der Treffer — die erste Zeile je Dokument ist also die beste Seite.
  for (const row of rows) {
    if (!hits.has(row.document_id)) {
      hits.set(row.document_id, { documentId: row.document_id, page: row.page, snippet: row.snippet });
    }
  }
  return hits;
}
```

- [x] **Step 4: An `listDocuments` anhängen**

Nach dem Laden von `rows`, also **nur für die sichtbare Seite**:

```ts
  // Erst blättern, dann Passagen holen: Für fünfzig Zeilen braucht niemand
  // die Fundstellen von fünfhundert.
  const hits = q.text ? fulltextHits(deps, rows.map((r) => r.id), q.text) : new Map<string, TextHit>();

  return ok({
    documents: rows.map((row) => toRecord(deps, row)),
    total,
    fulltextTooShort,
    hits: Object.fromEntries(hits),
  });
```

- [x] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- search`
Expected: PASS (12 Tests)

- [x] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): a hit says where it stands, not just that it exists"
```

---

### Task 5: Alles neu lesen, und ein Werkzeug für den Agenten

Zum Abschluss: der Sammelauftrag für die Verwaltung und `dms_search` über MCP, damit Prinzip 8 gewahrt bleibt.

**Files:**
- Modify: `packages/modules/dms/src/text.ts`, `packages/modules/dms/src/mcp-tools.ts`
- Test: `packages/modules/dms/tests/text.test.ts` (erweitern), `apps/kompass/tests/mcp-tools.test.ts` (läuft mit)

**Interfaces:**
- Produces:
  - `reindexAllDocuments(deps, ctx) → Promise<Result<{ queued: number }>>`, Recht `dms.manage`
  - MCP-Werkzeuge `dms_search` und `dms_reindex`

- [x] **Step 1: Failing Test schreiben**

In `packages/modules/dms/tests/text.test.ts` ergänzen:

```ts
  it('stellt alle Dokumente mit Datei wieder in die Schlange', async () => {
    const { deps, documentId } = await withDocument();
    await extractDocumentText(deps, ctxWith(['dms.manage']), { documentId });

    const result = await reindexAllDocuments(deps, ctxWith(['dms.manage']));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queued).toBe(1);
    const row = deps.db.select().from(documents).where(eq(documents.id, documentId)).get();
    expect(row?.textStatus).toBe('pending');
    expect(row?.textAttempts).toBe(0);
  });

  it('verweigert das Neu-Lesen ohne dms.manage', async () => {
    const { deps } = await withDocument();

    const result = await reindexAllDocuments(deps, ctxWith(['dms.view']));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('forbidden');
  });
```

- [x] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- text`
Expected: FAIL — `reindexAllDocuments` gibt es nicht.

- [x] **Step 3: Den Sammelauftrag schreiben**

In `packages/modules/dms/src/text.ts`:

```ts
/**
 * Alles noch einmal lesen. Setzt nur den Zustand zurück — gelesen wird vom
 * Worker, eins nach dem anderen. Ein Knopf, der zehn Minuten blockiert, wäre
 * kein Knopf, sondern eine Falle.
 *
 * Der Index bleibt bis zum jeweiligen Lauf stehen: Die Suche wird während des
 * Neu-Lesens nicht schlechter, nur langsam aktueller.
 */
export async function reindexAllDocuments(deps: Deps, ctx: CallContext): Promise<Result<{ queued: number }>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;

  const rows = deps.db.select({ id: documents.id }).from(documents).where(isNotNull(documents.fileName)).all();

  return deps.db.transaction((tx: DbOrTx) => {
    for (const row of rows) {
      tx.update(documents)
        .set({ textStatus: 'pending', textAttempts: 0, textError: null })
        .where(eq(documents.id, row.id))
        .run();
    }

    recordAudit(tx, deps, ctx, {
      action: 'document.reindexRequested',
      entityType: 'document',
      entityId: 'all',
      before: null,
      after: { queued: rows.length },
      summary: `${rows.length} Dokumente zum Neu-Lesen vorgemerkt`,
    });

    return ok({ queued: rows.length });
  });
}
```

- [x] **Step 4: Die MCP-Werkzeuge ergänzen**

In `packages/modules/dms/src/mcp-tools.ts` nach dem Muster der vorhandenen Einträge:

```ts
  t(
    'dms_search',
    'Sucht Dokumente der Akte über Betreff, Nummer und den erkannten Volltext (Recht dms.view). Liefert je Treffer die Fundstelle mit Seitenzahl. Suchbegriffe unter drei Zeichen finden im Volltext nichts.',
    documentListSchema,
    async (deps, ctx, input) => listDocuments(deps, ctx, input),
  ),
  t(
    'dms_reindex',
    'Stellt alle abgelegten Dokumente zum erneuten Lesen in die Warteschlange (Recht dms.manage). Der Volltext wird im Hintergrund neu erkannt.',
    z.object({}),
    async (deps, ctx) => reindexAllDocuments(deps, ctx),
  ),
```

**Hinweis:** Die genaue Form des Handlers aus den Nachbareinträgen derselben Datei übernehmen — sie unterscheidet sich je nachdem, wie `McpToolDefinition` die Argumente reicht.

- [x] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/app test -- mcp-tools`
Expected: PASS. `mcp-tools.test.ts` prüft, dass jedes Recht mindestens ein Werkzeug hat, das es in seiner Beschreibung nennt.

- [x] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): read everything again, and let an agent search the file"
```

---

## Abschluss dieses Plans

- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm verify`

Danach: `2026-09-11-volltext-4-oberflaeche.md`.
