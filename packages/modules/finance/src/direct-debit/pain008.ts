import type { PendingAmendment } from '../schema';
import { sepaText } from './charset';

/**
 * Die Bankdatei pain.008.001.08 (SEPA-Basislastschrift, DFÜ-Abkommen Anlage 3, GBIC_5; Spec § 7.4, Plan L2 Task 3).
 * Rein: Daten rein, XML-Text raus. Ein `PmtInf` je Fälligkeitstag und Sequenz, `CORE`, `SLEV`, `RCUR` auch für den
 * ersten Einzug bzw. `OOFF`; ohne BIC `NOTPROVIDED`; Namen auf 70, Verwendungszweck auf 140 Zeichen im Zeichensatz der
 * Deutschen Kreditwirtschaft; Beträge mit Punkt und zwei Stellen.
 */
export interface Pain008Item {
  endToEndId: string;
  amountCents: number;
  mandateReference: string;
  signedOn: string;
  amendment?: PendingAmendment | null;
  debtorName: string;
  debtorIban: string;
  debtorBic?: string | null;
  remittance: string;
}

export interface Pain008Group {
  collectionDate: string;
  sequence: 'recurring' | 'oneOff';
  items: readonly Pain008Item[];
}

export interface Pain008Run {
  messageId: string;
  /** ISO-Zeitstempel (UTC) der Erzeugung. */
  createdAt: string;
  initiatingParty: string;
  creditor: { name: string; iban: string; creditorId: string };
  batchBooking: boolean;
  groups: readonly Pain008Group[];
}

export const PAIN008_NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const el = (tag: string, inner: string) => `<${tag}>${inner}</${tag}>`;
const text = (tag: string, value: string) => el(tag, escape(value));
/** Betrag in Cent als `12.00`. */
export const sepaAmount = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
const sum = (items: readonly Pain008Item[]) => items.reduce((total, i) => total + i.amountCents, 0);
const id = (value: string) => sepaText(value, 35);

function agent(bic: string | null | undefined): string {
  return el('FinInstnId', bic ? text('BICFI', bic) : el('Othr', text('Id', 'NOTPROVIDED')));
}

function mandate(item: Pain008Item): string {
  const a = item.amendment ?? null;
  const details = a ? (a.originalReference ? text('OrgnlMndtId', id(a.originalReference)) : '') + (a.originalIban ? el('OrgnlDbtrAcct', el('Id', text('IBAN', a.originalIban))) : '') : '';
  const amended = details !== '';
  return el('MndtRltdInf', text('MndtId', id(item.mandateReference)) + text('DtOfSgntr', item.signedOn) + text('AmdmntInd', String(amended)) + (amended ? el('AmdmntInfDtls', details) : ''));
}

function transaction(item: Pain008Item): string {
  return el(
    'DrctDbtTxInf',
    el('PmtId', text('EndToEndId', id(item.endToEndId))) +
      `<InstdAmt Ccy="EUR">${sepaAmount(item.amountCents)}</InstdAmt>` +
      el('DrctDbtTx', mandate(item)) +
      el('DbtrAgt', agent(item.debtorBic)) +
      el('Dbtr', text('Nm', sepaText(item.debtorName, 70))) +
      el('DbtrAcct', el('Id', text('IBAN', item.debtorIban))) +
      el('RmtInf', text('Ustrd', sepaText(item.remittance, 140))),
  );
}

export function buildPain008(run: Pain008Run): string {
  const all = run.groups.flatMap((g) => g.items);
  const creditorName = sepaText(run.creditor.name, 70);
  const header = el(
    'GrpHdr',
    text('MsgId', id(run.messageId)) + text('CreDtTm', `${run.createdAt.slice(0, 19)}Z`) + text('NbOfTxs', String(all.length)) + text('CtrlSum', sepaAmount(sum(all))) + el('InitgPty', text('Nm', sepaText(run.initiatingParty, 70))),
  );
  const payments = run.groups.map((g, index) =>
    el(
      'PmtInf',
      text('PmtInfId', id(`${run.messageId}-P${index + 1}`)) +
        text('PmtMtd', 'DD') +
        text('BtchBookg', String(run.batchBooking)) +
        text('NbOfTxs', String(g.items.length)) +
        text('CtrlSum', sepaAmount(sum(g.items))) +
        el('PmtTpInf', el('SvcLvl', text('Cd', 'SEPA')) + el('LclInstrm', text('Cd', 'CORE')) + text('SeqTp', g.sequence === 'oneOff' ? 'OOFF' : 'RCUR')) +
        text('ReqdColltnDt', g.collectionDate) +
        el('Cdtr', text('Nm', creditorName)) +
        el('CdtrAcct', el('Id', text('IBAN', run.creditor.iban))) +
        el('CdtrAgt', agent(null)) +
        text('ChrgBr', 'SLEV') +
        el('CdtrSchmeId', el('Id', el('PrvtId', el('Othr', text('Id', run.creditor.creditorId) + el('SchmeNm', text('Prtry', 'SEPA')))))) +
        g.items.map(transaction).join(''),
    ),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Document xmlns="${PAIN008_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${el('CstmrDrctDbtInitn', header + payments.join(''))}</Document>\n`;
}
