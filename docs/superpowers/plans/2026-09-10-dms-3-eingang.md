# DMS 3 — Eingang, Klassifikation und Fristen (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eingegangene Post lässt sich ablegen, einsortieren und verknüpfen — und ein festgeschriebenes Dokument verschwindet erst, wenn seine Aufbewahrung abgelaufen ist und ein Mensch es bestätigt.

**Architecture:** Der Eingang ist derselbe Datensatz wie der Ausgang, nur ohne Entwurfsphase (Entscheidung 5). Der Eingangskorb ist kein Zustand, sondern `folder IS NULL` (Entscheidung 20). Die Einsortierhilfe schlägt vor und legt nie ab (Entscheidung 19): `suggestClassification` ist rein lesend und ändert nichts. Die Fristen hängen an der Dokumentart und werden über dieselben beiden Manifest-Haken beantwortet, die die Kontakte-Runde eingeführt hat.

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-dokumente-und-korrespondenz-design.md` (§ 6.2 Eingang, § 6.3 Lesen und Ordnen, § 6.5 Löschen und Fristen)

## Global Constraints

- Code Englisch, Oberflächentexte über i18n. Kein hartcodierter UI-Text (`AGENTS.md`, Prinzip 7).
- IDs über `newId()` (ULID). Zeit über `deps.clock.now()` bzw. `isoNow(deps.clock)`.
- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` → `ok`.
- Pro Service mindestens vier Tests: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Abgeleitete Werte werden berechnet, nie gespeichert (Prinzip 5). Es gibt kein Feld `deleteAfter`.
- Fristbeginn ist der Ablauf des Kalenderjahres (§ 147 Abs. 4 AO) — dafür gibt es `retentionEnd` im Kern.
- Die Manifest-Haken prüfen **keine** Rechte; sie sind synchron und nur lesend, wie `mediaReferences`.
- Keine Löschfunktion ohne Eintrag in `DELETION_POLICY`.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

**Voraussetzung:** Plan 2 (`2026-09-10-dms-2-entwurf.md`) ist abgeschlossen. Die Testhelfer `setupWithTypes()`, `pdfBytes()` und `fileFixture()` stehen in `packages/modules/dms/tests/helpers.ts` (Plan 2, Task 2).

---

### Task 1: Eingegangene Post ablegen

**Files:**
- Create: `packages/modules/dms/src/incoming.ts`
- Test: `packages/modules/dms/tests/incoming.test.ts`

**Interfaces:**
- Consumes: `storeMediaInternal` aus `@kompass/core`, `documentTypeFor` (Plan 2), `nextDocumentNumber` (Plan 1)
- Produces: `receiveDocument(deps, ctx, input) → Result<DocumentRecord>` (Recht `dms.create`) mit
  `{ filename: string; bytes: Uint8Array; typeKey: string; subject: string; documentDate: string; folder?: string | null; links?: {...}[] }`

- [ ] **Step 1: Failing Tests schreiben**

```ts
describe('receiveDocument', () => {
  it('legt die Datei ab und schreibt sofort fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'bescheid.pdf', bytes: pdfBytes(), typeKey: 'authority',
      subject: 'Freistellungsbescheid', documentDate: '2026-03-14',
    });
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(received.value.phase).toBe('issued');
    expect(received.value.direction).toBe('incoming');
    expect(received.value.sourceKind).toBe('uploaded');
    expect(received.value.number).toMatch(/^BEH-\d{4}-\d{3}$/);
    expect(received.value.assetId).not.toBeNull();
    expect(received.value.draftBody).toBeNull();
    expect(received.value.templateKey).toBeNull();
  });

  it('landet ohne Ordner im Eingangskorb', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' });
    if (!received.ok) return;
    expect(received.value.folder).toBeNull();
  });

  it('nimmt das Datum auf dem Dokument, nicht das von heute', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2024-01-02' });
    if (!received.ok) return;
    expect(received.value.documentDate).toBe('2024-01-02');
  });

  it('verlangt ein gültiges Datum', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '14.03.2026' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('validation');
  });

  it('verlangt dms.create', async () => {
    const { deps } = setupWithTypes();
    const denied = await receiveDocument(deps, deps.testing.contextWithout('dms.create'), { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' });
    expect(denied.ok).toBe(false);
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' });
    expect(deps.testing.auditActions()).toContain('dms.receive');
  });
});
```

`pdfBytes()` liefert ein minimales, gültiges PDF (`%PDF-1.4\n…`); die Mediathek prüft den MIME-Typ, also muss `application/pdf` durchgehen. Der vorhandene Helfer in `packages/core/tests/media.test.ts` zeigt das Muster.

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- incoming`
Expected: FAIL

- [ ] **Step 3: Eingang schreiben**

`receiveDocument`: Art laden (`notFound` wenn unbekannt), Datei über `storeMediaInternal` in den Dokumentordner legen, Nummer aus dem Präfix der Art ziehen (dieselbe Wiederholungsschleife wie `fileDocument`), Zeile mit `phase: 'issued'`, `direction: 'incoming'`, `sourceKind: 'uploaded'`, `templateKey: null`, `inputSnapshot: null`, `folder` aus Eingabe oder `defaultFolder` der Art oder `null` anlegen, Links schreiben, `recordAudit` mit `dms.receive`.

Zulässige MIME-Typen sind die der Mediathek; ein abgelehnter Typ kommt als `validation`-Fehler zurück und wird nicht abgefangen.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- incoming`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): incoming post is filed as it arrives"
```

---

### Task 2: Ordner, Einsortieren und Bezüge

**Files:**
- Modify: `packages/modules/dms/src/catalog.ts` (Ordner)
- Modify: `packages/modules/dms/src/service.ts` (`moveDocument`, `linkDocument`, `unlinkDocument`)
- Modify: `packages/core/src/deletion-policy.ts`
- Test: `packages/modules/dms/tests/folders.test.ts`, `packages/modules/dms/tests/links.test.ts`

**Interfaces:**
- Consumes: `documentFolders`, `documentLinks` (Plan 1)
- Produces:
  - `createDocumentFolder(deps, ctx, { path }) → Result<DocumentFolderRow>` (Recht `dms.manage`)
  - `listDocumentFolders(deps, ctx) → Result<DocumentFolderRow[]>` (Recht `dms.view`)
  - `deleteDocumentFolder(deps, ctx, { path }) → Result<null>` (Recht `dms.manage`, nur wenn leer)
  - `moveDocument(deps, ctx, { id, folder }) → Result<DocumentRecord>` (Recht `dms.create`)
  - `linkInputSchema` = `{ entityType: string; entityId: string; role: 'sender'|'recipient'|'about' }`; `linkSchema` = `linkInputSchema` plus `documentId`
  - `linkDocument(deps, ctx, input: linkSchema) → Result<DocumentLinkRow>` (Recht `dms.create`)
  - `unlinkDocument(deps, ctx, { id }) → Result<null>` (Recht `dms.create`)

- [ ] **Step 1: Failing Tests schreiben**

```ts
describe('folders', () => {
  it('legt einen Ordner an und normalisiert den Pfad', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDocumentFolder(deps, ctx, { path: '/Behoerden/Finanzamt/' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path).toBe('Behoerden/Finanzamt');
  });

  it('löscht einen Ordner nur, wenn er leer ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const received = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14', folder: 'behoerden' });
    if (!received.ok) throw new Error('setup');
    const blocked = await deleteDocumentFolder(deps, ctx, { path: 'behoerden' });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.kind).toBe('conflict');
  });

  it('verlangt dms.manage', async () => {
    const { deps } = setupWithTypes();
    const denied = await createDocumentFolder(deps, deps.testing.contextWithout('dms.manage'), { path: 'x' });
    expect(denied.ok).toBe(false);
  });
});

describe('moveDocument', () => {
  it('holt ein Dokument aus dem Eingangskorb', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const received = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' });
    if (!received.ok) throw new Error('setup');
    const moved = await moveDocument(deps, ctx, { id: received.value.id, folder: 'behoerden' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.folder).toBe('behoerden');
    expect(deps.testing.auditActions()).toContain('dms.move');
  });

  it('lehnt einen unbekannten Ordner ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' });
    if (!received.ok) throw new Error('setup');
    const result = await moveDocument(deps, ctx, { id: received.value.id, folder: 'gibtsnicht' });
    expect(result.ok).toBe(false);
  });
});

describe('links', () => {
  it('verknüpft dasselbe Dokument mit Empfänger und Betreff-Entität', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    const a = await linkDocument(deps, ctx, { documentId: doc.id, entityType: 'contact', entityId: 'c-1', role: 'recipient' });
    const b = await linkDocument(deps, ctx, { documentId: doc.id, entityType: 'animal', entityId: 'a-1', role: 'about' });
    expect(a.ok && b.ok).toBe(true);
  });

  it('legt denselben Bezug nicht doppelt an', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await fileFixture(deps, ctx);
    await linkDocument(deps, ctx, { documentId: doc.id, entityType: 'contact', entityId: 'c-1', role: 'recipient' });
    const again = await linkDocument(deps, ctx, { documentId: doc.id, entityType: 'contact', entityId: 'c-1', role: 'recipient' });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.kind).toBe('conflict');
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- folders links`
Expected: FAIL

- [ ] **Step 3: Ordner und Bezüge schreiben**

Pfadnormalisierung wie in `packages/core/src/media/folders.ts` — die dortige Funktion als Vorlage nehmen und nicht neu erfinden (führende und schließende Schrägstriche weg, Mehrfachschrägstriche zusammenziehen, keine `..`-Segmente). `deleteDocumentFolder` lehnt mit `conflict('folderNotEmpty', …)` ab, solange Dokumente oder Unterordner darin liegen. `linkDocument` fängt den Unique-Index ab und antwortet `conflict('linkExists', …)`.

- [ ] **Step 4: Löschpolitik ergänzen**

```ts
  {
    entity: 'documentFolder',
    deletable: true,
    reason: 'Nur Ordnung, kein Nachweis — wie ein Ordner der Mediathek.',
    guard: 'nur wenn leer (keine Dokumente, keine Unterordner)',
    auditAction: 'dms.folder.delete',
  },
  {
    entity: 'documentLink',
    deletable: true,
    reason: 'Ein Bezug ist eine Zuordnung, kein Vorgang. Falsch gesetzte Bezüge müssen korrigierbar sein.',
    guard: 'keiner',
    auditAction: 'dms.unlink',
  },
```

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/core test -- deletion`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms packages/core/src/deletion-policy.ts
git commit -m "feat(dms): subject tree and entity links, both optional on their own"
```

---

### Task 3: Arten und Regeln verwalten

**Files:**
- Modify: `packages/modules/dms/src/catalog.ts`
- Test: `packages/modules/dms/tests/catalog.test.ts`

**Interfaces:**
- Produces:
  - `createDocumentType`, `updateDocumentType` (Recht `dms.manage`) — `key` und `prefix` sind nach dem Anlegen unveränderlich, weil vergebene Nummern sonst ihren Bezug verlören; `isActive: false` ist der Weg, eine Art stillzulegen
  - `createDocumentRule`, `updateDocumentRule`, `deleteDocumentRule` (Recht `dms.manage`)
  - `listDocumentRules(deps, ctx) → Result<DocumentRuleRow[]>` (Recht `dms.view`)

- [ ] **Step 1: Failing Tests schreiben**

```ts
it('legt eine Art mit dreistelligem Präfix an', async () => {
  const { deps, ctx } = setupWithTypes();
  const created = await createDocumentType(deps, ctx, { key: 'donation-receipt', label: 'Zuwendungsbestätigung', prefix: 'ZUW', defaultDirection: 'outgoing', retentionClass: 'statutory10Y' });
  expect(created.ok).toBe(true);
});

it('lehnt ein Präfix ab, das nicht aus drei Großbuchstaben besteht', async () => {
  const { deps, ctx } = setupWithTypes();
  const result = await createDocumentType(deps, ctx, { key: 'x', label: 'X', prefix: 'Zu', defaultDirection: 'outgoing', retentionClass: 'consent' });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('validation');
});

it('lässt das Präfix einer bestehenden Art nicht ändern', async () => {
  const { deps, ctx } = setupWithTypes();
  const result = await updateDocumentType(deps, ctx, { key: 'letter', label: 'Anschreiben' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.prefix).toBe('BRF');
});

it('stellt eine Art still, statt sie zu löschen', async () => {
  const { deps, ctx } = setupWithTypes();
  const result = await updateDocumentType(deps, ctx, { key: 'letter', isActive: false });
  expect(result.ok).toBe(true);
  const active = await listDocumentTypes(deps, ctx, {});
  if (!active.ok) return;
  expect(active.value.map((t) => t.key)).not.toContain('letter');
});

it('verlangt dms.manage für Regeln', async () => {
  const { deps } = setupWithTypes();
  const denied = await createDocumentRule(deps, deps.testing.contextWithout('dms.manage'), { matchField: 'filename', matchContains: 'Finanzamt', thenTypeKey: 'authority' });
  expect(denied.ok).toBe(false);
});
```

Es gibt bewusst kein `deleteDocumentType`: Eine Art, auf die Dokumente verweisen, würde deren Nummer und Frist entwurzeln. Stilllegen genügt — deshalb steht sie auch nicht in `DELETION_POLICY`.

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- catalog`
Expected: FAIL

- [ ] **Step 3: Verwaltung schreiben**

```ts
export const documentTypeCreateSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(120),
  prefix: z.string().trim().regex(/^[A-Z]{3}$/),
  defaultDirection: z.enum(['outgoing', 'incoming']),
  retentionClass: z.enum(['permanent', 'statutory10Y', 'statutory6Y', 'consent']),
  defaultFolder: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const documentTypeUpdateSchema = z.object({
  key: z.string().min(1),
  label: z.string().trim().min(1).max(120).optional(),
  defaultDirection: z.enum(['outgoing', 'incoming']).optional(),
  retentionClass: z.enum(['permanent', 'statutory10Y', 'statutory6Y', 'consent']).optional(),
  defaultFolder: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
```

Regelservices analog, `matchContains` mit `.min(2)`, damit eine Regel nicht auf jeden Dateinamen passt. `deleteDocumentRule` bekommt einen Eintrag in `DELETION_POLICY` (`entity: 'documentRule'`, `reason: 'Eine Regel ist Bedienkomfort, kein Nachweis.'`, `auditAction: 'dms.rule.delete'`).

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- catalog && pnpm --filter @kompass/core test -- deletion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms packages/core/src/deletion-policy.ts
git commit -m "feat(dms): document types and rules as configurable master data"
```

---

### Task 4: Einsortierhilfe

**Files:**
- Create: `packages/modules/dms/src/classification.ts`
- Test: `packages/modules/dms/tests/classification.test.ts`

**Interfaces:**
- Produces:
  - `suggestSchema` = `{ filename: string; senderEntityType?: string; senderEntityId?: string }`
  - `suggestClassification(deps, ctx, input) → Result<Suggestion>` (Recht `dms.view`, rein lesend)
  - `Suggestion = { typeKey: string | null; folder: string | null; documentDate: string | null; matchedRuleId: string | null }`
  - `dateFromFilename(filename: string): string | null` — reine Funktion

- [ ] **Step 1: Failing Tests schreiben**

```ts
describe('dateFromFilename', () => {
  it('erkennt ein ISO-Datum am Anfang', () => {
    expect(dateFromFilename('2026-03-14 Finanzamt.pdf')).toBe('2026-03-14');
  });

  it('erkennt ein deutsches Datum', () => {
    expect(dateFromFilename('Bescheid 14.03.2026.pdf')).toBe('2026-03-14');
  });

  it('gibt null zurück, wenn keins drinsteht', () => {
    expect(dateFromFilename('scan001.pdf')).toBeNull();
  });

  it('erfindet kein Datum aus einer Zahlenkette', () => {
    expect(dateFromFilename('IMG_20260314_120000.jpg')).toBeNull();
  });
});

describe('suggestClassification', () => {
  it('wendet die erste passende Regel an', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const rule = await createDocumentRule(deps, ctx, { matchField: 'filename', matchContains: 'Finanzamt', thenTypeKey: 'authority', thenFolder: 'behoerden' });
    if (!rule.ok) throw new Error('setup');
    const suggestion = await suggestClassification(deps, ctx, { filename: '2026-03-14 Finanzamt Bescheid.pdf' });
    expect(suggestion.ok).toBe(true);
    if (!suggestion.ok) return;
    expect(suggestion.value.typeKey).toBe('authority');
    expect(suggestion.value.folder).toBe('behoerden');
    expect(suggestion.value.documentDate).toBe('2026-03-14');
    expect(suggestion.value.matchedRuleId).toBe(rule.value.id);
  });

  it('schlägt die zuletzt für diesen Absender benutzte Art vor', async () => {
    const { deps, ctx } = setupWithTypes();
    const earlier = await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2026-01-01', links: [{ entityType: 'contact', entityId: 'c-9', role: 'sender' }] });
    if (!earlier.ok) throw new Error('setup');
    const suggestion = await suggestClassification(deps, ctx, { filename: 'neu.pdf', senderEntityType: 'contact', senderEntityId: 'c-9' });
    if (!suggestion.ok) return;
    expect(suggestion.value.typeKey).toBe('invoice');
  });

  it('legt nichts ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const before = deps.db.select().from(documents).all().length;
    await suggestClassification(deps, ctx, { filename: 'x.pdf' });
    expect(deps.db.select().from(documents).all().length).toBe(before);
  });

  it('verlangt dms.view', async () => {
    const { deps } = setupWithTypes();
    const denied = await suggestClassification(deps, deps.testing.contextWithout('dms.view'), { filename: 'x.pdf' });
    expect(denied.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- classification`
Expected: FAIL

- [ ] **Step 3: Vorschläge schreiben**

`dateFromFilename` erkennt genau zwei Formen und sonst nichts: `\b(\d{4})-(\d{2})-(\d{2})\b` und `\b(\d{2})\.(\d{2})\.(\d{4})\b`. Ein Treffer wird auf Gültigkeit geprüft (Monat 1–12, Tag 1–31), sonst `null`. Zahlenketten ohne Trennzeichen bleiben absichtlich unerkannt — ein falsches Datum ist schlechter als keines.

Rangfolge in `suggestClassification`: erste aktive Regel nach `sortOrder`, die auf `filename` oder den Namen des Absenderkontakts passt; sonst die Art des letzten Dokuments desselben Absenders; sonst `null`. Der Ordner kommt aus der Regel, sonst aus `defaultFolder` der vorgeschlagenen Art. Keine Schreibvorgänge, kein Audit-Eintrag — ein Vorschlag ist kein Vorgang.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- classification`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): classification suggestions that fill the form and never file"
```

---

### Task 5: Fristen und Löschen

**Files:**
- Create: `packages/modules/dms/src/retention.ts`
- Modify: `packages/modules/dms/src/manifest.ts`, `packages/modules/dms/src/service.ts`
- Modify: `packages/core/src/deletion-policy.ts`
- Test: `packages/modules/dms/tests/retention.test.ts`, `packages/modules/dms/tests/delete.test.ts`

**Interfaces:**
- Consumes: `retentionMonths`, `retentionEnd`, `holdsFor`, `dueUntil` aus `@kompass/core`
- Produces:
  - `dmsRetentionHolds(deps, entityType, id): RetentionHold[]` — für `entityType === 'contact'`, `'animal'`, jede verknüpfte Entität: jedes verknüpfte, festgeschriebene Dokument hält sie
  - `dmsRetentionDue(deps): DueItem[]` — festgeschriebene Dokumente, deren eigene Frist abgelaufen ist
  - `deleteDocument(deps, ctx, { id }) → Result<null>` (Recht `dms.manage`)

- [ ] **Step 1: Failing Tests schreiben**

```ts
describe('dmsRetentionHolds', () => {
  it('nennt das haltende Dokument beim Namen', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'v.pdf', bytes: pdfBytes(), typeKey: 'contract', subject: 'Vertrag', documentDate: '2026-03-14',
      links: [{ entityType: 'contact', entityId: 'c-1', role: 'sender' }],
    });
    if (!doc.ok) throw new Error('setup');
    const holds = dmsRetentionHolds(deps, 'contact', 'c-1');
    expect(holds).toHaveLength(1);
    expect(holds[0].label).toContain(doc.value.number as string);
    expect(holds[0].until).toBe('2036-12-31'); // 10 Jahre ab Ablauf des Kalenderjahres 2026
  });

  it('hält nichts über einen Entwurf', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDraft(deps, ctx, { typeKey: 'letter', subject: 'x', body: 'y', links: [{ entityType: 'contact', entityId: 'c-2', role: 'recipient' }] });
    expect(dmsRetentionHolds(deps, 'contact', 'c-2')).toHaveLength(0);
  });

  it('hält dauerhaft, wenn die Art permanent ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, { filename: 'p.pdf', bytes: pdfBytes(), typeKey: 'minutes', subject: 'Protokoll', documentDate: '2020-01-01', links: [{ entityType: 'contact', entityId: 'c-3', role: 'about' }] });
    expect(dmsRetentionHolds(deps, 'contact', 'c-3')[0].until).toBeNull();
  });
});

describe('dmsRetentionDue', () => {
  it('führt ein Dokument auf, dessen Frist abgelaufen ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alte Rechnung', documentDate: '2005-06-01' });
    const due = dmsRetentionDue(deps);
    expect(due).toHaveLength(1);
    expect(due[0].entity).toBe('document');
  });

  it('führt nichts auf, was noch läuft', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, { filename: 'neu.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Neue Rechnung', documentDate: '2026-01-01' });
    expect(dmsRetentionDue(deps)).toHaveLength(0);
  });
});

describe('deleteDocument', () => {
  it('lehnt ab, solange die Frist läuft', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, { filename: 'neu.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Neu', documentDate: '2026-01-01' });
    if (!doc.ok) throw new Error('setup');
    const result = await deleteDocument(deps, ctx, { id: doc.value.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('conflict');
  });

  it('löscht, wenn die Frist abgelaufen ist — samt Datei und Bezügen', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01' });
    if (!doc.ok) throw new Error('setup');
    const result = await deleteDocument(deps, ctx, { id: doc.value.id });
    expect(result.ok).toBe(true);
    expect(deps.db.select().from(documents).all()).toHaveLength(0);
    expect(deps.db.select().from(documentLinks).all()).toHaveLength(0);
    expect(deps.testing.auditActions()).toContain('dms.delete');
  });

  it('verlangt dms.manage', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, { filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01' });
    if (!doc.ok) throw new Error('setup');
    const denied = await deleteDocument(deps, deps.testing.contextWithout('dms.manage'), { id: doc.value.id });
    expect(denied.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- retention delete`
Expected: FAIL

- [ ] **Step 3: Fristen schreiben**

`dmsRetentionHolds` liest die Links der gefragten Entität, lädt zu jedem das Dokument, überspringt `phase !== 'issued'`, holt die Fristklasse aus der Dokumentart und rechnet mit `retentionEnd(documentDate, retentionMonths(deps, cls))`. `permanent` ⇒ `until: null`. Label: `Dokument ${number}`. `entity: 'document'`, `id` des Dokuments.

`dmsRetentionDue` geht über alle festgeschriebenen Dokumente, rechnet ihre eigene Frist und nimmt auf, was vor heute abgelaufen ist. Der Fristenbildschirm des Kerns sammelt das über `collectRetentionDue` ohne weiteres Zutun.

Im Manifest `retentionHolds: dmsRetentionHolds`, `retentionDue: dmsRetentionDue` und `mediaReferences` ergänzen — letzteres meldet die `assetId` eines Dokuments, damit die Mediathek eine Datei nicht löscht, an der eine Akte hängt:

```ts
mediaReferences: (deps, assetId) =>
  deps.db.select().from(documents).where(eq(documents.assetId, assetId)).all()
    .map((row) => ({ label: `Dokument ${row.number ?? row.subject}`, entity: 'document', id: row.id })),
```

`deleteDocument` prüft `dms.manage`, rechnet die eigene Frist, lehnt mit `conflict('retentionRunning', …)` ab, solange sie läuft, und löscht sonst in einer Transaktion Links und Zeile, danach das Asset über den Medienservice, mit `recordAudit` (`dms.delete`, Vorher-Stand im Eintrag).

- [ ] **Step 4: Löschpolitik ergänzen**

```ts
  {
    entity: 'document',
    deletable: true,
    reason:
      'Personenbezogene Daten sind nach Wegfall des Zwecks zu löschen (DSGVO Art. 17). Die Aufbewahrungsfrist sticht diese Pflicht, solange sie läuft (Entscheidung 10).',
    guard: 'Erst nach Ablauf der Frist der Dokumentart, gerechnet ab Ablauf des Kalenderjahres von documentDate. Ein Mensch bestätigt jede Löschung.',
    auditAction: 'dms.delete',
    retentionClass: 'statutory10Y',
  },
```

Der Eintrag nennt `statutory10Y` als längste in der Praxis vorkommende Klasse; maßgeblich ist die Klasse an der Dokumentart. Diesen Satz als Kommentar dazuschreiben, damit der Test in `packages/core/tests/deletion-policy.test.ts` nicht als Widerspruch gelesen wird.

- [ ] **Step 5: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/core test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/modules/dms packages/core/src/deletion-policy.ts
git commit -m "feat(dms): retention holds, due dates and deletion only after the period ends"
```

---

## Abschluss

- [ ] `pnpm typecheck && pnpm test`
- [ ] Plan 4 (`2026-09-10-dms-4-oberflaeche.md`) beginnen
