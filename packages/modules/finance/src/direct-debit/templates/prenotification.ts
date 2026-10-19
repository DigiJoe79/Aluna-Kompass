import { isoDay, paperDate, type DocumentTemplate } from '@kompass/core';
import { z } from 'zod';
import { formatEuro } from '../../format/amount';
import { maskIban } from '../../format/iban';
import type { PledgeInterval } from '../../schema';

/**
 * Die Lastschriftankündigung (Spec § 7.5, Handoff 17b): ein Brief auf der Basis „Briefkopf“ für Zusagen und für einen
 * erneuten Einzug nach einer Rückgabe. Sie entsteht als **Entwurf** der Akte (Handoff 1.5: „Ankündigung als Entwurf
 * bereit“) — und ein Entwurf trägt nur Betreff, Text und Empfänger. Der Datenblock (Betrag, Rhythmus, erster Einzug,
 * Konto gekürzt, Mandatsreferenz, Gläubiger-ID) steht deshalb als Tabelle im Text, den `prenotificationBody` schreibt;
 * so bleibt er bis zum Festschreiben änderbar. Kein GiroCode: Es wird eingezogen, nicht überwiesen. Deutscher Wortlaut
 * im Modul wie der Brief zur Anzeige des maschinellen Verfahrens (`donations/machine.ts`).
 */
export const PRENOTIFICATION_TEMPLATE_KEY = 'sepa-prenotification';
export const PRENOTIFICATION_DOCUMENT_TYPE = 'sepa-prenotification';

/** Wie der freie Brief der Akte (`letterSchema`): Mit dieser Form legt die Akte einen Entwurf fest. */
export const prenotificationInputSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(100_000),
  recipient: z.string().max(500).nullish().transform((v) => v ?? ''),
});
export type PrenotificationInput = z.infer<typeof prenotificationInputSchema>;

export const prenotificationTemplate: DocumentTemplate<PrenotificationInput> = {
  key: PRENOTIFICATION_TEMPLATE_KEY,
  type: PRENOTIFICATION_DOCUMENT_TYPE,
  schema: prenotificationInputSchema,
  base: 'a4-mit-briefkopf',
  build: (data) => ({
    slots: { kind: 'letter', subject: data.subject, title: data.subject, recipient: data.recipient },
    body: { markdown: data.body },
  }),
};

const INTERVAL_WORDS: Record<PledgeInterval, string> = { monthly: 'monatlich', quarterly: 'vierteljährlich', halfYearly: 'halbjährlich', yearly: 'jährlich' };

export interface PrenotificationNotice {
  /** Anrede der Person, die zahlt (`greetingFor`). */
  greeting: string;
  creditorName: string;
  amountCents: number;
  interval: PledgeInterval;
  firstCollectionOn: string;
  iban: string;
  reference: string;
  creditorId: string;
}

/** „Sehr geehrte Frau …“, wo Anrede und Nachname bekannt sind, sonst „Guten Tag,“. */
export function greetingFor(contact: { kind: string; salutation: string | null; lastName: string | null }): string {
  const last = (contact.lastName ?? '').trim();
  const salutation = (contact.salutation ?? '').trim();
  if (contact.kind === 'person' && last !== '' && salutation === 'Frau') return `Sehr geehrte Frau ${last},`;
  if (contact.kind === 'person' && last !== '' && salutation === 'Herr') return `Sehr geehrter Herr ${last},`;
  return 'Guten Tag,';
}

export const prenotificationSubject = (reference: string) => `Lastschriftankündigung zum Mandat ${reference}`;

/** Der Text der Ankündigung mit dem Datenblock — rein, für den Entwurf. */
export function prenotificationBody(n: PrenotificationNotice): string {
  const amount = formatEuro(n.amountCents);
  const first = paperDate(isoDay(n.firstCollectionOn));
  return [
    n.greeting,
    `wir danken Ihnen für Ihre Unterstützung. Wie vereinbart ziehen wir ${amount} ${INTERVAL_WORDS[n.interval]} per SEPA-Lastschrift von Ihrem Konto ein, erstmals am ${first}. Fällt der Tag auf ein Wochenende oder einen Feiertag, buchen wir am folgenden Bankarbeitstag.`,
    '| | |\n|---|---|\n' +
      [
        ['Betrag', amount],
        ['Rhythmus', INTERVAL_WORDS[n.interval]],
        ['Erster Einzug', first],
        ['Konto', maskIban(n.iban)],
        ['Mandatsreferenz', n.reference],
        ['Gläubiger-Identifikationsnummer', n.creditorId],
      ]
        .map(([k, v]) => `| ${k} | ${v} |`)
        .join('\n'),
    `Bitte sorgen Sie für ausreichende Deckung. Ändert sich Ihre Bankverbindung, geben Sie uns bitte Bescheid.`,
    `Mit freundlichen Grüßen  \n${n.creditorName}`,
  ].join('\n\n');
}

export interface PrenotificationPlanNotice {
  greeting: string;
  creditorName: string;
  /** Die angekündigten Einzüge, Tag und Betrag. */
  plan: readonly { dueOn: string; amountCents: number; remittance?: string }[];
  iban: string;
  reference: string;
  creditorId: string;
}

/**
 * Der Text einer Ankündigung mit festem Plan (Plan L2 Task 1): je Einzug Tag und Betrag, danach der Datenblock wie bei
 * `prenotificationBody`. Rein; die IBAN steht nur gekürzt im Brief.
 */
export function prenotificationPlanBody(n: PrenotificationPlanNotice): string {
  // R11: Die Spalte nennt den Tag der Belastung; mit Verwendungszweck je Zeile, sobald einer bekannt ist.
  const withPurpose = n.plan.some((e) => e.remittance);
  const sorted = [...n.plan].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const rows = sorted.map((e) => (withPurpose ? `| ${paperDate(isoDay(e.dueOn))} | ${e.remittance ?? ''} | ${formatEuro(e.amountCents)} |` : `| ${paperDate(isoDay(e.dueOn))} | ${formatEuro(e.amountCents)} |`));
  const head = withPurpose ? ['| Einzug am | Verwendungszweck | Betrag |', '|---|---|---|'] : ['| Einzug am | Betrag |', '|---|---|'];
  return [
    n.greeting,
    `wir kündigen Ihnen die folgenden Einzüge per SEPA-Lastschrift von Ihrem Konto an. Fällt ein Tag auf ein Wochenende oder einen Feiertag, buchen wir am folgenden Bankarbeitstag.`,
    [...head, ...rows].join('\n'),
    '| | |\n|---|---|\n' +
      [
        ['Konto', maskIban(n.iban)],
        ['Mandatsreferenz', n.reference],
        ['Gläubiger-Identifikationsnummer', n.creditorId],
      ]
        .map(([k, v]) => `| ${k} | ${v} |`)
        .join('\n'),
    `Bitte sorgen Sie für ausreichende Deckung. Ändert sich Ihre Bankverbindung, geben Sie uns bitte Bescheid.`,
    `Mit freundlichen Grüßen  \n${n.creditorName}`,
  ].join('\n\n');
}
