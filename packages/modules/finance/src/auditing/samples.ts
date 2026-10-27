import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { financeAuditSamples, financeAuditSectionReviews, financeEntries } from '../schema';
import { auditorOfInternal, auditWorkFixedSinceInternal, requireAuditorOfYear, requireAuditRead } from './access';
import { entryRemarksInternal } from './remarks';
import { entryFingerprintInternal } from './baseline';
import { sectionReviewStatesInternal, sectionRowsHashInternal, type AuditSampleState } from './sections';
import { AUDIT_SECTIONS, type AuditRemarkView } from './types';

/**
 * Stichproben (Spec § D1 Schritt 2, Designer N4): je Prüfer und Buchung ein Haken mit dem Fingerabdruck von damals;
 * weicht er heute ab, steht die Stichprobe auf „erneut prüfen“.
 */

/** Der Stand eines Prüfers an einer Buchung. */
export function sampleStateInternal(db: DbOrTx, auditorId: string | null, entryId: string): AuditSampleState {
  if (!auditorId) return 'none';
  const sample = db.select().from(financeAuditSamples).where(and(eq(financeAuditSamples.auditorId, auditorId), eq(financeAuditSamples.entryId, entryId))).get();
  if (!sample) return 'none';
  return sample.fingerprint === entryFingerprintInternal(db, entryId) ? 'sampled' : 'recheck';
}

/** Je Buchung des Jahres die Zahl der Prüfer, die sie als Stichprobe haben. */
export function samplesByEntryInternal(db: DbOrTx, fiscalYearId: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of db.select({ entryId: financeAuditSamples.entryId }).from(financeAuditSamples).where(eq(financeAuditSamples.fiscalYearId, fiscalYearId)).all()) counts.set(s.entryId, (counts.get(s.entryId) ?? 0) + 1);
  return counts;
}

/** „Stichproben: n von m Buchungen“ — über alle Prüfer, jede Buchung einmal. */
export function sampleCountInternal(db: DbOrTx, fiscalYearId: string): { sampledEntries: number; totalEntries: number } {
  const total = db.select({ id: financeEntries.id }).from(financeEntries).where(and(eq(financeEntries.fiscalYearId, fiscalYearId), eq(financeEntries.status, 'final'))).all().length;
  return { sampledEntries: samplesByEntryInternal(db, fiscalYearId).size, totalEntries: total };
}


const entrySchema = z.object({ entryId: z.string().min(1) });

/**
 * `finance.read` oder `finance.audit`: was die Buchungsseite zur Kassenprüfung zeigt — die eigene Stichprobe (Zeile
 * „Als Stichprobe geprüft“), ihren Stand und die Vermerke. `null` ohne festgeschriebene Buchung in einem Jahr.
 */
export async function getEntryAuditState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fiscalYearId: string; myAuditorId: string | null; mySample: boolean; sampleState: AuditSampleState; remarks: AuditRemarkView[] } | null>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, entrySchema, input);
  if (!parsed.ok) return parsed;
  const entry = deps.db.select({ fiscalYearId: financeEntries.fiscalYearId, status: financeEntries.status }).from(financeEntries).where(eq(financeEntries.id, parsed.value.entryId)).get();
  if (!entry || entry.status !== 'final' || !entry.fiscalYearId) return ok(null);
  const me = auditorOfInternal(deps.db, ctx.userId, entry.fiscalYearId);
  const sampleState = sampleStateInternal(deps.db, me?.id ?? null, parsed.value.entryId);
  return ok({ fiscalYearId: entry.fiscalYearId, myAuditorId: me?.id ?? null, mySample: sampleState !== 'none', sampleState, remarks: entryRemarksInternal(deps.db, parsed.value.entryId) });
}

// ── Schreiben (persönliche Schritte, humanOnly) ───────────────────────────────────────

const sampleSchema = z.object({ fiscalYearId: z.string().min(1), entryId: z.string().min(1), sampled: z.boolean() });

/**
 * `finance.audit`, persönlicher Schritt (humanOnly), nur Prüfer des Jahres: eine festgeschriebene Buchung des Jahres als
 * Stichprobe abhaken (mit ihrem Fingerabdruck von jetzt — ein erneutes Abhaken nach „erneut prüfen“ setzt ihn neu)
 * oder den Haken wegnehmen.
 */
export async function setSample(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entryId: string; state: AuditSampleState }>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, sampleSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const checked = requireAuditorOfYear(deps, ctx, v.fiscalYearId);
  if ('failure' in checked) return checked.failure;
  const fixed = workFixed(deps, checked.year);
  if (fixed) return fixed;
  const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.id, v.entryId)).get();
  if (!entry) return notFound('financeEntry', v.entryId);
  if (entry.status !== 'final' || entry.fiscalYearId !== v.fiscalYearId) return financeConflict('entryNotInAuditYear', { designation: checked.year.designation });
  return deps.db.transaction((tx: DbOrTx) => {
    const existing = tx.select().from(financeAuditSamples).where(and(eq(financeAuditSamples.auditorId, checked.auditor.id), eq(financeAuditSamples.entryId, entry.id))).get();
    if (v.sampled) {
      const fingerprint = entryFingerprintInternal(tx, entry.id);
      const at = isoNow(deps.clock);
      if (existing) tx.update(financeAuditSamples).set({ fingerprint, at }).where(eq(financeAuditSamples.id, existing.id)).run();
      else tx.insert(financeAuditSamples).values({ id: newId(), fiscalYearId: v.fiscalYearId, auditorId: checked.auditor.id, entryId: entry.id, fingerprint, at }).run();
      financeAudit(tx, deps, ctx, { action: 'finance.audit.sample.set', entity: 'financeAuditSample', id: existing?.id ?? entry.id, after: { entryId: entry.id, auditorId: checked.auditor.id }, params: { number: entry.number ?? '' } });
      return ok({ entryId: entry.id, state: 'sampled' as const });
    }
    if (existing) {
      tx.delete(financeAuditSamples).where(eq(financeAuditSamples.id, existing.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.audit.sample.unset', entity: 'financeAuditSample', id: existing.id, before: { entryId: entry.id, auditorId: checked.auditor.id }, params: { number: entry.number ?? '' } });
    }
    return ok({ entryId: entry.id, state: 'none' as const });
  });
}

/** Nach Ablage des Prüfberichts stehen Stichproben und Durchsicht fest (Designer Runde 7, 274/279); Vermerke nicht. */
function workFixed(deps: Deps, year: { id: string; designation: string }) {
  const since = auditWorkFixedSinceInternal(deps.db, year.id);
  return since ? financeConflict('auditWorkFixed', { designation: year.designation, filedOn: since.slice(0, 10) }) : null;
}

const reviewSchema = z.object({ fiscalYearId: z.string().min(1), section: z.enum(AUDIT_SECTIONS) });

async function setReviewed(deps: Deps, ctx: CallContext, input: unknown, reviewed: boolean): Promise<Result<{ section: string; reviewed: boolean }>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reviewSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const checked = requireAuditorOfYear(deps, ctx, v.fiscalYearId);
  if ('failure' in checked) return checked.failure;
  const fixed = workFixed(deps, checked.year);
  if (fixed) return fixed;
  return deps.db.transaction((tx: DbOrTx) => {
    const where = and(eq(financeAuditSectionReviews.fiscalYearId, v.fiscalYearId), eq(financeAuditSectionReviews.auditorId, checked.auditor.id), eq(financeAuditSectionReviews.section, v.section));
    const existing = tx.select().from(financeAuditSectionReviews).where(where).get();
    // Eine Durchsicht, die nach einer Änderung im Abschnitt nur noch für einen früheren Prüfstand gilt, wird erneuert.
    const outdated = Boolean(existing) && reviewed && sectionReviewStatesInternal({ ...deps, db: tx }, v.fiscalYearId).some((s) => s.auditorId === checked.auditor.id && s.section === v.section && !s.current);
    // Der Fingerabdruck der Zeilen zur Zeit der Durchsicht (Plan D1e Task 0).
    const rowsHash = () => sectionRowsHashInternal({ ...deps, db: tx }, checked.year, v.section);
    if (reviewed && !existing) tx.insert(financeAuditSectionReviews).values({ fiscalYearId: v.fiscalYearId, auditorId: checked.auditor.id, section: v.section, at: isoNow(deps.clock), rowsHash: rowsHash() }).run();
    if (outdated) tx.update(financeAuditSectionReviews).set({ at: isoNow(deps.clock), rowsHash: rowsHash() }).where(where).run();
    if (!reviewed && existing) tx.delete(financeAuditSectionReviews).where(where).run();
    const entry = { entity: 'financeAuditSectionReview' as const, id: `${v.fiscalYearId}:${checked.auditor.id}:${v.section}`, after: { fiscalYearId: v.fiscalYearId, auditorId: checked.auditor.id, section: v.section, reviewed }, params: { section: v.section } };
    if (reviewed && (!existing || outdated)) financeAudit(tx, deps, ctx, { action: 'finance.audit.section.review', ...entry });
    if (!reviewed && existing) financeAudit(tx, deps, ctx, { action: 'finance.audit.section.unreview', ...entry });
    return ok({ section: v.section, reviewed });
  });
}

/**
 * `finance.audit`, persönlicher Schritt (humanOnly): „Abschnitt durchgesehen“ je Prüfer und Abschnitt. Gilt die
 * Durchsicht nur noch für einen früheren Prüfstand (Nachprüfung), entsteht eine neue mit dem Zeitpunkt von jetzt.
 */
export async function markSectionReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ section: string; reviewed: boolean }>> {
  return setReviewed(deps, ctx, input, true);
}

/** `finance.audit`, persönlicher Schritt (humanOnly): „durchgesehen“ zurücknehmen. */
export async function unmarkSectionReviewed(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ section: string; reviewed: boolean }>> {
  return setReviewed(deps, ctx, input, false);
}

/** Wer welche Abschnitte durchgesehen hat. */
export function sectionReviewsInternal(db: DbOrTx, fiscalYearId: string): { section: string; auditorId: string; at: string; rowsHash: string | null }[] {
  return db.select().from(financeAuditSectionReviews).where(eq(financeAuditSectionReviews.fiscalYearId, fiscalYearId)).orderBy(financeAuditSectionReviews.at).all();
}
