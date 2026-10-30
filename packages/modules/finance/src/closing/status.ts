import { hasPermission, notFound, ok, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireFinanceRead } from '../ledger/access';
import { fundsUseAppliesInternal } from '../reporting/funds-use-inputs';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { financeClosingConfirmations, financeFiscalYears, financePeriodEvents, type FinanceFiscalYearRow } from '../schema';
import { handoversOfYearInternal } from './handover';
import { STEPS_AFTER } from './steps-after';
import { STEPS_BEFORE, type StepContext, type StepResult } from './steps-before';
import { CLOSING_STEPS, CONFIRMABLE_STEPS, groupOf, type ClosingConfirmation, type ClosingStatus, type ClosingStepKey, type ClosingStepView } from './types';

/** Die jüngste Bestätigung je Schritt eines Jahres. */
export function closingConfirmationsInternal(db: DbOrTx, fiscalYearId: string): Map<ClosingStepKey, ClosingConfirmation> {
  const rows = db.select().from(financeClosingConfirmations).where(eq(financeClosingConfirmations.fiscalYearId, fiscalYearId)).orderBy(desc(financeClosingConfirmations.at), desc(financeClosingConfirmations.id)).all();
  const latest = new Map<ClosingStepKey, ClosingConfirmation>();
  for (const r of rows) if (!latest.has(r.step as ClosingStepKey)) latest.set(r.step as ClosingStepKey, { note: r.note, at: r.at, byUserId: r.byUserId });
  return latest;
}

/** Der Stand eines Schritts, ohne Rechteprüfung — `confirmClosingStep` fragt so, ob er bestätigt werden kann. */
export function closingStepInternal(deps: Deps, year: FinanceFiscalYearRow, key: ClosingStepKey, confirmations = closingConfirmationsInternal(deps.db, year.id)): StepResult {
  const ctx: StepContext = { deps, year, today: todayIn(deps), confirmation: (step) => confirmations.get(step) ?? null };
  const compute = (STEPS_BEFORE as Record<string, ((c: StepContext) => StepResult) | undefined>)[key] ?? (STEPS_AFTER as Record<string, (c: StepContext) => StepResult>)[key]!;
  return compute(ctx);
}

/** Wiedergeöffnet: das jüngste Ereignis `reopened` — bis 8, 9 und 10 (und 13, wenn gezeigt) wieder erledigt sind. */
const TO_REPEAT: readonly ClosingStepKey[] = ['close', 'auditPackage', 'auditReport', 'fundsUse'];

export function closingStatusInternal(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow): ClosingStatus {
  const confirmations = closingConfirmationsInternal(deps.db, year.id);
  // Schritt 13 nur über der Grenze (Spec 0.4.5 Teil M, Entscheidung 4); die Nummern 1–12 bleiben.
  const shown = CLOSING_STEPS.map((key, index) => ({ key, number: index + 1 })).filter((s) => s.key !== 'fundsUse' || fundsUseAppliesInternal(deps.db, year.id));
  const steps: ClosingStepView[] = shown.map(({ key, number }) => {
    const result = closingStepInternal(deps, year, key, confirmations);
    // Eine Bestätigung zählt nur für einen bestätigbaren Schritt; die von Schritt 2 aus E1 nicht mehr (Board 14a).
    const confirmable = (CONFIRMABLE_STEPS as readonly string[]).includes(key);
    return { key, number, group: groupOf(key), done: result.done, confirmable: result.confirmable && confirmable, confirmation: confirmable ? (confirmations.get(key) ?? null) : null, facts: result.facts };
  });
  const reopenedEvent = deps.db.select().from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, year.id), eq(financePeriodEvents.kind, 'reopened'))).orderBy(desc(financePeriodEvents.at)).get();
  const open = TO_REPEAT.filter((key) => steps.some((s) => s.key === key && !s.done));
  const reopened = reopenedEvent && open.length > 0 ? { at: reopenedEvent.at, byUserId: reopenedEvent.byUserId, reason: reopenedEvent.reason ?? '' } : null;
  return {
    fiscalYearId: year.id,
    designation: year.designation,
    startsOn: year.startsOn,
    endsOn: year.endsOn,
    ended: todayIn(deps) > year.endsOn,
    yearStatus: fiscalYearStatusInternal(deps.db, year.id),
    doneCount: steps.filter((s) => s.done).length,
    next: nextStep(steps),
    reopened,
    toRepeat: reopened ? open : [],
    handovers: handoversOfYearInternal(deps.db, year.id),
    steps,
    me: { canConfirm: hasPermission(ctx, 'finance.periodClose'), canClose: hasPermission(ctx, 'finance.periodClose'), canHandover: hasPermission(ctx, 'finance.setup'), canCount: hasPermission(ctx, 'finance.entriesFinalize'), canRunConfirmations: hasPermission(ctx, 'finance.donationsIssue') },
  };
}

/**
 * Der erste nicht erledigte Schritt. Ausnahme Schritt 11 mit gespeichertem, aber unvollständigem Ergebnis (Entlastung
 * vertagt oder verweigert): Das sperrt nichts, also geht es beim ersten offenen Schritt danach weiter; gibt es keinen,
 * bleibt es Schritt 11 (Befund 2, Joe 2026-10-25).
 */
function nextStep(steps: ClosingStepView[]): ClosingStepKey | null {
  const first = steps.find((s) => !s.done);
  if (!first) return null;
  if (first.facts.key === 'assembly' && first.facts.result !== null) return steps.find((s) => !s.done && s.number > first.number)?.key ?? first.key;
  return first.key;
}

const statusSchema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.read`: der Stand des Jahresabschlusses — zwölf Schritte (über der Grenze 13), was erledigt ist, was als Nächstes kommt. */
export async function getClosingStatus(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<ClosingStatus>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, statusSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  return ok(closingStatusInternal(deps, ctx, year));
}
