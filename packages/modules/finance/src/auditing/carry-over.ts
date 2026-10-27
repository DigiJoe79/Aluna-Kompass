import { isoNow, newId, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { and, desc, eq, gt } from 'drizzle-orm';
import type { FinalStageNote } from '../locks';
import { financeAuditBaselineEntries, financeAuditCarryOverEntries, financeAuditCarryOvers, financeEntries, financeFiscalYears, financePeriodEvents, type FinanceAuditCarryOverRow } from '../schema';
import { changedSinceInternal, latestBaselineInternal, referenceBaselineInternal } from './baseline';

/**
 * Rechenschaft C / D1 (Spec § D1, nach der MV, Joe 2026-10-24): „Korrektur geht in Prüfpaket und Kassenbericht
 * <Folgejahr> und wird der nächsten MV berichtet“ schließt die Nachprüfung — nur für den Prüfstand, auf dem sie steht.
 * Hier, eine Ebene unter `closing/`, damit `report.ts` und `access.ts` sie ohne Rückwärts-Import kennen.
 */

export type CarryOverChange = 'new' | 'reversed' | 'changed';

/** Die Übernahme auf diesem Prüfstand, oder `null`. */
export function carryOverForBaselineInternal(db: DbOrTx, baselineId: string): FinanceAuditCarryOverRow | null {
  return db.select().from(financeAuditCarryOvers).where(eq(financeAuditCarryOvers.baselineId, baselineId)).orderBy(desc(financeAuditCarryOvers.at)).get() ?? null;
}

/**
 * Schließt eine Übernahme die Nachprüfung des Jahres? Sie steht auf dem jüngsten Prüfstand, und danach wurde das Jahr
 * nicht wieder geöffnet.
 */
export function carryOverClosesFollowUpInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const latest = latestBaselineInternal(db, fiscalYearId);
  const carry = latest ? carryOverForBaselineInternal(db, latest.id) : null;
  if (!carry) return false;
  return !db.select({ id: financePeriodEvents.id }).from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, fiscalYearId), eq(financePeriodEvents.kind, 'reopened'), gt(financePeriodEvents.at, carry.at))).get();
}

/** Die jüngste Übernahme eines Jahres mit dem Folgejahr, für den Stand des Jahresabschlusses. */
export function carryOverOfYearInternal(db: DbOrTx, fiscalYearId: string): { at: string; note: string; targetDesignation: string } | null {
  const carry = db.select().from(financeAuditCarryOvers).where(eq(financeAuditCarryOvers.fiscalYearId, fiscalYearId)).orderBy(desc(financeAuditCarryOvers.at)).get();
  if (!carry) return null;
  const target = db.select({ designation: financeFiscalYears.designation }).from(financeFiscalYears).where(eq(financeFiscalYears.id, carry.targetFiscalYearId)).get();
  return { at: carry.at, note: carry.note, targetDesignation: target?.designation ?? '' };
}

/** Die Buchungen, die mit Übernahmen in dieses Jahr gingen — für Kassenbericht und Prüfpaket des Folgejahres. */
export function carriedIntoYearInternal(db: DbOrTx, targetFiscalYearId: string): { entryId: string; entryNumber: string; fiscalYearDesignation: string; change: CarryOverChange }[] {
  return db
    .select({ entryId: financeAuditCarryOverEntries.entryId, entryNumber: financeAuditCarryOverEntries.entryNumber, fiscalYearDesignation: financeFiscalYears.designation, change: financeAuditCarryOverEntries.change })
    .from(financeAuditCarryOverEntries)
    .innerJoin(financeAuditCarryOvers, eq(financeAuditCarryOvers.id, financeAuditCarryOverEntries.carryOverId))
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeAuditCarryOvers.fiscalYearId))
    .where(eq(financeAuditCarryOvers.targetFiscalYearId, targetFiscalYearId))
    .orderBy(financeFiscalYears.endsOn, financeAuditCarryOverEntries.entryNumber)
    .all();
}

/**
 * In der Transaktion des Aufrufers: die Übernahme auf dem jüngsten Prüfstand, je seit dem abgelegten Bericht geänderter
 * Buchung eine Zeile. Prüft nichts — das tut der Dienst (`closing/carry-over.ts`).
 */
export function recordCarryOverInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { fiscalYearId: string; note: string; targetFiscalYearId: string }): { carryOverId: string; count: number } {
  const latest = latestBaselineInternal(tx, input.fiscalYearId);
  const reference = referenceBaselineInternal(tx, input.fiscalYearId);
  if (!latest || !reference) throw new Error(`Geschäftsjahr ${input.fiscalYearId}: kein Prüfstand für die Übernahme`);
  const id = newId();
  tx.insert(financeAuditCarryOvers).values({ id, fiscalYearId: input.fiscalYearId, baselineId: latest.id, targetFiscalYearId: input.targetFiscalYearId, note: input.note, at: isoNow(deps.clock), byUserId: ctx.userId ?? 'system' }).run();
  const inReference = new Set(tx.select({ entryId: financeAuditBaselineEntries.entryId }).from(financeAuditBaselineEntries).where(eq(financeAuditBaselineEntries.baselineId, reference)).all().map((r) => r.entryId));
  const changed = changedSinceInternal(tx, input.fiscalYearId, reference);
  for (const entryId of changed) {
    const entry = tx.select({ number: financeEntries.number, reversedByEntryId: financeEntries.reversedByEntryId }).from(financeEntries).where(eq(financeEntries.id, entryId)).get();
    const change: CarryOverChange = !inReference.has(entryId) ? 'new' : entry?.reversedByEntryId ? 'reversed' : 'changed';
    tx.insert(financeAuditCarryOverEntries).values({ carryOverId: id, entryId, entryNumber: entry?.number ?? '', change }).run();
  }
  return { carryOverId: id, count: changed.length };
}

/** Hinweis im Kopf der danach festgeschriebenen Berichte des Jahres (Joe 2026-10-24) — eingetragen in `manifest.ts`. */
export const carryOverStageNote: FinalStageNote = (db, fiscalYearId) => {
  const carry = carryOverOfYearInternal(db, fiscalYearId);
  return carry ? { text: `Nach der Prüfung geändert, berichtet in ${carry.targetDesignation}`, since: carry.at } : null;
};
