import type { TransferBlockData } from '@kompass/documents/transfer-block';
import { formatEuro } from '@kompass/module-finance/format';
import type { ChargeFacts, DirectDebitFacts, LetterFacts } from './facts';
import { addDays, announcedCollectionDay, CLOSING, COLLECTION_ON, day, directDebitSentence, memberInfo, memberLetterTemplate, type MemberLetterInput } from './shared';

export const FEE_NOTICE_TEMPLATE_KEY = 'member-fee-notice';
export const feeNoticeTemplate = memberLetterTemplate(FEE_NOTICE_TEMPLATE_KEY, 'member-fee-notice', 'members.fees');

/** Sprachtabelle der Beitragsmitteilung (Spec § 5, § 7.5). */
const W = {
  subject: (year: number) => `Mitgliedsbeitrag ${year}`,
  intro: (year: number) => `für das Jahr ${year} sind die folgenden Beiträge fällig:`,
  /** M3: an die gesetzliche Vertretung. */
  introFor: (year: number, name: string) => `für das Jahr ${year} sind für ${name} die folgenden Beiträge fällig:`,
  /** R15: nur Bezahltes — nichts ist mehr „fällig“. */
  introPaid: (year: number) => `für das Jahr ${year} sind die folgenden Beiträge vermerkt:`,
  introPaidFor: (year: number, name: string) => `für das Jahr ${year} sind für ${name} die folgenden Beiträge vermerkt:`,
  nothingOpen: (year: number) => `Für ${year} ist nichts mehr offen.`,
  head: ['Beitrag', 'Zahlung', 'Betrag'],
  paid: 'bezahlt',
  until: (on: string) => `bis ${day(on)}`,
  open: 'noch offen',
  // M21: der Satz mit Doppelpunkt steht als Frist direkt vor dem Überweisungsblock.
  transfer: 'Bitte überweisen Sie jeden offenen Beitrag bis zum genannten Tag, mit dem Verwendungszweck des Beitrags. Für den ersten:',
  // M24: nach der Anrede klein weiter.
  none: 'für dieses Jahr fällt kein Beitrag an.',
};

export interface FeeNoticeFacts {
  year: number;
  charges: ChargeFacts[];
  directDebit: DirectDebitFacts | null;
  transfer: (charge: ChargeFacts) => TransferBlockData | null;
  /** Bei Lastschrift: der früheste Einzugstag, den dieser Brief ankündigen kann (Vorabankündigung, Bankarbeitstag). */
  earliestCollection: string | null;
  /** Zahlungsziel in Briefen (`members.paymentTermDays`): Frist für schon fällige Überweisungs-Beiträge. */
  paymentTermDays: number;
}

/**
 * Die Beitragsmitteilung (M21, release #2): je Beitrag, was zu tun ist — „bezahlt“, bei Lastschrift der Tag der
 * Belastung (E1), bei Überweisung die Frist: die Fälligkeit, frühestens aber Briefdatum plus Zahlungsziel (wie im
 * Aufnahmebrief, `9f90930b`). Die Summe nennt, was noch offen ist.
 */
export function feeNoticeLetter(f: LetterFacts, n: FeeNoticeFacts): MemberLetterInput {
  const charges = [...n.charges].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const open = charges.reduce((s, c) => s + c.openCents, 0);
  const until = addDays(f.today, n.paymentTermDays);
  // Nach Zahlweg getrennt (Plan N1 E3): Lastschrift-Beiträge mit Tag der Belastung, Überweisungs-Beiträge mit Frist.
  const byDebit = (c: ChargeFacts) => !!n.directDebit && c.method === 'directDebit';
  const when = (c: ChargeFacts) => {
    if (c.openCents <= 0) return W.paid;
    if (byDebit(c)) return `${COLLECTION_ON} ${day(announcedCollectionDay(c.dueOn, n.earliestCollection))}`;
    return W.until(c.dueOn > until ? c.dueOn : until);
  };
  const first = charges.find((c) => c.openCents > 0 && !byDebit(c)) ?? null;
  const debits = charges.some((c) => c.openCents > 0 && byDebit(c));
  const foot = charges.length > 1 || charges.some((c) => c.openCents <= 0);
  const allPaid = charges.length > 0 && open <= 0;
  return {
    recipient: f.recipient,
    subject: W.subject(n.year),
    info: memberInfo(f),
    intro: [f.greeting, charges.length === 0 ? W.none : allPaid ? (f.memberName ? W.introPaidFor(n.year, f.memberName) : W.introPaid(n.year)) : f.memberName ? W.introFor(n.year, f.memberName) : W.intro(n.year)],
    table: charges.length === 0 ? null : { head: W.head, rows: charges.map((c) => [c.period, when(c), formatEuro(c.amountCents)]), foot: foot ? [W.open, '', formatEuro(open)] : null, align: ['left', 'left', 'right'] },
    deadline: first ? W.transfer : null,
    transfer: first ? n.transfer(first) : null,
    outro: [...(allPaid ? [W.nothingOpen(n.year)] : []), ...(debits ? [directDebitSentence(n.directDebit!)] : [])],
    closing: [CLOSING, f.organizationName],
  };
}
