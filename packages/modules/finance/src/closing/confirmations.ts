import { isoNow, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { lastFiledReportInternal, scansOfInternal } from '../auditing/report';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { releaseReportsInternal } from '../reporting/finalize';
import { financeClosingConfirmations, financeFiscalYears } from '../schema';
import { closingStepInternal } from './status';
import { CLOSING_STEPS, CONFIRMABLE_STEPS, type ClosingStepKey } from './types';

const confirmSchema = z
  .object({ fiscalYearId: z.string().min(1), step: z.enum(CLOSING_STEPS), note: z.string().trim().min(1).max(1000).nullable().optional() })
  .superRefine((v, c) => {
    if (!(CONFIRMABLE_STEPS as readonly string[]).includes(v.step)) c.addIssue({ code: 'custom', path: ['step'], message: 'notConfirmable' });
    else if (v.step !== 'statements' && v.step !== 'auditReport' && !v.note) c.addIssue({ code: 'custom', path: ['note'], message: 'required' });
  });

/**
 * `finance.periodClose`, **`humanOnly`** (persönliche Erklärung, Joe 2026-10-24): einen Schritt des Jahresabschlusses
 * bestätigen — mit Begründung, außer „Alle Auszüge des Jahres liegen in der Akte“ (Schritt 1) und der Nachprüfung ohne
 * geänderte Buchung (Schritt 10: den Befund liefert Kompass, Board 14d B). Nur im beendeten Jahr.
 * Nur anhängen: eine zweite Bestätigung ersetzt die Anzeige, die erste bleibt. Schritt 10 (Nachprüfung ohne geänderte
 * Buchung) gibt das Jahr dabei wieder mit dem abgelegten Prüfbericht frei.
 */
export async function confirmClosingStep(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string; step: ClosingStepKey }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, confirmSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, v.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  if (!(todayIn(deps) > year.endsOn)) return financeConflict('fiscalYearNotEnded', { year: year.designation });
  if (!closingStepInternal(deps, year, v.step).confirmable) return financeConflict('closingStepNotConfirmable', { step: CLOSING_STEPS.indexOf(v.step) + 1 });
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    tx.insert(financeClosingConfirmations).values({ id, fiscalYearId: year.id, step: v.step, note: v.note ?? null, at: isoNow(deps.clock), byUserId: ctx.userId ?? 'system' }).run();
    // Schritt 10, Nachprüfung ohne geänderte Buchung (Befund 3): Der abgelegte Prüfbericht gilt weiter und gibt das
    // Jahr wieder frei — wie bei der Übernahme ins Folgejahr, mit dem Scan des zuletzt abgelegten Berichts.
    if (v.step === 'auditReport') {
      const filed = lastFiledReportInternal(tx, year.id);
      const scan = filed ? scansOfInternal(tx, filed.id)[0] : undefined;
      releaseReportsInternal(tx, deps, ctx, { fiscalYearId: year.id, basis: 'auditReport', note: v.note ?? null, ...(scan ? { documentId: scan.documentId } : {}) });
    }
    financeAudit(tx, deps, ctx, { action: 'finance.closing.confirm', entity: 'financeClosingConfirmation', id, after: { fiscalYearId: year.id, step: v.step }, params: { designation: year.designation, step: v.step } });
    return ok({ id, step: v.step });
  });
}
