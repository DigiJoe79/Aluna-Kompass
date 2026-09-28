import { defaultLocale, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { abortReceive, DOCUMENT_MAX_BYTES, documents, getDocumentRecord, linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { openCentsInternal } from '../ledger/open-items';
import { AMOUNT_EVIDENCE_KINDS, coverageRequired, EVIDENCE_KINDS, evidenceCoverage, evidenceKindLabelKey, evidenceSubject, missingEvidence, normalizeEvidenceKind, paymentProofSatisfied, requiredEvidenceKinds, type EvidenceRow, type PartnerBasis } from './evidence-rules';
import { nextVersion, ownPaymentProblem, positionViewsOf, sumPositionCents } from './partner-payments';
import { financePartnerEvidence, financePartnerPayments, financePartnerProfiles, type FinancePartnerEvidenceRow, type FinancePartnerPaymentRow } from '../schema';

/**
 * Nachweise einer Zahlung an Partner (F7 Task 3, Spec 8.1, Annahme 9–11):
 * hochladen oder verknüpfen, ändern, entfernen (nur vor dem Anerkennen),
 * anerkennen (`finance.approve`, humanOnly, ≠ Anleger). Die Pflichtarten und
 * die Deckung sind reine Regeln aus `evidence-rules.ts`.
 */

function partner(db: DbOrTx, partnerId: string) {
  return db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, partnerId)).get();
}

function evidenceOf(db: DbOrTx, paymentId: string): FinancePartnerEvidenceRow[] {
  return db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, paymentId)).all();
}

const auditFields = (row: FinancePartnerEvidenceRow) => ({ paymentId: row.paymentId, kind: row.kind, foreignLanguage: row.foreignLanguage, coveredCents: row.coveredCents, documentId: row.documentId });

const listEvidenceSchema = z.object({ paymentId: z.string().min(1) });

export interface EvidenceView extends FinancePartnerEvidenceRow {
  /** W (Prüfer Block 2): die Nummer des Dokuments in der Akte — `null` beim Grabstein. */
  documentNumber: string | null;
}

/** `finance.read`: die Nachweise eines Vorgangs, für die Vorgangsansicht — mit der Nummer des Dokuments. */
export async function listEvidence(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<EvidenceView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listEvidenceSchema, input);
  if (!parsed.ok) return parsed;
  const rows = evidenceOf(deps.db, parsed.value.paymentId);
  const ids = rows.map((r) => r.documentId).filter((id): id is string => !!id);
  const numbers = new Map(ids.length > 0 ? deps.db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, ids)).all().map((d) => [d.id, d.number] as const) : []);
  // Altarten (Foto, Zusage) werden als ihre heutige Art gelesen — gespeichert bleibt, was war (Task 2 Design-Nachtrag Phase 4).
  return ok(rows.map((row) => ({ ...row, kind: normalizeEvidenceKind(row.kind), documentNumber: row.documentId ? numbers.get(row.documentId) ?? null : null })));
}

function payment(db: DbOrTx, id: string) {
  return db.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, id)).get();
}

/** Nachweise gehören an einen eingereichten, freigegebenen Vorgang — nie an einen Entwurf oder einen abgelehnten. */
function evidenceAllowedOn(p: Pick<FinancePartnerPaymentRow, 'state'>): Result<null> {
  return p.state === 'submitted' || p.state === 'approved' ? ok(null) : financeConflict('partnerPaymentNotSubmitted');
}

export const metaSchema = z.object({
  paymentId: z.string().min(1),
  kind: z.enum(EVIDENCE_KINDS),
  foreignLanguage: z.boolean().default(false),
  explanationDe: z.string().trim().max(2000).nullable().optional(),
  coveredCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

function metaProblem(v: z.infer<typeof metaSchema>, basis: PartnerBasis): Result<null> {
  if (v.foreignLanguage && !v.explanationDe) return financeConflict('evidenceExplanationMissing', { kind: evidenceKindLabelKey(v.kind, basis) });
  if (AMOUNT_EVIDENCE_KINDS.includes(v.kind) && (v.coveredCents === null || v.coveredCents === undefined)) return financeConflict('evidenceAmountMissing', { kind: evidenceKindLabelKey(v.kind, basis) });
  return ok(null);
}

const uploadSchema = metaSchema.extend({ bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().min(1).max(300) });

/**
 * Ein Nachweis als hochgeladenes PDF, im eigenen Namen des Vorgangs
 * abgelegt (`receiveGeneratedUpload`, Art `finance-partner-evidence`) — die
 * einreichende Person braucht kein Recht der Akte. Betreff mit Art und
 * Datum, nie mit dem Namen des Partners (Annahme 9).
 */
export async function addEvidenceUpload(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinancePartnerEvidenceRow>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, uploadSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const p = payment(deps.db, v.paymentId);
  if (!p) return notFound('financePartnerPayment', v.paymentId);
  const allowed = evidenceAllowedOn(p);
  if (!allowed.ok) return allowed;
  const problem = metaProblem(v, p.basis);
  if (!problem.ok) return problem;
  if (v.bytes.byteLength > DOCUMENT_MAX_BYTES) return financeConflict('expenseFileTooLarge', { file: v.fileName, limit: `${Math.round(DOCUMENT_MAX_BYTES / (1024 * 1024))} MB` });

  const now = todayIn(deps);
  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: 'finance-partner-evidence',
    subject: evidenceSubject(v.kind, p.basis, now, defaultLocale(deps)),
    documentDate: now,
    links: [{ entityType: 'financePartnerPayment', entityId: p.id }],
    afterReceive: (tx, doc) => {
      const id = newId();
      const addedAt = isoNow(deps.clock);
      tx.insert(financePartnerEvidence).values({ id, paymentId: p.id, kind: v.kind, documentId: doc.id, foreignLanguage: v.foreignLanguage, explanationDe: v.explanationDe ?? null, coveredCents: v.coveredCents ?? null, addedByUserId: ctx.userId ?? 'system', addedAt }).run();
      financeAudit(tx, deps, ctx, { action: 'finance.partnerEvidence.add', entity: 'financePartnerEvidence', id, after: auditFields({ id, paymentId: p.id, kind: v.kind, documentId: doc.id, foreignLanguage: v.foreignLanguage, explanationDe: null, coveredCents: v.coveredCents ?? null, addedByUserId: '', addedAt }), summary: `Nachweis ${id} an Zahlung an Partner ${p.number ?? p.id} hinzugefügt` });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.paymentId, p.id)).all().at(-1)!);
}

export const linkSchema = metaSchema.extend({ documentId: z.string().min(1) });

/** Ein bereits abgelegtes, festgeschriebenes Dokument der Akte als Nachweis verknüpfen — darf an mehreren Vorgängen hängen (Annahme 9). */
export async function addEvidenceLink(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinancePartnerEvidenceRow>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, linkSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const p = payment(deps.db, v.paymentId);
  if (!p) return notFound('financePartnerPayment', v.paymentId);
  const allowed = evidenceAllowedOn(p);
  if (!allowed.ok) return allowed;
  const problem = metaProblem(v, p.basis);
  if (!problem.ok) return problem;
  const doc = await getDocumentRecord(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  if (doc.value.phase !== 'issued') return financeConflict('documentNotFinal');
  if (doc.value.status === 'voided') return financeConflict('documentVoided');

  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const addedAt = isoNow(deps.clock);
    tx.insert(financePartnerEvidence).values({ id, paymentId: p.id, kind: v.kind, documentId: v.documentId, foreignLanguage: v.foreignLanguage, explanationDe: v.explanationDe ?? null, coveredCents: v.coveredCents ?? null, addedByUserId: ctx.userId ?? 'system', addedAt }).run();
    linkDocumentInternal(tx, deps, { documentId: v.documentId, entityType: 'financePartnerPayment', entityId: p.id });
    financeAudit(tx, deps, ctx, { action: 'finance.partnerEvidence.add', entity: 'financePartnerEvidence', id, after: { paymentId: p.id, kind: v.kind, foreignLanguage: v.foreignLanguage, coveredCents: v.coveredCents ?? null, documentId: v.documentId }, summary: `Nachweis ${id} an Zahlung an Partner ${p.number ?? p.id} verknüpft` });
    return ok(tx.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.id, id)).get()!);
  });
}

export const updateSchema = z.object({ id: z.string().min(1), foreignLanguage: z.boolean().optional(), explanationDe: z.string().trim().max(2000).nullable().optional(), coveredCents: z.number().int().min(0).max(100_000_000).nullable().optional() });

/** Erläuterung oder Deckung ändern — nicht mehr, sobald der Vorgang anerkannt ist (Trigger, Annahme 11). */
export async function updateEvidence(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinancePartnerEvidenceRow>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.id, parsed.value.id)).get();
  if (!before) return notFound('financePartnerEvidence', parsed.value.id);
  const p = payment(deps.db, before.paymentId)!;
  if (p.acknowledgedAt) return financeConflict('evidenceAlreadyAcknowledged');
  return deps.db.transaction((tx: DbOrTx) => {
    const fields = { foreignLanguage: parsed.value.foreignLanguage ?? before.foreignLanguage, explanationDe: parsed.value.explanationDe === undefined ? before.explanationDe : parsed.value.explanationDe, coveredCents: parsed.value.coveredCents === undefined ? before.coveredCents : parsed.value.coveredCents };
    tx.update(financePartnerEvidence).set(fields).where(eq(financePartnerEvidence.id, before.id)).run();
    const after = tx.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerEvidence.update', entity: 'financePartnerEvidence', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Nachweis ${before.id} geändert` });
    return ok(after);
  });
}

export const idSchema = z.object({ id: z.string().min(1) });

/** Löschregel `financePartnerEvidence` (Annahme 15): nur vor dem Anerkennen. */
export async function removeEvidence(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financePartnerEvidence).where(eq(financePartnerEvidence.id, parsed.value.id)).get();
  if (!before) return notFound('financePartnerEvidence', parsed.value.id);
  const p = payment(deps.db, before.paymentId)!;
  if (p.acknowledgedAt) return financeConflict('evidenceAlreadyAcknowledged');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financePartnerEvidence).where(eq(financePartnerEvidence.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.partnerEvidence.remove', entity: 'financePartnerEvidence', id: before.id, before: auditFields(before), summary: `Nachweis ${before.id} entfernt` });
    return ok({ id: before.id });
  });
}

export const ackSchema = z.object({ paymentId: z.string().min(1) });

function evidenceRowsInternal(rows: readonly FinancePartnerEvidenceRow[]): EvidenceRow[] {
  return rows.map((r) => ({ kind: r.kind, documentId: r.documentId, foreignLanguage: r.foreignLanguage, explanationDe: r.explanationDe, coveredCents: r.coveredCents }));
}

/**
 * Anerkennen (Annahme 11): `finance.approve`, humanOnly, ≠ Anleger. Nur ein
 * freigegebener Vorgang, alle Pflichtarten mit echtem Dokument, jede
 * fremdsprachige mit Erläuterung, die Deckung vollständig, und die Zahlung
 * muss „passiert“ sein (`paymentProofSatisfied`).
 */
export async function acknowledgeEvidence(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FinancePartnerPaymentRow>> {
  const denied = requirePermission(ctx, 'finance.approve');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, ackSchema, input);
  if (!parsed.ok) return parsed;
  const p = payment(deps.db, parsed.value.paymentId);
  if (!p) return notFound('financePartnerPayment', parsed.value.paymentId);
  const own = ownPaymentProblem(ctx, p);
  if (own) return own;
  if (p.state !== 'approved') return financeConflict('partnerPaymentNotSubmitted');
  if (p.acknowledgedAt) return financeConflict('evidenceAlreadyAcknowledged');

  const part = partner(deps.db, p.partnerId)!;
  const rows = evidenceOf(deps.db, p.id);
  const positions = positionViewsOf(deps.db, p.id);
  const required = requiredEvidenceKinds({ basis: p.basis, partnerStatus: part.status, hasGoodsPositions: positions.some((pos) => pos.kind === 'goods') });
  const evidenceRows = evidenceRowsInternal(rows);
  const missing = missingEvidence(required, evidenceRows);
  if (missing.missingKinds.length > 0) return financeConflict('evidenceKindMissing', { kind: evidenceKindLabelKey(missing.missingKinds[0]!, p.basis) });
  if (missing.missingExplanation.length > 0) return financeConflict('evidenceExplanationMissing', { kind: evidenceKindLabelKey(missing.missingExplanation[0]!, p.basis) });
  if (missing.missingAmount.length > 0) return financeConflict('evidenceAmountMissing', { kind: evidenceKindLabelKey(missing.missingAmount[0]!, p.basis) });
  if (coverageRequired(required)) {
    const coverage = evidenceCoverage(evidenceRows, sumPositionCents(positions));
    if (!coverage.complete) return financeConflict('evidenceCoverageIncomplete');
  }

  const paid = paymentProofSatisfied({ retroactive: p.retroactive, openItemSettled: p.openItemId !== null && openCentsInternal(deps.db, p.openItemId) <= 0 });
  // AM: keine Person löst das — die gebuchte Überweisung mit der Nummer als Verwendungszweck (Zahlungsreferenz des Postens).
  if (!paid) return financeConflict('evidenceNotYetPaid', { number: p.number ?? p.id });

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const changed = tx
      .update(financePartnerPayments)
      .set({ acknowledgedAt: now, acknowledgedByUserId: ctx.userId ?? 'system', acknowledgedChannel: ctx.channel, updatedAt: nextVersion(deps, p.updatedAt) })
      .where(eq(financePartnerPayments.id, p.id))
      .run().changes;
    if (changed !== 1) return financeConflict('partnerPaymentNotSubmitted');
    const after = tx.select().from(financePartnerPayments).where(eq(financePartnerPayments.id, p.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerPayment.acknowledge', entity: 'financePartnerPayment', id: p.id, before: { acknowledgedAt: null }, after: { acknowledgedAt: now, channel: ctx.channel }, summary: `Nachweise der Zahlung an Partner ${p.number ?? p.id} anerkannt` });
    return ok(after);
  });
}

export { evidenceCoverage };
