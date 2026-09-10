# DMS 4 — Oberfläche, MCP und Seed (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Akte ist im Browser bedienbar — Brief entwerfen, Vorschau lesen, festschreiben, Post ablegen und einsortieren — und ein Agent kann über MCP dasselbe.

**Architecture:** Liste, Detailseite und Entwurfsbildschirm nach dem Muster des Kontaktmoduls (`page.tsx`, `[id]/`, `actions.ts`). Die Oberfläche ruft ausschließlich die Services aus den Plänen 2 und 3 — keine Fachlogik in der Server Action (Prinzip 8). Die MCP-Werkzeuge sind dieselben Aufrufe mit demselben Zod-Schema.

**Tech Stack:** Next.js (App Router, Server Actions), shadcn/ui, next-intl, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-dokumente-und-korrespondenz-design.md` (§ 7 Rechte und MCP, § 8 Oberfläche, § 9 Tests, § 10 Seed)

## Global Constraints

- **Lies vor jeder Änderung an `apps/kompass` die passende Anleitung unter `apps/kompass/node_modules/next/dist/docs/`.** Diese Next-Fassung weicht von verbreiteten Mustern ab; `apps/kompass/AGENTS.md` verlangt das ausdrücklich.
- Kein hartcodierter UI-Text. Alles über `apps/kompass/messages/de.json`, Sie-Form.
- Kein Farbliteral in `apps/kompass/src` — `apps/kompass/tests/no-color-literals.test.ts` scannt darauf. Nur Theme-Tokens.
- Keine vereinsspezifischen Inhalte — `apps/kompass/tests/no-association-content.test.ts` muss grün bleiben. Beispielnamen sind erfunden.
- Rechteprüfung serverseitig; die Oberfläche blendet nur aus, was ohnehin abgelehnt würde.
- Zu jedem Permission-Key gehört mindestens ein MCP-Werkzeug, das ihn in seiner Beschreibung nennt; Ausnahmen stehen begründet in `apps/kompass/tests/mcp-tools.test.ts`.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test. Auf UI-Ebene ist der rote Test der Playwright-Lauf.

**Voraussetzung:** Plan 3 (`2026-09-10-dms-3-eingang.md`) ist abgeschlossen.

---

### Task 1: MCP-Werkzeuge

**Files:**
- Create: `packages/modules/dms/src/mcp-tools.ts`
- Modify: `packages/modules/dms/src/manifest.ts`
- Test: `packages/modules/dms/tests/mcp-tools.test.ts`, `apps/kompass/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: alle Services aus Plan 2 und 3
- Produces: `DMS_MCP_TOOLS: McpToolDefinition[]`

- [ ] **Step 1: Failing Test schreiben**

```ts
import { describe, expect, it } from 'vitest';
import { DMS_MCP_TOOLS } from '../src/mcp-tools';
import { dmsModule } from '../src/manifest';

describe('dms mcp tools', () => {
  it('nennt zu jedem Recht mindestens ein Werkzeug', () => {
    for (const permission of dmsModule.permissions) {
      const named = DMS_MCP_TOOLS.filter((tool) => tool.description.includes(permission));
      expect(named.length, `kein Werkzeug nennt ${permission}`).toBeGreaterThan(0);
    }
  });

  it('zeigt echte Schemata, kein any', () => {
    for (const tool of DMS_MCP_TOOLS) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.name).toMatch(/^dms_[a-z_]+$/);
    }
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- mcp-tools`
Expected: FAIL

- [ ] **Step 3: Werkzeuge schreiben**

Nach dem Muster von `packages/modules/contacts/src/mcp-tools.ts` (Helfer `t(name, description, inputSchema, handler)`):

```ts
export const DMS_MCP_TOOLS: McpToolDefinition[] = [
  t('dms_list', 'List documents in the file, filtered by direction, type, folder, phase or linked entity. Requires dms.view.', documentListSchema, (deps, ctx, args) => listDocuments(deps, ctx, args)),
  t('dms_get', 'Read one document with its metadata and links. Requires dms.view.', z.object({ id: z.string() }), (deps, ctx, args) => getDocument(deps, ctx, (args as { id: string }).id)),
  t('dms_types', 'List the document types with their number prefix and retention class. Requires dms.view.', documentTypeListSchema, (deps, ctx, args) => listDocumentTypes(deps, ctx, args)),
  t('dms_suggest_classification', 'Suggest type, folder and document date for a file about to be filed. Reads only, files nothing. Requires dms.view.', suggestSchema, (deps, ctx, args) => suggestClassification(deps, ctx, args)),
  t('dms_create_draft', 'Create an outgoing draft with subject, markdown body and links. Requires dms.create.', draftCreateSchema, (deps, ctx, args) => createDraft(deps, ctx, args)),
  t('dms_update_draft', 'Change a draft that has not been filed yet. Requires dms.create.', draftUpdateSchema, (deps, ctx, args) => updateDraft(deps, ctx, args)),
  t('dms_receive', 'File an incoming document from a base64 payload or an existing asset. Requires dms.create.', receiveSchema, (deps, ctx, args) => receiveDocument(deps, ctx, args)),
  t('dms_move', 'Move a document into a folder of the subject tree. Requires dms.create.', z.object({ id: z.string(), folder: z.string().nullable() }), (deps, ctx, args) => moveDocument(deps, ctx, args)),
  t('dms_link', 'Link a document to a contact, animal or project with a role. Requires dms.create.', linkSchema, (deps, ctx, args) => linkDocument(deps, ctx, args)),
  t('dms_file', 'File a draft: assign the number, render the pdf, freeze it. Requires dms.file.', z.object({ id: z.string() }), (deps, ctx, args) => fileDocument(deps, ctx, args)),
  t('dms_void', 'Void a filed document with a reason. The number stays taken. Requires dms.void.', voidSchema, (deps, ctx, args) => voidDocument(deps, ctx, args)),
  t('dms_delete_draft', 'Throw away a draft. Requires dms.deleteDraft.', z.object({ id: z.string() }), (deps, ctx, args) => deleteDraft(deps, ctx, args)),
  t('dms_manage_types', 'Create or change a document type. Requires dms.manage.', documentTypeCreateSchema, (deps, ctx, args) => createDocumentType(deps, ctx, args)),
];
```

`receiveSchema` erweitert die Eingabe von `receiveDocument` um den Agentenweg:

```ts
export const receiveSchema = z.object({
  filename: z.string().trim().min(1),
  /** Entweder die Bytes als Base64 oder ein bereits abgelegtes Asset. */
  contentBase64: z.string().optional(),
  assetId: z.string().optional(),
  typeKey: z.string().min(1),
  subject: z.string().trim().min(1).max(300),
  documentDate: z.string().date(),
  folder: z.string().trim().min(1).nullable().optional(),
  links: z.array(linkInputSchema).default([]),
}).refine((value) => Boolean(value.contentBase64) !== Boolean(value.assetId), {
  message: 'entweder contentBase64 oder assetId',
});
```

Der Service nimmt beides entgegen; bei `assetId` entfällt das Ablegen und die vorhandene Prüfsumme gilt.

`dms_delete_document` gibt es bewusst **nicht**: Eine Löschung nach Fristablauf bestätigt ein Mensch am Fristenbildschirm (Entscheidung 10). In `apps/kompass/tests/mcp-tools.test.ts` die Ausnahme für `dms.manage` → `deleteDocument` mit genau dieser Begründung eintragen.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test && pnpm --filter @kompass/app test -- mcp-tools`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms apps/kompass/tests/mcp-tools.test.ts
git commit -m "feat(dms): mcp tools for every permission, deletion left to a human"
```

---

### Task 2: Seed

**Files:**
- Create: `packages/modules/dms/src/seed.ts`
- Modify: `packages/modules/dms/src/manifest.ts`
- Test: `packages/modules/dms/tests/seed.test.ts`

**Interfaces:**
- Produces: `seedDms(deps, ctx): Promise<void>`

- [ ] **Step 1: Failing Test schreiben**

```ts
describe('seedDms', () => {
  it('legt Arten, Ordner und Beispieldokumente an', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documentTypes).all().length).toBeGreaterThanOrEqual(5);
    expect(deps.db.select().from(documentFolders).all().length).toBeGreaterThan(0);
    const docs = deps.db.select().from(documents).all();
    expect(docs.some((d) => d.phase === 'draft')).toBe(true);
    expect(docs.some((d) => d.phase === 'issued' && d.direction === 'outgoing')).toBe(true);
    expect(docs.some((d) => d.direction === 'incoming' && d.folder === null)).toBe(true);
  });

  it('läuft zweimal, ohne zu verdoppeln', async () => {
    const { deps, ctx } = setup();
    await seedDms(deps, ctx);
    const after = deps.db.select().from(documents).all().length;
    await seedDms(deps, ctx);
    expect(deps.db.select().from(documents).all().length).toBe(after);
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/module-dms test -- seed`
Expected: FAIL

- [ ] **Step 3: Seed schreiben**

Nach dem Muster von `packages/modules/contacts/src/seed.ts`: sofort zurückkehren, wenn schon Zeilen da sind. Inhalt: die `DEFAULT_DOCUMENT_TYPES`, ein Ordnerbaum (`behoerden`, `behoerden/finanzamt`, `vertraege`, `protokolle`), ein Entwurf, ein festgeschriebener Brief an einen Seed-Kontakt, ein Eingangsdokument im Korb, eine Regel (`filename` enthält `Finanzamt` → Art `authority`, Ordner `behoerden/finanzamt`).

Alle Namen und Texte sind frei erfunden — `no-association-content.test.ts` prüft das. Für das Eingangsdokument ein kleines, im Code erzeugtes PDF verwenden, keine Datei aus dem Repo.

- [ ] **Step 4: Tests grün sehen**

Run: `pnpm --filter @kompass/module-dms test -- seed`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/modules/dms
git commit -m "feat(dms): invented example file for development"
```

---

### Task 3: Liste und Eingangskorb

**Files:**
- Create: `apps/kompass/src/app/(shell)/dms/page.tsx`, `document-list.tsx`, `actions.ts`
- Delete: `apps/kompass/src/app/(shell)/admin/documents/` bis auf `bases-panel.tsx` (dieses nach `admin/documents/page.tsx` als reine Basisübersicht zurechtstutzen)
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Consumes: `listDocuments`, `listDocumentTypes`, `listDocumentFolders`
- Produces: Route `/dms` mit Filtern und Eingangskorb-Zähler

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('zeigt die Akte mit Eingangskorb', async ({ page }) => {
  await login(page);
  await page.goto('/dms');
  await expect(page.getByRole('heading', { name: 'Akte' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Eingangskorb/ })).toBeVisible();
});
```

`login(page)` ist der vorhandene Helfer der E2E-Suite.

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: FAIL — Route fehlt (Dev-Server auf Port 3100 selbst starten).

- [ ] **Step 3: Liste bauen**

`page.tsx` als Server Component: Rechte über den vorhandenen Weg prüfen, `listDocuments` mit den Filtern aus der URL (`?direction=`, `?type=`, `?folder=`, `?phase=`, `?inbox=1`), Ergebnis an `document-list.tsx`. Spalten: Nummer, Betreff, Art, Datum, Ordner, Richtung, Zustand (Entwurf / festgeschrieben / storniert). Der Eingangskorb ist ein Filterlink mit Zähler aus `listDocuments({ inbox: true, limit: 1 })` (`total`).

Alle Beschriftungen nach `apps/kompass/messages/de.json` unter dem Schlüssel `dms.*`.

- [ ] **Step 4: Test grün sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): the file as a list, with the inbox as a filter"
```

---

### Task 4: Entwurfsbildschirm mit Vorschau und Festschreiben

**Files:**
- Create: `apps/kompass/src/app/(shell)/dms/new/page.tsx`, `draft-form.tsx`
- Create: `apps/kompass/src/app/(shell)/dms/[id]/page.tsx`, `document-detail.tsx`, `file-dialog.tsx`
- Create: `apps/kompass/src/app/dms/[id]/file/route.ts` (Auslieferung der Datei; Muster: `apps/kompass/src/app/documents/[id]/file/route.ts`)
- Create: `apps/kompass/src/app/dms/[id]/preview/route.ts` (Vorschau eines Entwurfs)
- Modify: `apps/kompass/src/app/(shell)/dms/actions.ts`, `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Consumes: `createDraft`, `updateDraft`, `previewDraft`, `fileDocument`, `listContacts`
- Produces: Routen `/dms/new`, `/dms/[id]`, Dateiauslieferung unter `/dms/[id]/file` und `/dms/[id]/preview`

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('entwirft einen Brief, sieht die Vorschau und schreibt ihn fest', async ({ page }) => {
  await login(page);
  await page.goto('/dms/new');
  await page.getByLabel('Betreff').fill('Einladung zur Mitgliederversammlung');
  await page.getByLabel('Text').fill('Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.');
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await expect(page.getByText('Entwurf')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vorschau' })).toBeVisible();
  await page.getByRole('button', { name: 'Festschreiben' }).click();
  await page.getByRole('button', { name: 'Festschreiben bestätigen' }).click();
  await expect(page.getByText(/BRF-\d{4}-\d{3}/)).toBeVisible();
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: FAIL

- [ ] **Step 3: Entwurf und Detailseite bauen**

`draft-form.tsx`: Empfängerauswahl (Kontaktsuche über `listContacts`), Betreff, Markdown-Textfeld, Ordner, Art. Server Actions in `actions.ts` rufen ausschließlich die Modulservices und geben deren `Result` weiter — keine Fachlogik, keine eigene Rechteprüfung.

Detailseite: Metadaten, Bezüge, Aufbewahrungsblock (Muster: `apps/kompass/src/app/(shell)/contacts/[id]/retention-panel.tsx`), PDF-Vorschau über `<iframe>` auf die Datei-Route, und je nach Phase die Knöpfe „Vorschau", „Festschreiben", „Stornieren", „Entwurf löschen" — jeder nur sichtbar, wenn das Recht da ist.

Das Festschreiben bekommt einen Bestätigungsdialog, weil es unumkehrbar ist. Der Dialog nennt beim Namen, was passiert: Nummer wird vergeben, Text wird eingefroren.

- [ ] **Step 4: Test grün sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): draft a letter, read the preview, file it"
```

---

### Task 5: Ablegen-Dialog für Eingangspost

**Files:**
- Create: `apps/kompass/src/app/(shell)/dms/receive/page.tsx`, `receive-form.tsx`
- Modify: `apps/kompass/src/app/(shell)/dms/actions.ts`, `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/dms.spec.ts`

**Interfaces:**
- Consumes: `receiveDocument`, `suggestClassification`, `listDocumentFolders`, `listDocumentTypes`

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('legt eine Datei im Eingangskorb ab und sortiert sie ein', async ({ page }) => {
  await login(page);
  await page.goto('/dms/receive');
  await page.getByLabel('Datei').setInputFiles({ name: '2026-03-14 Behoerde.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
  await expect(page.getByLabel('Datum auf dem Dokument')).toHaveValue('2026-03-14');
  await page.getByLabel('Betreff').fill('Eingegangenes Schreiben');
  await page.getByRole('button', { name: 'Ablegen' }).click();
  await expect(page.getByText(/BEH-\d{4}-\d{3}/)).toBeVisible();
});
```

`samplePdf()` erzeugt die Bytes im Test; keine Beispieldatei ins Repo legen.

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: FAIL

- [ ] **Step 3: Formular bauen**

Beim Auswählen der Datei ruft das Formular `suggestClassification` und belegt Art, Ordner und Datum vor — sichtbar vorbelegt, nicht still gesetzt (Entscheidung 19). Der Nutzer kann jeden Vorschlag überschreiben. Ohne Ordner landet die Datei im Eingangskorb.

Die Datei geht als `FormData` an die Server Action; für große Dateien gilt dieselbe Grenze wie in der Mediathek.

- [ ] **Step 4: Test grün sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): file incoming post with pre-filled suggestions"
```

---

### Task 6: Stammdaten unter Verwaltung

**Files:**
- Create: `apps/kompass/src/app/(shell)/admin/dms/page.tsx`, `types-panel.tsx`, `folders-panel.tsx`, `rules-panel.tsx`, `actions.ts`
- Modify: `apps/kompass/messages/de.json`
- Test: `apps/kompass/e2e/dms.spec.ts`

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('verwaltet Dokumentarten und Regeln', async ({ page }) => {
  await login(page);
  await page.goto('/admin/dms');
  await expect(page.getByRole('heading', { name: 'Dokumentarten' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Einsortierregeln' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ordner' })).toBeVisible();
});
```

- [ ] **Step 2: Test rot sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: FAIL

- [ ] **Step 3: Panels bauen**

Drei Tabellen mit Anlegen- und Ändern-Dialogen, alle über `dms.manage` geschützt. Bei den Arten sind `key` und `prefix` nach dem Anlegen nur noch lesend — das Formular zeigt sie deaktiviert, mit einem Hinweistext aus `de.json`, warum.

- [ ] **Step 4: Test grün sehen**

Run: `pnpm --filter @kompass/app e2e -- dms`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/kompass
git commit -m "feat(dms): master data screens for types, folders and rules"
```

---

### Task 7: Abschluss der Reihe

- [ ] **Step 1: Modulzähler und Navigation prüfen**

Die E2E-Erwartung der aktiven Modulanzahl anpassen (dieselbe Stelle wie in Commit `133e371`), Navigationseintrag `dms` in der Seitenleiste sichtbar.

- [ ] **Step 2: Volle Prüfung**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: PASS

- [ ] **Step 3: Prüfringe**

Run: `pnpm verify`
Expected: PASS (Docker nötig; liegt unter `/Applications/Docker.app/Contents/Resources/bin`)

- [ ] **Step 4: Dokumentation nachziehen**

`AGENTS.md`: `dms` in der Modulliste und im Seed-Muster erwähnen, falls dort Module aufgezählt werden. `docs/backlog.md`: nichts eintragen, außer es ist unterwegs etwas aufgefallen.

- [ ] **Step 5: Commit und Push**

```bash
git add -A
git commit -m "chore(dms): close out the documents and correspondence series"
git push
```

---

## Abschluss

- [ ] Alle vier Pläne abgeschlossen
- [ ] `pnpm verify` grün
- [ ] Ein Push für die ganze Reihe
