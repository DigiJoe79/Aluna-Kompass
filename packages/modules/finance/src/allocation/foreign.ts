import { readSetting, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { positionViewsOf, sumPositionCents } from './partner-payments';
import { financeAllocationLines, financeEntries, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financePartnerPaidLines, financePartnerPayments, financePartnerProfiles } from '../schema';

/**
 * Auslandsabfrage (F7 Task 5, Annahme 14, für den künftigen Auslandsbericht
 * F9b): drei getrennte Gruppen — Zahlungen an Partner nach Art, sonstige
 * Zeilen mit `abroad`, sonstige Zeilen an Kontakte im Ausland. Zeilen, die
 * schon zu einer Zahlung an Partner gehören (Paid-Lines, oder Zeilen der
 * Buchung, die einen aus ihr entstandenen Posten beglichen hat), erscheinen
 * nur in der ersten Gruppe.
 */
export interface ForeignPartnerPaymentEntry {
  paymentId: string;
  number: string | null;
  partnerName: string;
  basis: string;
  totalCents: number;
  approvedAt: string | null;
}
export interface ForeignLineEntry {
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  amountCents: number;
}
export interface ForeignActivityView {
  partnerPayments: ForeignPartnerPaymentEntry[];
  otherAbroadLines: ForeignLineEntry[];
  otherForeignContactLines: ForeignLineEntry[];
}

/** Zeilen, die schon zu einer Zahlung an Partner gehören: Paid-Lines und die Zeilen ihrer begleichenden Buchung. */
function partnerPaymentLineIdsInternal(db: DbOrTx): Set<string> {
  const paidLineIds = db.select({ id: financePartnerPaidLines.paidLineId }).from(financePartnerPaidLines).all().map((r) => r.id);
  const partnerItemIds = db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(eq(financeOpenItems.originType, 'financePartnerPayment')).all().map((r) => r.id);
  const settlingEntryIds =
    partnerItemIds.length === 0
      ? []
      : db
          .select({ entryId: financeMoneyLines.entryId })
          .from(financeOpenItemSettlements)
          .innerJoin(financeMoneyLines, eq(financeMoneyLines.id, financeOpenItemSettlements.moneyLineId))
          .where(inArray(financeOpenItemSettlements.openItemId, partnerItemIds))
          .all()
          .map((r) => r.entryId);
  const settlingLineIds = settlingEntryIds.length === 0 ? [] : db.select({ id: financeAllocationLines.id }).from(financeAllocationLines).where(inArray(financeAllocationLines.entryId, settlingEntryIds)).all().map((r) => r.id);
  return new Set([...paidLineIds, ...settlingLineIds]);
}

/** Reine Abfrage, ohne Rechteprüfung — für den Dienst und die Kachel. `orgCountry`: `organization.country` (Vorgabe `DE`). */
export function foreignActivityInternal(db: DbOrTx, range: { from: string; to: string }, orgCountry: string): ForeignActivityView {
  const excluded = partnerPaymentLineIdsInternal(db);

  const payments = db.select().from(financePartnerPayments).where(and(eq(financePartnerPayments.state, 'approved'), isNotNull(financePartnerPayments.approvedAt), gte(financePartnerPayments.approvedAt, range.from), lte(financePartnerPayments.approvedAt, `${range.to}T23:59:59.999Z`))).all();
  const partnerPayments: ForeignPartnerPaymentEntry[] = payments.map((p) => {
    const partner = db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, p.partnerId)).get()!;
    const contact = db.select().from(contacts).where(eq(contacts.id, partner.contactId)).get()!;
    return { paymentId: p.id, number: p.number, partnerName: displayName(contact), basis: p.basis, totalCents: sumPositionCents(positionViewsOf(db, p.id)), approvedAt: p.approvedAt };
  });

  const lines = db
    .select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, amountCents: financeAllocationLines.amountCents, abroad: financeAllocationLines.abroad, contactId: financeAllocationLines.contactId, entryDate: financeEntries.entryDate, entryNumber: financeEntries.number, status: financeEntries.status })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeEntries.status, 'final'), gte(financeEntries.entryDate, range.from), lte(financeEntries.entryDate, range.to)))
    .all()
    .filter((l) => !excluded.has(l.id));

  const otherAbroadLines: ForeignLineEntry[] = lines.filter((l) => l.abroad).map((l) => ({ entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, amountCents: l.amountCents }));

  const contactIds = [...new Set(lines.filter((l) => !l.abroad && l.contactId).map((l) => l.contactId!))];
  const foreignContactIds = new Set(contactIds.filter((id) => (db.select({ country: contacts.country }).from(contacts).where(eq(contacts.id, id)).get()?.country ?? orgCountry) !== orgCountry));
  const otherForeignContactLines: ForeignLineEntry[] = lines.filter((l) => !l.abroad && l.contactId && foreignContactIds.has(l.contactId)).map((l) => ({ entryId: l.entryId, entryNumber: l.entryNumber, entryDate: l.entryDate, amountCents: l.amountCents }));

  return { partnerPayments, otherAbroadLines, otherForeignContactLines };
}

const rangeSchema = z.object({ from: z.string().date(), to: z.string().date() });

/** `finance.read`: die Auslandsabfrage über einen Zeitraum. */
export async function foreignActivity(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ForeignActivityView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, rangeSchema, input);
  if (!parsed.ok) return parsed;
  const orgCountry = readSetting<string>(deps, 'organization.country');
  return { ok: true, value: foreignActivityInternal(deps.db, parsed.value, orgCountry) };
}
