# Akte fertig 2 — Modell: Zähler, Bezüge, Versand, Notizen, Bausteine, Parität (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Akte kann alles, was die Spec verlangt, auf Service-Ebene: Nummern, die nie wiederkommen; Bezüge zwischen Dokumenten; Versandvermerk; Notizen; Textbausteine; Ersatz beim Storno; Volltext für Agenten; korrigierte Phase- und Ordnerprüfungen; Sortierung; und MCP-Werkzeuge, die mechanisch gegen die Services geprüft werden.

**Architecture:** Vier neue Tabellen und drei Spalten im Modul `dms`, eine Migration für das Schema und eine für die Zähler-Erstbefüllung. Jede Neuerung ist ein eigener Service nach Muster mit eigenem Test; `toRecord` sammelt Bezüge und Notizen ein, damit die Oberfläche nichts nachlädt. Die MCP-Werkzeuge nennen ihren Service; der Paritätstest der App liest die Exporte der Module und verlangt für jede Service-Funktion ein Werkzeug.

**Tech Stack:** TypeScript, Drizzle/SQLite, Zod 4, Vitest, drizzle-kit.

**Spec:** `docs/superpowers/specs/2026-09-12-akte-fertig-design.md` (§ 4.2–4.6, § 5.2–5.8, § 6, § 8, § 9, Entscheidungen 33–36, 38–40, 42)

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok(...)`.
- Fachfehler als `Result`, nie Exceptions. Technische Fehler werfen.
- IDs über `newId()`, Zeit über `isoNow(deps.clock)`.
- Migrationen: `pnpm --filter @kompass/core db:generate --name=…` für Schema, `drizzle-kit generate --custom` für Daten; **nächste freie Nummer vorher prüfen** (`ls packages/core/src/db/migrations`). Plan 1 erzeugt ebenfalls Migrationen — beide Pläne erzeugen sie nacheinander im selben Baum, nie parallel.
- Pro Service Tests für Erfolg, `forbidden`, `validation`, Protokoll.
- Testhelfer der Akte: `setupWithTypes()`, `fileFixture()`, `pdfBytes()`, `auditActions()` aus `packages/modules/dms/tests/helpers.ts`.
- Keine Bytes über MCP (Entscheidung 39). Keine Löschung eines festgeschriebenen Dokuments über MCP (Entscheidung 10).
- Nach jedem Task ein Commit; nicht pushen.

**Abhängigkeiten:** Task 1–10 sind unabhängig von Plan 1. Task 11 (Aufräumen, Wrapper, Haken) braucht Plan 1 Task 2 und 3; Task 12 (Parität) braucht Plan 1 Task 3 und 5.

---

### Task 1: Schema und Migrationen

**Files:**
- Modify: `packages/modules/dms/src/schema.ts`
- Modify: `packages/modules/dms/src/install.ts` (Einstellung `dms.dispatchChannels`)
- Generated: `packages/core/src/db/migrations/00NN_dms_akte_fertig.sql`
- Generated (custom): `packages/core/src/db/migrations/00NN_dms_counters_fill.sql`
- Modify: `packages/core/tests/db.test.ts` (führt alle Tabellen namentlich auf — die vier neuen eintragen: `document_counters`, `document_notes`, `document_relations`, `document_snippets`)
- Test: `packages/modules/dms/tests/schema-akte-fertig.test.ts`, Ergänzung in `packages/modules/dms/tests/migration.test.ts`

**Interfaces:**
- Produces: Tabellen `documentRelations`, `documentNotes`, `documentSnippets`, `documentCounters`; Spalten `documents.sentAt`, `sentVia`, `sentNote`; Typen `DocumentRelationRow`, `DocumentNoteRow`, `DocumentSnippetRow`, `RelationKind`; Einstellung `dms.dispatchChannels` mit `DispatchChannel = { key: string; label: string }` und `DEFAULT_DISPATCH_CHANNELS`.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/schema-akte-fertig.test.ts`:

```ts
import { readSetting } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPATCH_CHANNELS } from '../src/install';
import { setupWithTypes } from './helpers';

const columns = (deps: ReturnType<typeof setupWithTypes>['deps'], table: string) =>
  (deps.sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();

describe('Schema Akte fertig', () => {
  it('kennt die vier neuen Tabellen', () => {
    const { deps } = setupWithTypes();
    expect(columns(deps, 'document_relations')).toEqual(['created_at', 'created_by_user_id', 'document_id', 'id', 'kind', 'related_document_id']);
    expect(columns(deps, 'document_notes')).toEqual(['body', 'created_at', 'created_by_user_id', 'document_id', 'id']);
    expect(columns(deps, 'document_snippets')).toEqual(['body', 'id', 'is_active', 'name', 'sort_order', 'subject']);
    expect(columns(deps, 'document_counters')).toEqual(['last', 'prefix', 'year']);
  });

  it('das Dokument trägt den Versandvermerk', () => {
    const { deps } = setupWithTypes();
    expect(columns(deps, 'documents')).toEqual(expect.arrayContaining(['sent_at', 'sent_via', 'sent_note']));
  });

  it('die Versandwege sind eine Einstellung mit Vorgabeliste', () => {
    const { deps } = setupWithTypes();
    const channels = readSetting<{ key: string; label: string }[]>(deps, 'dms.dispatchChannels');
    expect(channels).toEqual(DEFAULT_DISPATCH_CHANNELS);
    expect(channels.map((c) => c.key)).toEqual(['post', 'registeredMail', 'email', 'inPerson', 'portal', 'other']);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- schema-akte-fertig`
Expected: FAIL — Tabellen fehlen, `DEFAULT_DISPATCH_CHANNELS` fehlt.

- [ ] **Step 3: Schema erweitern**

`packages/modules/dms/src/schema.ts`, Import anpassen und am Ende anfügen:

```ts
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
```

In `documents`, nach `textExtractedAt`:

```ts
    /**
     * Der Versandvermerk (Entscheidung 34): alle drei zusammen gesetzt oder
     * zusammen leer. Nur an ausgehenden, festgeschriebenen Dokumenten. `sentVia`
     * ist ein Schlüssel aus der Einstellung `dms.dispatchChannels`; ein später
     * entfernter Weg bleibt hier als Schlüssel lesbar.
     */
    sentAt: text('sent_at'),
    sentVia: text('sent_via'),
    sentNote: text('sent_note'),
```

Am Dateiende:

```ts
export const RELATION_KINDS = ['repliesTo', 'signedCopyOf', 'replaces', 'attachmentOf'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/**
 * Bezug zwischen zwei Dokumenten (Entscheidung 33). Gelesen von `documentId`
 * aus: „BEH-004 ist Antwort auf BRF-002“. Beide Enden dürfen Entwürfe sein.
 */
export const documentRelations = sqliteTable(
  'document_relations',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id),
    relatedDocumentId: text('related_document_id').notNull().references(() => documents.id),
    kind: text('kind', { enum: RELATION_KINDS }).notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('document_relations_unique_idx').on(t.documentId, t.relatedDocumentId, t.kind),
    index('document_relations_related_idx').on(t.relatedDocumentId),
  ],
);

/** Journal (Entscheidung 35): nur anhängen, nie ändern. Nie im PDF, nie im Index. */
export const documentNotes = sqliteTable(
  'document_notes',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull().references(() => documents.id),
    body: text('body').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('document_notes_document_idx').on(t.documentId)],
);

/** Textbausteine ohne Platzhalter (Entscheidung 36). */
export const documentSnippets = sqliteTable(
  'document_snippets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('document_snippets_name_idx').on(t.name)],
);

/**
 * Nummernzähler je Präfix und Jahr (Entscheidung 38). Zustand, kein
 * abgeleiteter Wert: Er erinnert sich an Nummern, deren Dokument nicht mehr
 * da ist — genau dafür ist er da.
 */
export const documentCounters = sqliteTable(
  'document_counters',
  {
    prefix: text('prefix').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.prefix, t.year] })],
);

export type DocumentRelationRow = typeof documentRelations.$inferSelect;
export type DocumentNoteRow = typeof documentNotes.$inferSelect;
export type DocumentSnippetRow = typeof documentSnippets.$inferSelect;
```

- [ ] **Step 4: Einstellung für Versandwege**

`packages/modules/dms/src/install.ts`: Typ, Vorgabe und Definition ergänzen.

```ts
export interface DispatchChannel {
  key: string;
  label: string;
}

const CHANNEL_KEY = /^[a-z][a-zA-Z0-9]*$/;

/** Die Vorgabe in der Leitsprache; ein Verein ergänzt oder benennt um. */
export const DEFAULT_DISPATCH_CHANNELS: DispatchChannel[] = [
  { key: 'post', label: 'Post' },
  { key: 'registeredMail', label: 'Einschreiben' },
  { key: 'email', label: 'E-Mail' },
  { key: 'inPerson', label: 'Persönlich übergeben' },
  { key: 'portal', label: 'Portal' },
  { key: 'other', label: 'Sonstiges' },
];

export const dispatchChannelsSchema = z
  .array(z.object({ key: z.string().regex(CHANNEL_KEY), label: z.string().trim().min(1).max(60) }))
  .min(1)
  .refine((list) => new Set(list.map((c) => c.key)).size === list.length, { message: 'duplicateChannelKey' });
```

In `DMS_SETTINGS`:

```ts
  { key: 'dms.dispatchChannels', schema: dispatchChannelsSchema, default: DEFAULT_DISPATCH_CHANNELS },
```

Und in `installDms`, vor `recordAudit`, damit eine englische Installation englische Beschriftungen bekommt (die Vorgabe der Definition bleibt deutsch — sie gilt für Installationen, die vor dieser Einstellung eingerichtet wurden):

```ts
  const channelLabels: Record<string, Record<string, string>> = {
    en: { post: 'Post', registeredMail: 'Registered mail', email: 'E-mail', inPerson: 'Handed over', portal: 'Portal', other: 'Other' },
  };
  const labelsFor = channelLabels[locale];
  if (labelsFor) {
    writeSettingInternal(
      tx, deps, ctx, 'dms.dispatchChannels',
      DEFAULT_DISPATCH_CHANNELS.map((c) => ({ key: c.key, label: labelsFor[c.key] ?? c.label })),
      'dms.install',
    );
  }
```

- [ ] **Step 5: Migrationen erzeugen**

```bash
ls packages/core/src/db/migrations                        # nächste freie Nummer
pnpm --filter @kompass/core db:generate --name=dms_akte_fertig
pnpm --filter @kompass/core exec drizzle-kit generate --custom --name=dms_counters_fill
```

Die erste Datei: vier `CREATE TABLE`, drei `ALTER TABLE documents ADD` — nicht anfassen. Die zweite füllen. Das Nummernformat ist `PRE-JJJJ-NNN`: Präfix Zeichen 1–3, Jahr 5–8, Nummer ab 10.

```sql
-- Zähler aus dem Bestand: je Präfix und Jahr die höchste vergebene Nummer.
-- Für Dokumente, die vor dieser Migration gelöscht wurden, lässt sich nichts
-- nachholen; ab hier wird keine Nummer mehr wiedervergeben.
INSERT OR REPLACE INTO `document_counters` (`prefix`, `year`, `last`)
SELECT substr(`number`, 1, 3), CAST(substr(`number`, 5, 4) AS INTEGER), MAX(CAST(substr(`number`, 10) AS INTEGER))
FROM `documents`
WHERE `number` IS NOT NULL
GROUP BY substr(`number`, 1, 3), substr(`number`, 5, 4);
```

- [ ] **Step 6: Migrationstest ergänzen**

Anhängen an `packages/modules/dms/tests/migration.test.ts` (die Helfer `applyMigrations` und `MIGRATIONS_DIR` stehen oben in der Datei):

```ts
describe('migration dms_counters_fill', () => {
  it('setzt den Zähler auf die höchste vorhandene Nummer je Präfix und Jahr', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const fill = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_dms_counters_fill.sql'))!.replace(/\.sql$/, '');
    const schemaTag = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_dms_akte_fertig.sql'))!.replace(/\.sql$/, '');
    applyMigrations(sqlite, { upTo: schemaTag });

    sqlite.prepare("insert into document_types (key, label, prefix, default_direction, retention_class, is_active, sort_order) values ('letter','Brief','BRF','outgoing','statutory6Y',1,0)").run();
    const insert = sqlite.prepare("insert into documents (id, phase, direction, source_kind, type_key, number, subject, document_date, status, created_by_user_id, created_at, updated_at) values (?, 'issued', 'outgoing', 'generated', 'letter', ?, 's', '2026-01-01', 'issued', 'U1', 't', 't')");
    insert.run('D1', 'BRF-2026-001');
    insert.run('D2', 'BRF-2026-007');
    insert.run('D3', 'BRF-2025-003');

    applyMigrations(sqlite, { after: schemaTag, upTo: fill });

    const rows = sqlite.prepare('select prefix, year, last from document_counters order by year').all();
    expect(rows).toEqual([
      { prefix: 'BRF', year: 2025, last: 3 },
      { prefix: 'BRF', year: 2026, last: 7 },
    ]);
    sqlite.close();
  });
});
```

- [ ] **Step 7: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- schema-akte-fertig migration && pnpm --filter @kompass/core test -- db`
Expected: PASS — `db.test.ts` erst, nachdem die vier Tabellen in seiner Liste stehen (Plan 1 hat das für `follow_ups` gelernt).

- [ ] **Step 8: Commit**

```bash
git add packages/modules/dms/src/schema.ts packages/modules/dms/src/install.ts packages/core/src/db/migrations packages/core/tests/db.test.ts packages/modules/dms/tests/schema-akte-fertig.test.ts packages/modules/dms/tests/migration.test.ts
git commit -m "feat(dms): four tables and a dispatch note, and the counters remember every number"
```

---

### Task 2: Nummern, die nie wiederkommen

**Files:**
- Modify: `packages/modules/dms/src/service.ts` (`nextDocumentNumber` → `allocateDocumentNumber` + `peekDocumentNumber`)
- Modify: `packages/modules/dms/src/drafts.ts` (`fileDocument`)
- Modify: `packages/modules/dms/src/incoming.ts` (`receiveDocument`)
- Modify: Tests, die `nextDocumentNumber` importieren (`tests/service.test.ts`, `tests/preview-number.test.ts`)
- Test: `packages/modules/dms/tests/numbers.test.ts`

**Interfaces:**
- Produces:
  - `allocateDocumentNumber(tx: DbOrTx, prefix: string, year: number): string` — zählt hoch, gibt die Nummer zurück; nur in einer Transaktion.
  - `peekDocumentNumber(db: DbOrTx, prefix: string, year: number): string` — die nächste, ohne zu ziehen.
  - `nextDocumentNumber` verschwindet.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/numbers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { documentCounters } from '../src/schema';
import { allocateDocumentNumber, deleteDocument, peekDocumentNumber } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('Nummern', () => {
  it('zieht aus dem Zähler, und Ansehen zieht nicht', () => {
    const { deps } = setupWithTypes();
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-001');
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-001');
    const first = deps.db.transaction((tx) => allocateDocumentNumber(tx, 'BRF', 2026));
    const second = deps.db.transaction((tx) => allocateDocumentNumber(tx, 'BRF', 2026));
    expect([first, second]).toEqual(['BRF-2026-001', 'BRF-2026-002']);
    expect(peekDocumentNumber(deps.db, 'BRF', 2026)).toBe('BRF-2026-003');
    expect(deps.db.select().from(documentCounters).all()).toEqual([{ prefix: 'BRF', year: 2026, last: 2 }]);
  });

  it('vergibt eine gelöschte Nummer nie wieder', async () => {
    const { deps, ctx } = setupWithTypes();
    deps.clock = { now: () => new Date('2040-03-01T10:00:00.000Z') };
    const received = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'alt', documentDate: '2026-01-15' });
    if (!received.ok) throw new Error('receive');
    expect(received.value.number).toBe('RCH-2040-001');

    // Frist der Rechnung (10 Jahre ab Ende 2026) ist 2040 abgelaufen.
    const deleted = await deleteDocument(deps, ctx, { id: received.value.id });
    expect(deleted.ok).toBe(true);

    const next = await receiveDocument(deps, ctx, { filename: 'b.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'neu', documentDate: '2040-02-01' });
    expect(next.ok && next.value.number).toBe('RCH-2040-002');
  });

  it('ein festgeschriebener Entwurf trägt die Nummer aus dem Zähler', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'a', body: 'x' });
    const b = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'b', body: 'x' });
    if (!a.ok || !b.ok) throw new Error('draft');
    const fa = await fileDocument(deps, ctx, { id: a.value.id });
    const fb = await fileDocument(deps, ctx, { id: b.value.id });
    expect([fa.ok && fa.value.number, fb.ok && fb.value.number]).toEqual(['BRF-2026-001', 'BRF-2026-002']);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- numbers`
Expected: FAIL — `allocateDocumentNumber` gibt es nicht.

- [ ] **Step 3: Zähler-Funktionen**

In `packages/modules/dms/src/service.ts` `nextDocumentNumber` samt Kommentar ersetzen durch:

```ts
import { documentCounters, documentFolders, documentLinks, documents, type DocumentLinkRow, type DocumentRow } from './schema';

const format = (prefix: string, year: number, n: number) => `${prefix}-${year}-${String(n).padStart(3, '0')}`;

/**
 * Präfix aus der Dokumentart (Entscheidung 18), Jahr ist das Ablagejahr.
 * Der Zähler ist Zustand (Entscheidung 38): Eine Nummer, deren Dokument nach
 * Fristablauf gelöscht wurde, kommt nie wieder — das Protokoll nennt sie, und
 * sie darf kein zweites Dokument bezeichnen.
 *
 * Nur in einer Transaktion aufrufen: Lesen und Erhöhen müssen zusammen
 * stehen. better-sqlite3 führt Transaktionen nacheinander aus, ein zweiter
 * Aufruf sieht also immer den erhöhten Stand.
 */
export function allocateDocumentNumber(tx: DbOrTx, prefix: string, year: number): string {
  const row = tx.select().from(documentCounters).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).get();
  const next = (row?.last ?? 0) + 1;
  if (row) {
    tx.update(documentCounters).set({ last: next }).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).run();
  } else {
    tx.insert(documentCounters).values({ prefix, year, last: next }).run();
  }
  return format(prefix, year, next);
}

/** Die Nummer, die das nächste Dokument bekäme — ein Blick, kein Zug. */
export function peekDocumentNumber(db: DbOrTx, prefix: string, year: number): string {
  const row = db.select().from(documentCounters).where(and(eq(documentCounters.prefix, prefix), eq(documentCounters.year, year))).get();
  return format(prefix, year, (row?.last ?? 0) + 1);
}
```

`previewNextNumber` ruft `peekDocumentNumber(deps.db, docType.prefix, year)`.

- [ ] **Step 4: `receiveDocument` ohne Schleife**

In `packages/modules/dms/src/incoming.ts` die `for (let attempt …)`-Schleife ersetzen. Die Datei wird vor der Transaktion geschrieben (das Schreiben kann scheitern, dann darf keine Zeile da sein); scheitert die Transaktion, wird sie entfernt:

```ts
  const id = newId();
  const now = isoNow(deps.clock);
  const year = deps.clock.now().getUTCFullYear();

  const stored = await storeDocumentFile(deps, id, bytes);
  if (!stored.ok) return stored;

  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const number = allocateDocumentNumber(tx, docType.prefix, year);
      tx.insert(documents).values({ /* wie bisher, mit `number` */ }).run();
      for (const link of parsed.value.links) { /* wie bisher */ }
      recordAudit(tx, deps, ctx, { /* wie bisher, mit `number` */ });
      const row = tx.select().from(documents).where(eq(documents.id, id)).get()!;
      return ok(toRecord(deps, row, tx));
    });
  } catch (error) {
    await removeDocumentFile(deps, stored.value.fileName);
    throw error;
  }
```

Import `allocateDocumentNumber` statt `nextDocumentNumber`, dazu `removeDocumentFile` aus `./storage`. Die `conflict('documentNumberContention', …)`-Zeile entfällt.

- [ ] **Step 5: `fileDocument` — die Schleife bleibt, ihr Grund ändert sich**

Das PDF trägt die Nummer, also muss sie vor dem Rendern feststehen; das Rendern ist asynchron und kann nicht in der Transaktion laufen. Deshalb: Nummer ansehen, rendern, Datei schreiben, und in der Transaktion ziehen. Stimmt die gezogene nicht mit der angesehenen überein — jemand war zwischen Ansehen und Ziehen schneller —, wird die Transaktion zurückgerollt und noch einmal gerendert. Drei Anläufe, wie heute.

In `packages/modules/dms/src/drafts.ts`, `fileDocument`, die Schleife so umbauen:

```ts
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const year = deps.clock.now().getUTCFullYear();
    const expected = peekDocumentNumber(deps.db, docType.prefix, year);
    const context = await buildContext(deps, ctx, expected);
    const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context });

    const stored = await storeDocumentFile(deps, row.id, bytes);
    if (!stored.ok) return stored;

    const snapshot = { input: data, slots: built.slots, base: baseId, baseChecksum: base.checksum };
    const outcome = deps.db.transaction((tx: DbOrTx) => {
      const number = allocateDocumentNumber(tx, docType.prefix, year);
      // Die Nummer im PDF muss die gezogene sein. Weicht sie ab, war jemand
      // dazwischen: zurückrollen (durch das Werfen) und neu rendern.
      if (number !== expected) tx.rollback();
      const now = isoNow(deps.clock);
      tx.update(documents).set({ /* wie bisher, mit `number` */ }).where(eq(documents.id, row.id)).run();
      const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
      recordAudit(tx, deps, ctx, { /* wie bisher */ });
      return ok(toRecord(deps, after, tx));
    });
    return outcome;
  }
  return conflict('documentNumberContention', 'Dokumentnummer konnte nicht reserviert werden');
```

`tx.rollback()` wirft in Drizzle einen `TransactionRollbackError`; ihn fangen und die Schleife fortsetzen:

```ts
    let outcome: Result<DocumentRecord> | null = null;
    try {
      outcome = deps.db.transaction(/* … wie oben … */);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('Rollback'))) throw error;
    }
    if (outcome) return outcome;
```

Import `peekDocumentNumber, allocateDocumentNumber` statt `nextDocumentNumber`. Die Datei wird beim nächsten Anlauf überschrieben (gleicher Name aus der Dokument-ID), es bleibt nichts liegen.

- [ ] **Step 6: Bestehende Tests nachziehen**

```bash
grep -rn "nextDocumentNumber" packages/modules/dms
```

In `tests/service.test.ts` und `tests/preview-number.test.ts`: Wo der Test nur liest, `peekDocumentNumber(deps.db, …)`; wo er eine Nummer als vergeben annimmt, indem er eine Zeile mit Nummer einfügt, muss er zusätzlich den Zähler setzen — oder, besser, den Zähler über `allocateDocumentNumber` ziehen. Ein Test, der prüfte, dass nach dem Löschen der letzten Zeile wieder bei 001 begonnen wird, ist mit Entscheidung 38 falsch geworden und wird gelöscht; `numbers.test.ts` deckt den neuen Fall.

- [ ] **Step 7: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): a number is drawn from a counter, and never handed out twice"
```

---

### Task 3: Phase- und Ordnerprüfungen

**Files:**
- Modify: `packages/modules/dms/src/service.ts` (`voidDocument`, `deleteDocument`, neu `resolveFolder`)
- Modify: `packages/modules/dms/src/incoming.ts`, `packages/modules/dms/src/drafts.ts` (`createDraft`, `updateDraft`)
- Test: `packages/modules/dms/tests/guards.test.ts`

**Interfaces:**
- Produces: `resolveFolder(db: DbOrTx, folder: string | null | undefined, fallback: string | null): Result<string | null>` — normalisiert über `parseFolderPath`, prüft gegen `document_folders`; `undefined` liefert `fallback`, `null` liefert `null`.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/guards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDocumentFolder } from '../src/catalog';
import { createDraft, updateDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { deleteDocument, voidDocument } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

describe('Storno und Fristlöschung nur für Festgeschriebenes', () => {
  it('ein Entwurf lässt sich nicht stornieren', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const voided = await voidDocument(deps, ctx, { id: draft.value.id, reason: 'egal' });
    expect(!voided.ok && voided.error.type === 'conflict' && voided.error.code).toBe('documentIsDraft');
  });

  it('die Fristlöschung greift keinen Entwurf an, auch nicht mit altem Datum', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y', documentDate: '2001-01-01' });
    if (!draft.ok) throw new Error('draft');
    const deleted = await deleteDocument(deps, ctx, { id: draft.value.id });
    expect(!deleted.ok && deleted.error.type === 'conflict' && deleted.error.code).toBe('documentIsDraft');
  });
});

describe('Ordner werden geprüft', () => {
  it('Ablegen in einen unbekannten Ordner ist notFound', async () => {
    const { deps, ctx } = setupWithTypes();
    const res = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 's', documentDate: '2026-09-01', folder: 'gibt/es/nicht' });
    expect(!res.ok && res.error.type === 'notFound' && res.error.entity).toBe('documentFolder');
  });

  it('Ablegen in einen bekannten Ordner normalisiert den Pfad', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const res = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 's', documentDate: '2026-09-01', folder: '/behoerden/' });
    expect(res.ok && res.value.folder).toBe('behoerden');
  });

  it('Entwurf anlegen und ändern prüfen den Ordner ebenso', async () => {
    const { deps, ctx } = setupWithTypes();
    const bad = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y', folder: 'nirgends' });
    expect(!bad.ok && bad.error.type).toBe('notFound');
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const moved = await updateDraft(deps, ctx, { id: draft.value.id, folder: 'nirgends' });
    expect(!moved.ok && moved.error.type).toBe('notFound');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- guards`
Expected: FAIL — Storno am Entwurf gelingt, unbekannter Ordner wird angenommen.

- [ ] **Step 3: `resolveFolder` und die Prüfungen**

In `service.ts`:

```ts
/**
 * Ein Ordner, der im Formular steht, muss in `document_folders` stehen — sonst
 * landet ein Dokument an einem Ort, den die Ordnerspalte nie zeigt. Dieselbe
 * Regel für Ablegen, Entwurf und Verschieben.
 */
export function resolveFolder(db: DbOrTx, folder: string | null | undefined, fallback: string | null): Result<string | null> {
  if (folder === undefined) return ok(fallback);
  if (folder === null) return ok(null);
  const normalized = parseFolderPath(folder);
  if (!normalized) return invalid([{ path: 'folder', message: 'invalidFolderPath' }]);
  const row = db.select({ path: documentFolders.path }).from(documentFolders).where(eq(documentFolders.path, normalized)).get();
  if (!row) return notFound('documentFolder', folder);
  return ok(normalized);
}
```

`moveDocument` benutzt `resolveFolder(deps.db, parsed.value.folder, null)` statt seines eigenen Blocks.

`voidDocument`, nach `if (!row) return notFound(…)`:

```ts
  if (row.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${row.subject}“ kann nicht storniert werden — nur verworfen`);
```

`deleteDocument`, an derselben Stelle:

```ts
  if (doc.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${doc.subject}“ unterliegt keiner Frist — Entwürfe werden verworfen`);
```

`incoming.ts`, statt `const folder = parsed.value.folder !== undefined ? … : (docType.defaultFolder ?? null);`:

```ts
  const folderRes = resolveFolder(deps.db, parsed.value.folder, docType.defaultFolder ?? null);
  if (!folderRes.ok) return folderRes;
  const folder = folderRes.value;
```

`drafts.ts`, `createDraft` genauso (Fallback `docType.defaultFolder`), `updateDraft`:

```ts
  if (parsed.value.folder !== undefined) {
    const folderRes = resolveFolder(deps.db, parsed.value.folder, null);
    if (!folderRes.ok) return folderRes;
    updates.folder = folderRes.value;
  }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS. Bricht `seed.test.ts`, weil der Seed einen Entwurf in `protokolle` legt: Der Seed legt die Ordner schon vorher an — prüfen, dass `folders` vor `createDraft` eingefügt werden (ist so).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "fix(dms): a draft cannot be voided or purged, and a folder must exist to be filed into"
```

---

### Task 4: Bezüge zwischen Dokumenten

**Files:**
- Create: `packages/modules/dms/src/relations.ts`
- Modify: `packages/modules/dms/src/service.ts` (`DocumentRecord`, `toRecord`)
- Modify: `packages/modules/dms/src/index.ts` (Export)
- Test: `packages/modules/dms/tests/relations.test.ts`

**Interfaces:**
- Produces:
  - `interface DocumentRelationView { id: string; kind: RelationKind; direction: 'out' | 'in'; otherId: string; otherNumber: string | null; otherSubject: string; otherPhase: 'draft' | 'issued' }`
  - `relationsFor(db: DbOrTx, documentId: string): DocumentRelationView[]` — beide Richtungen
  - `relateDocuments(deps, ctx, { documentId, relatedDocumentId, kind })` → `Result<DocumentRelationRow>`, `dms.create`, Audit `dms.relate`; `conflict('relationSelf')`, `conflict('relationExists')`
  - `unrelateDocuments(deps, ctx, { id })` → `Result<null>`, Audit `dms.unrelate`
  - `relateSchema`, `unrelateSchema`
  - `DocumentRecord.relations: DocumentRelationView[]`

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/relations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relateDocuments, relationsFor, unrelateDocuments } from '../src/relations';
import { getDocumentRecord } from '../src/service';
import { auditActions, fileFixture, pdfBytes, setupWithTypes } from './helpers';

async function incoming(deps: any, ctx: any, subject: string) {
  const res = await receiveDocument(deps, ctx, { filename: `${subject}.pdf`, bytes: pdfBytes(), typeKey: 'authority', subject, documentDate: '2026-09-01' });
  if (!res.ok) throw new Error('receive');
  return res.value;
}

describe('Dokumentbezüge', () => {
  it('ein Eingang antwortet auf einen Brief, und beide Seiten wissen es', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const answer = await incoming(deps, ctx, 'Bescheid');
    const related = await relateDocuments(deps, ctx, { documentId: answer.id, relatedDocumentId: letter.id, kind: 'repliesTo' });
    expect(related.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.relate');

    expect(relationsFor(deps.db, answer.id)).toEqual([
      expect.objectContaining({ kind: 'repliesTo', direction: 'out', otherId: letter.id, otherNumber: letter.number, otherSubject: 'Fixture', otherPhase: 'issued' }),
    ]);
    expect(relationsFor(deps.db, letter.id)).toEqual([
      expect.objectContaining({ kind: 'repliesTo', direction: 'in', otherId: answer.id, otherSubject: 'Bescheid' }),
    ]);
    const record = await getDocumentRecord(deps, ctx, letter.id);
    expect(record.ok && record.value.relations).toHaveLength(1);
  });

  it('kein Bezug auf sich selbst, kein Doppel, kein unbekanntes Ende', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await fileFixture(deps, ctx);
    const b = await incoming(deps, ctx, 'b');
    const self = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: a.id, kind: 'attachmentOf' });
    expect(!self.ok && self.error.type === 'conflict' && self.error.code).toBe('relationSelf');
    await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'attachmentOf' });
    const twice = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'attachmentOf' });
    expect(!twice.ok && twice.error.type === 'conflict' && twice.error.code).toBe('relationExists');
    const ghost = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: 'NOPE', kind: 'attachmentOf' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });

  it('ein Entwurf darf Ende eines Bezugs sein, und Verwerfen nimmt den Bezug mit', async () => {
    const { deps, ctx } = setupWithTypes();
    const inbound = await incoming(deps, ctx, 'Anfrage');
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Antwort', body: 'x' });
    if (!draft.ok) throw new Error('draft');
    const rel = await relateDocuments(deps, ctx, { documentId: draft.value.id, relatedDocumentId: inbound.id, kind: 'repliesTo' });
    expect(rel.ok).toBe(true);
    expect(relationsFor(deps.db, inbound.id)).toHaveLength(1);
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(relationsFor(deps.db, inbound.id)).toHaveLength(0);
  });

  it('löst einen Bezug wieder, mit Protokoll, und braucht das Recht', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await fileFixture(deps, ctx);
    const b = await incoming(deps, ctx, 'b');
    const rel = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'signedCopyOf' });
    if (!rel.ok) throw new Error('relate');
    const { ctx: reader } = setupWithTypes(['dms.view']);
    const denied = await unrelateDocuments(deps, reader, { id: rel.value.id });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const gone = await unrelateDocuments(deps, ctx, { id: rel.value.id });
    expect(gone.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.unrelate');
    const bad = await relateDocuments(deps, ctx, { documentId: a.id, relatedDocumentId: b.id, kind: 'somethingElse' });
    expect(!bad.ok && bad.error.type).toBe('validation');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- relations`
Expected: FAIL — `../src/relations` fehlt.

- [ ] **Step 3: Service schreiben**

`packages/modules/dms/src/relations.ts`:

```ts
import {
  conflict,
  isoNow,
  newId,
  notFound,
  ok,
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
import { RELATION_KINDS, documentRelations, documents, type DocumentRelationRow, type RelationKind } from './schema';

export interface DocumentRelationView {
  id: string;
  kind: RelationKind;
  /** `out`: dieses Dokument ist `documentId` („ist Antwort auf“); `in`: es ist das andere Ende („beantwortet durch“). */
  direction: 'out' | 'in';
  otherId: string;
  otherNumber: string | null;
  otherSubject: string;
  otherPhase: 'draft' | 'issued';
}

export const relateSchema = z.object({
  documentId: z.string().min(1),
  relatedDocumentId: z.string().min(1),
  kind: z.enum(RELATION_KINDS),
});

export const unrelateSchema = z.object({ id: z.string().min(1) });

/** Beide Richtungen, jede Zeile mit Nummer, Betreff und Phase des anderen Endes. */
export function relationsFor(db: DbOrTx, documentId: string): DocumentRelationView[] {
  const other = (id: string) => db.select({ number: documents.number, subject: documents.subject, phase: documents.phase }).from(documents).where(eq(documents.id, id)).get();
  const view = (row: DocumentRelationRow, direction: 'out' | 'in'): DocumentRelationView | null => {
    const otherId = direction === 'out' ? row.relatedDocumentId : row.documentId;
    const doc = other(otherId);
    if (!doc) return null;
    return { id: row.id, kind: row.kind, direction, otherId, otherNumber: doc.number, otherSubject: doc.subject, otherPhase: doc.phase };
  };
  const out = db.select().from(documentRelations).where(eq(documentRelations.documentId, documentId)).all().map((r) => view(r, 'out'));
  const inbound = db.select().from(documentRelations).where(eq(documentRelations.relatedDocumentId, documentId)).all().map((r) => view(r, 'in'));
  return [...out, ...inbound].filter((v): v is DocumentRelationView => v !== null);
}

export async function relateDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRelationRow>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, relateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.documentId === v.relatedDocumentId) return conflict('relationSelf', 'Ein Dokument kann sich nicht auf sich selbst beziehen');

  const [doc, related] = [v.documentId, v.relatedDocumentId].map((id) => deps.db.select({ id: documents.id, number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, id)).get());
  if (!doc) return notFound('document', v.documentId);
  if (!related) return notFound('document', v.relatedDocumentId);

  const id = newId();
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      tx.insert(documentRelations).values({ id, documentId: v.documentId, relatedDocumentId: v.relatedDocumentId, kind: v.kind, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock) }).run();
      recordAudit(tx, deps, ctx, {
        action: 'dms.relate',
        entityType: 'documentRelation',
        entityId: id,
        after: { documentId: v.documentId, relatedDocumentId: v.relatedDocumentId, kind: v.kind },
        summary: `Bezug „${v.kind}“ von ${doc.number ?? doc.subject} auf ${related.number ?? related.subject} angelegt`,
      });
      return ok(tx.select().from(documentRelations).where(eq(documentRelations.id, id)).get()!);
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: document_relations/.test(error.message)) {
      return conflict('relationExists', 'Dieser Bezug besteht bereits');
    }
    throw error;
  }
}

export async function unrelateDocuments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, unrelateSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documentRelations).where(eq(documentRelations.id, parsed.value.id)).get();
  if (!row) return notFound('documentRelation', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentRelations).where(eq(documentRelations.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.unrelate', entityType: 'documentRelation', entityId: row.id, before: row, summary: `Bezug ${row.id} gelöst` });
    return ok(null);
  });
}

/** Für das Löschen eines Dokuments: Bezüge in beiden Richtungen, in der Transaktion des Aufrufers. */
export function deleteRelationsFor(tx: DbOrTx, documentId: string): number {
  const a = tx.delete(documentRelations).where(eq(documentRelations.documentId, documentId)).run().changes;
  const b = tx.delete(documentRelations).where(eq(documentRelations.relatedDocumentId, documentId)).run().changes;
  return a + b;
}
```

In `service.ts`: `DocumentRecord` um `relations: DocumentRelationView[]` erweitern; `toRecord` ruft `relationsFor(dbOrTx, row.id)`. Import über `./relations` — Achtung Zirkel: `relations.ts` importiert nichts aus `service.ts`, das ist in Ordnung.

`deleteDraft` (drafts.ts) und `deleteDocument` (service.ts): in der Transaktion vor dem Löschen der Zeile `deleteRelationsFor(tx, row.id)` aufrufen (Notizen und Wiedervorlagen folgen in Task 6 und 11).

`index.ts`: `export * from './relations';`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- relations`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): two documents can say what they are to each other"
```

---

### Task 4b: Ablegen mit Bezug — `receiveDocument` nimmt `relations`

**Files:**
- Modify: `packages/modules/dms/src/incoming.ts`
- Test: Ergänzung in `packages/modules/dms/tests/relations.test.ts`

**Interfaces:**
- Produces: `receiveFields.relations: { relatedDocumentId: string; kind: RelationKind }[]` (Vorgabe `[]`), in `receiveDocumentSchema` und `receiveSchema`; die Bezüge entstehen in derselben Transaktion wie das Dokument.

- [ ] **Step 1: Failing Test schreiben**

Anhängen an `relations.test.ts`:

```ts
  it('Post kann beim Ablegen schon sagen, worauf sie antwortet', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await receiveDocument(deps, ctx, {
      filename: 'antwort.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Antwort', documentDate: '2026-09-02',
      relations: [{ relatedDocumentId: letter.id, kind: 'repliesTo' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.relations).toEqual([expect.objectContaining({ kind: 'repliesTo', direction: 'out', otherId: letter.id })]);
    const ghost = await receiveDocument(deps, ctx, {
      filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'x', documentDate: '2026-09-02',
      relations: [{ relatedDocumentId: 'NOPE', kind: 'repliesTo' }],
    });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- relations`
Expected: FAIL — `relations` ist kein Feld; Zod verwirft es oder ignoriert es.

- [ ] **Step 3: Schema und Service**

In `incoming.ts`, `receiveFields`:

```ts
  relations: z.array(z.object({ relatedDocumentId: z.string().min(1), kind: z.enum(RELATION_KINDS) })).default([]),
```

Vor der Transaktion prüfen, dass jedes andere Ende existiert:

```ts
  for (const relation of parsed.value.relations) {
    const other = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, relation.relatedDocumentId)).get();
    if (!other) return notFound('document', relation.relatedDocumentId);
  }
```

In der Transaktion, nach den Links:

```ts
      for (const relation of parsed.value.relations) {
        tx.insert(documentRelations).values({ id: newId(), documentId: id, relatedDocumentId: relation.relatedDocumentId, kind: relation.kind, createdByUserId: ctx.userId ?? 'system', createdAt: now }).run();
      }
```

und im Protokolleintrag `after.relations: parsed.value.relations.length`. Imports: `RELATION_KINDS`, `documentRelations` aus `./schema`.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- relations`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): filed post can say on arrival what it answers"
```

---

### Task 5: Versandvermerk

**Files:**
- Create: `packages/modules/dms/src/dispatch.ts`
- Modify: `packages/modules/dms/src/index.ts`
- Test: `packages/modules/dms/tests/dispatch.test.ts`

**Interfaces:**
- Produces:
  - `dispatchChannels(deps): DispatchChannel[]` — aus der Einstellung
  - `recordDispatch(deps, ctx, { id, sentAt, sentVia, note? })` → `Result<DocumentRecord>`, `dms.create`, Audit `dms.dispatch` mit Vorher/Nachher; `conflict('notOutgoing')`, `conflict('documentIsDraft')`; `validation` bei unbekanntem Weg, Datum vor `documentDate` oder in der Zukunft
  - `clearDispatch(deps, ctx, { id })` → `Result<DocumentRecord>`, Audit `dms.dispatch.clear`
  - `dispatchSchema`, `dispatchClearSchema`

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/dispatch.test.ts`:

```ts
import { schema, setSetting } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { clearDispatch, recordDispatch } from '../src/dispatch';
import { createDraft } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { auditActions, fileFixture, pdfBytes, setupWithTypes } from './helpers';

describe('Versandvermerk', () => {
  it('vermerkt Datum, Weg und Bemerkung an einem festgeschriebenen Brief', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const sent = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'post', note: 'mit Anlagen' });
    expect(sent.ok && [sent.value.sentAt, sent.value.sentVia, sent.value.sentNote]).toEqual(['2026-09-05', 'post', 'mit Anlagen']);
    expect(auditActions(deps)).toContain('dms.dispatch');
  });

  it('ändert nachträglich mit Vorher und Nachher im Protokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'post' });
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-04', sentVia: 'email' });
    const entry = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'dms.dispatch').at(-1)!;
    expect(JSON.parse(entry.before!)).toMatchObject({ sentAt: '2026-09-05', sentVia: 'post' });
    expect(JSON.parse(entry.after!)).toMatchObject({ sentAt: '2026-09-04', sentVia: 'email' });
  });

  it('weist Entwurf, Eingang, unbekannten Weg, Datum vor dem Dokument und Zukunft ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    const inbound = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 's', documentDate: '2026-09-01' });
    const letter = await fileFixture(deps, ctx);
    if (!draft.ok || !inbound.ok) throw new Error('fixture');
    const onDraft = await recordDispatch(deps, ctx, { id: draft.value.id, sentAt: '2026-09-05', sentVia: 'post' });
    expect(!onDraft.ok && onDraft.error.type === 'conflict' && onDraft.error.code).toBe('documentIsDraft');
    const onInbound = await recordDispatch(deps, ctx, { id: inbound.value.id, sentAt: '2026-09-05', sentVia: 'post' });
    expect(!onInbound.ok && onInbound.error.type === 'conflict' && onInbound.error.code).toBe('notOutgoing');
    const via = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'carrierPigeon' });
    expect(!via.ok && via.error.type === 'validation' && via.error.issues[0]?.path).toBe('sentVia');
    const early = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2020-01-01', sentVia: 'post' });
    expect(!early.ok && early.error.type === 'validation' && early.error.issues[0]?.path).toBe('sentAt');
    const future = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2027-01-01', sentVia: 'post' });
    expect(!future.ok && future.error.type).toBe('validation');
  });

  it('ein aus der Einstellung entfernter Weg bleibt am Dokument stehen', async () => {
    const { deps, ctx } = setupWithTypes([...['dms.view', 'dms.create', 'dms.file', 'dms.void', 'dms.deleteDraft', 'dms.manage'], 'settings.manage']);
    const letter = await fileFixture(deps, ctx);
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'portal' });
    const without = await setSetting(deps, ctx, { key: 'dms.dispatchChannels', value: [{ key: 'post', label: 'Post' }] });
    expect(without.ok).toBe(true);
    const again = await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'portal' });
    expect(!again.ok && again.error.type).toBe('validation');
    const row = deps.db.select().from((await import('../src/schema')).documents).all().find((d) => d.id === letter.id)!;
    expect(row.sentVia).toBe('portal');
  });

  it('leert den Vermerk mit Protokoll und braucht das Recht', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    await recordDispatch(deps, ctx, { id: letter.id, sentAt: '2026-09-05', sentVia: 'post' });
    const { ctx: reader } = setupWithTypes(['dms.view']);
    const denied = await clearDispatch(deps, reader, { id: letter.id });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const cleared = await clearDispatch(deps, ctx, { id: letter.id });
    expect(cleared.ok && cleared.value.sentAt).toBeNull();
    expect(auditActions(deps)).toContain('dms.dispatch.clear');
  });
});
```

Hinweis: `setupWithTypes` hängt `contacts.manage` nur an, wenn die Vorgabeliste übergeben wird; für den Test mit `settings.manage` wird die Liste ausgeschrieben. `TEST_NOW` ist `2026-09-05T08:00:00.000Z`, deshalb ist `2027-01-01` Zukunft und `2026-09-05` erlaubt.

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- dispatch`
Expected: FAIL — `../src/dispatch` fehlt.

- [ ] **Step 3: Service schreiben**

`packages/modules/dms/src/dispatch.ts`:

```ts
import {
  conflict,
  invalid,
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
import type { DispatchChannel } from './install';
import { documents } from './schema';
import { toRecord, type DocumentRecord } from './service';

export const dispatchSchema = z.object({
  id: z.string().min(1),
  sentAt: z.string().date(),
  sentVia: z.string().trim().min(1),
  note: z.string().trim().max(300).optional(),
});

export const dispatchClearSchema = z.object({ id: z.string().min(1) });

export function dispatchChannels(deps: Deps): DispatchChannel[] {
  return readSetting<DispatchChannel[]>(deps, 'dms.dispatchChannels');
}

/**
 * Ein Vermerk je Dokument (Entscheidung 34). Er ändert nichts am Dokument,
 * nur an dem, was daneben steht — deshalb darf er an einem festgeschriebenen
 * Dokument gesetzt und korrigiert werden, mit Vorher und Nachher im Protokoll.
 */
export async function recordDispatch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, dispatchSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const row = deps.db.select().from(documents).where(eq(documents.id, v.id)).get();
  if (!row) return notFound('document', v.id);
  if (row.phase !== 'issued') return conflict('documentIsDraft', `Entwurf „${row.subject}“ wurde noch nicht festgeschrieben`);
  if (row.direction !== 'outgoing') return conflict('notOutgoing', `Dokument ${row.number} ist eingegangen, nicht versandt`);

  if (!dispatchChannels(deps).some((c) => c.key === v.sentVia)) return invalid([{ path: 'sentVia', message: 'unknownDispatchChannel' }]);
  if (v.sentAt < row.documentDate) return invalid([{ path: 'sentAt', message: 'sentBeforeDocumentDate' }]);
  if (v.sentAt > deps.clock.now().toISOString().slice(0, 10)) return invalid([{ path: 'sentAt', message: 'sentInFuture' }]);

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(documents).set({ sentAt: v.sentAt, sentVia: v.sentVia, sentNote: v.note ?? null, updatedAt: now }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.dispatch',
      entityType: 'document',
      entityId: row.id,
      before: { sentAt: row.sentAt, sentVia: row.sentVia, sentNote: row.sentNote },
      after: { sentAt: after.sentAt, sentVia: after.sentVia, sentNote: after.sentNote },
      summary: `Dokument ${row.number} als versandt vermerkt: ${v.sentAt} per ${v.sentVia}`,
    });
    return ok(toRecord(deps, after, tx));
  });
}

export async function clearDispatch(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, dispatchClearSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documents).where(eq(documents.id, parsed.value.id)).get();
  if (!row) return notFound('document', parsed.value.id);
  if (!row.sentAt) return conflict('notDispatched', `Dokument ${row.number} trägt keinen Versandvermerk`);

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documents).set({ sentAt: null, sentVia: null, sentNote: null, updatedAt: isoNow(deps.clock) }).where(eq(documents.id, row.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, row.id)).get()!;
    recordAudit(tx, deps, ctx, {
      action: 'dms.dispatch.clear',
      entityType: 'document',
      entityId: row.id,
      before: { sentAt: row.sentAt, sentVia: row.sentVia, sentNote: row.sentNote },
      after: { sentAt: null, sentVia: null, sentNote: null },
      summary: `Versandvermerk an Dokument ${row.number} entfernt`,
    });
    return ok(toRecord(deps, after, tx));
  });
}
```

`index.ts`: `export * from './dispatch';`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- dispatch`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): the file knows when and how a letter left the house"
```

---

### Task 6: Notizen

**Files:**
- Create: `packages/modules/dms/src/notes.ts`
- Modify: `packages/modules/dms/src/service.ts` (`DocumentRecord.notes`, `toRecord`, `deleteDocument`), `drafts.ts` (`deleteDraft`)
- Modify: `packages/modules/dms/src/index.ts`
- Test: `packages/modules/dms/tests/notes.test.ts`

**Interfaces:**
- Produces:
  - `addNote(deps, ctx, { documentId, body })` → `Result<DocumentNoteRow>`, `dms.create`, Audit `dms.note.add`
  - `deleteNote(deps, ctx, { id })` → `Result<null>`, eigene Notiz mit `dms.create` oder fremde mit `dms.manage`; sonst `forbidden('dms.manage')`; Audit `dms.note.delete`
  - `notesFor(db, documentId): DocumentNoteRow[]` chronologisch
  - `deleteNotesFor(tx, documentId): number`
  - `noteAddSchema`, `noteIdSchema`
  - `DocumentRecord.notes: DocumentNoteRow[]`

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/notes.test.ts`:

```ts
import { ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { addNote, deleteNote, notesFor } from '../src/notes';
import { getDocumentRecord } from '../src/service';
import { ALL_DMS, auditActions, fileFixture, setupWithTypes } from './helpers';

describe('Notizen', () => {
  it('hängt Notizen an, chronologisch, mit Person und Zeit, auch an Entwürfe', async () => {
    const { deps, ctx, userId } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const a = await addNote(deps, ctx, { documentId: draft.value.id, body: 'erst' });
    const b = await addNote(deps, ctx, { documentId: draft.value.id, body: 'dann' });
    expect(a.ok && b.ok).toBe(true);
    expect(notesFor(deps.db, draft.value.id).map((n) => [n.body, n.createdByUserId])).toEqual([['erst', userId], ['dann', userId]]);
    const record = await getDocumentRecord(deps, ctx, draft.value.id);
    expect(record.ok && record.value.notes).toHaveLength(2);
    expect(auditActions(deps)).toContain('dms.note.add');
  });

  it('weist leere und überlange Notizen und unbekannte Dokumente ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    expect((await addNote(deps, ctx, { documentId: letter.id, body: '   ' })).ok).toBe(false);
    expect((await addNote(deps, ctx, { documentId: letter.id, body: 'x'.repeat(4001) })).ok).toBe(false);
    const ghost = await addNote(deps, ctx, { documentId: 'NOPE', body: 'x' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });

  it('die eigene Notiz löscht, wer sie schrieb; eine fremde nur, wer verwaltet', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const mine = await addNote(deps, ctx, { documentId: letter.id, body: 'meine' });
    if (!mine.ok) throw new Error('note');
    const otherId = insertUser(deps, { name: 'Mira', email: 'mira@example.org' });
    const other = ctxWith(['dms.view', 'dms.create'], otherId);
    const denied = await deleteNote(deps, other, { id: mine.value.id });
    expect(!denied.ok && denied.error.type === 'forbidden' && denied.error.permission).toBe('dms.manage');
    const manager = ctxWith(ALL_DMS, otherId);
    expect((await deleteNote(deps, manager, { id: mine.value.id })).ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.note.delete');
  });

  it('Verwerfen eines Entwurfs nimmt die Notizen mit', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    await addNote(deps, ctx, { documentId: draft.value.id, body: 'weg damit' });
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(notesFor(deps.db, draft.value.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- notes`
Expected: FAIL — `../src/notes` fehlt.

- [ ] **Step 3: Service schreiben**

`packages/modules/dms/src/notes.ts`:

```ts
import {
  forbidden,
  hasPermission,
  isoNow,
  newId,
  notFound,
  ok,
  recordAudit,
  requirePermission,
  validate,
  type CallContext,
  type DbOrTx,
  type Deps,
  type Result,
} from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentNotes, documents, type DocumentNoteRow } from './schema';

export const noteAddSchema = z.object({ documentId: z.string().min(1), body: z.string().trim().min(1).max(4000) });
export const noteIdSchema = z.object({ id: z.string().min(1) });

export function notesFor(db: DbOrTx, documentId: string): DocumentNoteRow[] {
  return db.select().from(documentNotes).where(eq(documentNotes.documentId, documentId)).orderBy(asc(documentNotes.createdAt), asc(documentNotes.id)).all();
}

export async function addNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentNoteRow>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, noteAddSchema, input);
  if (!parsed.ok) return parsed;
  const doc = deps.db.select({ id: documents.id, number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(documentNotes).values({ id, documentId: doc.id, body: parsed.value.body, createdByUserId: ctx.userId ?? 'system', createdAt: isoNow(deps.clock) }).run();
    // Der Text der Notiz steht nicht im Protokoll: Sie ist Arbeitsmaterial,
    // und ihr Inhalt geht mit ihr (wie beim Entwurf, Entscheidung 4).
    recordAudit(tx, deps, ctx, { action: 'dms.note.add', entityType: 'documentNote', entityId: id, after: { documentId: doc.id }, summary: `Notiz an ${doc.number ?? doc.subject} angefügt` });
    return ok(tx.select().from(documentNotes).where(eq(documentNotes.id, id)).get()!);
  });
}

/** Die eigene Notiz löscht, wer sie schrieb (mit `dms.create`); eine fremde nur, wer verwaltet. */
export async function deleteNote(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, noteIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(documentNotes).where(eq(documentNotes.id, parsed.value.id)).get();
  if (!row) return notFound('documentNote', parsed.value.id);
  if (row.createdByUserId !== ctx.userId && !hasPermission(ctx, 'dms.manage')) return forbidden('dms.manage');

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentNotes).where(eq(documentNotes.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.note.delete', entityType: 'documentNote', entityId: row.id, before: { documentId: row.documentId, createdByUserId: row.createdByUserId }, summary: `Notiz ${row.id} gelöscht` });
    return ok(null);
  });
}

export function deleteNotesFor(tx: DbOrTx, documentId: string): number {
  return tx.delete(documentNotes).where(eq(documentNotes.documentId, documentId)).run().changes;
}
```

`service.ts`: `DocumentRecord.notes: DocumentNoteRow[]`, `toRecord` ergänzt `notes: notesFor(dbOrTx, row.id)`; `deleteDocument` ruft `deleteNotesFor(tx, doc.id)` neben `deleteRelationsFor`. `drafts.ts`, `deleteDraft`: ebenso. `index.ts`: `export * from './notes';`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- notes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): a journal of notes beside the document, never inside it"
```

---

### Task 7: Textbausteine

**Files:**
- Create: `packages/modules/dms/src/snippets.ts`
- Modify: `packages/modules/dms/src/index.ts`
- Test: `packages/modules/dms/tests/snippets.test.ts`

**Interfaces:**
- Produces: `createSnippet`, `updateSnippet`, `deleteSnippet` (`dms.manage`; Audit `dms.snippet.create|update|delete`), `listSnippets(deps, ctx, { includeInactive })` (`dms.view`, nach `sortOrder`, `name`); Schemata `snippetCreateSchema`, `snippetUpdateSchema`, `snippetIdSchema`, `snippetListSchema`; `conflict('snippetExists')` bei doppeltem Namen.

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/snippets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from '../src/snippets';
import { auditActions, setupWithTypes } from './helpers';

describe('Textbausteine', () => {
  it('legt an, listet sortiert, ändert, deaktiviert und löscht — mit Protokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await createSnippet(deps, ctx, { name: 'Grußformel', body: 'Mit freundlichen Grüßen', sortOrder: 2 });
    const b = await createSnippet(deps, ctx, { name: 'Rückmeldung', subject: 'Bitte um Rückmeldung', body: 'Wir bitten um Rückmeldung bis …', sortOrder: 1 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const listed = await listSnippets(deps, ctx, {});
    expect(listed.ok && listed.value.map((s) => s.name)).toEqual(['Rückmeldung', 'Grußformel']);

    expect((await updateSnippet(deps, ctx, { id: a.value.id, isActive: false })).ok).toBe(true);
    const active = await listSnippets(deps, ctx, {});
    expect(active.ok && active.value.map((s) => s.name)).toEqual(['Rückmeldung']);
    const all = await listSnippets(deps, ctx, { includeInactive: true });
    expect(all.ok && all.value).toHaveLength(2);

    expect((await deleteSnippet(deps, ctx, { id: b.value.id })).ok).toBe(true);
    expect(auditActions(deps)).toEqual(expect.arrayContaining(['dms.snippet.create', 'dms.snippet.update', 'dms.snippet.delete']));
  });

  it('kein doppelter Name, kein leerer Text, kein Anlegen ohne Verwaltungsrecht', async () => {
    const { deps, ctx } = setupWithTypes();
    await createSnippet(deps, ctx, { name: 'Gruß', body: 'x' });
    const twice = await createSnippet(deps, ctx, { name: 'Gruß', body: 'y' });
    expect(!twice.ok && twice.error.type === 'conflict' && twice.error.code).toBe('snippetExists');
    const empty = await createSnippet(deps, ctx, { name: 'Leer', body: '' });
    expect(!empty.ok && empty.error.type).toBe('validation');
    const { ctx: writer } = setupWithTypes(['dms.view', 'dms.create']);
    const denied = await createSnippet(deps, writer, { name: 'Neu', body: 'x' });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const missing = await updateSnippet(deps, ctx, { id: 'NOPE', name: 'x' });
    expect(!missing.ok && missing.error.type).toBe('notFound');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- snippets`
Expected: FAIL

- [ ] **Step 3: Service schreiben**

`packages/modules/dms/src/snippets.ts`:

```ts
import { conflict, newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documentSnippets, type DocumentSnippetRow } from './schema';

const fields = {
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().max(300).nullable().optional(),
  body: z.string().trim().min(1).max(20_000),
  sortOrder: z.number().int().min(0).default(0),
};

export const snippetCreateSchema = z.object(fields);
export const snippetUpdateSchema = z.object({
  id: z.string().min(1),
  name: fields.name.optional(),
  subject: fields.subject,
  body: fields.body.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export const snippetIdSchema = z.object({ id: z.string().min(1) });
export const snippetListSchema = z.object({ includeInactive: z.boolean().default(false) });

const load = (db: DbOrTx, id: string) => db.select().from(documentSnippets).where(eq(documentSnippets.id, id)).get() ?? null;
const nameTaken = (db: DbOrTx, name: string, exceptId?: string) => {
  const row = db.select({ id: documentSnippets.id }).from(documentSnippets).where(eq(documentSnippets.name, name)).get();
  return !!row && row.id !== exceptId;
};

export async function createSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentSnippetRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetCreateSchema, input);
  if (!parsed.ok) return parsed;
  if (nameTaken(deps.db, parsed.value.name)) return conflict('snippetExists', `Baustein „${parsed.value.name}“ existiert bereits`);
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(documentSnippets).values({ id, name: parsed.value.name, subject: parsed.value.subject ?? null, body: parsed.value.body, sortOrder: parsed.value.sortOrder, isActive: true }).run();
    const row = load(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.create', entityType: 'documentSnippet', entityId: id, after: { name: row.name, subject: row.subject }, summary: `Textbaustein „${row.name}“ angelegt` });
    return ok(row);
  });
}

export async function updateSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentSnippetRow>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = load(deps.db, id);
  if (!before) return notFound('documentSnippet', id);
  if (changes.name !== undefined && nameTaken(deps.db, changes.name, id)) return conflict('snippetExists', `Baustein „${changes.name}“ existiert bereits`);
  const updates: Partial<typeof documentSnippets.$inferInsert> = {};
  if (changes.name !== undefined) updates.name = changes.name;
  if (changes.subject !== undefined) updates.subject = changes.subject;
  if (changes.body !== undefined) updates.body = changes.body;
  if (changes.sortOrder !== undefined) updates.sortOrder = changes.sortOrder;
  if (changes.isActive !== undefined) updates.isActive = changes.isActive;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(documentSnippets).set(updates).where(eq(documentSnippets.id, id)).run();
    const after = load(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.update', entityType: 'documentSnippet', entityId: id, before: { name: before.name, isActive: before.isActive }, after: { name: after.name, isActive: after.isActive }, summary: `Textbaustein „${after.name}“ geändert` });
    return ok(after);
  });
}

export async function deleteSnippet(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'dms.manage');
  if (denied) return denied;
  const parsed = validate(deps, snippetIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('documentSnippet', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(documentSnippets).where(eq(documentSnippets.id, row.id)).run();
    recordAudit(tx, deps, ctx, { action: 'dms.snippet.delete', entityType: 'documentSnippet', entityId: row.id, before: { name: row.name }, summary: `Textbaustein „${row.name}“ gelöscht` });
    return ok(null);
  });
}

export async function listSnippets(deps: Deps, ctx: CallContext, input: unknown = {}): Promise<Result<DocumentSnippetRow[]>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, snippetListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(documentSnippets).orderBy(asc(documentSnippets.sortOrder), asc(documentSnippets.name)).all();
  return ok(parsed.value.includeInactive ? rows : rows.filter((r) => r.isActive));
}
```

`index.ts`: `export * from './snippets';`

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- snippets`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): text blocks for the letters that always say the same thing"
```

---

### Task 8: Volltext lesen und Ersatz beim Storno

**Files:**
- Modify: `packages/modules/dms/src/text.ts` (`getDocumentText`)
- Modify: `packages/modules/dms/src/drafts.ts` (`createReplacementDraft`)
- Test: `packages/modules/dms/tests/text-read.test.ts`, `packages/modules/dms/tests/replacement.test.ts`

**Interfaces:**
- Produces:
  - `getDocumentText(deps, ctx, { documentId })` → `Result<{ textStatus: string | null; textError: string | null; pages: { page: number; text: string }[] }>`, `dms.view`; `documentTextSchema`
  - `createReplacementDraft(deps, ctx, { voidedId })` → `Result<DocumentRecord>`, `dms.create`; `conflict('documentNotVoided')`; `replacementSchema`

- [ ] **Step 1: Failing Tests schreiben**

`packages/modules/dms/tests/text-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { replaceDocumentText } from '../src/index-store';
import { getDocumentText } from '../src/text';
import { fileFixture, setupWithTypes } from './helpers';

describe('getDocumentText', () => {
  it('liefert die Seiten aus dem Index, sobald gelesen wurde', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    replaceDocumentText(deps, letter.id, [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }]);
    deps.sqlite.prepare(`update documents set text_status = 'done' where id = ?`).run(letter.id);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value).toEqual({ textStatus: 'done', textError: null, pages: [{ page: 1, text: 'Seite eins' }, { page: 2, text: 'Seite zwei' }] });
  });

  it('sagt, warum nichts da ist, statt leer zu schweigen', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await getDocumentText(deps, ctx, { documentId: letter.id });
    expect(res.ok && res.value.textStatus).toBe('pending');
    expect(res.ok && res.value.pages).toEqual([]);
    const { ctx: nobody } = setupWithTypes([]);
    expect((await getDocumentText(deps, nobody, { documentId: letter.id })).ok).toBe(false);
    const ghost = await getDocumentText(deps, ctx, { documentId: 'NOPE' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
  });
});
```

Hinweis: `deps.sqlite` ist der rohe Treiber, wie in `index-store.ts`.

`packages/modules/dms/tests/replacement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDraft, createReplacementDraft, fileDocument } from '../src/drafts';
import { relationsFor } from '../src/relations';
import { voidDocument } from '../src/service';
import { setupWithTypes } from './helpers';

describe('createReplacementDraft', () => {
  it('legt aus einem stornierten Brief einen Entwurf mit Text, Empfänger und Bezug „ersetzt“ an', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Einladung', body: 'Liebe Mitglieder,', folder: null, links: [{ entityType: 'contact', entityId: 'C1', role: 'recipient' }] });
    if (!draft.ok) throw new Error('draft');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    if (!filed.ok) throw new Error('file');
    const notYet = await createReplacementDraft(deps, ctx, { voidedId: filed.value.id });
    expect(!notYet.ok && notYet.error.type === 'conflict' && notYet.error.code).toBe('documentNotVoided');

    await voidDocument(deps, ctx, { id: filed.value.id, reason: 'falsches Datum' });
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: filed.value.id });
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.value).toMatchObject({ phase: 'draft', typeKey: 'letter', subject: 'Einladung', draftBody: 'Liebe Mitglieder,' });
    expect(replacement.value.links).toEqual([expect.objectContaining({ entityType: 'contact', entityId: 'C1', role: 'recipient' })]);
    expect(relationsFor(deps.db, filed.value.id)).toEqual([expect.objectContaining({ kind: 'replaces', direction: 'in', otherId: replacement.value.id })]);
  });

  it('bei eingegangener Post gibt es keinen Text zu übernehmen — der Entwurf ist leer', async () => {
    const { deps, ctx } = setupWithTypes();
    const { receiveDocument } = await import('../src/incoming');
    const { pdfBytes } = await import('./helpers');
    const inbound = await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Bescheid', documentDate: '2026-09-01' });
    if (!inbound.ok) throw new Error('receive');
    await voidDocument(deps, ctx, { id: inbound.value.id, reason: 'doppelt' });
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: inbound.value.id });
    expect(replacement.ok && replacement.value.draftBody).toBe('');
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- text-read replacement`
Expected: FAIL

- [ ] **Step 3: `getDocumentText`**

In `text.ts` anfügen:

```ts
export const documentTextSchema = z.object({ documentId: z.string().min(1) });

/**
 * Was ein Agent von einem Dokument bekommt (Entscheidung 39): den erkannten
 * Text, seitenweise, oder den Grund, warum es keinen gibt. Nie die Bytes.
 */
export async function getDocumentText(
  deps: Deps,
  ctx: CallContext,
  input: unknown,
): Promise<Result<{ textStatus: string | null; textError: string | null; pages: { page: number; text: string }[] }>> {
  const denied = requirePermission(ctx, 'dms.view');
  if (denied) return denied;
  const parsed = validate(deps, documentTextSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select({ textStatus: documents.textStatus, textError: documents.textError }).from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!row) return notFound('document', parsed.value.documentId);
  const pages = row.textStatus === 'done' ? readDocumentText(deps, parsed.value.documentId) : [];
  return ok({ textStatus: row.textStatus, textError: row.textError, pages });
}
```

In `index-store.ts`:

```ts
export function readDocumentText(deps: Deps, documentId: string): { page: number; text: string }[] {
  return deps.sqlite.prepare(`SELECT page, text FROM document_text WHERE document_id = ? ORDER BY page`).all(documentId) as { page: number; text: string }[];
}
```

- [ ] **Step 4: `createReplacementDraft`**

In `drafts.ts` anfügen:

```ts
export const replacementSchema = z.object({ voidedId: z.string().min(1) });

/**
 * Nach dem Storno: derselbe Brief noch einmal, als Entwurf, mit Bezug
 * „ersetzt“. Der Text kommt aus dem eingefrorenen Eingabestand — nur bei
 * erzeugten Dokumenten; eingegangene Post hat keinen.
 */
export async function createReplacementDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DocumentRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, replacementSchema, input);
  if (!parsed.ok) return parsed;
  const old = deps.db.select().from(documents).where(eq(documents.id, parsed.value.voidedId)).get();
  if (!old) return notFound('document', parsed.value.voidedId);
  if (old.status !== 'voided') return conflict('documentNotVoided', `Dokument ${old.number ?? old.subject} ist nicht storniert`);

  const snapshot = old.inputSnapshot ? (JSON.parse(old.inputSnapshot) as { input?: { body?: string } }) : null;
  const body = old.sourceKind === 'generated' ? (snapshot?.input?.body ?? '') : '';
  const links = deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, old.id)).all().map((l) => ({ entityType: l.entityType, entityId: l.entityId, role: l.role }));

  const created = await createDraft(deps, ctx, { typeKey: old.typeKey, subject: old.subject, body, folder: old.folder, links });
  if (!created.ok) return created;
  const related = await relateDocuments(deps, ctx, { documentId: created.value.id, relatedDocumentId: old.id, kind: 'replaces' });
  if (!related.ok) return related;
  return getDocumentRecord(deps, ctx, created.value.id);
}
```

Imports in `drafts.ts` ergänzen: `relateDocuments` aus `./relations`, `getDocumentRecord` aus `./service`. Ein Zirkel `service ↔ drafts` besteht nicht (drafts importiert service, nicht umgekehrt).

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- text-read replacement`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): an agent reads the text, and a voided letter can be written again"
```

---

### Task 9: Sortierung und neue Filter

**Files:**
- Modify: `packages/modules/dms/src/service.ts` (`documentListSchema`, `listDocuments`)
- Modify: `packages/modules/contacts/src/service.ts` (`contactListSchema`, `listContacts`)
- Test: `packages/modules/dms/tests/list-order.test.ts`, `packages/modules/contacts/tests/list-order.test.ts`

**Interfaces:**
- Produces:
  - `documentListSchema.orderBy?: { field: 'number' | 'subject' | 'documentDate' | 'typeKey' | 'folder' | 'createdAt'; direction: 'asc' | 'desc' }`, `unsent?: boolean`, `relatedTo?: string`
  - `contactListSchema.orderBy?: { field: 'name' | 'kind' | 'city' | 'createdAt'; direction: 'asc' | 'desc' }`
  - `withOpenFollowUp` kommt in Task 11 (braucht die Kerntabelle).

- [ ] **Step 1: Failing Tests schreiben**

`packages/modules/dms/tests/list-order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordDispatch } from '../src/dispatch';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { relateDocuments } from '../src/relations';
import { listDocuments } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

async function issued(deps: any, ctx: any, subject: string) {
  const d = await createDraft(deps, ctx, { typeKey: 'letter', subject, body: 'x' });
  if (!d.ok) throw new Error('draft');
  const f = await fileDocument(deps, ctx, { id: d.value.id });
  if (!f.ok) throw new Error('file');
  return f.value;
}

describe('listDocuments: Sortierung und Filter', () => {
  it('sortiert nach Betreff in beide Richtungen, ohne Parameter chronologisch', async () => {
    const { deps, ctx } = setupWithTypes();
    await issued(deps, ctx, 'Zebra');
    await issued(deps, ctx, 'Apfel');
    const asc = await listDocuments(deps, ctx, { orderBy: { field: 'subject', direction: 'asc' } });
    expect(asc.ok && asc.value.documents.map((d) => d.subject)).toEqual(['Apfel', 'Zebra']);
    const desc = await listDocuments(deps, ctx, { orderBy: { field: 'subject', direction: 'desc' } });
    expect(desc.ok && desc.value.documents.map((d) => d.subject)).toEqual(['Zebra', 'Apfel']);
    const plain = await listDocuments(deps, ctx, {});
    expect(plain.ok && plain.value.documents.map((d) => d.subject)).toEqual(['Apfel', 'Zebra']); // jüngste zuerst
    const bad = await listDocuments(deps, ctx, { orderBy: { field: 'draftBody', direction: 'asc' } });
    expect(bad.ok).toBe(false);
  });

  it('„nicht versandt“ meint ausgehend, festgeschrieben, ohne Vermerk', async () => {
    const { deps, ctx } = setupWithTypes();
    const sent = await issued(deps, ctx, 'versandt');
    await recordDispatch(deps, ctx, { id: sent.id, sentAt: '2026-09-05', sentVia: 'post' });
    await issued(deps, ctx, 'liegt noch');
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Entwurf', body: 'x' });
    await receiveDocument(deps, ctx, { filename: 'a.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Eingang', documentDate: '2026-09-01' });
    const unsent = await listDocuments(deps, ctx, { unsent: true });
    expect(unsent.ok && unsent.value.documents.map((d) => d.subject)).toEqual(['liegt noch']);
  });

  it('„relatedTo“ liefert die Dokumente an beiden Enden eines Bezugs', async () => {
    const { deps, ctx } = setupWithTypes();
    const a = await issued(deps, ctx, 'a');
    const b = await issued(deps, ctx, 'b');
    await issued(deps, ctx, 'c');
    await relateDocuments(deps, ctx, { documentId: b.id, relatedDocumentId: a.id, kind: 'repliesTo' });
    const ofA = await listDocuments(deps, ctx, { relatedTo: a.id });
    expect(ofA.ok && ofA.value.documents.map((d) => d.subject)).toEqual(['b']);
    const ofB = await listDocuments(deps, ctx, { relatedTo: b.id });
    expect(ofB.ok && ofB.value.documents.map((d) => d.subject)).toEqual(['a']);
  });
});
```

`packages/modules/contacts/tests/list-order.test.ts` (Helfer wie in den vorhandenen Kontakt-Tests, z. B. `tests/service.test.ts` — dort nachsehen, wie `deps`/`ctx` gebaut werden, und denselben Aufbau verwenden):

```ts
import { describe, expect, it } from 'vitest';
import { createContact, listContacts } from '../src/service';
// setup(): deps mit coreModule + contactsModule, ctx mit contacts.view und contacts.manage — Aufbau aus tests/service.test.ts übernehmen.

describe('listContacts: Sortierung', () => {
  it('sortiert nach Name, Ort und Art in beide Richtungen', async () => {
    const { deps, ctx } = setup();
    await createContact(deps, ctx, { kind: 'person', lastName: 'Zimmer', firstName: 'Anna', city: 'Aachen' });
    await createContact(deps, ctx, { kind: 'organization', name: 'Bauhof GmbH', city: 'Zwickau' });
    await createContact(deps, ctx, { kind: 'person', lastName: 'Meier', firstName: 'Kai', city: 'Mainz' });
    const byName = await listContacts(deps, ctx, { orderBy: { field: 'name', direction: 'asc' } });
    expect(byName.ok && byName.value.contacts.map((c) => c.lastName ?? c.name)).toEqual(['Bauhof GmbH', 'Meier', 'Zimmer']);
    const byCity = await listContacts(deps, ctx, { orderBy: { field: 'city', direction: 'desc' } });
    expect(byCity.ok && byCity.value.contacts.map((c) => c.city)).toEqual(['Zwickau', 'Mainz', 'Aachen']);
    const byKind = await listContacts(deps, ctx, { orderBy: { field: 'kind', direction: 'asc' } });
    expect(byKind.ok && byKind.value.contacts[0]?.kind).toBe('organization');
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- list-order && pnpm --filter @kompass/module-contacts test -- list-order`
Expected: FAIL — `orderBy` ist unbekannt (Zod lehnt ab bzw. ignoriert, Reihenfolge stimmt nicht).

- [ ] **Step 3: `listDocuments` erweitern**

In `service.ts`, `documentListSchema`:

```ts
  orderBy: z
    .object({
      field: z.enum(['number', 'subject', 'documentDate', 'typeKey', 'folder', 'createdAt']),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  /** Ausgehend, festgeschrieben, ohne Versandvermerk. */
  unsent: z.boolean().optional(),
  /** Dokumente, die mit diesem in einem Bezug stehen — in beiden Richtungen. */
  relatedTo: z.string().min(1).optional(),
```

In `listDocuments`, nach den bestehenden Bedingungen:

```ts
  if (q.unsent) {
    conditions.push(eq(documents.direction, 'outgoing'), eq(documents.phase, 'issued'), sql`${documents.sentAt} is null`);
  }
  if (q.relatedTo) {
    const ids = new Set<string>();
    for (const r of deps.db.select().from(documentRelations).where(eq(documentRelations.documentId, q.relatedTo)).all()) ids.add(r.relatedDocumentId);
    for (const r of deps.db.select().from(documentRelations).where(eq(documentRelations.relatedDocumentId, q.relatedTo)).all()) ids.add(r.documentId);
    conditions.push(inArray(documents.id, ids.size > 0 ? [...ids] : ['__none__']));
  }
```

Die Sortierung:

```ts
  const columns = { number: documents.number, subject: documents.subject, documentDate: documents.documentDate, typeKey: documents.typeKey, folder: documents.folder, createdAt: documents.createdAt } as const;
  // Ohne Parameter bleibt es chronologisch (Entscheidung 31); mit Parameter
  // bricht die Nummer Gleichstände, damit die Reihenfolge stabil bleibt.
  const order = q.orderBy
    ? [q.orderBy.direction === 'asc' ? asc(columns[q.orderBy.field]) : desc(columns[q.orderBy.field]), desc(documents.number)]
    : [desc(documents.createdAt), desc(documents.number)];
  const rows = deps.db.select().from(documents).where(where).orderBy(...order).limit(q.limit).offset(q.offset).all();
```

Import `asc` aus `drizzle-orm` und `documentRelations` aus `./schema`.

- [ ] **Step 4: `listContacts` erweitern**

In `packages/modules/contacts/src/service.ts`, `contactListSchema`:

```ts
  orderBy: z.object({ field: z.enum(['name', 'kind', 'city', 'createdAt']), direction: z.enum(['asc', 'desc']) }).optional(),
```

In `listContacts`, die Zeile mit `.orderBy(desc(contacts.createdAt))`:

```ts
  // „Name“ ist bei Personen der Nachname, bei Organisationen der Name — sortiert
  // wird über das, was in der Liste steht, nicht über zwei Spalten getrennt.
  const nameKey = sql`lower(coalesce(${contacts.lastName}, ${contacts.name}, ''))`;
  const columns = { name: nameKey, kind: contacts.kind, city: contacts.city, createdAt: contacts.createdAt } as const;
  const order = q.orderBy
    ? [q.orderBy.direction === 'asc' ? asc(columns[q.orderBy.field]) : desc(columns[q.orderBy.field]), desc(contacts.createdAt)]
    : [desc(contacts.createdAt)];
  const rows = deps.db.select({ id: contacts.id }).from(contacts).where(where).orderBy(...order).limit(q.limit).offset(q.offset).all();
```

Imports `asc`, `sql` aus `drizzle-orm` prüfen.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/module-contacts test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms packages/modules/contacts
git commit -m "feat(dms,contacts): lists that sort by a column, and two ways to ask the file"
```

---

### Task 10: Seed

**Files:**
- Modify: `packages/modules/dms/src/seed.ts`
- Modify: `packages/modules/dms/tests/seed.test.ts`

- [ ] **Step 1: Failing Test schreiben**

Anhängen an `packages/modules/dms/tests/seed.test.ts`:

```ts
  it('bringt je Neuerung ein Beispiel: Antwort, Versand, Notiz, Bausteine', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const { documentNotes, documentRelations, documentSnippets } = await import('../src/schema');
    expect(deps.db.select().from(documentRelations).all().some((r) => r.kind === 'repliesTo')).toBe(true);
    expect(deps.db.select().from(documents).all().some((d) => d.sentAt !== null && d.sentVia === 'post')).toBe(true);
    expect(deps.db.select().from(documents).all().some((d) => d.direction === 'outgoing' && d.phase === 'issued' && d.sentAt === null)).toBe(true);
    expect(deps.db.select().from(documentNotes).all().length).toBeGreaterThan(0);
    expect(deps.db.select().from(documentSnippets).all().map((s) => s.name).sort()).toEqual(['Bitte um Rückmeldung', 'Grußformel']);
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documentSnippets).all()).toHaveLength(2);
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- seed`
Expected: FAIL

- [ ] **Step 3: Seed erweitern**

In `seed.ts`, nach dem Block „3. Eingangsdokument“ (das Ergebnis von `receiveDocument` in `const inbound = unwrap(…)` fassen; der festgeschriebene Brief steht in `draft`/`filed`):

```ts
  // 4. Der Eingang antwortet auf den Brief; der Brief ist per Post raus.
  unwrap(await relateDocuments(deps, ctx, { documentId: inbound.id, relatedDocumentId: draft.id, kind: 'repliesTo' }));
  unwrap(await recordDispatch(deps, ctx, { id: draft.id, sentAt: '2026-02-12', sentVia: 'post', note: 'mit Anmeldeformular' }));

  // 4b. Ein zweiter Brief, festgeschrieben und **nicht** versandt — die Liste
  // soll beides zeigen (Plan 3 prüft die Markierung „nicht versandt“).
  const thanks = unwrap(await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Dankschreiben an die Tierarztpraxis', body: 'Vielen Dank für die kurzfristige Behandlung.', documentDate: '2026-03-02', links }));
  unwrap(await fileDocument(deps, ctx, { id: thanks.id }));

  // 5. Eine Notiz am Eingang.
  unwrap(await addNote(deps, ctx, { documentId: inbound.id, body: 'Bescheid liegt im Original im Ordner Behörden, Fach 3.' }));

  // 6. Zwei Bausteine, je Schlüssel, damit ein zweiter Lauf nichts verdoppelt.
  for (const snippet of [
    { name: 'Grußformel', body: 'Mit freundlichen Grüßen\n\nDer Vorstand' },
    { name: 'Bitte um Rückmeldung', subject: 'Bitte um Rückmeldung', body: 'wir bitten um Ihre Rückmeldung bis zum genannten Termin.' },
  ]) {
    const exists = deps.db.select().from(documentSnippets).where(eq(documentSnippets.name, snippet.name)).get();
    if (!exists) unwrap(await createSnippet(deps, ctx, snippet));
  }
```

Der Seed prüft am Anfang `if (existing.length > 0) return;` über Dokumente — die Bausteine liegen danach; deshalb die Schlüsselprüfung dort. `documentDate` des Briefs ist das Seed-Datum (`isoNow`), `sentAt: '2026-02-12'` muss **nach** dem Dokumentdatum liegen: den Brief mit `documentDate: '2026-02-10'` anlegen. Imports: `relateDocuments`, `recordDispatch`, `addNote`, `createSnippet`, `documentSnippets`.

Die Wiedervorlagen des Seeds kommen in Task 11.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test -- seed`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): the seed shows an answer, a dispatch, a note and two text blocks"
```

---

### Task 11: Wiedervorlagen an der Akte, Aufräumen beim Löschen, Filter

**Voraussetzung:** Plan 1, Task 2 und 3 sind umgesetzt (`createFollowUp`, `listFollowUps`, `deleteFollowUpsFor`, `followUpTargets`).

**Files:**
- Create: `packages/modules/dms/src/follow-ups.ts`
- Modify: `packages/modules/dms/src/manifest.ts` (`followUpTargets`), `service.ts` (`toRecord.followUps`, `deleteDocument`, Filter `withOpenFollowUp`), `drafts.ts` (`deleteDraft`), `seed.ts`, `index.ts`
- Test: `packages/modules/dms/tests/follow-ups.test.ts`

**Interfaces:**
- Produces:
  - `createDocumentFollowUp(deps, ctx, { documentId, dueAt, title, assigneeUserId? })` → `Result<FollowUpRecord>`; prüft `dms.create` und die Existenz des Dokuments, ruft dann `createFollowUp` (Recht `followUps.manage` prüft der Kern)
  - `dmsFollowUpTargets(deps, entityType, id): FollowUpTarget | null`
  - `DocumentRecord.followUps: FollowUpRecord[]` (offene und erledigte)
  - `documentListSchema.withOpenFollowUp?: boolean`

- [ ] **Step 1: Failing Test schreiben**

`packages/modules/dms/tests/follow-ups.test.ts`:

```ts
import { schema } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDraft, deleteDraft } from '../src/drafts';
import { createDocumentFollowUp, dmsFollowUpTargets } from '../src/follow-ups';
import { getDocumentRecord, listDocuments } from '../src/service';
import { ALL_DMS, fileFixture, setupWithTypes } from './helpers';

const WITH_FOLLOW_UPS = [...ALL_DMS, 'followUps.view', 'followUps.manage'];

describe('Wiedervorlage am Dokument', () => {
  it('legt sie am Dokument an, das Dokument zeigt sie, die Liste filtert danach', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const letter = await fileFixture(deps, ctx);
    await fileFixture(deps, ctx);
    const created = await createDocumentFollowUp(deps, ctx, { documentId: letter.id, dueAt: '2026-09-20', title: 'Antwort abwarten' });
    expect(created.ok && created.value.entityType).toBe('document');
    const record = await getDocumentRecord(deps, ctx, letter.id);
    expect(record.ok && record.value.followUps.map((f) => f.title)).toEqual(['Antwort abwarten']);
    const open = await listDocuments(deps, ctx, { withOpenFollowUp: true });
    expect(open.ok && open.value.documents.map((d) => d.id)).toEqual([letter.id]);
  });

  it('prüft das Dokument und das Recht der Akte, bevor der Kern zum Zug kommt', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const ghost = await createDocumentFollowUp(deps, ctx, { documentId: 'NOPE', dueAt: '2026-09-20', title: 'x' });
    expect(!ghost.ok && ghost.error.type).toBe('notFound');
    const letter = await fileFixture(deps, ctx);
    const noDms = await createDocumentFollowUp(deps, ctxWith(['followUps.manage'], userId), { documentId: letter.id, dueAt: '2026-09-20', title: 'x' });
    expect(!noDms.ok && noDms.error.type === 'forbidden' && noDms.error.permission).toBe('dms.create');
    const noCore = await createDocumentFollowUp(deps, ctxWith(ALL_DMS, userId), { documentId: letter.id, dueAt: '2026-09-20', title: 'x' });
    expect(!noCore.ok && noCore.error.type === 'forbidden' && noCore.error.permission).toBe('followUps.manage');
  });

  it('beschriftet die Entität für die Startseite', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const letter = await fileFixture(deps, ctx);
    expect(dmsFollowUpTargets(deps, 'document', letter.id)).toEqual({ label: `${letter.number} · Fixture`, href: `/dms/${letter.id}` });
    expect(dmsFollowUpTargets(deps, 'contact', 'C1')).toBeNull();
    expect(dmsFollowUpTargets(deps, 'document', 'NOPE')).toBeNull();
  });

  it('Verwerfen eines Entwurfs räumt seine Wiedervorlagen weg, auch erledigte', async () => {
    const { deps, userId } = setupWithTypes();
    const ctx = ctxWith(WITH_FOLLOW_UPS, userId);
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y' });
    if (!draft.ok) throw new Error('draft');
    const a = await createDocumentFollowUp(deps, ctx, { documentId: draft.value.id, dueAt: '2026-09-20', title: 'a' });
    await createDocumentFollowUp(deps, ctx, { documentId: draft.value.id, dueAt: '2026-09-21', title: 'b' });
    if (!a.ok) throw new Error('follow-up');
    const { completeFollowUp } = await import('@kompass/core');
    await completeFollowUp(deps, ctx, { id: a.value.id });
    await deleteDraft(deps, ctx, { id: draft.value.id });
    expect(deps.db.select().from(schema.followUps).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- follow-ups`
Expected: FAIL

- [ ] **Step 3: Wrapper und Haken**

`packages/modules/dms/src/follow-ups.ts`:

```ts
import { createFollowUp, notFound, requirePermission, validate, type CallContext, type Deps, type FollowUpRecord, type FollowUpTarget, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from './schema';

export const documentFollowUpSchema = z.object({
  documentId: z.string().min(1),
  dueAt: z.string().date(),
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().trim().min(1).nullable().optional(),
});

/**
 * Der Kern prüft die Entität nicht (Plan 1). Hier steht die Prüfung, die er
 * nicht leisten kann: Gibt es das Dokument, und darf der Aufrufer in der
 * Akte schreiben. Danach gilt das Recht des Kerns.
 */
export async function createDocumentFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'dms.create');
  if (denied) return denied;
  const parsed = validate(deps, documentFollowUpSchema, input);
  if (!parsed.ok) return parsed;
  const doc = deps.db.select({ id: documents.id }).from(documents).where(eq(documents.id, parsed.value.documentId)).get();
  if (!doc) return notFound('document', parsed.value.documentId);
  const { documentId, ...rest } = parsed.value;
  return createFollowUp(deps, ctx, { entityType: 'document', entityId: documentId, ...rest });
}

export function dmsFollowUpTargets(deps: Deps, entityType: string, id: string): FollowUpTarget | null {
  if (entityType !== 'document') return null;
  const doc = deps.db.select({ number: documents.number, subject: documents.subject }).from(documents).where(eq(documents.id, id)).get();
  if (!doc) return null;
  return { label: doc.number ? `${doc.number} · ${doc.subject}` : doc.subject, href: `/dms/${id}` };
}
```

`manifest.ts`: `followUpTargets: dmsFollowUpTargets,`. `index.ts`: `export * from './follow-ups';`

- [ ] **Step 4: `toRecord`, Filter, Aufräumen**

`service.ts`:

- `DocumentRecord.followUps: FollowUpRecord[]`; in `toRecord`: `followUps: dbOrTx.select().from(schema.followUps).where(and(eq(schema.followUps.entityType, 'document'), eq(schema.followUps.entityId, row.id))).orderBy(asc(schema.followUps.dueAt)).all()` (`schema` aus `@kompass/core`). Ein direkter Lesezugriff ohne Rechteprüfung, weil die Akte ihre eigenen Anhängsel liest — wer das Dokument sehen darf, sieht seine Wiedervorlagen.
- `documentListSchema.withOpenFollowUp: z.boolean().optional()`; Bedingung:

```ts
  if (q.withOpenFollowUp) {
    conditions.push(sql`${documents.id} IN (SELECT entity_id FROM follow_ups WHERE entity_type = 'document' AND done_at IS NULL)`);
  }
```

- `deleteDocument`, in der Transaktion vor dem Löschen der Zeile:

```ts
    const removed = {
      relations: deleteRelationsFor(tx, doc.id),
      notes: deleteNotesFor(tx, doc.id),
      followUps: deleteFollowUpsFor(tx, 'document', doc.id),
    };
```

und `removed` ins `before` des Protokolleintrags (`…, removed`). `deleteDraft` in `drafts.ts` genauso (Protokoll `before: { subject, typeKey, removed }`). `deleteFollowUpsFor` aus `@kompass/core`.

- [ ] **Step 5: Seed**

In `seed.ts`, nach den Bausteinen:

```ts
  // 7. Eine offene und eine erledigte Wiedervorlage am Brief.
  const open = unwrap(await createDocumentFollowUp(deps, ctx, { documentId: draft.id, dueAt: addDays(deps, 5), title: 'Antwort abwarten' }));
  const done = unwrap(await createDocumentFollowUp(deps, ctx, { documentId: draft.id, dueAt: addDays(deps, -3), title: 'Unterlagen beilegen' }));
  unwrap(await completeFollowUp(deps, ctx, { id: done.id }));
  void open;
```

mit

```ts
const addDays = (deps: Deps, days: number) => new Date(deps.clock.now().getTime() + days * 86_400_000).toISOString().slice(0, 10);
```

Der Seed-Kontext trägt alle Rechte (`seedDevelopment` gibt `permissionKeys` der Registry mit) — `followUps.manage` ist dabei, sobald Plan 1 die Rechte im Kern führt. Im `seed.test.ts` der Akte den `ctx` um `'followUps.view', 'followUps.manage'` erweitern.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-dms test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): a follow-up on a document, and nothing left behind when the document goes"
```

---

### Task 12: MCP-Werkzeuge und der mechanische Paritätstest

**Voraussetzung:** Plan 1, Task 3 (`McpToolDefinition.service`) und Task 5 (Kernwerkzeuge mit `service`).

**Files:**
- Modify: `packages/modules/dms/src/mcp-tools.ts` (neu geschrieben)
- Modify: `packages/modules/dms/src/service.ts` (`getDocumentRecord` bleibt; `getDocument` bleibt für die Routen)
- Modify: `packages/modules/contacts/src/mcp-tools.ts`, `packages/modules/animals/src/mcp-tools.ts`, `packages/modules/site/src/mcp-tools.ts` (nur `service:` ergänzen)
- Modify: `apps/kompass/tests/mcp-tools.test.ts`
- Test: `packages/modules/dms/tests/mcp-tools.test.ts`

**Interfaces:**
- Produces: die Werkzeugliste aus Spec § 6.

- [ ] **Step 1: Failing Tests schreiben**

`packages/modules/dms/tests/mcp-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';
import { fileFixture, setupWithTypes } from './helpers';

const tool = (name: string) => {
  const found = DMS_MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('DMS-Werkzeuge', () => {
  it('dms_get liefert Metadaten, Bezüge und Notizen — keine Bytes', async () => {
    const { deps, ctx } = setupWithTypes();
    const letter = await fileFixture(deps, ctx);
    const res = await tool('dms_get').handler(deps, ctx, { id: letter.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const value = res.value as Record<string, unknown>;
    expect(value).not.toHaveProperty('bytes');
    expect(value).toHaveProperty('relations');
    expect(value).toHaveProperty('notes');
    expect(value).toHaveProperty('sentAt');
  });

  it('dms_receive kennt kein assetId mehr', () => {
    const schema = tool('dms_receive').inputSchema.safeParse({ filename: 'a.pdf', typeKey: 'authority', subject: 's', documentDate: '2026-09-01', assetId: 'X' });
    expect(schema.success).toBe(false);
  });

  it('jedes Werkzeug nennt seinen Service, und die neuen sind da', () => {
    const names = DMS_MCP_TOOLS.map((t) => t.name);
    for (const expected of ['dms_text', 'dms_unlink', 'dms_relate', 'dms_unrelate', 'dms_dispatch', 'dms_dispatch_clear', 'dms_add_note', 'dms_delete_note', 'dms_snippets', 'dms_create_snippet', 'dms_update_snippet', 'dms_delete_snippet', 'dms_folders', 'dms_create_folder', 'dms_delete_folder', 'dms_rules', 'dms_create_rule', 'dms_update_rule', 'dms_delete_rule', 'dms_create_type', 'dms_update_type', 'dms_create_replacement', 'dms_create_follow_up']) {
      expect(names, expected).toContain(expected);
    }
    expect(names).not.toContain('dms_manage_types');
    expect(DMS_MCP_TOOLS.filter((t) => typeof t.service !== 'function').map((t) => t.name)).toEqual([]);
  });
});
```

In `apps/kompass/tests/mcp-tools.test.ts` einen neuen Block anfügen:

```ts
import * as animalsPkg from '@kompass/module-animals';
import * as contactsPkg from '@kompass/module-contacts';
import * as dmsPkg from '@kompass/module-dms';
import * as sitePkg from '@kompass/module-site';

/**
 * Was ein Service ist, entscheidet die Signatur, nicht eine Liste: eine
 * exportierte Funktion, deren erste zwei Parameter `deps` und `ctx` heißen.
 * Jede muss von einem Werkzeug als `service` genannt werden — sonst ist sie
 * über MCP unerreichbar, und Prinzip 8 („ein Weg zu den Daten“) ist verletzt.
 */
const SERVICE_SIGNATURE = /^(?:async\s+)?function\s+\w+\s*\(\s*deps\s*,\s*ctx\b/;

/** Services, die bewusst ohne Werkzeug bleiben — jeder mit Grund. */
const WITHOUT_TOOL: Record<string, string> = {
  'dms.deleteDocument': 'Löschung nach Fristablauf bestätigt ein Mensch (Entscheidung 10).',
  'dms.previewDraft': 'Liefert Bytes; ein Agent liest den Volltext (Entscheidung 39).',
  'dms.getDocument': 'Liefert Bytes; dms_get ruft getDocumentRecord.',
  'dms.extractDocumentText': 'Innenleben des Workers; dms_reindex stößt es an.',
  'dms.previewNextNumber': 'Ein Hinweis in der Oberfläche, kein Vorgang.',
  'dms.countUnreadDocuments': 'Ein Zähler für die Verwaltungsseite.',
  'dms.countDocumentsByFolder': 'Die Zahlen neben den Ordnern; die Liste selbst ist dms_list.',
  'contacts.deleteContact': 'Löschung personenbezogener Daten bestätigt ein Mensch.',
};

const servicesOf = (moduleKey: string, pkg: Record<string, unknown>) =>
  Object.entries(pkg)
    .filter(([, value]) => typeof value === 'function' && SERVICE_SIGNATURE.test((value as Function).toString()))
    .map(([name, fn]) => ({ key: `${moduleKey}.${name}`, fn: fn as Function }));

describe('every service has a tool', () => {
  const packages: [string, Record<string, unknown>][] = [['contacts', contactsPkg], ['animals', animalsPkg], ['site', sitePkg], ['dms', dmsPkg]];
  const named = new Set(registeredTools.map((tool) => tool.service).filter((s): s is Function => typeof s === 'function'));

  it('names every module service from a tool, or explains why not', () => {
    const uncovered = packages.flatMap(([key, pkg]) => servicesOf(key, pkg).filter(({ key, fn }) => !named.has(fn) && !(key in WITHOUT_TOOL)).map(({ key }) => key));
    expect(uncovered).toEqual([]);
  });

  it('keeps the exception list honest: every listed service exists and has no tool', () => {
    const all = new Map(packages.flatMap(([key, pkg]) => servicesOf(key, pkg).map(({ key, fn }) => [key, fn] as const)));
    for (const key of Object.keys(WITHOUT_TOOL)) {
      expect(all.has(key), `${key} gibt es nicht mehr`).toBe(true);
      expect(named.has(all.get(key)!), `${key} hat inzwischen ein Werkzeug — aus der Liste nehmen`).toBe(false);
    }
  });

  it('finds a module service without a tool', () => {
    const fake = { async orphan(deps: unknown, ctx: unknown) { void deps; void ctx; } };
    expect(servicesOf('fake', fake).map((s) => s.key)).toEqual(['fake.orphan']);
  });
});
```

Der Kern bleibt beim Rechte-Test: Seine Exporte umfassen Auth, Setup, Backup und Rendering, die aus guten Gründen nicht über MCP laufen; eine Ausnahmeliste dafür wäre länger als die Werkzeugliste. Das steht als Kommentar über dem Block.

Läuft der Test rot mit Services, die hier nicht vorgesehen sind (etwa in `contacts`, `animals`, `site`), gilt: Entweder das Werkzeug fehlt tatsächlich — dann ergänzen, mit `service:` — oder es ist bewusst keines da — dann in `WITHOUT_TOOL` mit einem Grund eintragen. Beides ist eine Entscheidung, die im Diff sichtbar wird.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/module-dms test -- mcp-tools && pnpm --filter @kompass/app test -- mcp-tools`
Expected: FAIL — Werkzeuge fehlen, `service` fehlt überall.

- [ ] **Step 3: `mcp-tools.ts` der Akte neu schreiben**

`packages/modules/dms/src/mcp-tools.ts`:

```ts
import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  createDocumentFolder, createDocumentRule, createDocumentType, deleteDocumentFolder, deleteDocumentRule, documentFolderCreateSchema, documentFolderDeleteSchema,
  documentRuleCreateSchema, documentRuleDeleteSchema, documentRuleListSchema, documentRuleUpdateSchema, documentTypeCreateSchema, documentTypeListSchema, documentTypeUpdateSchema,
  listDocumentFolders, listDocumentRules, listDocumentTypes, updateDocumentRule, updateDocumentType,
} from './catalog';
import { suggestClassification, suggestSchema } from './classification';
import { clearDispatch, dispatchClearSchema, dispatchSchema, recordDispatch } from './dispatch';
import { createDraft, createReplacementDraft, deleteDraft, draftCreateSchema, draftUpdateSchema, fileDocument, replacementSchema, updateDraft } from './drafts';
import { createDocumentFollowUp, documentFollowUpSchema } from './follow-ups';
import { receiveDocument, receiveSchema } from './incoming';
import { addNote, deleteNote, noteAddSchema, noteIdSchema } from './notes';
import { relateDocuments, relateSchema, unrelateDocuments, unrelateSchema } from './relations';
import { documentListSchema, getDocumentRecord, linkDocument, linkSchema, listDocuments, moveDocument, moveDocumentSchema, unlinkDocument, unlinkSchema, voidDocument } from './service';
import { createSnippet, deleteSnippet, listSnippets, snippetCreateSchema, snippetIdSchema, snippetListSchema, snippetUpdateSchema, updateSnippet } from './snippets';
import { documentTextSchema, getDocumentText, reindexAllDocuments } from './text';

const t = <T>(def: McpToolDefinition<T>): McpToolDefinition => def as McpToolDefinition;
const voidSchema = z.object({ id: z.string().min(1), reason: z.string().trim().min(1).max(300) });
const idSchema = z.object({ id: z.string().min(1) });

export const DMS_MCP_TOOLS: McpToolDefinition[] = [
  // Lesen
  t({ name: 'dms_list', description: 'List and search documents in the file. Filters by direction, type, folder, phase, linked entity, relatedTo (another document), unsent (outgoing, filed, no dispatch note) and withOpenFollowUp; orderBy sorts by a column. The text filter searches subject, number and the recognised full text and returns the passage with its page for every full-text hit; terms shorter than three characters do not reach the full text. Requires dms.view.', inputSchema: documentListSchema, handler: (deps, ctx, args) => listDocuments(deps, ctx, args), service: listDocuments }),
  t({ name: 'dms_get', description: 'Read one document: metadata, links to contacts/animals/projects, relations to other documents, dispatch note, notes and follow-ups. Never the file itself — use dms_text for its content. Requires dms.view.', inputSchema: idSchema, handler: (deps, ctx, { id }) => getDocumentRecord(deps, ctx, id), service: getDocumentRecord }),
  t({ name: 'dms_text', description: 'Read the recognised full text of a document, page by page, or the state of recognition and why there is none yet. Requires dms.view.', inputSchema: documentTextSchema, handler: (deps, ctx, args) => getDocumentText(deps, ctx, args), service: getDocumentText }),
  t({ name: 'dms_types', description: 'List the document types with their number prefix and retention class. Requires dms.view.', inputSchema: documentTypeListSchema, handler: (deps, ctx, args) => listDocumentTypes(deps, ctx, args), service: listDocumentTypes }),
  t({ name: 'dms_folders', description: 'List the folders of the subject tree. Requires dms.view.', inputSchema: z.object({}), handler: (deps, ctx) => listDocumentFolders(deps, ctx), service: listDocumentFolders }),
  t({ name: 'dms_rules', description: 'List the filing rules that pre-fill the receive form. Requires dms.view.', inputSchema: documentRuleListSchema, handler: (deps, ctx, args) => listDocumentRules(deps, ctx, args), service: listDocumentRules }),
  t({ name: 'dms_snippets', description: 'List the text blocks available in the letter editor. Requires dms.view.', inputSchema: snippetListSchema, handler: (deps, ctx, args) => listSnippets(deps, ctx, args), service: listSnippets }),
  t({ name: 'dms_suggest_classification', description: 'Suggest type, folder and document date for a file about to be filed. Reads only, files nothing. Requires dms.view.', inputSchema: suggestSchema, handler: (deps, ctx, args) => suggestClassification(deps, ctx, args), service: suggestClassification }),

  // Entwurf und Ablage
  t({ name: 'dms_create_draft', description: 'Create an outgoing draft with subject, markdown body and links. Requires dms.create.', inputSchema: draftCreateSchema, handler: (deps, ctx, args) => createDraft(deps, ctx, args), service: createDraft }),
  t({ name: 'dms_update_draft', description: 'Change a draft that has not been filed yet. Requires dms.create.', inputSchema: draftUpdateSchema, handler: (deps, ctx, args) => updateDraft(deps, ctx, args), service: updateDraft }),
  t({ name: 'dms_file', description: 'File a draft: draw the number, render the pdf, freeze it. Requires dms.file.', inputSchema: idSchema, handler: (deps, ctx, args) => fileDocument(deps, ctx, args), service: fileDocument }),
  t({ name: 'dms_delete_draft', description: 'Throw away a draft. Requires dms.deleteDraft.', inputSchema: idSchema, handler: (deps, ctx, args) => deleteDraft(deps, ctx, args), service: deleteDraft }),
  t({ name: 'dms_receive', description: 'File an incoming pdf from a base64 payload with type, subject, document date, folder and links. Requires dms.create.', inputSchema: receiveSchema, handler: (deps, ctx, args) => receiveDocument(deps, ctx, args), service: receiveDocument }),
  t({ name: 'dms_void', description: 'Void a filed document with a reason. The number stays taken. Requires dms.void.', inputSchema: voidSchema, handler: (deps, ctx, args) => voidDocument(deps, ctx, args), service: voidDocument }),
  t({ name: 'dms_create_replacement', description: 'After voiding: create a new draft from a voided document with its subject, body and recipient, related as "replaces". Requires dms.create.', inputSchema: replacementSchema, handler: (deps, ctx, args) => createReplacementDraft(deps, ctx, args), service: createReplacementDraft }),
  t({ name: 'dms_move', description: 'Move a document into a folder of the subject tree (null = inbox). Requires dms.create.', inputSchema: moveDocumentSchema, handler: (deps, ctx, args) => moveDocument(deps, ctx, args), service: moveDocument }),

  // Bezüge
  t({ name: 'dms_link', description: 'Link a document to a contact, animal or project with a role. Requires dms.create.', inputSchema: linkSchema, handler: (deps, ctx, args) => linkDocument(deps, ctx, args), service: linkDocument }),
  t({ name: 'dms_unlink', description: 'Remove a link between a document and a contact, animal or project. Requires dms.create.', inputSchema: unlinkSchema, handler: (deps, ctx, args) => unlinkDocument(deps, ctx, args), service: unlinkDocument }),
  t({ name: 'dms_relate', description: 'Relate two documents: repliesTo, signedCopyOf, replaces or attachmentOf, read from documentId towards relatedDocumentId. Requires dms.create.', inputSchema: relateSchema, handler: (deps, ctx, args) => relateDocuments(deps, ctx, args), service: relateDocuments }),
  t({ name: 'dms_unrelate', description: 'Remove a relation between two documents. Requires dms.create.', inputSchema: unrelateSchema, handler: (deps, ctx, args) => unrelateDocuments(deps, ctx, args), service: unrelateDocuments }),

  // Versand, Notizen, Wiedervorlage
  t({ name: 'dms_dispatch', description: 'Record that a filed outgoing document was sent: date, channel key from the dms.dispatchChannels setting, optional note. Replaces an earlier note, audited with before and after. Requires dms.create.', inputSchema: dispatchSchema, handler: (deps, ctx, args) => recordDispatch(deps, ctx, args), service: recordDispatch }),
  t({ name: 'dms_dispatch_clear', description: 'Remove the dispatch note from a document. Requires dms.create.', inputSchema: dispatchClearSchema, handler: (deps, ctx, args) => clearDispatch(deps, ctx, args), service: clearDispatch }),
  t({ name: 'dms_add_note', description: 'Append a note to a document (working material, never part of the document). Requires dms.create.', inputSchema: noteAddSchema, handler: (deps, ctx, args) => addNote(deps, ctx, args), service: addNote }),
  t({ name: 'dms_delete_note', description: 'Delete a note: your own with dms.create, anyone\'s with dms.manage.', inputSchema: noteIdSchema, handler: (deps, ctx, args) => deleteNote(deps, ctx, args), service: deleteNote }),
  t({ name: 'dms_create_follow_up', description: 'Create a follow-up on a document: due date, title, optional assignee. Requires dms.create and followUps.manage.', inputSchema: documentFollowUpSchema, handler: (deps, ctx, args) => createDocumentFollowUp(deps, ctx, args), service: createDocumentFollowUp }),

  // Stammdaten
  t({ name: 'dms_create_type', description: 'Create a document type with prefix, direction and retention class. Requires dms.manage.', inputSchema: documentTypeCreateSchema, handler: (deps, ctx, args) => createDocumentType(deps, ctx, args), service: createDocumentType }),
  t({ name: 'dms_update_type', description: 'Change a document type (label, direction, retention class, default folder, active, order). Requires dms.manage.', inputSchema: documentTypeUpdateSchema, handler: (deps, ctx, args) => updateDocumentType(deps, ctx, args), service: updateDocumentType }),
  t({ name: 'dms_create_folder', description: 'Create a folder in the subject tree. Requires dms.manage.', inputSchema: documentFolderCreateSchema, handler: (deps, ctx, args) => createDocumentFolder(deps, ctx, args), service: createDocumentFolder }),
  t({ name: 'dms_delete_folder', description: 'Delete an empty folder. Requires dms.manage.', inputSchema: documentFolderDeleteSchema, handler: (deps, ctx, args) => deleteDocumentFolder(deps, ctx, args), service: deleteDocumentFolder }),
  t({ name: 'dms_create_rule', description: 'Create a filing rule. Requires dms.manage.', inputSchema: documentRuleCreateSchema, handler: (deps, ctx, args) => createDocumentRule(deps, ctx, args), service: createDocumentRule }),
  t({ name: 'dms_update_rule', description: 'Change a filing rule. Requires dms.manage.', inputSchema: documentRuleUpdateSchema, handler: (deps, ctx, args) => updateDocumentRule(deps, ctx, args), service: updateDocumentRule }),
  t({ name: 'dms_delete_rule', description: 'Delete a filing rule. Requires dms.manage.', inputSchema: documentRuleDeleteSchema, handler: (deps, ctx, args) => deleteDocumentRule(deps, ctx, args), service: deleteDocumentRule }),
  t({ name: 'dms_create_snippet', description: 'Create a text block for the letter editor. Requires dms.manage.', inputSchema: snippetCreateSchema, handler: (deps, ctx, args) => createSnippet(deps, ctx, args), service: createSnippet }),
  t({ name: 'dms_update_snippet', description: 'Change a text block. Requires dms.manage.', inputSchema: snippetUpdateSchema, handler: (deps, ctx, args) => updateSnippet(deps, ctx, args), service: updateSnippet }),
  t({ name: 'dms_delete_snippet', description: 'Delete a text block. Requires dms.manage.', inputSchema: snippetIdSchema, handler: (deps, ctx, args) => deleteSnippet(deps, ctx, args), service: deleteSnippet }),
  t({ name: 'dms_reindex', description: 'Queue every filed document to be read again. The full text is recognised in the background, one document at a time. Requires dms.manage.', inputSchema: z.object({}), handler: (deps, ctx) => reindexAllDocuments(deps, ctx), service: reindexAllDocuments }),
];
```

Voraussetzungen im Modul: `moveDocumentSchema` und `documentFolderDeleteSchema` sind exportiert (sind es); `receiveSchema` verliert in `incoming.ts` das Feld `assetId` und den `refine` — es bleibt `contentBase64: z.string().min(1)` als Pflichtfeld; im Service-Schema `receiveDocumentSchema` ebenso (`bytes` oder `contentBase64`, genau eines).

Werkzeug `dms_get` ruft `getDocumentRecord` — das liefert Metadaten samt `links`, `relations`, `notes`, `followUps` und den drei Versandspalten (Task 4, 6, 11).

- [ ] **Step 4: `service:` an den Werkzeugen der anderen Module**

In `packages/modules/contacts/src/mcp-tools.ts`, `animals/src/mcp-tools.ts`, `site/src/mcp-tools.ts`: jedem Werkzeug `service: <Funktion, die der Handler ruft>` geben. Das Muster ist überall gleich: Der Handler ruft genau einen Service; der wird als Referenz eingetragen.

- [ ] **Step 5: Tests laufen lassen und die Ausnahmeliste ehrlich machen**

Run: `pnpm --filter @kompass/module-dms test -- mcp-tools && pnpm --filter @kompass/app test -- mcp-tools`

Erwartung beim ersten Lauf: Der Test `names every module service from a tool` nennt Services aus `contacts`, `animals` oder `site`, die kein Werkzeug haben. Für jeden entscheiden: Werkzeug ergänzen (mit `service:`) oder in `WITHOUT_TOOL` eintragen, mit einem Satz Begründung. Dann grün.

Expected danach: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules apps/kompass/tests/mcp-tools.test.ts
git commit -m "feat(dms): every service has a tool, and a test that reads the exports to prove it"
```

---

### Task 13: Abschluss

- [ ] **Step 1: Alles grün**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 2: Spec-Abgleich**

In `docs/superpowers/specs/2026-09-12-akte-fertig-design.md`, § 5.2, den Punkt zu `allocateDocumentNumber` ergänzen: „In `fileDocument` bleibt eine Schleife, aber aus einem anderen Grund: Das PDF trägt die Nummer, also wird sie angesehen, gerendert, und in der Transaktion gezogen; weicht die gezogene ab, wird zurückgerollt und neu gerendert. `receiveDocument` kommt ohne Schleife aus.“

```bash
git add docs/superpowers/specs/2026-09-12-akte-fertig-design.md
git commit -m "docs(dms): why filing still loops, and receiving does not"
```

---

## Self-Review

**Spec-Abdeckung.** § 4.2–4.6 Schema: Task 1. § 4.3 Einstellung der Versandwege: Task 1 und 5. § 5.2 Korrekturen (Phase, Ordner, Zähler): Task 2 und 3. § 5.3 Bezüge und Ersatz: Task 4 und 8. § 5.4 Versand: Task 5. § 5.5 Notizen: Task 6. § 5.6 Bausteine: Task 7. § 5.7 Volltext: Task 8. § 5.8 Sortierung und Filter: Task 9 (`withOpenFollowUp` in Task 11). § 6 MCP samt Parität: Task 12. § 9 Seed: Task 10 und 11. Aufräumen beim Löschen (§ 4.2): Task 4, 6, 11. Oberfläche und Startseite: Plan 3 und 4.

**Platzhalter.** Die „wie bisher“-Stellen in Task 2 (Insert-Werte, Links, Audit) stehen im heutigen Code an derselben Stelle und ändern nur die Herkunft von `number`; Task 4 in Plan 1 und `service:`-Ergänzungen in Task 12 folgen einer genannten Regel.

**Typen.** `DocumentRecord` wächst in Task 4 (`relations`), 6 (`notes`), 11 (`followUps`); `toRecord(deps, row, dbOrTx)` behält die Signatur. `resolveFolder(db, folder, fallback): Result<string | null>` wird in Task 3 überall gleich benutzt. `DispatchChannel` aus `install.ts` wird in `dispatch.ts` importiert. `deleteFollowUpsFor(tx, 'document', id)` entspricht Plan 1 Task 2.

## Nachtrag zur Ausführung (2026-09-12)

Vier Stellen standen im Plan anders, als sie beim Bauen trugen. Sie stehen
hier, weil die nächste Person sonst denselben Umweg geht.

**1. `tx.rollback()` gibt es auf `DbOrTx` nicht.** Der Typ vereint Datenbank
und Transaktion; `rollback` kennt nur die zweite. In `fileDocument` bricht
jetzt eine eigene Fehlerklasse `NumberMovedOn` die Transaktion ab, und der
`catch` fängt diese Klasse — nicht eine Fehlermeldung, die Drizzle ändern
könnte.

**2. Der Versand-Test in Task 5 war unhaltbar.** Er vermerkte nachträglich
den `2026-09-04`, das Fixture-Dokument trägt aber `documentDate` `2026-09-05`
(`TEST_NOW`); der frühere Versand wurde zu Recht abgewiesen — der Test hatte
die Regel verletzt, die er prüfen sollte. Er baut sich jetzt einen Brief mit
Datum `2026-09-01`.

**3. Der Selbsttest des Paritätstests fand nichts.** `{ async orphan(deps,
ctx) {} }` ist Methodenkurzschrift; ihr `toString()` beginnt mit `async
orphan(`, nicht mit `function`. Der Beweis, dass die Regex greift, ist jetzt
eine echte Funktionsdeklaration.

**4. Die Sammlungs-Werkzeuge der Webseite entstehen erst mit Template.**
`site.mcpTools` ist eine Funktion von `deps`; ohne eingelesenes Template gibt
es keine Sammlungen und damit keine Werkzeuge für `createEntry`,
`updateEntry`, `deleteEntry` und ihre Nachbarn. Der Test baut sich eine zweite
Registry mit gesetztem `siteTemplateState`, damit diese sieben Services als
das gezählt werden, was sie sind: Services mit Werkzeug. Ohne diesen Schritt
hätte die Ausnahmeliste sie verdeckt.

**Ausnahmeliste `WITHOUT_TOOL`, Stand nach Task 12:** die sechs der Akte aus
dem Plan, dazu `countDocumentsByFolder`; die `seed*`-Funktionen aller Module
(Beispieldaten der Entwicklung, nie über MCP); `contacts.deleteContact`
(Entscheidung 12 der Kontakte-Spec); `site.applySeed` (Entscheidung 4 der
Site-Seed-Spec: kein MCP-Werkzeug); `site.previewTemplateSync` und
`site.recordPublish` (Innenleben von `site_template_sync` und
`site_publish`). Offen geblieben: `site.listPublishes`, ein reiner
Lesezugriff auf den Veröffentlichungsverlauf — siehe die Entscheidung unten.

**Kleineres:** `tests/mcp-tools.test.ts` der Akte gab es schon, der neue
Block wurde angehängt; `tests/incoming.test.ts` behauptete die Abweisung von
`contentBase64 + assetId` und zog mit dem Wegfall von `assetId` mit;
`deps.clock` ist im Test ein `FixedClock` mit `set(...)`, kein Objekt zum
Ersetzen.
