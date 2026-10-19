import type { TransferBlockData } from '@kompass/documents/transfer-block';
import { formatEuro } from '@kompass/module-finance/format';
import type { ChargeFacts, LetterFacts } from './facts';
import { addDays, CLOSING, day, memberInfo, memberLetterTemplate, type MemberLetterInput } from './shared';

export const REMINDER_TEMPLATE_KEY = 'member-reminder';
export const PAYMENT_REQUEST_TEMPLATE_KEY = 'member-payment-request';
export const reminderTemplate = memberLetterTemplate(REMINDER_TEMPLATE_KEY, 'member-reminder', 'members.fees');
/** Zahlungsaufforderung nach einer Rückgabe (Weg `requestTransfer`, Plan L3): dieselbe Art wie die Mahnung, ohne Stufe. */
export const paymentRequestTemplate = memberLetterTemplate(PAYMENT_REQUEST_TEMPLATE_KEY, 'member-reminder', 'members.fees');

/** Sprachtabelle der Erinnerung, Mahnung und Zahlungsaufforderung (Handoff D7, 10a). */
const W = {
  subject: (years: string, level: string) => `Mitgliedsbeitrag ${years} – ${level}`,
  paymentRequest: 'Zahlungsaufforderung',
  // M24: Der erste Absatz nach der Anrede beginnt klein, ein weiterer groß.
  returned: (on: string) => `die Lastschrift vom ${day(on)} wurde von Ihrer Bank zurückgegeben.`,
  situation: (count: number, first: boolean) => {
    const text = count === 1 ? 'nach unseren Unterlagen ist der folgende Beitrag noch offen:' : 'nach unseren Unterlagen sind die folgenden Beiträge noch offen:';
    return first ? text : text.charAt(0).toUpperCase() + text.slice(1);
  },
  head: ['Beitrag', 'fällig am', 'Betrag', 'bezahlt', 'offen'],
  open: 'Offen',
  deadline: (sum: string, until: string) => `Bitte überweisen Sie ${sum} bis zum ${day(until)}.`,
  overlap: 'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.',
  referenceFor: (years: string, memberNumber: string) => `Beitrag ${years} Mitglied ${memberNumber}`,
};

export interface ReminderFacts {
  /** Name der Stufe aus den Einstellungen; `null` bei der Zahlungsaufforderung. */
  levelName: string | null;
  /** Stufentext aus dem Textbaustein der Stufe — Kompass schreibt keine Folge nach der Satzung hinein. */
  levelText: string | null;
  charges: ChargeFacts[];
  returnedOn: string | null;
  paymentTermDays: number;
  transfer: (amountCents: number, reference: string) => TransferBlockData | null;
}

export function reminderLetter(f: LetterFacts, r: ReminderFacts): MemberLetterInput {
  const charges = [...r.charges].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const years = [...new Set(charges.map((c) => c.year))].join('/');
  const sum = charges.reduce((s, c) => s + c.openCents, 0);
  // Ein Beitrag: seine eigene Zahlungsreferenz, damit die Arbeitsliste die Überweisung sicher zuordnet.
  const reference = charges.length === 1 ? charges[0]!.reference : W.referenceFor(years, f.memberNumber);
  return {
    recipient: f.recipient,
    subject: W.subject(years, r.levelName ?? W.paymentRequest),
    info: memberInfo(f),
    intro: [f.greeting, ...(r.returnedOn ? [W.returned(r.returnedOn)] : []), W.situation(charges.length, !r.returnedOn)],
    table: {
      head: W.head,
      rows: charges.map((c) => [c.period, day(c.dueOn), formatEuro(c.amountCents), formatEuro(c.paidCents), formatEuro(c.openCents)]),
      foot: [W.open, '', '', '', formatEuro(sum)],
      align: ['left', 'left', 'right', 'right', 'right'],
    },
    deadline: W.deadline(formatEuro(sum), addDays(f.today, r.paymentTermDays)),
    transfer: r.transfer(sum, reference),
    outro: [...(r.levelText ? [r.levelText] : []), W.overlap],
    closing: [CLOSING, f.organizationName],
  };
}
