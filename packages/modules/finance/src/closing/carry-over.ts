import { notFound, ok, timeZoneOf, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { recordCarryOverInternal } from '../auditing/carry-over';
import { followUpOpenInternal, lastFiledReportInternal, scansOfInternal } from '../auditing/report';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { ensureFiscalYearFor, fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { taxReturnFiledForYearInternal } from '../ledger/tax-periods';
import { releaseReportsInternal } from '../reporting/finalize';
import { financeFiscalYears } from '../schema';
import { assemblyOfYearInternal } from './assembly';
import { addDaysInternal } from '../allocation/partner-proof';


const schema = z.object({ fiscalYearId: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/**
 * `finance.periodClose`, **`humanOnly`** (Spec § D1 „Wiederöffnen nach der Prüfung“, nach der MV): die offene
 * Nachprüfung schließen mit „Korrektur geht in Prüfpaket und Kassenbericht <Folgejahr> und wird der nächsten MV
 * berichtet“. Vor der MV nur über den Nachtrag (`assemblyNotRecorded`). Danach ist das Jahr wieder mit dem Scan des
 * zuletzt abgelegten Berichts freigegeben, die Begründung als Notiz (Joe 2026-10-24); danach festgeschriebene Berichte
 * tragen „Nach der Prüfung geändert, berichtet in <Folgejahr>“.
 */
export async function carryOverAuditFollowUp(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ carryOverId: string; count: number; targetFiscalYearId: string; notices: 'section153'[] }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  if (!followUpOpenInternal(deps.db, year.id)) return financeConflict('auditFollowUpNotOpen', { designation: year.designation });
  if (fiscalYearStatusInternal(deps.db, year.id) !== 'closed') return financeConflict('auditReportYearOpen', { designation: year.designation });
  if (!assemblyOfYearInternal(deps, deps.db, year.id, timeZoneOf(deps))) return financeConflict('assemblyNotRecorded', { designation: year.designation });
  const filed = lastFiledReportInternal(deps.db, year.id)!;
  const scan = scansOfInternal(deps.db, filed.id)[0];

  return deps.db.transaction((tx: DbOrTx) => {
    const target = ensureFiscalYearFor(tx, deps, ctx, addDaysInternal(year.endsOn, 1));
    if (!target.ok) return target;
    // Ein abgeschlossenes Folgejahr bekäme still einen anderen Datenstand (Schlussdurchsicht M3).
    if (fiscalYearStatusInternal(tx, target.value.id) === 'closed') return financeConflict('carryOverTargetClosed', { designation: target.value.designation });
    const recorded = recordCarryOverInternal(tx, deps, ctx, { fiscalYearId: year.id, note: v.note, targetFiscalYearId: target.value.id });
    releaseReportsInternal(tx, deps, ctx, { fiscalYearId: year.id, basis: 'auditReport', note: v.note, ...(scan ? { documentId: scan.documentId } : {}) });
    financeAudit(tx, deps, ctx, { action: 'finance.audit.carryOver', entity: 'financeAuditCarryOver', id: recorded.carryOverId, after: { fiscalYearId: year.id, targetFiscalYearId: target.value.id, entryCount: recorded.count }, params: { designation: year.designation, count: recorded.count } });
    // E6a (C1 5): Steuerlich bleibt die Korrektur im Jahr selbst. § 153 Abs. 1 S. 1 Nr. 1 AO (gesetze-im-internet.de,
    // abgerufen 2026-10-25): Erkennt der Steuerpflichtige nachträglich, „dass eine von ihm oder für ihn abgegebene
    // Erklärung unrichtig oder unvollständig ist und dass es dadurch zu einer Verkürzung von Steuern kommen kann“, ist
    // er verpflichtet, „dies unverzüglich anzuzeigen“. Ist die Erklärung des Jahres abgegeben: ein Hinweis, keine Sperre.
    const notices: 'section153'[] = taxReturnFiledForYearInternal(tx, year.id) !== null ? ['section153'] : [];
    return ok({ ...recorded, targetFiscalYearId: target.value.id, notices });
  });
}
