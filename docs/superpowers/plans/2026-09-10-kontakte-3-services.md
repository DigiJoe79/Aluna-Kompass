# Kontakte 3 — Services, Rechte, Löschen und MCP (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kontakte lassen sich anlegen, ändern, suchen, mit Rollen und Kommunikationswegen versehen — und erst löschen, wenn kein Halter mehr läuft. Alles auch über MCP, mit einer bewussten Ausnahme.

**Architecture:** Services nach der Hausform `fn(deps, ctx, input) → Promise<Result<T>>` mit `requirePermission → validate → transaction → recordAudit → ok`. Das Kontaktmodul beantwortet den eigenen `retentionHolds`-Haken aus seinen Rollen; `deleteContact` fragt den Kern und lehnt ab, solange etwas hält.

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-kontakte-design.md` (§ 5.4 Löschen, § 6 Services, Rechte und MCP)

## Global Constraints

- Service-Signatur `fn(deps, ctx, input) → Promise<Result<T>>`; Ablauf `requirePermission` → `validate` (Zod) → `db.transaction` → `recordAudit` in derselben Transaktion → `ok(...)`.
- Fachfehler sind `Result`-Werte, nie Exceptions. Nur technische Fehler werfen.
- Pro Service mindestens vier Tests: Erfolg, `forbidden`, `validation`, Audit-Eintrag.
- Keine Löschfunktion ohne Eintrag in `DELETION_POLICY` (`packages/core/src/deletion-policy.ts`).
- Ein neues Modul bringt seine Werkzeuge mit: zu jedem Permission-Key gehört mindestens ein MCP-Werkzeug, das ihn in seiner Beschreibung nennt. Ausnahmen stehen begründet in `apps/kompass/tests/mcp-tools.test.ts`.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.

## File Structure

| Datei | Verantwortung |
|---|---|
| `packages/modules/contacts/src/service.ts` | alle Kontakt-Services und ihre Zod-Schemata |
| `packages/modules/contacts/src/retention.ts` | `contactsRetentionHolds`, `contactsRetentionDue` |
| `packages/modules/contacts/src/mcp-tools.ts` | `CONTACTS_MCP_TOOLS` |
| `packages/modules/contacts/src/manifest.ts` | Haken und Werkzeuge einhängen |
| `packages/modules/contacts/tests/service.test.ts` | Stamm, Wege, Rollen |
| `packages/modules/contacts/tests/delete.test.ts` | Halter, Fälligkeit, Löschen |
| `packages/core/src/deletion-policy.ts` | `retentionClass`, Regel für `contact` |
| `apps/kompass/tests/mcp-tools.test.ts` | Begründung für das fehlende Löschwerkzeug |

---

### Task 1: Stammdaten — anlegen, ändern, lesen, listen

**Files:**
- Create: `packages/modules/contacts/src/service.ts`
- Create: `packages/modules/contacts/tests/service.test.ts`

**Interfaces:**
- Consumes: `contacts`, `contactChannels`, `contactRoles` (Plan 1 Task 1); `formatPostalAddress`, `displayName` (Plan 1 Task 2).
- Produces:
  - `ContactRecord = ContactRow & { channels: ContactChannelRow[]; roles: ContactRoleRow[]; belongsTo: ContactRow | null }`
  - `contactCreateSchema`, `contactUpdateSchema`, `contactListSchema`
  - `createContact`, `updateContact`, `getContact`, `listContacts`, `setContactStatus`

- [ ] **Step 1: Den Test schreiben**

`packages/modules/contacts/tests/service.test.ts`:

```typescript
import { coreModule, schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { createContact, getContact, listContacts, setContactStatus, updateContact } from '../src/service';

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['contacts.view', 'contacts.manage'], userId), userId };
}

const anna = { kind: 'person' as const, salutation: 'Frau', firstName: 'Anna', lastName: 'Berger', street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt' };

describe('contacts service', () => {
  it('creates a person, reads it back with an empty role and channel list, and audits it', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, anna));
    expect(created).toMatchObject({ kind: 'person', lastName: 'Berger', status: 'active' });
    expect(created.roles).toEqual([]);
    expect(created.channels).toEqual([]);
    expect(created.belongsTo).toBeNull();

    const audit = deps.db.select().from(schema.auditLog).all().filter((e) => e.action === 'contacts.create');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toContain('Anna Berger');
  });

  it('requires a last name for a person and a name for an organisation', async () => {
    const { deps, ctx } = setup();
    const noLastName = await createContact(deps, ctx, { kind: 'person', firstName: 'Anna' });
    expect(noLastName.ok === false && noLastName.error.type === 'validation').toBe(true);
    const noName = await createContact(deps, ctx, { kind: 'organization' });
    expect(noName.ok === false && noName.error.type === 'validation').toBe(true);
    expect((await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt' })).ok).toBe(true);
  });

  it('refuses without contacts.manage', async () => {
    const { deps } = setup();
    const denied = await createContact(deps, ctxWith(['contacts.view']), anna);
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });

  it('updates a contact and records what changed', async () => {
    const { deps, ctx } = setup();
    const created = unwrap(await createContact(deps, ctx, anna));
    const updated = unwrap(await updateContact(deps, ctx, { id: created.id, city: 'Neustadt' }));
    expect(updated.city).toBe('Neustadt');
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.update')).toBe(true);
    const missing = await updateContact(deps, ctx, { id: 'GIBTSNICHT', city: 'x' });
    expect(missing.ok === false && missing.error.type === 'notFound').toBe(true);
  });

  it('resolves belongsTo when a person sits at an organisation', async () => {
    const { deps, ctx } = setup();
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt', street: 'Bankplatz 2', postalCode: '12345', city: 'Musterstadt' }));
    const person = unwrap(await createContact(deps, ctx, { kind: 'person', firstName: 'Bea', lastName: 'Klein', belongsToId: org.id }));
    expect(unwrap(await getContact(deps, ctx, person.id)).belongsTo?.name).toBe('Sparkasse Musterstadt');
  });

  it('refuses a belongsTo that points at a person or at itself', async () => {
    const { deps, ctx } = setup();
    const a = unwrap(await createContact(deps, ctx, anna));
    const atPerson = await createContact(deps, ctx, { kind: 'person', lastName: 'Klein', belongsToId: a.id });
    expect(atPerson.ok === false && atPerson.error.type === 'conflict' && atPerson.error.code === 'belongsToNotAnOrganization').toBe(true);
    const atSelf = await updateContact(deps, ctx, { id: a.id, belongsToId: a.id });
    expect(atSelf.ok === false && atSelf.error.type === 'conflict' && atSelf.error.code === 'belongsToNotAnOrganization').toBe(true);
  });

  it('lists actives newest first, filters by kind and finds by text', async () => {
    const { deps, ctx } = setup();
    unwrap(await createContact(deps, ctx, anna));
    deps.clock.advance(1000);
    const org = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Sparkasse Musterstadt', city: 'Musterstadt' }));
    deps.clock.advance(1000);
    const archived = unwrap(await createContact(deps, ctx, { kind: 'person', lastName: 'Alt' }));
    unwrap(await setContactStatus(deps, ctx, { id: archived.id, status: 'archived' }));

    const active = unwrap(await listContacts(deps, ctx, {}));
    expect(active.total).toBe(2);
    expect(active.contacts[0]!.id).toBe(org.id);
    expect(unwrap(await listContacts(deps, ctx, { kind: 'organization' })).total).toBe(1);
    expect(unwrap(await listContacts(deps, ctx, { text: 'berger' })).total).toBe(1);
    expect(unwrap(await listContacts(deps, ctx, { text: 'musterstadt' })).total).toBe(2);
    expect(unwrap(await listContacts(deps, ctx, { includeArchived: true })).total).toBe(3);
    expect((await listContacts(deps, ctxWith([]), {})).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- service`
Expected: FAIL — `Cannot find module '../src/service'`.

- [ ] **Step 3: Die Services schreiben**

`packages/modules/contacts/src/service.ts`:

```typescript
import {
  conflict, isoNow, newId, notFound, ok, recordAudit, requirePermission, validate,
  type CallContext, type DbOrTx, type Deps, type Result,
} from '@kompass/core';
import { and, count, desc, eq, like, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { displayName } from './address';
import { contactChannels, contactRoles, contacts, type ContactChannelRow, type ContactRoleRow, type ContactRow } from './schema';

export type ContactRecord = ContactRow & {
  channels: ContactChannelRow[];
  roles: ContactRoleRow[];
  belongsTo: ContactRow | null;
};

function loadContact(db: DbOrTx, id: string): ContactRecord | null {
  const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
  if (!row) return null;
  return {
    ...row,
    channels: db.select().from(contactChannels).where(eq(contactChannels.contactId, id)).all(),
    roles: db.select().from(contactRoles).where(eq(contactRoles.contactId, id)).all(),
    belongsTo: row.belongsToId ? (db.select().from(contacts).where(eq(contacts.id, row.belongsToId)).get() ?? null) : null,
  };
}

const address = {
  belongsToId: z.string().min(1).nullable().optional(),
  addressExtra: z.string().trim().max(200).nullable().optional(),
  street: z.string().trim().max(200).nullable().optional(),
  postalCode: z.string().trim().max(10).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
};

/**
 * Person und Organisation sind zwei Varianten desselben Kontakts. Welche Felder
 * Pflicht sind, entscheidet `kind` — deshalb eine Union statt eines Schemas mit
 * lauter optionalen Feldern.
 */
export const contactCreateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('person'),
    salutation: z.string().trim().max(60).nullable().optional(),
    firstName: z.string().trim().max(120).nullable().optional(),
    lastName: z.string().trim().min(1).max(120),
    ...address,
  }),
  z.object({
    kind: z.literal('organization'),
    name: z.string().trim().min(1).max(200),
    legalForm: z.string().trim().max(120).nullable().optional(),
    ...address,
  }),
]);

export const contactUpdateSchema = z.object({
  id: z.string().min(1),
  salutation: z.string().trim().max(60).nullable().optional(),
  firstName: z.string().trim().max(120).nullable().optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  legalForm: z.string().trim().max(120).nullable().optional(),
  ...address,
});

export const contactStatusSchema = z.object({ id: z.string().min(1), status: z.enum(['active', 'archived']) });

export const contactListSchema = z.object({
  kind: z.enum(['person', 'organization']).optional(),
  role: z.string().min(1).optional(),
  text: z.string().trim().min(1).optional(),
  includeArchived: z.boolean().default(false),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `belongsTo` darf nur auf eine Organisation zeigen und nie auf den Kontakt selbst. */
function belongsToProblem(db: DbOrTx, belongsToId: string | null | undefined, selfId?: string): Result<null> | null {
  if (!belongsToId) return null;
  if (belongsToId === selfId) return conflict('belongsToNotAnOrganization', 'Ein Kontakt kann nicht bei sich selbst sitzen');
  const target = db.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, belongsToId)).get();
  if (!target) return notFound('contact', belongsToId);
  if (target.kind !== 'organization') return conflict('belongsToNotAnOrganization', 'Zugehörigkeit ist nur zu einer Organisation möglich');
  return null;
}

export async function createContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactCreateSchema, input);
  if (!parsed.ok) return parsed;
  const problem = belongsToProblem(deps.db, parsed.value.belongsToId);
  if (problem) return problem as Result<ContactRecord>;
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(contacts).values({ id, ...parsed.value, status: 'active', createdAt: now, updatedAt: now }).run();
    const record = loadContact(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.create', entityType: 'contact', entityId: id, after: record, summary: `Kontakt ${displayName(record)} angelegt` });
    return ok(record);
  });
}

export async function updateContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactUpdateSchema, input);
  if (!parsed.ok) return parsed;
  const { id, ...changes } = parsed.value;
  const before = loadContact(deps.db, id);
  if (!before) return notFound('contact', id);
  const problem = belongsToProblem(deps.db, changes.belongsToId, id);
  if (problem) return problem as Result<ContactRecord>;
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contacts).set({ ...changes, updatedAt: isoNow(deps.clock) }).where(eq(contacts.id, id)).run();
    const after = loadContact(tx, id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.update', entityType: 'contact', entityId: id, before, after, summary: `Kontakt ${displayName(after)} geändert` });
    return ok(after);
  });
}

export async function setContactStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactStatusSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadContact(deps.db, parsed.value.id);
  if (!before) return notFound('contact', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contacts).set({ status: parsed.value.status, updatedAt: isoNow(deps.clock) }).where(eq(contacts.id, parsed.value.id)).run();
    const after = loadContact(tx, parsed.value.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.setStatus', entityType: 'contact', entityId: after.id, before: { status: before.status }, after: { status: after.status }, summary: `Kontakt ${displayName(after)} ${after.status === 'archived' ? 'archiviert' : 'reaktiviert'}` });
    return ok(after);
  });
}

export async function getContact(deps: Deps, ctx: CallContext, id: string): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const record = loadContact(deps.db, id);
  return record ? ok(record) : notFound('contact', id);
}

export async function listContacts(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ contacts: ContactRecord[]; total: number }>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const parsed = validate(deps, contactListSchema, input);
  if (!parsed.ok) return parsed;
  const q = parsed.value;

  const conditions: SQL[] = [];
  if (!q.includeArchived) conditions.push(eq(contacts.status, 'active'));
  if (q.kind) conditions.push(eq(contacts.kind, q.kind));
  if (q.text) {
    // SQLite `like` ist bei ASCII ohnehin case-insensitive; für Umlaute reicht
    // das nicht, deshalb wird zusätzlich klein geschrieben verglichen.
    const needle = `%${q.text.toLowerCase()}%`;
    const hit = (col: typeof contacts.lastName) => like(sqlLower(col), needle);
    conditions.push(or(hit(contacts.lastName), hit(contacts.firstName), hit(contacts.name), hit(contacts.city))!);
  }
  if (q.role) {
    const ids = deps.db.select({ id: contactRoles.contactId }).from(contactRoles).where(eq(contactRoles.role, q.role)).all().map((r) => r.id);
    if (ids.length === 0) return ok({ contacts: [], total: 0 });
    conditions.push(or(...ids.map((id) => eq(contacts.id, id)))!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const total = deps.db.select({ n: count() }).from(contacts).where(where).get()?.n ?? 0;
  const rows = deps.db.select({ id: contacts.id }).from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(q.limit).offset(q.offset).all();
  return ok({ contacts: rows.map((r) => loadContact(deps.db, r.id)!), total });
}
```

Für `sqlLower` oben oben in der Datei ergänzen:

```typescript
import { sql, type SQLWrapper } from 'drizzle-orm';

/** `lower()` in SQL, damit die Suche auch Umlaute in Großschreibung findet. */
const sqlLower = (col: SQLWrapper) => sql<string>`lower(${col})`;
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test -- service`
Expected: PASS (sieben Tests).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/contacts/src/service.ts packages/modules/contacts/tests/service.test.ts
git commit -m "feat(contacts): create, update, read and list contacts"
```

---

### Task 2: Kommunikationswege und Rollen

**Files:**
- Modify: `packages/modules/contacts/src/service.ts`
- Modify: `packages/modules/contacts/tests/service.test.ts`

**Interfaces:**
- Consumes: `contactRoleDefinitions` (Plan 2 Task 4).
- Produces: `setContactChannels`, `addContactRole`, `endContactRole`, dazu `contactChannelsSchema`, `contactRoleAddSchema`, `contactRoleEndSchema`.

- [ ] **Step 1: Den Test ergänzen**

An `packages/modules/contacts/tests/service.test.ts` anhängen:

```typescript
import { addContactRole, endContactRole, setContactChannels } from '../src/service';

describe('contact channels and roles', () => {
  it('replaces the whole channel set and keeps exactly one primary', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const withTwo = unwrap(await setContactChannels(deps, ctx, {
      id: c.id,
      channels: [
        { kind: 'email', value: 'anna@example.org', isPrimary: true },
        { kind: 'mobile', value: '0157 000', label: 'privat' },
      ],
    }));
    expect(withTwo.channels).toHaveLength(2);
    expect(withTwo.channels.filter((ch) => ch.isPrimary)).toHaveLength(1);

    const replaced = unwrap(await setContactChannels(deps, ctx, { id: c.id, channels: [{ kind: 'phone', value: '030 000' }] }));
    expect(replaced.channels.map((ch) => ch.kind)).toEqual(['phone']);
    // Ohne ausdrückliche Angabe wird der erste Weg der primäre.
    expect(replaced.channels[0]!.isPrimary).toBe(true);
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.setChannels')).toBe(true);
  });

  it('refuses more than one primary channel', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const bad = await setContactChannels(deps, ctx, { id: c.id, channels: [{ kind: 'email', value: 'a@example.org', isPrimary: true }, { kind: 'phone', value: '1', isPrimary: true }] });
    expect(bad.ok === false && bad.error.type === 'conflict' && bad.error.code === 'multiplePrimaryChannels').toBe(true);
  });

  it('adds a known role and refuses an unknown one', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const withRole = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    expect(withRole.roles.map((r) => [r.role, r.since, r.until])).toEqual([['interested', '2026-01-01', null]]);

    const unknown = await addContactRole(deps, ctx, { id: c.id, role: 'erfunden', since: '2026-01-01' });
    expect(unknown.ok === false && unknown.error.type === 'validation' && unknown.error.issues[0]?.path === 'role').toBe(true);
  });

  it('refuses the same role twice while it is still running', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    const again = await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-02-01' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'roleAlreadyRunning').toBe(true);
  });

  it('ends a role by setting until, without deleting the row', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-01-01' }));
    const ended = unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2026-06-30' }));
    expect(ended.roles).toHaveLength(1);
    expect(ended.roles[0]!.until).toBe('2026-06-30');
    expect(deps.db.select().from(schema.auditLog).all().some((e) => e.action === 'contacts.endRole')).toBe(true);

    // Danach darf dieselbe Rolle wieder beginnen.
    expect((await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-07-01' })).ok).toBe(true);
  });

  it('refuses both without contacts.manage', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    expect((await setContactChannels(deps, ctxWith(['contacts.view']), { id: c.id, channels: [] })).ok).toBe(false);
    expect((await addContactRole(deps, ctxWith(['contacts.view']), { id: c.id, role: 'interested', since: '2026-01-01' })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- service`
Expected: FAIL — `setContactChannels is not a function`.

- [ ] **Step 3: Die drei Services schreiben**

An `packages/modules/contacts/src/service.ts` anhängen:

```typescript
import { isNull } from 'drizzle-orm';
import { contactRoleDefinitions } from './roles';

export const contactChannelsSchema = z.object({
  id: z.string().min(1),
  channels: z
    .array(
      z.object({
        kind: z.enum(['email', 'phone', 'mobile', 'fax', 'web']),
        value: z.string().trim().min(1).max(200),
        label: z.string().trim().max(60).nullable().optional(),
        isPrimary: z.boolean().default(false),
      }),
    )
    .max(20),
});

/** Ersetzt die Menge der Kommunikationswege — dasselbe Muster wie `setAnimalPhotos`. */
export async function setContactChannels(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactChannelsSchema, input);
  if (!parsed.ok) return parsed;
  const before = loadContact(deps.db, parsed.value.id);
  if (!before) return notFound('contact', parsed.value.id);
  const marked = parsed.value.channels.filter((c) => c.isPrimary);
  if (marked.length > 1) return conflict('multiplePrimaryChannels', 'Es kann nur einen primären Kommunikationsweg geben');

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(contactChannels).where(eq(contactChannels.contactId, before.id)).run();
    parsed.value.channels.forEach((channel, index) => {
      tx.insert(contactChannels)
        .values({
          id: newId(),
          contactId: before.id,
          kind: channel.kind,
          value: channel.value,
          label: channel.label ?? null,
          // Ohne ausdrückliche Angabe ist der erste Weg der primäre.
          isPrimary: marked.length === 0 ? index === 0 : channel.isPrimary,
        })
        .run();
    });
    const after = loadContact(tx, before.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.setChannels', entityType: 'contact', entityId: after.id, before: before.channels, after: after.channels, summary: `Kommunikationswege von ${displayName(after)} geändert` });
    return ok(after);
  });
}

export const contactRoleAddSchema = z.object({
  id: z.string().min(1),
  role: z.string().min(1),
  since: z.iso.date(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const contactRoleEndSchema = z.object({ roleId: z.string().min(1), until: z.iso.date() });

export async function addContactRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactRoleAddSchema, input);
  if (!parsed.ok) return parsed;
  // Die Rolle muss aus der Registry kommen, weil an ihr die Frist hängt.
  const known = contactRoleDefinitions(deps);
  if (!known.has(parsed.value.role)) {
    return validate(deps, z.object({ role: z.enum([...known.keys()] as [string, ...string[]]) }), { role: parsed.value.role }) as Result<ContactRecord>;
  }
  const contact = loadContact(deps.db, parsed.value.id);
  if (!contact) return notFound('contact', parsed.value.id);
  if (contact.roles.some((r) => r.role === parsed.value.role && r.until === null)) {
    return conflict('roleAlreadyRunning', `Die Rolle „${parsed.value.role}" läuft bereits`);
  }
  return deps.db.transaction((tx: DbOrTx) => {
    tx.insert(contactRoles).values({ id: newId(), contactId: contact.id, role: parsed.value.role, since: parsed.value.since, until: null, note: parsed.value.note ?? null }).run();
    const after = loadContact(tx, contact.id)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.addRole', entityType: 'contact', entityId: after.id, after: { role: parsed.value.role, since: parsed.value.since }, summary: `Rolle ${parsed.value.role} für ${displayName(after)} begonnen` });
    return ok(after);
  });
}

/** Beendet eine Rolle. Die Zeile bleibt stehen — an ihr hängt die Frist. */
export async function endContactRole(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ContactRecord>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactRoleEndSchema, input);
  if (!parsed.ok) return parsed;
  const row = deps.db.select().from(contactRoles).where(eq(contactRoles.id, parsed.value.roleId)).get();
  if (!row) return notFound('contactRole', parsed.value.roleId);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(contactRoles).set({ until: parsed.value.until }).where(eq(contactRoles.id, row.id)).run();
    const after = loadContact(tx, row.contactId)!;
    recordAudit(tx, deps, ctx, { action: 'contacts.endRole', entityType: 'contact', entityId: after.id, before: { role: row.role, until: null }, after: { role: row.role, until: parsed.value.until }, summary: `Rolle ${row.role} für ${displayName(after)} beendet` });
    return ok(after);
  });
}
```

Der Import `isNull` wird nur gebraucht, falls du die laufende Rolle über SQL statt über `loadContact` suchst — lässt du es wie oben, entferne ihn wieder.

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test -- service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/contacts/src/service.ts packages/modules/contacts/tests/service.test.ts
git commit -m "feat(contacts): communication channels and roles that end instead of vanishing"
```

---

### Task 3: Halter, Fälligkeit und Löschen

**Files:**
- Create: `packages/modules/contacts/src/retention.ts`
- Create: `packages/modules/contacts/tests/delete.test.ts`
- Modify: `packages/modules/contacts/src/service.ts`, `packages/modules/contacts/src/manifest.ts`, `packages/modules/contacts/src/index.ts`
- Modify: `packages/core/src/deletion-policy.ts`

**Interfaces:**
- Consumes: `holdsFor`, `dueUntil`, `retentionEnd`, `retentionMonths` (Plan 2).
- Produces:
  - `contactsRetentionHolds(deps, entityType, id): RetentionHold[]` — die Rollen des Kontakts als Halter
  - `contactsRetentionDue(deps): DueItem[]`
  - `contactRetention(deps, ctx, id): Result<{ holds: RetentionHold[]; until: string | null; due: boolean }>`
  - `listDueContacts(deps, ctx): Result<DueItem[]>`
  - `deleteContact(deps, ctx, input): Result<{ id: string }>`

- [ ] **Step 1: Den Test schreiben**

`packages/modules/contacts/tests/delete.test.ts`:

```typescript
import { coreModule, defineModule, schema, unwrap, writeSettingInternal, type ModuleManifest } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactRetention, createContact, deleteContact, listDueContacts, addContactRole, endContactRole } from '../src/service';
import { contactChannels, contactRoles, contacts } from '../src/schema';

/** Ein Fachmodul, das einen Kontakt über ein Dokument festhält. */
const holdingModule: ModuleManifest = defineModule({
  key: 'finance',
  version: '1',
  permissions: ['finance.view'],
  dependsOn: ['contacts'],
  contactRoles: [{ key: 'donor', retention: 'statutory10Y' }],
  retentionHolds: (_deps, entityType, id) =>
    entityType === 'contact' && id === 'HELD' ? [{ label: 'Zuwendungsbestätigung BST-2026-0042', until: '2036-12-31', entity: 'document', id: 'D1' }] : [],
});

function setup(manifests: ModuleManifest[] = [coreModule, contactsModule], enabled = ['contacts']) {
  const deps = createTestDeps({ manifests });
  const userId = insertUser(deps, {});
  const ctx = ctxWith(['contacts.view', 'contacts.manage'], userId);
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', enabled, 'test.enable');
  });
  return { deps, ctx, userId };
}

const anna = { kind: 'person' as const, firstName: 'Anna', lastName: 'Berger' };

describe('contact retention and deletion', () => {
  it('reports a running role as a hold with its computed end date', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-03-15' }));

    const r = unwrap(await contactRetention(deps, ctx, c.id));
    // consent = 24 Monate, gerechnet ab Ablauf des Kalenderjahres 2026.
    expect(r.until).toBe('2028-12-31');
    expect(r.due).toBe(false);
    expect(r.holds[0]!.label).toContain('interested');
  });

  it('never becomes due while a permanent role runs', async () => {
    const { deps, ctx } = setup();
    const office = unwrap(await createContact(deps, ctx, { kind: 'organization', name: 'Finanzamt Musterstadt' }));
    unwrap(await addContactRole(deps, ctx, { id: office.id, role: 'authority', since: '2026-01-01' }));
    const r = unwrap(await contactRetention(deps, ctx, office.id));
    expect(r.until).toBeNull();
    expect(r.due).toBe(false);
  });

  it('takes the longest hold across modules', async () => {
    const { deps, ctx } = setup([coreModule, contactsModule, holdingModule], ['contacts', 'finance']);
    deps.db.insert(contacts).values({ id: 'HELD', kind: 'person', lastName: 'Spender', status: 'active', createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' }).run();
    deps.db.insert(contactRoles).values({ id: 'RR', contactId: 'HELD', role: 'interested', since: '2026-03-15' }).run();

    const r = unwrap(await contactRetention(deps, ctx, 'HELD'));
    expect(r.until).toBe('2036-12-31');
    expect(r.holds.map((h) => h.label).some((l) => l.includes('BST-2026-0042'))).toBe(true);
  });

  it('refuses to delete while a hold is running and names the holders', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2026-03-15' }));
    const res = await deleteContact(deps, ctx, { id: c.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'retentionHoldActive').toBe(true);
    expect(res.ok === false && res.error.message).toContain('interested');
  });

  it('deletes a contact with no running hold, removes its rows and audits it', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2020-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2021-01-01' }));
    // consent ab Ablauf 2021 = 31.12.2023, die Testuhr steht 2026 → fällig.

    expect(unwrap(await deleteContact(deps, ctx, { id: c.id })).id).toBe(c.id);
    expect(deps.db.select().from(contacts).all()).toHaveLength(0);
    expect(deps.db.select().from(contactRoles).all()).toHaveLength(0);
    expect(deps.db.select().from(contactChannels).all()).toHaveLength(0);
    const entry = deps.db.select().from(schema.auditLog).all().find((e) => e.action === 'contacts.delete');
    expect(entry?.summary).toContain('Anna Berger');
  });

  it('refuses to delete a contact that nothing holds at all, because nothing proves it may go', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const res = await deleteContact(deps, ctx, { id: c.id });
    expect(res.ok === false && res.error.type === 'conflict' && res.error.code === 'retentionUnknown').toBe(true);
  });

  it('lists the due contacts and refuses the list without contacts.manage', async () => {
    const { deps, ctx } = setup();
    const c = unwrap(await createContact(deps, ctx, anna));
    const added = unwrap(await addContactRole(deps, ctx, { id: c.id, role: 'interested', since: '2020-01-01' }));
    unwrap(await endContactRole(deps, ctx, { roleId: added.roles[0]!.id, until: '2021-01-01' }));

    const due = unwrap(await listDueContacts(deps, ctx));
    expect(due.map((d) => d.id)).toEqual([c.id]);
    expect(due[0]!.dueSince).toBe('2023-12-31');
    expect((await listDueContacts(deps, ctxWith(['contacts.view']))).ok).toBe(false);
  });
});
```

**Zur vorletzten Erwartung:** Ein Kontakt ganz ohne Rolle und ohne fremden Halter ist *nicht* automatisch löschbar. Es gibt keinen Nachweis, dass seine Frist abgelaufen ist — es gibt gar keine. Deshalb `retentionUnknown` statt stiller Freigabe: Wer so einen Kontakt loswerden will, gibt ihm zuerst eine Rolle oder archiviert ihn.

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- delete`
Expected: FAIL — `Cannot find module '../src/retention'` bzw. `contactRetention is not a function`.

- [ ] **Step 3: Die Halter des Kontaktmoduls schreiben**

`packages/modules/contacts/src/retention.ts`:

```typescript
import { dueUntil, holdsFor, retentionEnd, retentionMonths, type Deps, type DueItem, type RetentionHold } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { displayName } from './address';
import { contactRoleDefinitions } from './roles';
import { contactRoles, contacts } from './schema';

/**
 * Die Rollen eines Kontakts als Halter. Eine laufende Rolle (`until === null`)
 * hält bis auf Weiteres — ihr Ende steht noch nicht fest, also rechnet sie ab
 * heute. Eine beendete Rolle hält ab ihrem Ende.
 */
export function contactsRetentionHolds(deps: Deps, entityType: string, id: string): RetentionHold[] {
  if (entityType !== 'contact') return [];
  const definitions = contactRoleDefinitions(deps);
  const rows = deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, id)).all();
  return rows.flatMap((row) => {
    const definition = definitions.get(row.role);
    if (!definition) return [];
    if (definition.retention === 'permanent') return [{ label: `Rolle ${row.role} (dauerhaft)`, until: null, entity: 'contactRole', id: row.id }];
    const months = retentionMonths(deps, definition.retention);
    if (months === null) return [];
    const from = row.until ?? deps.clock.now().toISOString();
    return [{ label: `Rolle ${row.role}`, until: retentionEnd(from, months), entity: 'contactRole', id: row.id }];
  });
}

/** Kontakte, deren sämtliche Halter abgelaufen sind. */
export function contactsRetentionDue(deps: Deps): DueItem[] {
  const today = deps.clock.now().toISOString().slice(0, 10);
  const due: DueItem[] = [];
  for (const row of deps.db.select().from(contacts).all()) {
    const holds = holdsFor(deps, 'contact', row.id);
    if (holds.length === 0) continue; // ohne Halter ist nichts nachgewiesen — siehe `retentionUnknown`
    const until = dueUntil(holds);
    if (until !== null && until < today) due.push({ entity: 'contact', id: row.id, label: displayName(row), dueSince: until });
  }
  return due;
}
```

- [ ] **Step 4: Die drei Services ergänzen**

An `packages/modules/contacts/src/service.ts` anhängen:

```typescript
import { dueUntil, holdsFor, type DueItem, type RetentionHold } from '@kompass/core';
import { contactsRetentionDue } from './retention';

/** Bis wann dieser Kontakt gehalten wird — und von wem, damit man es nachlesen kann. */
export async function contactRetention(
  deps: Deps,
  ctx: CallContext,
  id: string,
): Promise<Result<{ holds: RetentionHold[]; until: string | null; due: boolean }>> {
  const denied = requirePermission(ctx, 'contacts.view');
  if (denied) return denied;
  const contact = deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
  if (!contact) return notFound('contact', id);
  const holds = holdsFor(deps, 'contact', id);
  const until = dueUntil(holds);
  const today = deps.clock.now().toISOString().slice(0, 10);
  return ok({ holds, until, due: holds.length > 0 && until !== null && until < today });
}

export async function listDueContacts(deps: Deps, ctx: CallContext): Promise<Result<DueItem[]>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  return ok(contactsRetentionDue(deps));
}

export const contactDeleteSchema = z.object({ id: z.string().min(1) });

/**
 * Löscht einen Kontakt samt Rollen und Kommunikationswegen — aber erst, wenn
 * kein Halter mehr läuft. Was verschwindet, ist der Inhalt; dass jemand ihn
 * entfernt hat, bleibt im Änderungsprotokoll (Prinzip 3).
 */
export async function deleteContact(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'contacts.manage');
  if (denied) return denied;
  const parsed = validate(deps, contactDeleteSchema, input);
  if (!parsed.ok) return parsed;
  const contact = loadContact(deps.db, parsed.value.id);
  if (!contact) return notFound('contact', parsed.value.id);

  const holds = holdsFor(deps, 'contact', contact.id);
  if (holds.length === 0) {
    return conflict('retentionUnknown', 'Für diesen Kontakt ist keine Frist nachgewiesen. Vergeben Sie eine Rolle oder archivieren Sie ihn.');
  }
  const until = dueUntil(holds);
  const today = deps.clock.now().toISOString().slice(0, 10);
  if (until === null || until >= today) {
    return conflict('retentionHoldActive', `Noch gehalten von: ${holds.map((h) => `${h.label}${h.until ? ` (bis ${h.until})` : ' (dauerhaft)'}`).join('; ')}`);
  }

  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(contactChannels).where(eq(contactChannels.contactId, contact.id)).run();
    tx.delete(contactRoles).where(eq(contactRoles.contactId, contact.id)).run();
    tx.delete(contacts).where(eq(contacts.id, contact.id)).run();
    recordAudit(tx, deps, ctx, { action: 'contacts.delete', entityType: 'contact', entityId: contact.id, before: { name: displayName(contact), until }, summary: `Kontakt ${displayName(contact)} nach Fristablauf gelöscht` });
    return ok({ id: contact.id });
  });
}
```

- [ ] **Step 5: Die Haken ans Manifest hängen**

In `packages/modules/contacts/src/manifest.ts` innerhalb von `defineModule` ergänzen:

```typescript
  retentionHolds: contactsRetentionHolds,
  retentionDue: contactsRetentionDue,
```

mit `import { contactsRetentionDue, contactsRetentionHolds } from './retention';` am Dateikopf. In `packages/modules/contacts/src/index.ts` ergänzen:

```typescript
export * from './retention';
export * from './service';
```

- [ ] **Step 6: Die Löschpolitik nachziehen**

In `packages/core/src/deletion-policy.ts` das Feld ergänzen:

```typescript
  /** Nur bei deletable: die Aufbewahrungsklasse, nach deren Ablauf gelöscht werden darf. */
  retentionClass?: RetentionClass;
```

mit `import type { RetentionClass } from './retention/classes';` am Dateikopf, und eine Regel in `DELETION_POLICY` aufnehmen:

```typescript
  {
    entity: 'contact',
    deletable: true,
    reason:
      'Personenbezogene Daten sind nach Wegfall des Zwecks zu löschen (DSGVO Art. 17). Die gesetzliche Aufbewahrung sticht diese Pflicht nur, solange sie läuft.',
    guard: 'Erst wenn kein Halter mehr läuft — geprüft über retentionHolds aller aktiven Module. Ohne nachgewiesene Frist bleibt der Kontakt bestehen.',
    auditAction: 'contacts.delete',
  },
```

- [ ] **Step 7: Tests laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test && pnpm --filter @kompass/core test -- deletion-policy`
Expected: PASS. Der bestehende Test „deletable rules carry a guard and a well-formed audit action" muss grün bleiben.

- [ ] **Step 8: Commit**

```bash
git add packages/modules/contacts packages/core/src/deletion-policy.ts
git commit -m "feat(contacts): delete only after every retention hold has run out"
```

---

### Task 4: MCP-Werkzeuge

**Files:**
- Create: `packages/modules/contacts/src/mcp-tools.ts`
- Modify: `packages/modules/contacts/src/manifest.ts`, `packages/modules/contacts/src/index.ts`
- Modify: `apps/kompass/src/modules.ts`, `apps/kompass/package.json`
- Modify: `apps/kompass/tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: alle Services aus Tasks 1–3.
- Produces: `CONTACTS_MCP_TOOLS: McpToolDefinition[]` mit `contacts_list`, `contacts_get`, `contacts_retention`, `contacts_create`, `contacts_update`, `contacts_set_channels`, `contacts_add_role`, `contacts_end_role`, `contacts_set_status`, `contacts_due`.

- [ ] **Step 1: Die Werkzeuge schreiben**

Hier ist kein eigener neuer Test nötig: `apps/kompass/tests/mcp-tools.test.ts` prüft die Werkzeuge bereits (jedes Recht genannt, jedes Argument benannt, nichts offen). Dieser Test ist seit Plan 1 rot — er ist der rote Test dieses Tasks. Überzeuge dich davon zuerst:

Run: `pnpm --filter @kompass/app test -- mcp-tools`
Expected: FAIL mit `contacts: contacts.view` und `contacts: contacts.manage`, sobald das Modul in `installedModules` steht (Schritt 3 unten). Steht es noch nicht drin, hole Plan 1 Task 3 Schritt 5 zuerst nach.

`packages/modules/contacts/src/mcp-tools.ts`:

```typescript
import type { McpToolDefinition } from '@kompass/core';
import { z } from 'zod';
import {
  addContactRole, contactChannelsSchema, contactCreateSchema, contactListSchema, contactRetention,
  contactRoleAddSchema, contactRoleEndSchema, contactStatusSchema, contactUpdateSchema, createContact,
  endContactRole, getContact, listContacts, listDueContacts, setContactChannels, setContactStatus, updateContact,
} from './service';

const t = (name: string, description: string, inputSchema: z.ZodType<unknown>, handler: McpToolDefinition['handler']): McpToolDefinition => ({ name, description, inputSchema, handler });

export const CONTACTS_MCP_TOOLS: McpToolDefinition[] = [
  t('contacts_list', 'List contacts, filtered by kind, role or free text. Requires contacts.view.', contactListSchema, (deps, ctx, args) => listContacts(deps, ctx, args)),
  t('contacts_get', 'Read one contact with its channels, roles and affiliation. Requires contacts.view.', z.object({ id: z.string() }), (deps, ctx, args) => getContact(deps, ctx, (args as { id: string }).id)),
  t('contacts_retention', 'Report until when a contact is held and by whom. Requires contacts.view.', z.object({ id: z.string() }), (deps, ctx, args) => contactRetention(deps, ctx, (args as { id: string }).id)),
  t('contacts_create', 'Create a person or an organisation. Requires contacts.manage.', contactCreateSchema, (deps, ctx, args) => createContact(deps, ctx, args)),
  t('contacts_update', 'Update a contact. Requires contacts.manage.', contactUpdateSchema, (deps, ctx, args) => updateContact(deps, ctx, args)),
  t('contacts_set_channels', 'Replace the communication channels of a contact. Requires contacts.manage.', contactChannelsSchema, (deps, ctx, args) => setContactChannels(deps, ctx, args)),
  t('contacts_add_role', 'Start a role for a contact. Requires contacts.manage.', contactRoleAddSchema, (deps, ctx, args) => addContactRole(deps, ctx, args)),
  t('contacts_end_role', 'End a role of a contact without deleting it. Requires contacts.manage.', contactRoleEndSchema, (deps, ctx, args) => endContactRole(deps, ctx, args)),
  t('contacts_set_status', 'Archive or reactivate a contact. Requires contacts.manage.', contactStatusSchema, (deps, ctx, args) => setContactStatus(deps, ctx, args)),
  t('contacts_due', 'List contacts whose retention has run out and that are due for deletion. Requires contacts.manage.', z.object({}), (deps, ctx) => listDueContacts(deps, ctx)),
];
```

- [ ] **Step 2: Einhängen**

In `packages/modules/contacts/src/manifest.ts` `mcpTools: CONTACTS_MCP_TOOLS,` ergänzen, mit Import. In `packages/modules/contacts/src/index.ts` `export * from './mcp-tools';` ergänzen.

- [ ] **Step 3: Modul installieren (falls noch nicht geschehen)**

`apps/kompass/src/modules.ts` und `apps/kompass/package.json` wie in Plan 1 Task 3 Schritt 5 beschrieben, dann `pnpm install`.

- [ ] **Step 4: Die bewusste Ausnahme begründen**

In `apps/kompass/tests/mcp-tools.test.ts` einen eigenen Test ergänzen — `WITHOUT_MCP` bleibt unverändert, weil beide Rechte abgedeckt sind:

```typescript
  /**
   * `contacts_delete` fehlt bewusst. Das unwiederbringliche Löschen
   * personenbezogener Daten soll einen Menschen vor einem Bildschirm haben, der
   * zeigt, was gleich verschwindet. Ein Agent, der eine Fälligkeitsliste falsch
   * liest, löscht sonst dreißig Spender. Die Fälligkeitsliste selbst ist über
   * `contacts_due` lesbar — nur das Ausführen bleibt der Oberfläche vorbehalten.
   */
  it('offers no tool that deletes a contact', () => {
    expect(registeredTools.map((tool) => tool.name)).not.toContain('contacts_delete');
    expect(registeredTools.some((tool) => tool.name === 'contacts_due')).toBe(true);
  });
```

- [ ] **Step 5: Alles laufen lassen**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — insbesondere `mcp-tools.test.ts` wieder grün.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/contacts apps/kompass/src/modules.ts apps/kompass/package.json apps/kompass/tests/mcp-tools.test.ts pnpm-lock.yaml
git commit -m "feat(contacts): mcp tools for every permission, with deletion deliberately left out"
```

---

## Self-Review

**Spec-Abdeckung.** § 6 Tabelle: `createContact`/`updateContact` (Task 1), `setContactChannels`, `addContactRole`/`endContactRole` (Task 2), `setContactStatus`, `listContacts`, `getContact` (Task 1), `contactRetention`, `listDueContacts`, `deleteContact` (Task 3). § 6 MCP samt begründeter Lücke: Task 4. § 5.4 Löschen und Löschpolitik: Task 3 Schritte 4 und 6.

**Platzhalter.** Keine. Zwei Stellen verlangen einen Blick in die Zieldatei statt eines wörtlichen Diffs (Manifest-Ergänzungen, Löschpolitik-Eintrag) — der einzufügende Code steht jeweils vollständig da.

**Typkonsistenz.** `ContactRecord` (Task 1) ist der Rückgabetyp aller schreibenden Services, auch derer aus Task 2. `RetentionHold`/`DueItem` stammen aus Plan 2 Task 3 und werden hier unverändert benutzt. Die Schemanamen in `mcp-tools.ts` (Task 4) sind genau die aus Tasks 1–3 exportierten.

**Zwei bewusste Härten.**
1. `retentionUnknown`: Ein Kontakt ohne jeden Halter ist nicht löschbar. Stille Freigabe wäre der gefährlichere Weg — sie träfe genau die Kontakte, bei denen niemand je eine Rolle gepflegt hat.
2. Eine laufende Rolle rechnet ab *heute*, nicht ab `since`. Solange jemand Spender ist, beginnt die Frist nicht zu laufen; sie beginnt, wenn die Rolle endet.
