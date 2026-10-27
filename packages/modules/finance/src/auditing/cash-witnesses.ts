import type { DbOrTx } from '@kompass/core';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { CashCountWitnessCheck } from '../locks';
import { financeCashCountWitnesses, financeCashCounts, financeFiscalYears } from '../schema';
import { auditorsOfYearInternal, currentAuditYearInternal } from './access';
import type { AuditCashCount } from './types';

/**
 * Kassenzählung „im Beisein von“ (Designer Runde 3 12f): Zeugen sind Prüfer des Jahres, das gerade geprüft wird —
 * ohne laufende Prüfung keine. Eingetragen über das Manifest in `CASH_COUNT_WITNESS_CHECKS` (`ledger/cash.ts`).
 */
export const auditWitnessCheck: CashCountWitnessCheck = (db, _countedOn, auditorIds) => {
  const yearId = currentAuditYearInternal(db);
  if (!yearId) return { code: 'witnessNoAudit' };
  const ofYear = new Set(auditorsOfYearInternal(db, yearId).map((a) => a.id));
  return auditorIds.every((id) => ofYear.has(id)) ? null : { code: 'witnessNotAuditor' };
};

/**
 * Zählungen mit Zeugen unter den Prüfern des Jahres nach dem Prüfstand, neueste zuerst: gezählt nach dem Ende des
 * Geschäftsjahres, und beim Prüfstand einer Nachprüfung erst nach ihm angelegt (die alte Zählung gehörte zum Bericht).
 */
export function cashCountsAfterInternal(db: DbOrTx, fiscalYearId: string, baseline: { createdAt: string; kind: 'initial' | 'followUp' }): AuditCashCount[] {
  const auditorIds = auditorsOfYearInternal(db, fiscalYearId).map((a) => a.id);
  const year = db.select({ endsOn: financeFiscalYears.endsOn }).from(financeFiscalYears).where(eq(financeFiscalYears.id, fiscalYearId)).get();
  if (auditorIds.length === 0 || !year) return [];
  const witnessed = db.select().from(financeCashCountWitnesses).where(inArray(financeCashCountWitnesses.auditorId, auditorIds)).all();
  const countIds = [...new Set(witnessed.map((w) => w.countId))];
  if (countIds.length === 0) return [];
  return db
    .select()
    .from(financeCashCounts)
    .where(and(inArray(financeCashCounts.id, countIds), gt(financeCashCounts.countedOn, year.endsOn), baseline.kind === 'followUp' ? gt(financeCashCounts.createdAt, baseline.createdAt) : undefined))
    .orderBy(desc(financeCashCounts.countedOn), desc(financeCashCounts.createdAt))
    .all()
    .map((c) => ({ countId: c.id, countedOn: c.countedOn, countedCents: c.countedCents, witnessAuditorIds: witnessed.filter((w) => w.countId === c.id).map((w) => w.auditorId) }));
}

export function witnessOfInternal(db: DbOrTx, auditorId: string): boolean {
  return Boolean(db.select({ id: financeCashCountWitnesses.countId }).from(financeCashCountWitnesses).where(eq(financeCashCountWitnesses.auditorId, auditorId)).get());
}
