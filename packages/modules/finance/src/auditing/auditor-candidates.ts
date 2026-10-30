import { notFound, ok, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeFiscalYears } from '../schema';
import { auditorCandidatesOf, type AuditorCandidate } from '../sources';
import { auditorsOfYearInternal } from './access';
import { lastFiledReportInternal } from './report';

export const auditorCandidatesSchema = z.object({ fiscalYearId: z.string().min(1) });

/**
 * `finance.periodClose` (wie `saveAuditor`): die Kassenprüfer, die Gremien für den Prüfzeitraum führt, als Vorschlag
 * für den Prüfer-Dialog (Spec Gremien § 8.1) — mit „gewählt am“ und Protokoll. Wer für das Jahr schon eingetragen ist,
 * fällt heraus. Ohne Quelle, ohne Gremien oder mit abgelegtem Prüfbericht des Jahres (V-9) leer. Schreibt nichts: Modus und Zugang bleiben Handlungen der Finanzen.
 */
export async function auditorCandidates(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditorCandidate[]>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, auditorCandidatesSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  // Das Jahr ist geprüft: Wer prüfte, steht fest — ein Vorschlag wäre irreführend (V-9).
  if (lastFiledReportInternal(deps.db, year.id)) return ok([]);
  const listed = new Set(auditorsOfYearInternal(deps.db, year.id).map((a) => a.contactId));
  return ok(auditorCandidatesOf(deps, deps.db, year).filter((c) => !listed.has(c.contactId)));
}
