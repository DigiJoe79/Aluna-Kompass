import type { Organization } from './content';
import type { Locale } from './locale';

/**
 * Das Impressum als Markdown, gebaut aus den Vereinsdaten in Kompass.
 *
 * Die Pflichtangaben nach § 5 DDG — Name, Anschrift, Vertretung, Kontakt,
 * Registereintrag — stehen damit nirgends ein zweites Mal und veralten nicht
 * auf der Seite, wenn der Verein umzieht. Nur der Vorstand kommt aus dem
 * Template (`content/site.ts`): Kompass kennt die Ämter nicht.
 *
 * Bewusst nicht enthalten:
 *
 * - **EU-Streitschlichtung.** Die OS-Plattform der Kommission ist seit dem
 *   20. Juli 2025 abgeschaltet (VO (EU) 2024/3228); der übliche Link geht ins
 *   Leere.
 * - **Verbraucherstreitbeilegung nach § 36 VSBG.** Die Pflicht trifft
 *   Unternehmer mit mehr als zehn Beschäftigten, nicht den typischen Verein.
 * - **Umsatzsteuer-Identifikationsnummer.** Die meisten gemeinnützigen
 *   Vereine haben keine; wer eine hat, ergänzt die Zeile hier.
 */

/** Harter Zeilenumbruch in Markdown — ein einfaches `\n` verschmelzt die Zeilen zu einem Absatz. */
const BR = '\\\n';

export interface BoardMember {
  /** Der Name steht in jeder Sprache gleich; nur das Amt wird übersetzt. */
  name: string;
  role: Record<Locale, string>;
}

export function imprintBody(org: Organization, board: readonly BoardMember[], locale: Locale): string {
  const de = locale === 'de';
  const registered = org.registerNumber.trim() !== '';
  const court = org.registerCourt.trim();

  const register = de
    ? registered
      ? `Eintragung im Vereinsregister.${BR}Registergericht: ${court}${BR}Registernummer: ${org.registerNumber}`
      : court
        ? `Eintragung im Vereinsregister beim ${court} beantragt (in Eintragung).`
        : 'Eintragung im Vereinsregister beantragt (in Eintragung).'
    : registered
      ? `Entry in the register of associations.${BR}Register court: ${court}${BR}Register number: ${org.registerNumber}`
      : court
        ? `Registration in the register of associations at ${court} is pending.`
        : 'Registration in the register of associations is pending.';

  const contact = [
    `${de ? 'E-Mail' : 'Email'}: [${org.email}](mailto:${org.email})`,
    org.phone.trim() ? `${de ? 'Telefon' : 'Phone'}: ${org.phone}` : null,
  ]
    .filter(Boolean)
    .join(BR);

  const represented = board.length > 0
    ? board.map((m) => `${m.name} (${m.role[locale]})`).join(BR)
    : de
      ? 'den Vorstand'
      : 'the board';

  return de
    ? [
        `## Angaben gemäß § 5 DDG\n\n${org.name}${BR}${org.street}${BR}${org.postalCode} ${org.city}`,
        `## Vertreten durch\n\n${represented}`,
        `## Kontakt\n\n${contact}`,
        `## Registereintrag\n\n${register}`,
        `## Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV\n\n${board[0]?.name ?? org.name}${BR}Anschrift wie oben`,
      ].join('\n\n')
    : [
        '> **Die deutsche Fassung dieses Impressums ist die rechtlich verbindliche.**',
        `## Information pursuant to § 5 DDG\n\n${org.name}${BR}${org.street}${BR}${org.postalCode} ${org.city}`,
        `## Represented by\n\n${represented}`,
        `## Contact\n\n${contact}`,
        `## Register entry\n\n${register}`,
        `## Responsible for content pursuant to § 18 (2) MStV\n\n${board[0]?.name ?? org.name}${BR}Address as above`,
      ].join('\n\n');
}
