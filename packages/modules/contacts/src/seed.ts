import { schema, unwrap, type CallContext, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { contacts } from './schema';
import { addContactRole, createContact, endContactRole, setContactChannels } from './service';
import { hasLinkHistoryInternal, linkUserToContact } from './user-links';

// Beispielkontakte: erfunden. Das Repo ist öffentlich; personenbezogene Daten
// haben darin nichts verloren, auch keine harmlos wirkenden.
const EXAMPLE_CONTACTS: Array<{
  kind: 'person' | 'organization';
  salutation?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  street: string;
  postalCode: string;
  city: string;
  role: string;
  since?: string;
  until?: string;
  channel: { kind: 'email' | 'phone' | 'web'; value: string; isPrimary: boolean };
}> = [
  {
    kind: 'person' as const,
    salutation: 'Frau',
    firstName: 'Mira',
    lastName: 'Sandberg',
    street: 'Ahornweg 4',
    postalCode: '12345',
    city: 'Musterstadt',
    role: 'interested',
    channel: { kind: 'email' as const, value: 'mira.sandberg@example.org', isPrimary: true },
  },
  {
    kind: 'person' as const,
    salutation: 'Herr',
    firstName: 'Tomas',
    lastName: 'Leitner',
    street: 'Birkengasse 11',
    postalCode: '12345',
    city: 'Musterstadt',
    role: 'partner',
    channel: { kind: 'phone' as const, value: '+49 123 456789', isPrimary: true },
  },
  {
    kind: 'organization' as const,
    name: 'Amtsgericht Musterstadt',
    street: 'Gerichtsplatz 1',
    postalCode: '12345',
    city: 'Musterstadt',
    role: 'authority',
    channel: { kind: 'web' as const, value: 'https://amtsgericht-musterstadt.example.org', isPrimary: true },
  },
  {
    kind: 'person' as const,
    salutation: 'Frau',
    firstName: 'Lena',
    lastName: 'Vogt',
    street: 'Lindenallee 8',
    postalCode: '12345',
    city: 'Musterstadt',
    role: 'interested',
    // Interessentin, aus der nichts wurde: Rolle 2023 beendet, Einwilligungsfrist
    // (24 Monate ab Jahresende) am 2025-12-31 abgelaufen — löschfällig.
    since: '2023-01-15',
    until: '2023-09-30',
    channel: { kind: 'email' as const, value: 'lena.vogt@example.org', isPrimary: true },
  },
];

export async function seedContacts(deps: Deps, ctx: CallContext): Promise<void> {
  const existing = deps.db.select({ id: contacts.id }).from(contacts).all();
  if (existing.length === 0) await seedExampleContacts(deps, ctx);
  await seedUserLink(deps, ctx);
}

/**
 * Ein Beispielkonto (das keine Verwaltung ist) und sein Kontakt — damit die
 * Spalte „Kontakt“ der Nutzerverwaltung nach dem Seed nicht leer ist. Gesetzt
 * vom Seed-Verwalter, nicht selbst; nur einmal, auch nach einem zweiten Lauf.
 */
async function seedUserLink(deps: Deps, ctx: CallContext): Promise<void> {
  const account = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'peter@kompass.local')).get();
  if (!account || hasLinkHistoryInternal(deps.db, account.id)) return;
  const contact = unwrap(await createContact(deps, ctx, { kind: 'person', salutation: 'Herr', firstName: 'Peter', lastName: 'Lang', street: 'Kastanienweg 2', postalCode: '12345', city: 'Musterstadt' }));
  unwrap(await addContactRole(deps, ctx, { id: contact.id, role: 'service', since: '2026-01-01' }));
  unwrap(await linkUserToContact(deps, ctx, { userId: account.id, contactId: contact.id }));
}

async function seedExampleContacts(deps: Deps, ctx: CallContext): Promise<void> {
  for (const c of EXAMPLE_CONTACTS) {
    const input =
      c.kind === 'organization'
        ? { kind: 'organization' as const, name: c.name, street: c.street, postalCode: c.postalCode, city: c.city }
        : {
            kind: 'person' as const,
            salutation: c.salutation,
            firstName: c.firstName,
            lastName: c.lastName,
            street: c.street,
            postalCode: c.postalCode,
            city: c.city,
          };
    const created = unwrap(await createContact(deps, ctx, input));
    const roleAdded = unwrap(await addContactRole(deps, ctx, { id: created.id, role: c.role, since: c.since ?? '2026-01-01' }));
    if (c.until) {
      const roleRow = roleAdded.roles.find((r) => r.role === c.role && r.until === null);
      if (roleRow) unwrap(await endContactRole(deps, ctx, { roleId: roleRow.id, until: c.until }));
    }
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [c.channel] }));
  }
}
