import { formatEuro } from '@kompass/module-finance/format';
import type { ChargeFacts, DirectDebitFacts, FeeFacts, LetterFacts } from './facts';
import { addDays, announcedCollectionDay, CLOSING, COLLECTION_ON, day, directDebitSentence, INTERVAL_WORDS, MEMBER_NUMBER_LABEL, memberInfo, METHOD_WORDS, memberLetterTemplate, type MemberLetterInput } from './shared';
import type { TransferBlockData } from '@kompass/documents/transfer-block';

export const ADMISSION_TEMPLATE_KEY = 'member-admission';
export const admissionTemplate = memberLetterTemplate(ADMISSION_TEMPLATE_KEY, 'member-admission', 'members.manage');

/** Sprachtabelle der Aufnahmebestätigung. */
const W = {
  subject: 'Bestätigung Ihrer Aufnahme',
  welcome: (joinedOn: string) => `wir freuen uns, Sie als Mitglied begrüßen zu dürfen. Ihre Mitgliedschaft beginnt am ${day(joinedOn)}.`,
  /** M3: an die gesetzliche Vertretung — das Mitglied mit Namen. */
  welcomeFor: (name: string, joinedOn: string) => `wir freuen uns, ${name} als Mitglied begrüßen zu dürfen. Die Mitgliedschaft beginnt am ${day(joinedOn)}.`,
  head: ['Ihre Mitgliedschaft', ''],
  /** R14: an die gesetzliche Vertretung — es ist nicht deren Mitgliedschaft. */
  headFor: ['Die Mitgliedschaft', ''],
  number: MEMBER_NUMBER_LABEL,
  type: 'Mitgliedsart',
  start: 'Beginn',
  fee: 'Beitrag',
  method: 'Zahlweg',
  exempt: 'beitragsfrei',
  firstTransfer: (amount: string, dueOn: string) => `Bitte überweisen Sie den ersten Beitrag von ${amount} bis zum ${day(dueOn)}.`,
};

export interface AdmissionFacts {
  typeName: string;
  joinedOn: string;
  fee: FeeFacts | null;
  /** Die schon angelegten, offenen Beiträge, früheste zuerst. */
  charges: ChargeFacts[];
  directDebit: DirectDebitFacts | null;
  transfer: (charge: ChargeFacts) => TransferBlockData | null;
  /** Zahlungsziel in Briefen (`members.paymentTermDays`). */
  paymentTermDays: number;
  /** Bei Lastschrift: der früheste Einzugstag, den dieser Brief ankündigen kann (Vorabankündigung, Bankarbeitstag). */
  earliestCollection: string | null;
}

export function admissionLetter(f: LetterFacts, a: AdmissionFacts): MemberLetterInput {
  const feeText = a.fee ? (a.fee.amountCents === 0 ? W.exempt : `${formatEuro(a.fee.amountCents)} ${INTERVAL_WORDS[a.fee.interval]}`) : null;
  const rows = [
    [W.number, f.memberNumber],
    [W.type, a.typeName],
    [W.start, day(a.joinedOn)],
    ...(feeText ? [[W.fee, feeText]] : []),
    ...(a.fee && a.fee.amountCents > 0 ? [[W.method, METHOD_WORDS[a.fee.method]]] : []),
  ];
  // Nach Zahlweg am Beitrag getrennt (Plan N1 E3).
  const byDebit = (c: ChargeFacts) => !!a.directDebit && c.method === 'directDebit';
  // Plan N2 (R2, R14): Ein schon bezahlter Beitrag wird nicht eingezogen — keine Zeile „Einzug am …: 0,00 €“.
  const debited = a.charges.filter((c) => byDebit(c) && c.openCents > 0);
  const first = a.charges.find((c) => c.openCents > 0 && !byDebit(c)) ?? null;
  const outro: string[] = [];
  let transfer: TransferBlockData | null = null;
  let deadline: string | null = null;
  if (a.directDebit && debited.length > 0) {
    outro.push(directDebitSentence(a.directDebit));
    // Ein schon fälliger Beitrag (rückwirkende Aufnahme) wird frühestens nach der Vorabankündigung eingezogen; der
    // Brief nennt den Tag der Belastung, und genau diesen hält der Plan der Ankündigung fest (E1).
    outro.push(...debited.map((c) => `${COLLECTION_ON} ${day(announcedCollectionDay(c.dueOn, a.earliestCollection))}: ${formatEuro(c.openCents)}`));
  }
  if (first && a.fee?.method !== 'directDebit') {
    // Die Frist gegenüber dem Mitglied: die Fälligkeit, frühestens aber Briefdatum plus Zahlungsziel — bei einer
    // rückwirkenden Aufnahme läge die Fälligkeit sonst in der Vergangenheit (Befund 2026-10-18).
    const until = addDays(f.today, a.paymentTermDays);
    deadline = W.firstTransfer(formatEuro(first.openCents), first.dueOn > until ? first.dueOn : until);
    transfer = a.transfer(first);
  }
  return {
    recipient: f.recipient,
    subject: W.subject,
    info: memberInfo(f),
    intro: [f.greeting, f.memberName ? W.welcomeFor(f.memberName, a.joinedOn) : W.welcome(a.joinedOn)],
    table: { head: f.memberName ? W.headFor : W.head, rows, foot: null, align: ['left', 'left'] },
    deadline,
    transfer,
    outro,
    closing: [CLOSING, f.organizationName],
  };
}
