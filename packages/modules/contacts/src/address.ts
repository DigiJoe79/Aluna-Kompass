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
    if (contact.kind === 'person') {
      const attention = [clean(contact.salutation), personName(contact)].filter(Boolean).join(' ');
      if (attention) lines.push(`z. Hd. ${attention}`);
    } else {
      const name = displayName(contact);
      if (name) lines.push(name);
    }
  } else {
    if (contact.kind === 'person' && clean(contact.salutation)) lines.push(clean(contact.salutation));
    lines.push(displayName(contact));
  }

  // Die Anschrift des Kontakts gewinnt; fehlt sie ganz, gilt die der Organisation.
  const source = clean(contact.street) || clean(contact.postalCode) || clean(contact.city) ? contact : (organisation ?? contact);

  // Die Anrede-Zeile ist Empfänger-Routing des Kontakts selbst, kein Teil des
  // Straßenblocks — sie gewinnt immer, auch wenn die Adresse von der
  // Organisation stammt.
  lines.push(clean(contact.addressExtra) || clean(source.addressExtra));
  lines.push(clean(source.street));
  lines.push([clean(source.postalCode), clean(source.city)].filter(Boolean).join(' '));

  const country = clean(source.country);
  if (country && homeCountry && country !== homeCountry) lines.push(country);

  return lines.filter(Boolean).join('\n');
}
