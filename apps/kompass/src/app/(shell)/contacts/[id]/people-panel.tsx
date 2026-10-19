import type { ContactPerson } from '@kompass/module-contacts';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Section } from '@/components/section';
import { CreateContactDialog } from '../contact-form';

/** Wie in den Listen der Startseite: höchstens fünf Zeilen, dann „Alle n anzeigen“ (Nachtrag Ansprechpersonen § 2). */
const SHOWN = 5;

/**
 * Karte „Ansprechpersonen“ einer Organisation (Nachtrag Ansprechpersonen § 2, 23b): je Zeile der Name als Link und
 * der Hauptkontaktweg, keine Knöpfe in der Zeile — gelöst wird die Zuordnung an der Person. Ohne Personen steht
 * keine Karte da; „Person anlegen“ wandert dann in „Kommunikationswege“ (die Seite entscheidet).
 */
export async function PeoplePanel({ organization, people, canManage }: { organization: { id: string; name: string }; people: ContactPerson[]; canManage: boolean }) {
  const t = await getTranslations('contacts');
  const shown = people.slice(0, SHOWN);
  // Die Suche der Kontaktliste findet Personen auch über den Namen ihrer Organisation.
  const allHref = `/contacts?${new URLSearchParams({ kind: 'person', text: organization.name }).toString()}`;
  return (
    <section data-testid="contact-people" className="rounded-md border border-line bg-surface p-5">
      <Section title={t('people.title')} actions={canManage ? <CreateContactDialog triggerLabel={t('people.create')} initialBelongsTo={organization} /> : undefined}>
        <ul className="divide-y divide-line-2">
          {shown.map((p) => (
            <li key={p.id} data-testid="contact-person" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
              <Link href={`/contacts/${p.id}`} className="text-link underline-offset-2 hover:underline">{p.name}</Link>
              {p.channel ? <span className="text-meta text-ink-2">{p.channel.value}</span> : null}
            </li>
          ))}
        </ul>
        {people.length > SHOWN ? (
          <Link href={allHref} className="mt-2 inline-block text-meta text-link underline-offset-2 hover:underline">{t('people.more', { n: people.length })}</Link>
        ) : null}
      </Section>
    </section>
  );
}
