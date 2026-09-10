import { unwrap, type CallContext, type Deps } from '@kompass/core';
import { contacts } from './schema';
import { addContactRole, createContact, setContactChannels } from './service';

// Beispielkontakte: erfunden. Das Repo ist öffentlich; personenbezogene Daten
// haben darin nichts verloren, auch keine harmlos wirkenden.
const EXAMPLE_CONTACTS = [
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
];

export async function seedContacts(deps: Deps, ctx: CallContext): Promise<void> {
  const existing = deps.db.select({ id: contacts.id }).from(contacts).all();
  if (existing.length > 0) return;

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
    unwrap(await addContactRole(deps, ctx, { id: created.id, role: c.role, since: '2026-01-01' }));
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [c.channel] }));
  }
}
