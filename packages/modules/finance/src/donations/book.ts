import { buildContext, invalid, isoNow, ok, prepare, readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { valueAt } from '../ledger/dated-values';
import { financeAllocationLines, financeCategories, financeConfirmationLines, financeConfirmations, financeEntries, financeInKindDetails, financePurposes } from '../schema';
import { inKindDetailsMissing, missingContactFields, returnedCentsInternal } from './check';
import { organizationParty, type ConfirmationKind } from './confirmations';
import { noticeValidAtInternal } from './notices';
import { SIMPLIFIED_RECEIPT_TEMPLATE_KEY } from './templates/simplified';

/**
 * Spendenbuch und Abstimmung (F6b Task 5, Spec 9.2, Annahme 9) — reine
 * Abfragen über festgeschriebene, nicht zurückgenommene Zeilen der vier
 * bescheinigungsfähigen Einnahmearten; Mitgliedsbeiträge nur, solange der
 * Verein sie bestätigt. Nichts wird gespeichert, nichts protokolliert.
 */
export type DonationBookKind = (typeof CERTIFIABLE_INCOME_KINDS)[number];

export interface DonationBookRow {
  lineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  /** `null`: anonym (ohne Kontakt) — die Oberfläche schreibt „anonym“. */
  contactId: string | null;
  contactName: string | null;
  kind: DonationBookKind;
  /** Wie gebucht: Rückgaben (Rücklastschrift, Rückzahlung mit `originLineId`) negativ. */
  amountCents: number;
  purposeName: string | null;
  /** Die gültige Bestätigung, in der die Zeile steht. */
  confirmation: { id: string; number: string; kind: ConfirmationKind } | null;
}

export type DonationBookSums = Record<DonationBookKind | 'total', number>;

export interface DonationBook {
  rows: DonationBookRow[];
  total: number;
  /** Über das ganze Jahr, nicht die Seite. */
  sums: DonationBookSums;
  membershipFeesCertifiable: boolean;
}

interface BookLine extends Omit<DonationBookRow, 'confirmation' | 'contactName'> {
  originLineId: string | null;
}

/** Die Zeilen des Jahres, sortiert nach Datum, Nummer und Position — ohne Rechteprüfung. */
function bookLinesInternal(db: DbOrTx, deps: Deps, year: number): { lines: BookLine[]; feesCertifiable: boolean } {
  const feesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  const kinds = CERTIFIABLE_INCOME_KINDS.filter((k) => feesCertifiable || k !== 'membershipFee');
  const lines = db
    .select({
      lineId: financeAllocationLines.id,
      entryId: financeEntries.id,
      entryNumber: financeEntries.number,
      entryDate: financeEntries.entryDate,
      position: financeAllocationLines.position,
      contactId: financeAllocationLines.contactId,
      kind: financeCategories.incomeKind,
      amountCents: financeAllocationLines.amountCents,
      purposeName: financePurposes.name,
      originLineId: financeAllocationLines.originLineId,
    })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .leftJoin(financePurposes, eq(financeAllocationLines.purposeId, financePurposes.id))
    .where(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), inArray(financeCategories.incomeKind, [...kinds])))
    .all()
    .filter((r) => r.amountCents !== 0 && r.entryDate.startsWith(`${year}-`))
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || (a.entryNumber ?? '').localeCompare(b.entryNumber ?? '') || a.position - b.position)
    .map(({ position: _position, kind, ...rest }) => ({ ...rest, kind: kind as DonationBookKind }));
  return { lines, feesCertifiable };
}

/** Je Zeile die gültige Bestätigung (nicht freigegebene Zeile) mit dem bestätigten Betrag. */
function validConfirmationsInternal(db: DbOrTx, lineIds: readonly string[]): Map<string, { id: string; number: string; kind: ConfirmationKind; amountCents: number }> {
  const out = new Map<string, { id: string; number: string; kind: ConfirmationKind; amountCents: number }>();
  if (lineIds.length === 0) return out;
  const rows = db
    .select({ lineId: financeConfirmationLines.lineId, amountCents: financeConfirmationLines.amountCents, id: financeConfirmations.id, number: financeConfirmations.documentNumber, kind: financeConfirmations.kind })
    .from(financeConfirmationLines)
    .innerJoin(financeConfirmations, eq(financeConfirmationLines.confirmationId, financeConfirmations.id))
    .where(and(inArray(financeConfirmationLines.lineId, [...lineIds]), isNull(financeConfirmationLines.releasedAt), isNull(financeConfirmations.voidedAt)))
    .all();
  for (const r of rows) out.set(r.lineId, { id: r.id, number: r.number, kind: r.kind as ConfirmationKind, amountCents: r.amountCents });
  return out;
}

const yearSchema = z.number().int().min(2000).max(9999);
const bookSchema = z.object({ year: yearSchema, limit: z.number().int().min(1).max(500).default(200), offset: z.number().int().min(0).default(0) });

/** `finance.read`: das Spendenbuch eines Jahres — Zeilen mit Spender oder anonym, Summen je Art. */
export async function getDonationBook(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DonationBook>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, bookSchema, input);
  if (!parsed.ok) return parsed;
  const { year, limit, offset } = parsed.value;

  const { lines, feesCertifiable } = bookLinesInternal(deps.db, deps, year);
  const sums: DonationBookSums = { donation: 0, membershipFee: 0, inKindDonation: 0, expenseWaiver: 0, total: 0 };
  for (const line of lines) {
    sums[line.kind] += line.amountCents;
    sums.total += line.amountCents;
  }
  const page = lines.slice(offset, offset + limit);
  const confirmations = validConfirmationsInternal(deps.db, page.map((l) => l.lineId));
  const contactIds = [...new Set(page.map((l) => l.contactId).filter((id): id is string => id !== null))];
  const names = new Map((contactIds.length === 0 ? [] : deps.db.select().from(contacts).where(inArray(contacts.id, contactIds)).all()).map((c) => [c.id, displayName(c)] as const));
  const rows = page.map(({ originLineId: _origin, ...line }) => {
    const confirmation = confirmations.get(line.lineId);
    return { ...line, contactName: line.contactId ? (names.get(line.contactId) ?? '') : null, confirmation: confirmation ? { id: confirmation.id, number: confirmation.number, kind: confirmation.kind } : null };
  });
  return ok({ rows, total: lines.length, sums, membershipFeesCertifiable: feesCertifiable });
}

export type ReconciliationReasonKey = 'belowMinimum' | 'addressMissing' | 'inKindUndescribed' | 'expenseWaiverUnconfirmed' | 'anonymous' | 'other';
const REASON_ORDER: readonly ReconciliationReasonKey[] = ['belowMinimum', 'addressMissing', 'inKindUndescribed', 'expenseWaiverUnconfirmed', 'anonymous', 'other'];

export interface DonationReconciliation {
  year: number;
  /** Summe des Spendenbuchs (Rückgaben abgezogen). */
  donationsCents: number;
  /** Summe der gültigen Bestätigungen über Zeilen des Jahres — wie bestätigt. */
  confirmedCents: number;
  /** `donationsCents − confirmedCents` = Summe der Gründe − `toCorrect.cents`. */
  differenceCents: number;
  /** Nur Gründe mit Zeilen, in fester Reihenfolge; `count` zählt Zeilen. */
  reasons: { key: ReconciliationReasonKey; count: number; cents: number; href: string }[];
  /** Bestätigungen, die mehr bescheinigen, als nach Rückgaben noch da ist (Prüfstein 6). */
  toCorrect: { count: number; cents: number; href: string };
  /** Die heute geltende Grenze des vereinfachten Nachweises (`simplifiedReceiptLimit`) — `null`, wenn keine hinterlegt ist. */
  simplifiedReceiptLimitCents: number | null;
}

const reasonHref = (key: ReconciliationReasonKey, year: number): string =>
  key === 'anonymous' ? `/finance/donations/book?year=${year}&contact=anonymous` : key === 'addressMissing' || key === 'other' ? `/finance/donations/run?year=${year}` : '/finance/donations?tab=uncertified';

/**
 * `finance.read`: Zuwendungen gegen gültige Bestätigungen (Annahme 9). Jede
 * offene Zeile (nach Rückgaben noch etwas wert, in keiner gültigen
 * Bestätigung) bekommt genau einen Grund, in dieser Rangfolge: anonym (ohne
 * Kontakt) · unter dem Mindestbetrag des Serienlaufs (Summe je Kontakt) ·
 * Anschrift fehlt · Sachspende nicht beschrieben · Aufwandsspende nicht
 * bestätigt · sonst „sonstige“ (bescheinigbar, aber nicht bestätigt).
 * Übersteigt eine Bestätigung ihre Zeilen nach Rückgaben, steht der
 * Überhang unter „zu korrigieren“. Trägt zusätzlich die heute geltende
 * Grenze des vereinfachten Nachweises mit — der Knopf im Spendenbuch
 * braucht sie für den Satz dazu, ohne eine eigene Abfrage.
 */
export async function getDonationReconciliation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DonationReconciliation>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, z.object({ year: yearSchema }), input);
  if (!parsed.ok) return parsed;
  const { year } = parsed.value;
  const db = deps.db;

  const { lines } = bookLinesInternal(db, deps, year);
  const donationsCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const gifts = lines.filter((l) => l.amountCents > 0);
  const giftIds = gifts.map((l) => l.lineId);
  const confirmed = validConfirmationsInternal(db, giftIds);
  const returned = returnedCentsInternal(db, giftIds);

  const tally = new Map<ReconciliationReasonKey, { count: number; cents: number }>();
  const add = (key: ReconciliationReasonKey, cents: number, count = 1) => {
    const t = tally.get(key) ?? { count: 0, cents: 0 };
    tally.set(key, { count: t.count + count, cents: t.cents + cents });
  };
  let confirmedCents = 0;
  const overConfirmed = new Map<string, number>();
  const open: (BookLine & { netCents: number })[] = [];
  for (const line of gifts) {
    const netCents = line.amountCents - (returned.get(line.lineId) ?? 0);
    const holder = confirmed.get(line.lineId);
    if (holder) {
      confirmedCents += holder.amountCents;
      const delta = netCents - holder.amountCents;
      if (delta < 0) overConfirmed.set(holder.id, (overConfirmed.get(holder.id) ?? 0) - delta);
      else if (delta > 0) add('other', delta);
      continue;
    }
    if (netCents > 0) open.push({ ...line, netCents });
  }

  const minCents = readSetting<number>(deps, 'finance.batchMinimumCents');
  const openByContact = new Map<string, number>();
  for (const line of open) if (line.contactId) openByContact.set(line.contactId, (openByContact.get(line.contactId) ?? 0) + line.netCents);
  const contactIds = [...openByContact.keys()];
  const contactRows = new Map((contactIds.length === 0 ? [] : db.select().from(contacts).where(inArray(contacts.id, contactIds)).all()).map((c) => [c.id, c] as const));
  const inKindIds = open.filter((l) => l.kind === 'inKindDonation').map((l) => l.lineId);
  const details = new Map((inKindIds.length === 0 ? [] : db.select().from(financeInKindDetails).where(inArray(financeInKindDetails.lineId, inKindIds)).all()).map((d) => [d.lineId, d] as const));

  for (const line of open) {
    const contact = line.contactId ? contactRows.get(line.contactId) : undefined;
    let key: ReconciliationReasonKey;
    if (!line.contactId) key = 'anonymous';
    else if ((openByContact.get(line.contactId) ?? 0) < minCents) key = 'belowMinimum';
    else if (!contact || missingContactFields(contact).length > 0) key = 'addressMissing';
    else if (line.kind === 'inKindDonation' && inKindDetailsMissing(details.get(line.lineId)).length > 0) key = 'inKindUndescribed';
    else if (line.kind === 'expenseWaiver') key = 'expenseWaiverUnconfirmed';
    else key = 'other';
    add(key, line.netCents);
  }

  const differenceCents = donationsCents - confirmedCents;
  const toCorrect = { count: overConfirmed.size, cents: [...overConfirmed.values()].reduce((s, c) => s + c, 0), href: '/finance/donations?tab=toCorrect' };
  // Rückgaben über die Jahresgrenze (Zeile im Vorjahr, Rückgabe in diesem): Was die Zeilen nicht erklären, steht unter „sonstige“.
  const explained = [...tally.values()].reduce((s, t) => s + t.cents, 0) - toCorrect.cents;
  if (explained !== differenceCents) add('other', differenceCents - explained, 0);

  const reasons = REASON_ORDER.filter((key) => tally.has(key)).map((key) => ({ key, ...tally.get(key)!, href: reasonHref(key, year) }));
  const limitValue = valueAt(db, 'simplifiedReceiptLimit', isoNow(deps.clock).slice(0, 10));
  const simplifiedReceiptLimitCents = typeof limitValue === 'number' ? limitValue : null;
  return ok({ year, donationsCents, confirmedCents, differenceCents, reasons, toCorrect, simplifiedReceiptLimitCents });
}

/**
 * `finance.read`: der vereinfachte Zuwendungsnachweis (§ 50 Abs. 4 EStDV,
 * Spec 7.5) als PDF — Vereinsangaben, der Bescheid-Satz des heute tragenden
 * Bescheids, Zweck und die heute geltende Grenze (`simplifiedReceiptLimit`).
 * Ein Vordruck ohne Spender: nichts wird abgelegt, nichts protokolliert.
 * Liefert Bytes: kein MCP-Werkzeug.
 */
export async function readSimplifiedReceipt(deps: Deps, ctx: CallContext): Promise<Result<{ bytes: Uint8Array; filename: string }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const today = isoNow(deps.clock).slice(0, 10);
  const notice = noticeValidAtInternal(deps.db, today);
  if (!notice) return financeConflict('noNoticeValidAt', { date: today });
  const organization = organizationParty(deps);
  if (!organization.name || organization.addressLines.length === 0) return financeConflict('confirmationOrganizationIncomplete');
  const limitCents = valueAt(deps.db, 'simplifiedReceiptLimit', today);
  if (typeof limitCents !== 'number') return invalid([{ path: 'simplifiedReceiptLimit', message: 'noValueAt' }]);

  const input = {
    organization,
    notice: { kind: notice.kind, taxOffice: notice.taxOffice, taxNumber: notice.taxNumber, noticeDate: notice.noticeDate, assessmentPeriod: notice.assessmentPeriod, purposesText: notice.purposesText },
    limitCents,
  };
  const prepared = await prepare(deps, ctx, { templateKey: SIMPLIFIED_RECEIPT_TEMPLATE_KEY, input }, { number: '', issuedOn: today });
  if (!prepared.ok) return prepared;
  const { built, baseId, bodyTypst, images } = prepared.value;
  const context = await buildContext(deps, ctx, '', today);
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context, images });
  return ok({ bytes, filename: 'Vereinfachter-Zuwendungsnachweis.pdf' });
}
