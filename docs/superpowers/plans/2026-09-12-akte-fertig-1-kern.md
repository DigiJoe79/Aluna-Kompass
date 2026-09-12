# Akte fertig 1 — Kern: Wiedervorlagen, Rechte, Haken, Löschpolitik (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Kern kennt Wiedervorlagen an beliebigen Entitäten, zwei Rechte dafür, einen Haken, über den ein Modul seine Entität beschriftet, sechs MCP-Werkzeuge, und die Löschpolitik kennt die vier neuen Arbeitsmaterialien der Akte.

**Architecture:** Eine Kerntabelle `follow_ups` mit generischem Bezug (`entityType`, `entityId`), wie `document_links` und `mediaReferences`. Der Kern prüft nie, ob die Entität existiert — das tut der Aufrufer im Modul. Ein Manifest-Haken `followUpTargets` liefert Beschriftung und Link für die Startseite; er läuft in Richtung Kern → Modul, wie `retentionHolds`. `McpToolDefinition` bekommt ein Feld `service`, damit ein späterer Test Werkzeuge mechanisch gegen Services prüfen kann.

**Tech Stack:** TypeScript, Drizzle/SQLite, Zod 4, Vitest, drizzle-kit.

**Spec:** `docs/superpowers/specs/2026-09-12-akte-fertig-design.md` (§ 4.1, § 5.1, § 6, § 8, Entscheidung 32)

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` → `db.transaction` → `recordAudit` in derselben Transaktion → `ok(...)`.
- Fachfehler als `Result` (`forbidden`, `validation`, `notFound`, `conflict`), nie Exceptions.
- IDs über `newId()`, Zeit über `deps.clock.now()` bzw. `isoNow(deps.clock)`, nie `new Date()` in Fachcode.
- Migrationen: `pnpm --filter @kompass/core db:generate` für Schemaänderungen, `drizzle-kit generate --custom` für Datenmigrationen; erzeugte Dateien werden committet und nie nachträglich editiert. **Vorher `ls packages/core/src/db/migrations` und die nächste freie Nummer prüfen** — Plan 2 legt ebenfalls Migrationen an; wer als Zweiter erzeugt, bekommt die höhere Nummer.
- Pro Service mindestens ein Test für Erfolg, `forbidden`, `validation` und den Protokolleintrag.
- Kein Code ohne zuvor rot gesehenen Test.
- Nach jedem Task ein Commit; nicht pushen.

**Unabhängig von Plan 2.** Beide Pläne fassen `packages/core/src/deletion-policy.ts` **nicht** gleichzeitig an: Die vier Einträge der Akte entstehen hier in Task 4, Plan 2 verlässt sich darauf.

---

### Task 1: Tabelle, Rechte, Migration

**Files:**
- Modify: `packages/core/src/db/schema.ts` (neue Tabelle am Ende)
- Modify: `packages/core/src/permissions/core.ts`
- Generated: `packages/core/src/db/migrations/00NN_follow_ups.sql`
- Generated (custom): `packages/core/src/db/migrations/00NN_follow_ups_permissions.sql`
- Modify: `packages/core/tests/permissions.test.ts` (führt die Kernrechte vollständig auf)
- Modify: `apps/kompass/src/lib/permission-groups.ts` (jedes Kernrecht steht in einer Gruppe, sonst zeigt der Rolleneditor es nie)
- Modify: `apps/kompass/messages/de.json` (`permissions.groups.core.followUps`, `permissions.keys.followUps.*`)
- Test: `packages/core/tests/follow-ups-schema.test.ts`

**Interfaces:**
- Produces: `followUps` (Drizzle-Tabelle), Rechte `followUps.view`, `followUps.manage`.

- [ ] **Step 1: Failing Test schreiben**

`packages/core/tests/follow-ups-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { createTestDeps } from '../src/testing';

describe('follow_ups', () => {
  it('die Tabelle existiert mit ihren Spalten', () => {
    const deps = createTestDeps();
    const columns = deps.sqlite.prepare(`PRAGMA table_info(follow_ups)`).all() as { name: string }[];
    expect(columns.map((c) => c.name).sort()).toEqual(
      ['assignee_user_id', 'created_at', 'created_by_user_id', 'done_at', 'done_by_user_id', 'due_at', 'entity_id', 'entity_type', 'id', 'title', 'updated_at'].sort(),
    );
  });

  it('der Kern kennt zwei Rechte für Wiedervorlagen', () => {
    expect(CORE_PERMISSIONS).toContain('followUps.view');
    expect(CORE_PERMISSIONS).toContain('followUps.manage');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/core test -- follow-ups-schema`
Expected: FAIL — `PRAGMA table_info` liefert keine Spalten, die Rechte fehlen.

- [ ] **Step 3: Schema und Rechte**

`packages/core/src/db/schema.ts`, am Ende anfügen (`users` ist oben in der Datei definiert):

```ts
/**
 * Wiedervorlagen an beliebigen Entitäten — generischer Bezug wie in
 * `document_links`. Der Kern prüft die Entität nicht; das tut das Modul, das
 * die Wiedervorlage anlegt. Erledigt heißt abgehakt, nicht gelöscht: Die Zeile
 * bleibt, damit ein Vorgang zeigt, dass jemand nachgesehen hat.
 */
export const followUps = sqliteTable(
  'follow_ups',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    /** ISO-Datum. */
    dueAt: text('due_at').notNull(),
    title: text('title').notNull(),
    /** Leer heißt: alle. */
    assigneeUserId: text('assignee_user_id').references(() => users.id),
    createdByUserId: text('created_by_user_id').notNull(),
    createdAt: text('created_at').notNull(),
    doneAt: text('done_at'),
    doneByUserId: text('done_by_user_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('follow_ups_entity_idx').on(t.entityType, t.entityId), index('follow_ups_due_idx').on(t.doneAt, t.dueAt)],
);
```

`packages/core/src/permissions/core.ts`, vor `'backup.export'`:

```ts
  // Wiedervorlagen hängen an Vorgängen aller Module; die Liste auf der
  // Startseite zeigt Anlässe, keine Inhalte — deshalb ein eigenes Leserecht.
  'followUps.view',
  'followUps.manage',
```

- [ ] **Step 3b: Die Rechte in Test, Gruppe und Sprachdatei nachziehen**

Drei Stellen kennen die Kernrechte als Liste und werden sonst rot:

`packages/core/tests/permissions.test.ts`: die beiden Schlüssel in die erwartete Liste aufnehmen, hinter `'retention.view'`.

`apps/kompass/src/lib/permission-groups.ts`, `CORE_GROUPS`: eine eigene Gruppe, weil Wiedervorlagen weder Verwaltung noch Rechenschaft sind:

```ts
  { key: 'core.followUps', keys: ['followUps.view', 'followUps.manage'] },
```

`apps/kompass/messages/de.json`: unter `permissions.groups.core` `"followUps": "Kern — Wiedervorlagen"`; unter `permissions.keys`:

```json
"followUps": {
  "view": { "label": "Wiedervorlagen sehen", "description": "Die Liste der fälligen Wiedervorlagen auf der Startseite und an Vorgängen sehen — Anlässe, keine Inhalte." },
  "manage": { "label": "Wiedervorlagen pflegen", "description": "Wiedervorlagen an Vorgängen anlegen, abhaken, wieder öffnen und löschen." }
}
```

Run: `pnpm --filter @kompass/core test -- permissions && pnpm --filter @kompass/app test -- permission`
Expected: PASS (`permission-groups.test.ts` und `permission-labels.test.ts`).

**Bis Task 5 bleibt `apps/kompass/tests/mcp-tools.test.ts` rot:** zwei Rechte ohne Werkzeug. Das ist erwartet und löst sich in Task 5; wer dazwischen `pnpm test` fährt, sieht genau diesen einen Fehler.

- [ ] **Step 4: Migrationen erzeugen**

```bash
ls packages/core/src/db/migrations                       # nächste freie Nummer
pnpm --filter @kompass/core db:generate --name=follow_ups
pnpm --filter @kompass/core exec drizzle-kit generate --custom --name=follow_ups_permissions
```

Die erste Datei enthält `CREATE TABLE follow_ups` und die zwei Indizes — nicht anfassen. Die zweite ist leer und wird gefüllt:

```sql
-- Wer heute die Akte befüllen darf, darf ab jetzt auch Wiedervorlagen sehen
-- und pflegen. Sonst stünde nach dem Update jede Rolle vor einem leeren
-- Kasten, bis ein Admin die Rechte nachträgt.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'followUps.view' FROM `role_permissions` WHERE `permission_key` = 'dms.create';--> statement-breakpoint
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission_key`)
SELECT `role_id`, 'followUps.manage' FROM `role_permissions` WHERE `permission_key` = 'dms.create';
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- follow-ups-schema && pnpm --filter @kompass/core test -- db`
Expected: PASS — sobald `follow_ups` in `packages/core/tests/db.test.ts` steht: Der Test führt **alle** Tabellen der Datenbank namentlich auf, Kern und Module, und meldet jede, die er nicht kennt.

- [ ] **Step 6: Migrationstest für die Rechteübertragung**

Anhängen an `packages/core/tests/follow-ups-schema.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../src/db/migrations');

describe('Migration follow_ups_permissions', () => {
  it('gibt jeder Rolle mit dms.create die beiden Wiedervorlage-Rechte', () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith('_follow_ups_permissions.sql'));
    expect(file).toBeDefined();
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file!), 'utf8');
    expect(sql).toContain("'followUps.view'");
    expect(sql).toContain("'followUps.manage'");
    expect(sql).toContain("`permission_key` = 'dms.create'");
    expect(sql).toContain('INSERT OR IGNORE');
  });
});
```

Run: `pnpm --filter @kompass/core test -- follow-ups-schema`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/permissions/core.ts packages/core/src/db/migrations packages/core/tests/follow-ups-schema.test.ts packages/core/tests/permissions.test.ts apps/kompass/src/lib/permission-groups.ts apps/kompass/messages/de.json
git commit -m "feat(core): a table for follow-ups, and two rights to see and keep them"
```

---

### Task 2: Der Service

**Files:**
- Create: `packages/core/src/follow-ups/service.ts`
- Modify: `packages/core/src/index.ts` (Export)
- Test: `packages/core/tests/follow-ups.test.ts`

**Interfaces:**
- Produces:
  - `type FollowUpRecord = typeof followUps.$inferSelect`
  - `createFollowUp(deps, ctx, { entityType, entityId, dueAt, title, assigneeUserId? })` → `Result<FollowUpRecord>`, Recht `followUps.manage`, Audit `followUps.create`
  - `completeFollowUp(deps, ctx, { id })` → `Result<FollowUpRecord>`, `conflict('followUpDone')` wenn schon erledigt
  - `reopenFollowUp(deps, ctx, { id })` → `Result<FollowUpRecord>`, `conflict('followUpOpen')` wenn offen
  - `deleteFollowUp(deps, ctx, { id })` → `Result<null>`, Audit `followUps.delete`
  - `listFollowUps(deps, ctx, { entityType, entityId, includeDone? })` → `Result<FollowUpRecord[]>`, Recht `followUps.view`, offene zuerst nach `dueAt`, dann erledigte nach `doneAt` absteigend
  - `listDueFollowUps(deps, ctx, { until, assigneeUserId? })` → `Result<FollowUpRecord[]>`, offen und `dueAt <= until`, älteste zuerst
  - `deleteFollowUpsFor(tx, entityType, entityId)` → `number` (gelöschte Zeilen), kein `ctx`, kein eigener Protokolleintrag
  - `followUpCreateSchema`, `followUpIdSchema`, `followUpListSchema`, `followUpDueSchema` (Zod, für MCP)

- [ ] **Step 1: Failing Tests schreiben**

`packages/core/tests/follow-ups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { auditLog, followUps } from '../src/db/schema';
import {
  completeFollowUp,
  createFollowUp,
  deleteFollowUp,
  deleteFollowUpsFor,
  listDueFollowUps,
  listFollowUps,
  reopenFollowUp,
} from '../src/follow-ups/service';
import { createTestDeps, ctxWith, insertUser } from '../src/testing';

const ALL = ['followUps.view', 'followUps.manage'];

function setup() {
  const deps = createTestDeps({ now: '2026-09-12T08:00:00.000Z' });
  const userId = insertUser(deps, { name: 'Anna' });
  return { deps, ctx: ctxWith(ALL, userId), userId };
}

const actions = (deps: ReturnType<typeof setup>['deps']) => deps.db.select().from(auditLog).all().map((e) => e.action);

describe('createFollowUp', () => {
  it('legt eine offene Wiedervorlage an und protokolliert sie', async () => {
    const { deps, ctx, userId } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'Antwort abwarten' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'Antwort abwarten', doneAt: null, createdByUserId: userId, assigneeUserId: null });
    expect(actions(deps)).toContain('followUps.create');
  });

  it('weist ohne Recht ab', async () => {
    const { deps } = setup();
    const denied = await createFollowUp(deps, ctxWith(['followUps.view']), { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.type).toBe('forbidden');
  });

  it('weist ein kaputtes Datum und einen leeren Anlass ab', async () => {
    const { deps, ctx } = setup();
    const bad = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '20.09.2026', title: '' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.type).toBe('validation');
  });

  it('nimmt eine zuständige Person nur, wenn es sie gibt', async () => {
    const { deps, ctx } = setup();
    const missing = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x', assigneeUserId: 'NOBODY' });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.type).toBe('notFound');
  });
});

describe('completeFollowUp / reopenFollowUp', () => {
  it('hakt ab, merkt sich wer und wann, und lässt sich nicht zweimal abhaken', async () => {
    const { deps, ctx, userId } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const done = await completeFollowUp(deps, ctx, { id: created.value.id });
    expect(done.ok && done.value.doneAt).toBe('2026-09-12T08:00:00.000Z');
    expect(done.ok && done.value.doneByUserId).toBe(userId);
    const again = await completeFollowUp(deps, ctx, { id: created.value.id });
    expect(!again.ok && again.error.type === 'conflict' && again.error.code).toBe('followUpDone');
    expect(actions(deps)).toContain('followUps.complete');
  });

  it('öffnet wieder und weist Wiederöffnen einer offenen ab', async () => {
    const { deps, ctx } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const open = await reopenFollowUp(deps, ctx, { id: created.value.id });
    expect(!open.ok && open.error.type === 'conflict' && open.error.code).toBe('followUpOpen');
    await completeFollowUp(deps, ctx, { id: created.value.id });
    const reopened = await reopenFollowUp(deps, ctx, { id: created.value.id });
    expect(reopened.ok && reopened.value.doneAt).toBeNull();
    expect(actions(deps)).toContain('followUps.reopen');
  });

  it('meldet eine unbekannte Wiedervorlage', async () => {
    const { deps, ctx } = setup();
    const missing = await completeFollowUp(deps, ctx, { id: 'NOPE' });
    expect(!missing.ok && missing.error.type).toBe('notFound');
  });
});

describe('listFollowUps / listDueFollowUps', () => {
  it('listet je Vorgang offene zuerst, erledigte nur auf Wunsch', async () => {
    const { deps, ctx } = setup();
    const a = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-25', title: 'spät' });
    const b = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-15', title: 'früh' });
    const c = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-10', title: 'erledigt' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-10', title: 'anderes' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('create');
    await completeFollowUp(deps, ctx, { id: c.value.id });

    const open = await listFollowUps(deps, ctx, { entityType: 'document', entityId: 'D1' });
    expect(open.ok && open.value.map((f) => f.title)).toEqual(['früh', 'spät']);
    const all = await listFollowUps(deps, ctx, { entityType: 'document', entityId: 'D1', includeDone: true });
    expect(all.ok && all.value.map((f) => f.title)).toEqual(['früh', 'spät', 'erledigt']);
  });

  it('liefert die fälligen bis zu einem Datum, älteste zuerst, wahlweise nur für eine Person', async () => {
    const { deps, ctx, userId } = setup();
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'überfällig' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-18', title: 'diese Woche', assigneeUserId: userId });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D3', dueAt: '2026-10-30', title: 'später' });

    const due = await listDueFollowUps(deps, ctx, { until: '2026-09-19' });
    expect(due.ok && due.value.map((f) => f.title)).toEqual(['überfällig', 'diese Woche']);
    const mine = await listDueFollowUps(deps, ctx, { until: '2026-09-19', assigneeUserId: userId });
    expect(mine.ok && mine.value.map((f) => f.title)).toEqual(['diese Woche']);
  });

  it('braucht das Leserecht', async () => {
    const { deps } = setup();
    const denied = await listDueFollowUps(deps, ctxWith([]), { until: '2026-09-19' });
    expect(!denied.ok && denied.error.type).toBe('forbidden');
  });
});

describe('deleteFollowUp / deleteFollowUpsFor', () => {
  it('löscht eine einzelne mit Protokoll', async () => {
    const { deps, ctx } = setup();
    const created = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'x' });
    if (!created.ok) throw new Error('create');
    const deleted = await deleteFollowUp(deps, ctx, { id: created.value.id });
    expect(deleted.ok).toBe(true);
    expect(deps.db.select().from(followUps).all()).toHaveLength(0);
    expect(actions(deps)).toContain('followUps.delete');
  });

  it('räumt alle Wiedervorlagen eines Vorgangs weg, auch erledigte, ohne eigenen Protokolleintrag', async () => {
    const { deps, ctx } = setup();
    const a = await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-20', title: 'a' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-21', title: 'b' });
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D2', dueAt: '2026-09-21', title: 'bleibt' });
    if (!a.ok) throw new Error('create');
    await completeFollowUp(deps, ctx, { id: a.value.id });
    const before = actions(deps).length;

    const removed = deps.db.transaction((tx) => deleteFollowUpsFor(tx, 'document', 'D1'));

    expect(removed).toBe(2);
    expect(deps.db.select().from(followUps).all().map((f) => f.title)).toEqual(['bleibt']);
    expect(actions(deps).length).toBe(before);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/core test -- follow-ups.test`
Expected: FAIL — Modul `../src/follow-ups/service` fehlt.

- [ ] **Step 3: Service schreiben**

`packages/core/src/follow-ups/service.ts`:

```ts
import { and, asc, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { followUps, users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { requirePermission } from '../permissions/check';
import { conflict, notFound, ok, type Result } from '../result';
import { validate } from '../validate';

export type FollowUpRecord = typeof followUps.$inferSelect;

const ENTITY = z.string().trim().min(1).max(60);

export const followUpCreateSchema = z.object({
  entityType: ENTITY,
  entityId: z.string().trim().min(1),
  dueAt: z.string().date(),
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().trim().min(1).nullable().optional(),
});

export const followUpIdSchema = z.object({ id: z.string().min(1) });

export const followUpListSchema = z.object({
  entityType: ENTITY,
  entityId: z.string().trim().min(1),
  includeDone: z.boolean().default(false),
});

export const followUpDueSchema = z.object({
  until: z.string().date(),
  assigneeUserId: z.string().trim().min(1).optional(),
});

function load(db: DbOrTx, id: string): FollowUpRecord | null {
  return db.select().from(followUps).where(eq(followUps.id, id)).get() ?? null;
}

/**
 * Der Kern prüft die Entität nicht — er kennt sie nicht. Wer eine Wiedervorlage
 * anlegt, hat vorher geprüft, dass es den Vorgang gibt und dass er ihn sehen
 * darf (in der Akte: `createDocumentFollowUp`).
 */
export async function createFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  if (v.assigneeUserId) {
    const user = deps.db.select({ id: users.id }).from(users).where(eq(users.id, v.assigneeUserId)).get();
    if (!user) return notFound('user', v.assigneeUserId);
  }

  return deps.db.transaction((tx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(followUps)
      .values({
        id,
        entityType: v.entityType,
        entityId: v.entityId,
        dueAt: v.dueAt,
        title: v.title,
        assigneeUserId: v.assigneeUserId ?? null,
        createdByUserId: ctx.userId ?? 'system',
        createdAt: now,
        doneAt: null,
        doneByUserId: null,
        updatedAt: now,
      })
      .run();
    const record = load(tx, id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.create',
      entityType: 'followUp',
      entityId: id,
      after: record,
      summary: `Wiedervorlage „${v.title}“ zum ${v.dueAt} angelegt`,
    });
    return ok(record);
  });
}

export async function completeFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);
  if (row.doneAt) return conflict('followUpDone', `Wiedervorlage „${row.title}“ ist bereits erledigt`);

  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(followUps).set({ doneAt: now, doneByUserId: ctx.userId, updatedAt: now }).where(eq(followUps.id, row.id)).run();
    const after = load(tx, row.id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.complete',
      entityType: 'followUp',
      entityId: row.id,
      before: { doneAt: null },
      after: { doneAt: now },
      summary: `Wiedervorlage „${row.title}“ erledigt`,
    });
    return ok(after);
  });
}

export async function reopenFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);
  if (!row.doneAt) return conflict('followUpOpen', `Wiedervorlage „${row.title}“ ist noch offen`);

  return deps.db.transaction((tx) => {
    const now = isoNow(deps.clock);
    tx.update(followUps).set({ doneAt: null, doneByUserId: null, updatedAt: now }).where(eq(followUps.id, row.id)).run();
    const after = load(tx, row.id)!;
    recordAudit(tx, deps, ctx, {
      action: 'followUps.reopen',
      entityType: 'followUp',
      entityId: row.id,
      before: { doneAt: row.doneAt },
      after: { doneAt: null },
      summary: `Wiedervorlage „${row.title}“ wieder geöffnet`,
    });
    return ok(after);
  });
}

export async function deleteFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'followUps.manage');
  if (denied) return denied;
  const parsed = validate(deps, followUpIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = load(deps.db, parsed.value.id);
  if (!row) return notFound('followUp', parsed.value.id);

  return deps.db.transaction((tx) => {
    tx.delete(followUps).where(eq(followUps.id, row.id)).run();
    recordAudit(tx, deps, ctx, {
      action: 'followUps.delete',
      entityType: 'followUp',
      entityId: row.id,
      before: row,
      summary: `Wiedervorlage „${row.title}“ gelöscht`,
    });
    return ok(null);
  });
}

export async function listFollowUps(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord[]>> {
  const denied = requirePermission(ctx, 'followUps.view');
  if (denied) return denied;
  const parsed = validate(deps, followUpListSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const scope = and(eq(followUps.entityType, q.entityType), eq(followUps.entityId, q.entityId));
  const open = deps.db.select().from(followUps).where(and(scope, isNull(followUps.doneAt))).orderBy(asc(followUps.dueAt), asc(followUps.createdAt)).all();
  if (!q.includeDone) return ok(open);
  const done = deps.db.select().from(followUps).where(and(scope, sql`${followUps.doneAt} is not null`)).orderBy(desc(followUps.doneAt)).all();
  return ok([...open, ...done]);
}

export async function listDueFollowUps(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpRecord[]>> {
  const denied = requirePermission(ctx, 'followUps.view');
  if (denied) return denied;
  const parsed = validate(deps, followUpDueSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;
  const conditions = [isNull(followUps.doneAt), lte(followUps.dueAt, q.until)];
  if (q.assigneeUserId) conditions.push(eq(followUps.assigneeUserId, q.assigneeUserId));
  const rows = deps.db.select().from(followUps).where(and(...conditions)).orderBy(asc(followUps.dueAt), asc(followUps.createdAt)).all();
  return ok(rows);
}

/**
 * Für Module, die ihre Entität löschen: räumt alle Wiedervorlagen daran weg,
 * auch die erledigten. Läuft in der Transaktion des Aufrufers und schreibt
 * keinen eigenen Protokolleintrag — der Eintrag des Moduls nennt die Zahl.
 */
export function deleteFollowUpsFor(tx: DbOrTx, entityType: string, entityId: string): number {
  const result = tx.delete(followUps).where(and(eq(followUps.entityType, entityType), eq(followUps.entityId, entityId))).run();
  return result.changes;
}
```

`packages/core/src/index.ts`, nach `export * from './retention/service';`:

```ts
export * from './follow-ups/service';
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- follow-ups.test`
Expected: PASS (12 Tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/follow-ups/service.ts packages/core/src/index.ts packages/core/tests/follow-ups.test.ts
git commit -m "feat(core): follow-ups on any record — create, tick off, reopen, list what is due"
```

---

### Task 3: Der Haken `followUpTargets` und das Feld `service` am Werkzeug

**Files:**
- Modify: `packages/core/src/modules/manifest.ts`
- Create: `packages/core/src/follow-ups/targets.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/follow-up-targets.test.ts`

**Interfaces:**
- Produces:
  - `interface FollowUpTarget { label: string; href: string | null }`
  - `ModuleManifest.followUpTargets?: (deps, entityType, id) => FollowUpTarget | null`
  - `resolveFollowUpTarget(deps, entityType, id): FollowUpTarget | null` — fragt die **eingeschalteten** Module, das erste, das antwortet, gewinnt
  - `listDueFollowUpsWithTargets(deps, ctx, input)` → `Result<(FollowUpRecord & { target: FollowUpTarget | null })[]>` — für Startseite und MCP
  - `McpToolDefinition.service?: Function` — der Service, den das Werkzeug ruft (für den Paritätstest in Plan 2)

- [ ] **Step 1: Failing Test schreiben**

`packages/core/tests/follow-up-targets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { settings } from '../src/db/schema';
import { createFollowUp } from '../src/follow-ups/service';
import { listDueFollowUpsWithTargets, resolveFollowUpTarget } from '../src/follow-ups/targets';
import { defineModule } from '../src/modules/manifest';
import { createTestDeps, ctxWith } from '../src/testing';

const files = defineModule({
  key: 'files',
  version: '0',
  permissions: [],
  followUpTargets: (_deps, entityType, id) => (entityType === 'document' ? { label: `Dokument ${id}`, href: `/dms/${id}` } : null),
});

function setup(enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, files] });
  deps.db.insert(settings).values({ key: 'modules.enabled', value: JSON.stringify(enabled), updatedAt: 'now' }).run();
  return deps;
}

describe('followUpTargets', () => {
  it('ein eingeschaltetes Modul beschriftet seine Entität', () => {
    const deps = setup(['files']);
    expect(resolveFollowUpTarget(deps, 'document', 'D1')).toEqual({ label: 'Dokument D1', href: '/dms/D1' });
  });

  it('ein ausgeschaltetes Modul schweigt, ein fremder Typ bleibt ohne Ziel', () => {
    expect(resolveFollowUpTarget(setup([]), 'document', 'D1')).toBeNull();
    expect(resolveFollowUpTarget(setup(['files']), 'invoice', 'I1')).toBeNull();
  });

  it('die Fälligkeitsliste trägt das Ziel an jeder Zeile', async () => {
    const deps = setup(['files']);
    const ctx = ctxWith(['followUps.view', 'followUps.manage']);
    await createFollowUp(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'a' });
    await createFollowUp(deps, ctx, { entityType: 'invoice', entityId: 'I1', dueAt: '2026-09-02', title: 'b' });
    const due = await listDueFollowUpsWithTargets(deps, ctx, { until: '2026-09-30' });
    expect(due.ok && due.value.map((f) => f.target)).toEqual([{ label: 'Dokument D1', href: '/dms/D1' }, null]);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/core test -- follow-up-targets`
Expected: FAIL — `followUpTargets` ist kein Feld des Manifests (Typfehler), `targets.ts` fehlt.

- [ ] **Step 3: Manifest erweitern**

`packages/core/src/modules/manifest.ts`, nach `DueItem`:

```ts
/** Wie ein Modul eine Entität für die Wiedervorlage-Liste beschriftet. */
export interface FollowUpTarget {
  label: string;
  /** Der Weg zur Entität; `null`, wenn es keine Seite dafür gibt. */
  href: string | null;
}
```

In `McpToolDefinition`, nach `handler`:

```ts
  /**
   * Der Service, den `handler` ruft — als Referenz, nicht als Name. Der
   * Paritätstest der App vergleicht damit mechanisch: jeder Service eines
   * Moduls muss von mindestens einem Werkzeug genannt werden. Fehlt das Feld,
   * gilt das Werkzeug als „ruft keinen Service“ — und fällt im Test auf,
   * sobald ein Service ohne Werkzeug bleibt.
   */
  service?: (...args: never[]) => unknown;
```

In `ModuleManifest`, nach `retentionDue`:

```ts
  /**
   * Beschriftung und Link für eine Entität dieses Moduls, an der eine
   * Wiedervorlage hängt. Richtung Kern → Modul, wie `retentionHolds`: Der Kern
   * fragt nach einem Namen für etwas, das das Modul besitzt. `null` heißt:
   * nicht meine Entität.
   */
  followUpTargets?: (deps: Deps, entityType: string, id: string) => FollowUpTarget | null;
```

- [ ] **Step 4: `targets.ts` schreiben**

`packages/core/src/follow-ups/targets.ts`:

```ts
import type { CallContext } from '../context';
import type { Deps } from '../deps';
import type { FollowUpTarget } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { ok, type Result } from '../result';
import { listDueFollowUps, type FollowUpRecord } from './service';

/**
 * Fragt die eingeschalteten Module; das erste, das antwortet, gewinnt. Ein
 * ausgeschaltetes Modul schweigt — dann steht der Anlass ohne Link da, was
 * richtiger ist als ein Link ins Leere.
 */
export function resolveFollowUpTarget(deps: Deps, entityType: string, id: string): FollowUpTarget | null {
  for (const manifest of enabledManifests(deps)) {
    const target = manifest.followUpTargets?.(deps, entityType, id);
    if (target) return target;
  }
  return null;
}

export type FollowUpWithTarget = FollowUpRecord & { target: FollowUpTarget | null };

export async function listDueFollowUpsWithTargets(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FollowUpWithTarget[]>> {
  const due = await listDueFollowUps(deps, ctx, input);
  if (!due.ok) return due;
  return ok(due.value.map((row) => ({ ...row, target: resolveFollowUpTarget(deps, row.entityType, row.entityId) })));
}
```

`packages/core/src/index.ts`, nach dem Export des Services:

```ts
export * from './follow-ups/targets';
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- follow-up-targets && pnpm --filter @kompass/core typecheck`
Expected: PASS; Typecheck grün (das neue Manifest-Feld ist optional, kein bestehendes Modul bricht).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/core/src/follow-ups/targets.ts packages/core/src/index.ts packages/core/tests/follow-up-targets.test.ts
git commit -m "feat(core): a module names the record a follow-up points at, and a tool names its service"
```

---

### Task 4: Löschpolitik

**Files:**
- Modify: `packages/core/src/deletion-policy.ts`
- Modify: `packages/core/tests/deletion-policy.test.ts`

**Interfaces:**
- Produces: Einträge `followUp`, `documentRelation`, `documentNote`, `documentSnippet` (alle `deletable: true`).

- [ ] **Step 1: Failing Test schreiben**

Anhängen an `packages/core/tests/deletion-policy.test.ts`, innerhalb `describe('deletion policy')`:

```ts
  it('kennt die vier Arbeitsmaterialien der Akte als löschbar, mit ihrer Protokollaktion', () => {
    const expected: Record<string, string> = {
      followUp: 'followUps.delete',
      documentRelation: 'dms.unrelate',
      documentNote: 'dms.note.delete',
      documentSnippet: 'dms.snippet.delete',
    };
    for (const [entity, action] of Object.entries(expected)) {
      const rule = DELETION_POLICY.find((r) => r.entity === entity);
      expect(rule, entity).toBeDefined();
      expect(rule!.deletable, entity).toBe(true);
      expect(rule!.auditAction, entity).toBe(action);
    }
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/core test -- deletion-policy`
Expected: FAIL — `followUp` nicht definiert.

- [ ] **Step 2b: Die Regex des Tests kennt camelCase**

`deletion-policy.test.ts` prüft jede `auditAction` gegen `/^[a-z]+(\.[a-z]+)+$/` — reine Kleinschreibung, und `followUps.delete` fällt durch. Die Segmente dürfen dieselbe Form haben wie `PERMISSION_KEY` in `modules/manifest.ts`:

```ts
        expect(rule.auditAction ?? '', rule.entity).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
```

- [ ] **Step 3: Einträge ergänzen**

In `packages/core/src/deletion-policy.ts`, im Block „Arbeitsmaterial“ nach dem Eintrag `documentRule`:

```ts
  {
    entity: 'documentRelation',
    deletable: true,
    reason: 'Ein Bezug zwischen zwei Dokumenten ist eine Zuordnung, kein Vorgang — wie documentLink.',
    guard: 'keiner',
    auditAction: 'dms.unrelate',
  },
  {
    entity: 'documentNote',
    deletable: true,
    reason: 'Eine Notiz ist Arbeitsmaterial neben dem Dokument; sie steht nie im PDF, nie im Index, nie in einem Export.',
    guard: 'nur die eigene Notiz, oder mit dms.manage',
    auditAction: 'dms.note.delete',
  },
  {
    entity: 'documentSnippet',
    deletable: true,
    reason: 'Ein Textbaustein ist Bedienkomfort; der Text lebt im Brief, der ihn benutzt hat.',
    guard: 'keiner',
    auditAction: 'dms.snippet.delete',
  },
  {
    entity: 'followUp',
    deletable: true,
    reason: 'Eine Wiedervorlage ist ein Merkzettel am Vorgang. Der Normalweg ist Abhaken; Löschen bleibt für Versehen.',
    guard: 'keiner',
    auditAction: 'followUps.delete',
  },
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/core test -- deletion-policy`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/deletion-policy.ts packages/core/tests/deletion-policy.test.ts
git commit -m "docs(core): the deletion policy names four new pieces of working material"
```

---

### Task 5: MCP-Werkzeuge des Kerns

**Files:**
- Modify: `packages/mcp/src/core-tools.ts`
- Test: `packages/mcp/tests/follow-up-tools.test.ts` (Verzeichnis anlegen, falls es fehlt; sonst neben die vorhandenen Tests)

**Interfaces:**
- Produces: `followups_list_due`, `followups_list`, `followups_create`, `followups_complete`, `followups_reopen`, `followups_delete`, jedes mit `service`-Referenz. Alle bestehenden Kernwerkzeuge bekommen ebenfalls ihr `service`.

- [ ] **Step 1: Failing Test schreiben**

`packages/mcp/tests/follow-up-tools.test.ts`:

```ts
import { coreModule, createFollowUp, listDueFollowUpsWithTargets } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { coreMcpTools } from '../src/core-tools';

const tool = (name: string) => {
  const found = coreMcpTools.find((t) => t.name === name);
  if (!found) throw new Error(`kein Werkzeug ${name}`);
  return found;
};

describe('followups_* tools', () => {
  it('sind registriert und nennen ihren Service', () => {
    for (const name of ['followups_list_due', 'followups_list', 'followups_create', 'followups_complete', 'followups_reopen', 'followups_delete']) {
      expect(tool(name).service, name).toBeTypeOf('function');
      expect(tool(name).description).toMatch(/followUps\.(view|manage)/);
    }
    expect(tool('followups_create').service).toBe(createFollowUp);
    expect(tool('followups_list_due').service).toBe(listDueFollowUpsWithTargets);
  });

  it('jedes Kernwerkzeug nennt einen Service', () => {
    const silent = coreMcpTools.filter((t) => typeof t.service !== 'function').map((t) => t.name);
    expect(silent).toEqual([]);
  });

  it('legt über das Werkzeug an und liest über das andere zurück', async () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const ctx = ctxWith(['followUps.view', 'followUps.manage']);
    const created = await tool('followups_create').handler(deps, ctx, { entityType: 'document', entityId: 'D1', dueAt: '2026-09-01', title: 'Antwort' });
    expect(created.ok).toBe(true);
    const due = await tool('followups_list_due').handler(deps, ctx, { until: '2026-12-31' });
    expect(due.ok && (due.value as { title: string }[]).map((f) => f.title)).toEqual(['Antwort']);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @kompass/mcp test -- follow-up-tools`
Expected: FAIL — kein Werkzeug `followups_list_due`; danach: Kernwerkzeuge ohne `service`.

- [ ] **Step 3: Werkzeuge ergänzen und `service` setzen**

In `packages/mcp/src/core-tools.ts` die Importliste um die Services erweitern:

```ts
  completeFollowUp, createFollowUp, deleteFollowUp, followUpCreateSchema, followUpDueSchema, followUpIdSchema, followUpListSchema,
  listDueFollowUpsWithTargets, listFollowUps, reopenFollowUp,
```

Am Ende der Liste `coreMcpTools`:

```ts
  // Wiedervorlagen: Anlässe an Vorgängen aller Module. Der Kern prüft die
  // Entität nicht; ein Modul, das eine anlegt, hat sie vorher geprüft. Über
  // dieses Werkzeug legt ein Agent deshalb nur an, was er selbst gelesen hat.
  t({ name: 'followups_list_due', description: 'List open follow-ups due until a date, oldest first, with a label and link for each record they point at. Optional assigneeUserId. Requires followUps.view.', inputSchema: followUpDueSchema, handler: (deps, ctx, args) => listDueFollowUpsWithTargets(deps, ctx, args), service: listDueFollowUpsWithTargets }),
  t({ name: 'followups_list', description: 'List the follow-ups on one record (entityType + entityId), open ones first; includeDone adds ticked-off ones. Requires followUps.view.', inputSchema: followUpListSchema, handler: (deps, ctx, args) => listFollowUps(deps, ctx, args), service: listFollowUps }),
  t({ name: 'followups_create', description: 'Create a follow-up on a record: due date, title, optional assignee. Requires followUps.manage. Audited.', inputSchema: followUpCreateSchema, handler: (deps, ctx, args) => createFollowUp(deps, ctx, args), service: createFollowUp }),
  t({ name: 'followups_complete', description: 'Tick a follow-up off; the row stays. Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => completeFollowUp(deps, ctx, args), service: completeFollowUp }),
  t({ name: 'followups_reopen', description: 'Reopen a ticked-off follow-up. Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => reopenFollowUp(deps, ctx, args), service: reopenFollowUp }),
  t({ name: 'followups_delete', description: 'Delete a follow-up (working material). Requires followUps.manage. Audited.', inputSchema: followUpIdSchema, handler: (deps, ctx, args) => deleteFollowUp(deps, ctx, args), service: deleteFollowUp }),
```

Dann **jedem** bestehenden Kernwerkzeug sein `service` geben — der Service, den der Handler ruft. Beispiele; die übrigen genauso:

```ts
  t({ name: 'settings_list', …, handler: async (deps) => ok(readAllSettings(deps)), service: readAllSettings }),
  t({ name: 'settings_get', …, service: readSetting }),
  t({ name: 'settings_set', …, service: setSetting }),
  t({ name: 'roles_list', …, service: listRoles }),
  t({ name: 'modules_list', …, service: listModules }),
  t({ name: 'themes_list', …, service: listThemes }),
  t({ name: 'retention_due', …, service: listRetentionDue }),
```

Handler, die keinen Service rufen, gibt es im Kern nicht; wer beim Durchgehen einen findet, trägt die Funktion ein, die er tatsächlich ruft.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @kompass/mcp test && pnpm --filter @kompass/app test -- mcp-tools`
Expected: PASS. Der App-Test `offers a tool for every permission a module defines` bleibt grün, weil beide neuen Rechte in Beschreibungen vorkommen.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/core-tools.ts packages/mcp/tests/follow-up-tools.test.ts
git commit -m "feat(mcp): follow-ups over mcp, and every core tool names the service it calls"
```

---

### Task 6: Abschluss

- [ ] **Step 1: Alles grün**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 2: Spec-Abgleich**

In `docs/superpowers/specs/2026-09-12-akte-fertig-design.md`, § 9 (Seed): Der Satz zu `packages/core/src/seed/follow-ups.ts` entfällt — die Beispiel-Wiedervorlagen legt der Seed der Akte über den Wrapper an (Plan 2), der Kern-Seed bleibt unberührt. Den Satz ersetzen durch: „Die Beispiel-Wiedervorlagen kommen aus `seedDms`; der Kern-Seed legt keine an, weil er kein Ziel dafür hat.“ Dazu in § 11 die Zeile `packages/core/src/seed/follow-ups.ts` streichen.

```bash
git add docs/superpowers/specs/2026-09-12-akte-fertig-design.md
git commit -m "docs(dms): the example follow-ups come from the file's seed, not the core's"
```

---

## Self-Review

**Spec-Abdeckung.** § 4.1 Tabelle und Indizes: Task 1. Rechte und Migration bestehender Rollen: Task 1. § 5.1 Services samt `deleteFollowUpsFor` und Haken: Task 2 und 3. `McpToolDefinition.service`: Task 3. § 6 `followups_*`: Task 5. Löschpolitik (§ 4.1, 4.2, 4.4, 4.5): Task 4. Der Wrapper `createDocumentFollowUp` und `followUpTargets` der Akte: Plan 2. Startseite: Plan 4.

**Platzhalter.** Keine. Der einzige „genauso“-Schritt (Task 5, `service` an bestehende Werkzeuge) nennt die Regel und Beispiele; jeder Handler ruft genau einen Service, der schon importiert ist.

**Typen.** `FollowUpRecord`, `FollowUpTarget`, `FollowUpWithTarget` sind in Task 2 und 3 definiert und in Task 5 so benutzt. `deleteFollowUpsFor(tx, entityType, entityId): number` — Plan 2 ruft es mit `(tx, 'document', doc.id)`.
