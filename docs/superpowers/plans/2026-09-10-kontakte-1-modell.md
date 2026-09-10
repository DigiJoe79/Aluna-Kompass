# Kontakte 1 — Modul, Datenmodell und Anschrift (Implementierungsplan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Modul `contacts` existiert mit seinen drei Tabellen, ist installierbar und liefert den mehrzeiligen Anschriftsblock, den die Dokumentenpipeline später braucht.

**Architecture:** Ein Modulpaket nach dem Muster von `packages/modules/animals`: Schema im Modul, Migration zentral in `packages/core/src/db/migrations`, Manifest über `defineModule`. `formatPostalAddress` ist eine reine Funktion ohne `ctx`, damit sie später aus der Dokumentenpipeline heraus aufrufbar ist.

**Tech Stack:** TypeScript, Drizzle (SQLite), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-kontakte-design.md` (§ 3 Entscheidungen 1–4, § 4 Datenmodell)

## Global Constraints

- Code Englisch, Oberflächentexte über i18n. Kein hartcodierter UI-Text (`AGENTS.md`, Prinzip 7).
- IDs über `newId()` (ULID). Zeit über `deps.clock.now()` bzw. `isoNow(deps.clock)` — nie `new Date()` in Fachcode.
- Fachfehler sind `Result`-Werte (`forbidden`, `validation`, `notFound`, `conflict`), nie Exceptions.
- Migrationen entstehen mit `pnpm --filter @kompass/core db:generate` und werden nie nachträglich editiert.
- TDD: kein Produktionscode ohne zuvor rot gesehenen Test.
- Vor dem Push `pnpm verify`. Docker liegt auf diesem Rechner unter `/Applications/Docker.app/Contents/Resources/bin` und ist eventuell nicht im PATH.

## File Structure

| Datei | Verantwortung |
|---|---|
| `packages/modules/contacts/package.json` | Paketdefinition `@kompass/module-contacts` |
| `packages/modules/contacts/tsconfig.json` | TypeScript-Konfiguration |
| `packages/modules/contacts/vitest.config.ts` | Testkonfiguration |
| `packages/modules/contacts/src/schema.ts` | Drizzle-Tabellen `contacts`, `contact_channels`, `contact_roles` |
| `packages/modules/contacts/src/address.ts` | `formatPostalAddress` — rein, ohne `ctx` |
| `packages/modules/contacts/src/manifest.ts` | `contactsModule` über `defineModule` |
| `packages/modules/contacts/src/index.ts` | Öffentliche Oberfläche des Pakets |
| `packages/modules/contacts/tests/address.test.ts` | Tests des Anschriftsblocks |
| `packages/core/src/db/migrations/00NN_contacts.sql` | erzeugte Migration |

---

### Task 1: Paketgerüst und Tabellen

**Files:**
- Create: `packages/modules/contacts/package.json`, `packages/modules/contacts/tsconfig.json`, `packages/modules/contacts/vitest.config.ts`
- Create: `packages/modules/contacts/src/schema.ts`
- Create: `packages/modules/contacts/tests/schema.test.ts`

**Interfaces:**
- Consumes: `schema as core` aus `@kompass/core` (für den Verweis auf `users` wird hier nichts gebraucht; der Selbstverweis bleibt innerhalb der Tabelle).
- Produces: `contacts`, `contactChannels`, `contactRoles` als Drizzle-Tabellen; die Typaliase `ContactRow = typeof contacts.$inferSelect`.

- [ ] **Step 1: Paketdateien anlegen**

`packages/modules/contacts/package.json` — exakt nach dem Muster von `packages/modules/animals/package.json`:

```json
{
  "name": "@kompass/module-contacts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@kompass/core": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.5.4"
  },
  "devDependencies": {
    "@types/node": "^26.4.1",
    "typescript": "^6.0.3",
    "vitest": "^5.0.0"
  }
}
```

`packages/modules/contacts/tsconfig.json` und `packages/modules/contacts/vitest.config.ts` wörtlich aus `packages/modules/animals/` kopieren — sie enthalten nichts Modulspezifisches.

Danach `pnpm install` ausführen, damit das Workspace-Paket verlinkt wird.

- [ ] **Step 2: Den Test schreiben, der die Tabellen festnagelt**

`packages/modules/contacts/tests/schema.test.ts`:

```typescript
import { createTestDeps } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactChannels, contactRoles, contacts } from '../src/schema';

describe('contacts schema', () => {
  it('stores a person, a channel and a role and reads them back', () => {
    const deps = createTestDeps();
    deps.db.insert(contacts).values({
      id: 'C1', kind: 'person', salutation: 'Frau', firstName: 'Anna', lastName: 'Berger',
      street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE',
      status: 'active', createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z',
    }).run();
    deps.db.insert(contactChannels).values({ id: 'CH1', contactId: 'C1', kind: 'email', value: 'anna@example.org', isPrimary: true }).run();
    deps.db.insert(contactRoles).values({ id: 'R1', contactId: 'C1', role: 'interested', since: '2026-01-01' }).run();

    const row = deps.db.select().from(contacts).all()[0]!;
    expect([row.kind, row.lastName, row.status]).toEqual(['person', 'Berger', 'active']);
    expect(deps.db.select().from(contactChannels).all()[0]!.isPrimary).toBe(true);
    expect(deps.db.select().from(contactRoles).all()[0]!.until).toBeNull();
  });

  it('links a person to an organisation through belongsToId', () => {
    const deps = createTestDeps();
    const base = { status: 'active' as const, createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z' };
    deps.db.insert(contacts).values({ id: 'ORG', kind: 'organization', name: 'Sparkasse Musterstadt', legalForm: 'Anstalt des öffentlichen Rechts', ...base }).run();
    deps.db.insert(contacts).values({ id: 'P', kind: 'person', firstName: 'Bea', lastName: 'Klein', belongsToId: 'ORG', ...base }).run();

    const person = deps.db.select().from(contacts).all().find((c) => c.id === 'P')!;
    expect(person.belongsToId).toBe('ORG');
  });
});
```

- [ ] **Step 3: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test`
Expected: FAIL — `Cannot find module '../src/schema'`.

- [ ] **Step 4: Das Schema schreiben**

`packages/modules/contacts/src/schema.ts`:

```typescript
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Ein Kontakt ist entweder eine natürliche Person oder eine Organisation.
 * `belongsToId` bildet die dritte Sorte aus dem Alltag ab: eine Person bei
 * einer Organisation („Frau Klein, Sparkasse"). Welche Felder Pflicht sind,
 * entscheidet `kind` — geprüft wird das in Zod, nicht in der Tabelle, weil
 * SQLite keine bedingten Constraints kennt.
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['person', 'organization'] }).notNull(),
    // Person
    salutation: text('salutation'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // Organisation
    name: text('name'),
    legalForm: text('legal_form'),
    // beide
    belongsToId: text('belongs_to_id'),
    addressExtra: text('address_extra'),
    street: text('street'),
    postalCode: text('postal_code'),
    city: text('city'),
    country: text('country'),
    notes: text('notes'),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('contacts_status_idx').on(t.status), index('contacts_belongs_to_idx').on(t.belongsToId)],
);

/** Kommunikationswege. Mehrere je Kontakt; genau einer darf `isPrimary` sein. */
export const contactChannels = sqliteTable(
  'contact_channels',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    kind: text('kind', { enum: ['email', 'phone', 'mobile', 'fax', 'web'] }).notNull(),
    value: text('value').notNull(),
    label: text('label'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('contact_channels_contact_idx').on(t.contactId)],
);

/**
 * Rollen über die Zeit. Eine Rolle endet über `until`; gelöscht wird sie nie,
 * weil an ihr die Aufbewahrungsfrist hängt.
 */
export const contactRoles = sqliteTable(
  'contact_roles',
  {
    id: text('id').primaryKey(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    role: text('role').notNull(),
    since: text('since').notNull(),
    until: text('until'),
    note: text('note'),
  },
  (t) => [index('contact_roles_contact_idx').on(t.contactId), index('contact_roles_role_idx').on(t.role)],
);

export type ContactRow = typeof contacts.$inferSelect;
export type ContactChannelRow = typeof contactChannels.$inferSelect;
export type ContactRoleRow = typeof contactRoles.$inferSelect;
```

- [ ] **Step 5: Migration erzeugen**

Run: `pnpm --filter @kompass/core db:generate`

Die Datei landet als `packages/core/src/db/migrations/00NN_<name>.sql`. Sie wird **nicht** editiert. Benenne sie nicht um — der Migrationsstand wird über die Reihenfolge geführt.

- [ ] **Step 6: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test`
Expected: PASS (beide Tests).

- [ ] **Step 7: Commit**

```bash
git add packages/modules/contacts packages/core/src/db/migrations pnpm-lock.yaml
git commit -m "feat(contacts): module scaffold with contacts, channels and roles tables"
```

---

### Task 2: Der Anschriftsblock

**Files:**
- Create: `packages/modules/contacts/src/address.ts`
- Create: `packages/modules/contacts/tests/address.test.ts`

**Interfaces:**
- Consumes: `ContactRow` aus `./schema` (Task 1).
- Produces: `formatPostalAddress(contact: PostalAddressInput, organisation?: PostalAddressInput | null, homeCountry?: string): string` — mehrzeilig, `\n`-getrennt, ohne Leerzeilen und ohne einsame Satzzeichen. `homeCountry` ist das Land des Vereins; nur ein davon abweichendes Land wird genannt. Dazu `displayName(contact): string` — der Name, unter dem angeschrieben wird; Plan 3 benutzt ihn in den Audit-Zusammenfassungen. `PostalAddressInput` ist ein Ausschnitt aus `ContactRow`, damit die Funktion auch mit Testobjekten aufrufbar bleibt.

- [ ] **Step 1: Den Test schreiben**

`packages/modules/contacts/tests/address.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatPostalAddress, type PostalAddressInput } from '../src/address';

const person: PostalAddressInput = {
  kind: 'person', salutation: 'Frau', firstName: 'Anna', lastName: 'Berger',
  name: null, legalForm: null, addressExtra: null,
  street: 'Musterweg 1', postalCode: '12345', city: 'Musterstadt', country: 'DE',
};

describe('formatPostalAddress', () => {
  it('writes a person as salutation, name, street, postal code and city', () => {
    expect(formatPostalAddress(person)).toBe('Frau\nAnna Berger\nMusterweg 1\n12345 Musterstadt');
  });

  it('writes an organisation with its name and skips the legal form', () => {
    const org: PostalAddressInput = { ...person, kind: 'organization', salutation: null, firstName: null, lastName: null, name: 'Musterverein e. V.', legalForm: 'e. V.' };
    expect(formatPostalAddress(org)).toBe('Musterverein e. V.\nMusterweg 1\n12345 Musterstadt');
  });

  it('puts the organisation first and the person as an attention line', () => {
    const org: PostalAddressInput = { ...person, kind: 'organization', salutation: null, firstName: null, lastName: null, name: 'Sparkasse Musterstadt', legalForm: null, street: 'Bankplatz 2', postalCode: '12345', city: 'Musterstadt' };
    const employee: PostalAddressInput = { ...person, salutation: 'Frau', firstName: 'Bea', lastName: 'Klein', street: null, postalCode: null, city: null };
    expect(formatPostalAddress(employee, org)).toBe('Sparkasse Musterstadt\nz. Hd. Frau Bea Klein\nBankplatz 2\n12345 Musterstadt');
  });

  it('keeps the address extra above the street', () => {
    expect(formatPostalAddress({ ...person, addressExtra: 'c/o Familie Meier' })).toBe('Frau\nAnna Berger\nc/o Familie Meier\nMusterweg 1\n12345 Musterstadt');
  });

  it('drops empty lines and never leaves a lone postal code or a stray space', () => {
    expect(formatPostalAddress({ ...person, street: null, postalCode: null, city: 'Musterstadt' })).toBe('Frau\nAnna Berger\nMusterstadt');
    expect(formatPostalAddress({ ...person, street: null, postalCode: '12345', city: null })).toBe('Frau\nAnna Berger\n12345');
    expect(formatPostalAddress({ ...person, salutation: null, street: null, postalCode: null, city: null })).toBe('Anna Berger');
  });

  it('names the country only when it differs from the given home country', () => {
    const abroad: PostalAddressInput = { ...person, country: 'AT', city: 'Wien', postalCode: '1010' };
    expect(formatPostalAddress(abroad, null, 'DE')).toBe('Frau\nAnna Berger\nMusterweg 1\n1010 Wien\nAT');
    expect(formatPostalAddress(person, null, 'DE')).toBe('Frau\nAnna Berger\nMusterweg 1\n12345 Musterstadt');
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- address`
Expected: FAIL — `Cannot find module '../src/address'`.

- [ ] **Step 3: Die Funktion schreiben**

`packages/modules/contacts/src/address.ts`:

```typescript
import type { ContactRow } from './schema';

/** Der Ausschnitt aus einem Kontakt, den ein Anschriftsblock braucht. */
export type PostalAddressInput = Pick<
  ContactRow,
  'kind' | 'salutation' | 'firstName' | 'lastName' | 'name' | 'legalForm' | 'addressExtra' | 'street' | 'postalCode' | 'city' | 'country'
>;

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/** Vorname und Nachname, ohne doppeltes Leerzeichen, wenn eines fehlt. */
const personName = (c: PostalAddressInput): string => [clean(c.firstName), clean(c.lastName)].filter(Boolean).join(' ');

/** Der Name, unter dem ein Kontakt angeschrieben wird. */
export const displayName = (c: PostalAddressInput): string => (c.kind === 'organization' ? clean(c.name) : personName(c));

/**
 * Der mehrzeilige Anschriftsblock fürs Fensterkuvert. Leere Felder erzeugen
 * keine Leerzeile und kein einsames Satzzeichen — genau hier entstehen sonst
 * die „12345 " mit hängendem Leerzeichen.
 *
 * Reine Funktion ohne `ctx`: Die Dokumentenpipeline ruft sie ohne Aufrufkontext.
 *
 * @param contact       Der Kontakt, an den geschrieben wird.
 * @param organisation  Die Organisation, bei der er sitzt (aus `belongsToId`).
 *                      Ist sie gesetzt, führt sie den Block an und die Anschrift
 *                      stammt aus ihr, soweit der Kontakt selbst keine hat.
 * @param homeCountry   Land des Vereins. Ein abweichendes Land wird genannt.
 */
export function formatPostalAddress(
  contact: PostalAddressInput,
  organisation?: PostalAddressInput | null,
  homeCountry?: string,
): string {
  const lines: string[] = [];

  if (organisation) {
    lines.push(displayName(organisation));
    const attention = [clean(contact.salutation), personName(contact)].filter(Boolean).join(' ');
    if (attention) lines.push(`z. Hd. ${attention}`);
  } else {
    if (contact.kind === 'person' && clean(contact.salutation)) lines.push(clean(contact.salutation));
    lines.push(displayName(contact));
  }

  // Die Anschrift des Kontakts gewinnt; fehlt sie ganz, gilt die der Organisation.
  const source = clean(contact.street) || clean(contact.postalCode) || clean(contact.city) ? contact : (organisation ?? contact);

  lines.push(clean(source.addressExtra));
  lines.push(clean(source.street));
  lines.push([clean(source.postalCode), clean(source.city)].filter(Boolean).join(' '));

  const country = clean(source.country);
  if (country && homeCountry && country !== homeCountry) lines.push(country);

  return lines.filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test -- address`
Expected: PASS (sechs Tests).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/contacts/src/address.ts packages/modules/contacts/tests/address.test.ts
git commit -m "feat(contacts): postal address block that survives missing fields"
```

---

### Task 3: Manifest, Paketoberfläche und Installation

**Files:**
- Create: `packages/modules/contacts/src/manifest.ts`, `packages/modules/contacts/src/index.ts`
- Create: `packages/modules/contacts/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `defineModule` aus `@kompass/core`.
- Produces: `contactsModule: ModuleManifest` mit `key: 'contacts'`, `permissions: ['contacts.view', 'contacts.manage']`, `dependsOn: []`, `navigation` auf `/contacts`.

- [ ] **Step 1: Den Test schreiben**

`packages/modules/contacts/tests/manifest.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';

describe('contacts manifest', () => {
  it('declares its key, permissions and navigation without depending on other modules', () => {
    expect(contactsModule.key).toBe('contacts');
    expect([...contactsModule.permissions]).toEqual(['contacts.view', 'contacts.manage']);
    expect([...(contactsModule.dependsOn ?? [])]).toEqual([]);
    expect(contactsModule.navigation?.[0]).toMatchObject({ href: '/contacts', permission: 'contacts.view' });
  });
});
```

- [ ] **Step 2: Den Test laufen lassen und das Scheitern sehen**

Run: `pnpm --filter @kompass/module-contacts test -- manifest`
Expected: FAIL — `Cannot find module '../src/manifest'`.

- [ ] **Step 3: Manifest und Paketoberfläche schreiben**

`packages/modules/contacts/src/manifest.ts`:

```typescript
import { defineModule, type ModuleManifest } from '@kompass/core';

export const contactsModule: ModuleManifest = defineModule({
  key: 'contacts',
  version: '0.1.0',
  permissions: ['contacts.view', 'contacts.manage'],
  // `icon` muss in der Whitelist in `apps/kompass/src/components/shell/sidebar.tsx`
  // stehen. `contact` ist dort noch nicht eingetragen — das erledigt Plan 3 Task 4
  // zusammen mit der Installation. Bis dahin ist der Name nur eine Zeichenkette.
  navigation: [{ key: 'contacts.list', href: '/contacts', icon: 'contact', group: 'contacts', permission: 'contacts.view' }],
});
```

`packages/modules/contacts/src/index.ts`:

```typescript
export * from './address';
export * from './manifest';
export * from './schema';
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @kompass/module-contacts test`
Expected: PASS (alle Tests des Pakets).

- [ ] **Step 5: Prüfen, dass das Paket für sich steht**

Run: `pnpm --filter @kompass/module-contacts test && pnpm --filter @kompass/module-contacts typecheck && pnpm test`
Expected: PASS, alles.

**Das Modul wird in diesem Plan bewusst noch nicht in der App installiert.** Es bringt zwei Rechte mit, aber noch keine MCP-Werkzeuge; `apps/kompass/tests/mcp-tools.test.ts` würde sofort rot. Installation, Navigation, Icon und Übersetzungen macht Plan 3 Task 4, wenn die Werkzeuge da sind. Bis dahin bleibt jeder Commit grün.

- [ ] **Step 6: Commit**

```bash
git add packages/modules/contacts
git commit -m "feat(contacts): module manifest with view and manage permissions"
```

---

## Self-Review

**Spec-Abdeckung.** § 4 Datenmodell: Task 1 (drei Tabellen, `kind`, Selbstverweis, `until` statt Löschen) und Task 2 (`formatPostalAddress`). § 3 Entscheidung 1 (Modul, `dependsOn: []`): Task 3. Entscheidung 4 (Anrede als Freitext): das Feld ist `text` ohne Enum, die Vorschlagsliste kommt in Plan 4 mit der Oberfläche.

**Platzhalter.** Keine. Task 3 berührt `apps/kompass` gar nicht mehr; Navigation, Icon und Übersetzungen wandern mit der Installation nach Plan 3 Task 4.

**Typkonsistenz.** `ContactRow` (Task 1) ist die Quelle für `PostalAddressInput` (Task 2). `contactsModule` (Task 3) heißt in `apps/kompass/src/modules.ts` genauso.

**Bekannte Zwischenstufe — aufgelöst.** Der ursprüngliche Zuschnitt installierte das Modul schon hier und nahm dafür einen roten MCP-Paritätstest in Kauf. Nach dem Konfliktscan am 2026-09-10 zieht Plan 3 Task 4 die ganze Installation (modules.ts, package.json, Icon-Whitelist, Übersetzungen) an sich. Plan 1 bleibt vollständig innerhalb von `packages/` und ist durchgehend grün.
