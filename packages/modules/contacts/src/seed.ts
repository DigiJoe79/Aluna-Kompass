import { schema, seedStoryYear, todayIn, unwrap, type CallContext, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { contacts } from './schema';
import { addContactRole, createContact, endContactRole, setContactChannels } from './service';
import { hasLinkHistoryInternal, linkUserToContact } from './user-links';

interface ExampleRole {
  role: string;
  since: string;
  until?: string;
}

// Beispielkontakte: erfunden. Das Repo ist öffentlich; personenbezogene Daten
// haben darin nichts verloren, auch keine harmlos wirkenden.
interface ExampleContact {
  kind: 'person' | 'organization';
  salutation?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  street: string;
  postalCode: string;
  city: string;
  roles: ExampleRole[];
  channel: { kind: 'email' | 'phone' | 'web'; value: string; isPrimary: boolean };
}

/** Die Beispiele aus 0.1 mit festen Daten — Fristen, Rollenfilter und Telefonsuche der Tests hängen daran. */
const EXAMPLE_CONTACTS: ExampleContact[] = [
  {
    kind: 'person',
    salutation: 'Frau',
    firstName: 'Mira',
    lastName: 'Sandberg',
    street: 'Ahornweg 4',
    postalCode: '12345',
    city: 'Musterstadt',
    roles: [{ role: 'interested', since: '2026-01-01' }],
    channel: { kind: 'email', value: 'mira.sandberg@example.org', isPrimary: true },
  },
  {
    kind: 'person',
    salutation: 'Herr',
    firstName: 'Tomas',
    lastName: 'Leitner',
    street: 'Birkengasse 11',
    postalCode: '12345',
    city: 'Musterstadt',
    roles: [{ role: 'partner', since: '2026-01-01' }],
    channel: { kind: 'phone', value: '+49 123 456789', isPrimary: true },
  },
  {
    kind: 'organization',
    name: 'Amtsgericht Musterstadt',
    street: 'Gerichtsplatz 1',
    postalCode: '12345',
    city: 'Musterstadt',
    roles: [{ role: 'authority', since: '2026-01-01' }],
    channel: { kind: 'web', value: 'https://amtsgericht-musterstadt.example.org', isPrimary: true },
  },
  {
    kind: 'person',
    salutation: 'Frau',
    firstName: 'Lena',
    lastName: 'Vogt',
    street: 'Lindenallee 8',
    postalCode: '12345',
    city: 'Musterstadt',
    // Interessentin, aus der nichts wurde: Rolle 2023 beendet, Einwilligungsfrist
    // (24 Monate ab Jahresende) am 2025-12-31 abgelaufen — löschfällig.
    roles: [{ role: 'interested', since: '2023-01-15', until: '2023-09-30' }],
    channel: { kind: 'email', value: 'lena.vogt@example.org', isPrimary: true },
  },
];

/**
 * Der Verein nach einem Jahr (Spec 2026-10-06 § 4): Finanzamt, Tierarztpraxis,
 * Landesverband, zwei Pflegestellen und zwei Menschen, deren Rolle sich über die
 * Zeit ändert. Daten relativ zum Stichjahr `y`; eine beendete Rolle endet
 * spätestens im Stichjahr (Clara Neumanns Interesse am Tag vor der
 * Versammlung), und mit 24 Monaten Einwilligungsfrist wird keiner dieser
 * Kontakte fällig, solange das Stichjahr gilt (Fristen-Test: nur Lena Vogt). „Mitglied“ gibt es als Rolle
 * nicht — Clara Neumanns Weg in den Vorstand ergänzt der Finanz-Seed mit der
 * Rolle `board-member`.
 */
function storyContacts(y: number): ExampleContact[] {
  return [
    {
      kind: 'organization',
      name: 'Finanzamt Musterstadt',
      street: 'Steuerplatz 2',
      postalCode: '12345',
      city: 'Musterstadt',
      roles: [{ role: 'authority', since: `${y - 3}-01-01` }],
      channel: { kind: 'web', value: 'https://finanzamt-musterstadt.example.org', isPrimary: true },
    },
    {
      kind: 'organization',
      name: 'Tierarztpraxis am Stadtpark',
      street: 'Parkstraße 5',
      postalCode: '12345',
      city: 'Musterstadt',
      roles: [{ role: 'service', since: `${y - 1}-02-01` }],
      channel: { kind: 'phone', value: '+49 1234 98765-0', isPrimary: true },
    },
    {
      kind: 'organization',
      name: 'Landesverband Musterland e.V.',
      street: 'Verbandsweg 12',
      postalCode: '54321',
      city: 'Beispielstadt',
      roles: [{ role: 'partner', since: `${y - 2}-01-01` }],
      channel: { kind: 'email', value: 'info@landesverband-musterland.example.org', isPrimary: true },
    },
    {
      kind: 'person',
      salutation: 'Frau',
      firstName: 'Sabine',
      lastName: 'Krämer',
      street: 'Wiesenweg 9',
      postalCode: '12347',
      city: 'Musterstadt',
      // Pflegestelle seit dem Vorjahr.
      roles: [{ role: 'partner', since: `${y - 1}-04-01` }],
      channel: { kind: 'email', value: 'sabine.kraemer@example.org', isPrimary: true },
    },
    {
      kind: 'person',
      salutation: 'Herr',
      firstName: 'Jakob',
      lastName: 'Brenner',
      street: 'Mühlgasse 3',
      postalCode: '12345',
      city: 'Musterstadt',
      // Erst interessiert, dann selbst Pflegestelle geworden.
      roles: [
        { role: 'interested', since: `${y - 1}-03-01`, until: `${y - 1}-06-30` },
        { role: 'partner', since: `${y - 1}-07-01` },
      ],
      channel: { kind: 'email', value: 'jakob.brenner@example.org', isPrimary: true },
    },
    {
      kind: 'person',
      salutation: 'Frau',
      firstName: 'Clara',
      lastName: 'Neumann',
      street: 'Eichenring 14',
      postalCode: '12349',
      city: 'Musterstadt',
      // Interessiert bis zur Mitgliederversammlung, dann in den Vorstand gewählt (Rolle aus dem Finanz-Seed).
      roles: [{ role: 'interested', since: `${y - 1}-09-01`, until: `${y}-04-28` }],
      channel: { kind: 'phone', value: '+49 1234 55501', isPrimary: true },
    },
    {
      kind: 'person',
      salutation: 'Herr',
      firstName: 'Bernd',
      lastName: 'Hagedorn',
      street: 'Bahnhofstraße 21',
      postalCode: '12345',
      city: 'Musterstadt',
      // Fährt seit Jahren Hunde zum Tierarzt; bis zur Versammlung im Vorstand (Rolle aus dem Finanz-Seed).
      roles: [{ role: 'partner', since: `${y - 3}-01-01` }],
      channel: { kind: 'email', value: 'bernd.hagedorn@example.org', isPrimary: true },
    },
  ];
}

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
  const y = seedStoryYear(todayIn(deps));
  for (const c of [...EXAMPLE_CONTACTS, ...storyContacts(y)]) {
    const input =
      c.kind === 'organization'
        ? { kind: 'organization' as const, name: c.name, street: c.street, postalCode: c.postalCode, city: c.city }
        : { kind: 'person' as const, salutation: c.salutation, firstName: c.firstName, lastName: c.lastName, street: c.street, postalCode: c.postalCode, city: c.city };
    const created = unwrap(await createContact(deps, ctx, input));
    for (const r of c.roles) {
      const added = unwrap(await addContactRole(deps, ctx, { id: created.id, role: r.role, since: r.since }));
      if (r.until) {
        const open = added.roles.find((x) => x.role === r.role && x.until === null);
        if (open) unwrap(await endContactRole(deps, ctx, { roleId: open.id, until: r.until }));
      }
    }
    unwrap(await setContactChannels(deps, ctx, { id: created.id, channels: [c.channel] }));
  }
}
