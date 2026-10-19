import { isoNow, newId, recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { documents } from '@kompass/module-dms';
import { expiredRunIdsInternal, financeOpenItems, financeSepaPrenotifications, openCentsInternal, unreturnedRunItemsInternal } from '@kompass/module-finance';
import { feePaymentReference } from './fee-period';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { agreementAt } from './fee-agreement';
import { memberFeeCharges, memberMemberships, memberTransferRequests, type FeeChargeRow, type PaymentMethod } from './schema';

/**
 * Der Zahlweg am Beitrag (Plan N1, Entscheidung E3; Befund M7): Ein Beitrag bekommt beim Anlegen den Zahlweg der
 * Vereinbarung an seiner Fälligkeit. Wechselt der Zahlweg, ziehen offene Beiträge mit — außer ein festgeschriebener
 * Brief forderte schon zur Überweisung auf, oder der Beitrag steckt in einem Einzug. Sonst zahlte das Mitglied doppelt:
 * einmal auf den Brief hin, einmal per Einzug.
 */

const later = (a: string, b: string) => (a > b ? a : b);

/** Der Zahlweg eines neuen Beitrags: der der Vereinbarung an seiner Fälligkeit, ohne Vereinbarung Überweisung. */
export function paymentMethodAt(db: DbOrTx, membershipId: string, dueOn: string): PaymentMethod {
  return agreementAt(db, membershipId, dueOn)?.paymentMethod ?? 'transfer';
}

/**
 * Das Mandat, von dem ein Lastschrift-Beitrag am Tag `on` eingezogen wird: das der Vereinbarung, die am späteren von
 * Fälligkeit und `on` gilt (ein überfälliger Beitrag geht vom heutigen Mandat). `null` bei Überweisung oder ohne Mandat.
 */
export function mandateForChargeInternal(db: DbOrTx, charge: Pick<FeeChargeRow, 'membershipId' | 'dueOn' | 'paymentMethod'>, on: string): string | null {
  if (charge.paymentMethod !== 'directDebit') return null;
  const agreement = agreementAt(db, charge.membershipId, later(charge.dueOn, on));
  return agreement?.paymentMethod === 'directDebit' ? agreement.mandateId : null;
}

/** Hält fest, dass ein Brief zu diesen Beiträgen zur Überweisung auffordert — in der Transaktion des Ausstellens. */
export function recordTransferRequestsInternal(tx: DbOrTx, deps: Deps, chargeIds: readonly string[], documentId: string): void {
  const now = isoNow(deps.clock);
  for (const chargeId of new Set(chargeIds)) tx.insert(memberTransferRequests).values({ id: newId(), chargeId, documentId, createdAt: now }).run();
}

export interface TransferKept {
  chargeId: string;
  periodStart: string;
  documentId: string;
  documentNumber: string | null;
  documentDate: string;
}

/** Der jüngste nicht stornierte, festgeschriebene Brief, der zu diesem Beitrag zur Überweisung aufforderte. */
function transferLetterOf(db: DbOrTx, chargeId: string): { id: string; number: string | null; documentDate: string } | null {
  return (
    db
      .select({ id: documents.id, number: documents.number, documentDate: documents.documentDate })
      .from(memberTransferRequests)
      .innerJoin(documents, eq(documents.id, memberTransferRequests.documentId))
      .where(and(eq(memberTransferRequests.chargeId, chargeId), eq(documents.phase, 'issued'), ne(documents.status, 'voided')))
      .orderBy(desc(documents.documentDate))
      .get() ?? null
  );
}

/**
 * R4: die jüngste festgeschriebene, nicht stornierte Ankündigung, die diesen Beitrag als Einzug nennt (über den
 * Verwendungszweck im Plan). Das Mitglied verlässt sich auf den Einzug — wechselt der Zahlweg auf Überweisung, braucht
 * es eine neue Beitragsmitteilung mit Überweisungsdaten.
 */
function debitNoticeOf(db: DbOrTx, reference: string): { id: string; number: string | null; documentDate: string } | null {
  const rows = db
    .select({ id: documents.id, number: documents.number, documentDate: documents.documentDate, plan: financeSepaPrenotifications.plan })
    .from(financeSepaPrenotifications)
    .innerJoin(documents, eq(documents.id, financeSepaPrenotifications.documentId))
    .where(and(eq(documents.phase, 'issued'), ne(documents.status, 'voided')))
    .all()
    .filter((r) => r.plan.some((e) => e.remittance === reference))
    .sort((a, b) => b.documentDate.localeCompare(a.documentDate));
  const latest = rows[0];
  return latest ? { id: latest.id, number: latest.number, documentDate: latest.documentDate } : null;
}

/** Ein Beitrag, dessen Zahlweg noch wechseln kann: vorgemerkt, oder angelegt mit offenem, nicht storniertem Posten. */
function stillOpen(db: DbOrTx, charge: FeeChargeRow): boolean {
  if (charge.state === 'pending') return true;
  if (charge.state !== 'created' || !charge.openItemId) return false;
  const item = db.select({ cancelledAt: financeOpenItems.cancelledAt }).from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId)).get();
  return !!item && item.cancelledAt === null && openCentsInternal(db, charge.openItemId) > 0;
}

/**
 * Was ein Zahlwegwechsel ab `from` mit den offenen Beiträgen macht, ohne zu schreiben: Jeder bekommt den Zahlweg der
 * Vereinbarung am späteren von Fälligkeit und `from` — ein Beitrag vor dem Wechsel also den neuen. Bleiben müssen
 * Beiträge in einem Einzug, der nicht storniert und nicht zurückgegeben ist, und Überweisungs-Beiträge mit Brief.
 */
export interface PaymentMethodSyncPlan {
  change: { charge: FeeChargeRow; to: PaymentMethod }[];
  transferKept: TransferKept[];
  /** R4: Beiträge, die auf Überweisung wechseln, obwohl ein Brief sie als Einzug angekündigt hat — neue Beitragsmitteilung ausstellen. */
  debitAnnounced: TransferKept[];
}

export function planPaymentMethodSyncInternal(db: DbOrTx, membershipId: string, from: string, expired: ReadonlySet<string> = new Set()): PaymentMethodSyncPlan {
  const charges = db.select().from(memberFeeCharges).where(and(eq(memberFeeCharges.membershipId, membershipId), inArray(memberFeeCharges.state, ['pending', 'created']))).all();
  const memberNumber = db.select({ n: memberMemberships.memberNumber }).from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get()?.n ?? null;
  const out: PaymentMethodSyncPlan = { change: [], transferKept: [], debitAnnounced: [] };
  for (const charge of charges.sort((a, b) => a.periodStart.localeCompare(b.periodStart))) {
    const to = paymentMethodAt(db, membershipId, later(charge.dueOn, from));
    if (to === charge.paymentMethod || !stillOpen(db, charge)) continue;
    if (charge.openItemId && unreturnedRunItemsInternal(db, { source: 'openItem', sourceId: charge.openItemId, excludeRunIds: expired }).length > 0) continue;
    const letter = to === 'directDebit' ? transferLetterOf(db, charge.id) : null;
    if (letter) {
      out.transferKept.push({ chargeId: charge.id, periodStart: charge.periodStart, documentId: letter.id, documentNumber: letter.number, documentDate: letter.documentDate });
      continue;
    }
    out.change.push({ charge, to });
    const notice = to === 'transfer' && memberNumber ? debitNoticeOf(db, feePaymentReference(charge.periodStart, charge.periodEnd, memberNumber)) : null;
    if (notice) out.debitAnnounced.push({ chargeId: charge.id, periodStart: charge.periodStart, documentId: notice.id, documentNumber: notice.number, documentDate: notice.documentDate });
  }
  return out;
}

/** Wendet den Wechsel an (in der Transaktion des Aufrufers) und protokolliert ihn mit Nummer und Zahl. */
export function syncPaymentMethodsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membershipId: string, from: string): PaymentMethodSyncPlan {
  const plan = planPaymentMethodSyncInternal(tx, membershipId, from, expiredRunIdsInternal(deps, tx));
  const { change } = plan;
  if (change.length === 0) return plan;
  for (const { charge, to } of change) tx.update(memberFeeCharges).set({ paymentMethod: to }).where(eq(memberFeeCharges.id, charge.id)).run();
  const membership = tx.select({ memberNumber: memberMemberships.memberNumber }).from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  recordAudit(tx, deps, ctx, {
    action: 'members.fees.paymentMethod',
    entityType: 'membership',
    entityId: membershipId,
    after: { charges: change.map((c) => ({ chargeId: c.charge.id, paymentMethod: c.to })) },
    params: { memberNumber: membership?.memberNumber ?? null, count: change.length },
  });
  return plan;
}
