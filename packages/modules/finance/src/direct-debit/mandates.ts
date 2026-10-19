import { invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { documentLinks, documentRelations, documents, linkDocumentInternal } from '@kompass/module-dms';
import { and, asc, desc, eq, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { maskIban } from '../format/iban';
import { learnContactIbanInternal } from '../import/contact-ibans';
import { requireFinanceRead } from '../ledger/access';
import { isValidIban, normalizeIban } from '../ledger/iban';
import { MANDATE_END_REASONS, financePledges, financeSepaCounter, financeSepaMandateChanges, financeSepaMandates, type FinanceSepaMandateChangeRow, type FinanceSepaMandateRow, type MandateChangeField, type PendingAmendment } from '../schema';
import { addCalendarDays } from './business-days';
import { activeRunItemsInternal, expiredRunIdsInternal, openRunItemsInternal } from './run-items';
import { MANDATE_REFERENCE_MAX, type MandateReferenceFormat } from './settings';

/** Das Recht der Lastschrift (Plan L1): Mandate, Zusagen, Einzüge vorbereiten. */
export const DIRECT_DEBIT_PERMISSION = 'finance.directDebit';
/** Entität der Akte für Dokumente am Mandat (Formular, unterschriebene Fassung). */
export const MANDATE_ENTITY = 'financeMandate';
export { MANDATE_EXPIRY_MONTHS, MANDATE_STATES, mandateExpiresOn, mandateState, type MandateState } from './mandate-state';
import { MANDATE_STATES, mandateExpiresOn, mandateState, type MandateState } from './mandate-state';

// ── Eingaben ────────────────────────────────────────────────────────────────

const id = z.string().min(1);
const day = z.iso.date();
/** Kontoinhaber im SEPA-Satz: höchstens 70 Zeichen. */
export const debtorNameField = z.string().trim().min(1).max(70);
export const mandateIbanField = z
  .string()
  .trim()
  .min(1)
  .max(42)
  .refine((v) => isValidIban(v), 'invalidIban')
  .transform((v) => normalizeIban(v));
const bicField = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .refine((v) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), 'invalidBic');

/** Was ein Mandat vom Zahler braucht — auch für Mitglieder und Zusagen, die eines vorbereiten. */
export const mandateDetailsSchema = z.object({ debtorName: debtorNameField, iban: mandateIbanField, bic: bicField.nullable().optional() });
export type MandateDetails = z.output<typeof mandateDetailsSchema>;

export const mandatePrepareSchema = mandateDetailsSchema.extend({ contactId: id });
export const mandateCorrectSchema = z.object({ mandateId: id, debtorName: debtorNameField.optional(), iban: mandateIbanField.optional(), bic: bicField.nullable().optional() });
export const mandateActivateSchema = z.object({ mandateId: id, signedOn: day, signedDocumentId: id });
export const mandateAmendSchema = z.object({ mandateId: id, iban: mandateIbanField.optional(), debtorName: debtorNameField.optional(), bic: bicField.nullable().optional(), validFrom: day });
export const mandateEndSchema = z.object({ mandateId: id, endedOn: day, reason: z.enum(MANDATE_END_REASONS) });
export const mandateGetSchema = z.object({ id });
export const mandateListSchema = z.object({
  state: z.enum(MANDATE_STATES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

// ── Ansicht ─────────────────────────────────────────────────────────────────

/** Wofür ein Mandat steht: Mitgliedschaften (über den Haken `mandateUsages` der Module) und Zusagen. */
export interface MandateUsage {
  kind: string;
  id: string;
  label?: { key: string; params?: Record<string, string | number> };
}

export interface MandateView {
  id: string;
  contactId: string;
  contactName: string | null;
  reference: string;
  debtorName: string;
  /** Im Detail offen (kompakt), in Listen maskiert (`maskIban`). */
  iban: string;
  bic: string | null;
  sequence: FinanceSepaMandateRow['sequence'];
  preparedOn: string;
  signedOn: string | null;
  signedDocumentId: string | null;
  endedOn: string | null;
  endReason: FinanceSepaMandateRow['endReason'];
  lastCollectedOn: string | null;
  /** Letzter gültiger Tag ohne weiteren Einzug (nur unterschrieben). */
  expiresOn: string | null;
  pendingAmendment: PendingAmendment | null;
  state: MandateState;
  usedFor: MandateUsage[];
}

export interface MandateDetailView extends MandateView {
  changes: Pick<FinanceSepaMandateChangeRow, 'id' | 'field' | 'before' | 'after' | 'validFrom' | 'createdAt'>[];
  /** Die Einzüge mit diesem Mandat, neueste zuerst (ohne verworfene und herausgenommene Posten). */
  collections: { runId: string; collectionDate: string; source: 'openItem' | 'pledge'; installmentOn: string | null; remittance: string; amountCents: number }[];
}

/**
 * Die Verwendungen eines Mandats: was die Module über `mandateUsages` melden (Mitgliedschaften), dann die Zusagen. Auch
 * ausgeschaltete Module melden — ihre Daten nutzen das Mandat weiter.
 */
export function mandateUsagesInternal(deps: Deps, mandateId: string): MandateUsage[] {
  const fromModules = deps.registry.manifests.flatMap((m) => [...(m.mandateUsages?.(deps, mandateId) ?? [])]);
  const pledges = deps.db.select({ id: financePledges.id }).from(financePledges).where(eq(financePledges.mandateId, mandateId)).orderBy(asc(financePledges.createdAt)).all().map((p) => ({ kind: 'pledge', id: p.id }));
  return [...fromModules, ...pledges];
}

function contactNameOf(db: DbOrTx, contactId: string): string | null {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return contact ? displayName(contact) : null;
}

function viewOf(deps: Deps, row: FinanceSepaMandateRow, masked: boolean): MandateView {
  return {
    id: row.id,
    contactId: row.contactId,
    contactName: contactNameOf(deps.db, row.contactId),
    reference: row.reference,
    debtorName: row.debtorName,
    iban: masked ? maskIban(row.iban) : row.iban,
    bic: row.bic,
    sequence: row.sequence,
    preparedOn: row.preparedOn,
    signedOn: row.signedOn,
    signedDocumentId: row.signedDocumentId,
    endedOn: row.endedOn,
    endReason: row.endReason,
    lastCollectedOn: row.lastCollectedOn,
    expiresOn: mandateExpiresOn(row),
    pendingAmendment: row.pendingAmendment && masked ? { ...row.pendingAmendment, ...(row.pendingAmendment.originalIban ? { originalIban: maskIban(row.pendingAmendment.originalIban) } : {}) } : (row.pendingAmendment ?? null),
    state: mandateState(row, todayIn(deps)),
    usedFor: mandateUsagesInternal(deps, row.id),
  };
}

function detailOf(deps: Deps, row: FinanceSepaMandateRow): MandateDetailView {
  const changes = deps.db
    .select({ id: financeSepaMandateChanges.id, field: financeSepaMandateChanges.field, before: financeSepaMandateChanges.before, after: financeSepaMandateChanges.after, validFrom: financeSepaMandateChanges.validFrom, createdAt: financeSepaMandateChanges.createdAt })
    .from(financeSepaMandateChanges)
    .where(eq(financeSepaMandateChanges.mandateId, row.id))
    .orderBy(asc(financeSepaMandateChanges.createdAt), asc(financeSepaMandateChanges.id))
    .all();
  const collections = activeRunItemsInternal(deps.db, { mandateId: row.id })
    .map((r) => ({ runId: r.item.runId, collectionDate: r.collectionDate, source: r.item.source, installmentOn: r.item.installmentOn, remittance: r.item.remittance, amountCents: r.item.amountCents }))
    .sort((a, b) => b.collectionDate.localeCompare(a.collectionDate));
  return { ...viewOf(deps, row, false), changes, collections };
}

/** Das Mandat — ohne Rechteprüfung, für die Dienste der Lastschrift und der Mitglieder. */
export function mandateRowInternal(db: DbOrTx, mandateId: string): FinanceSepaMandateRow | null {
  return db.select().from(financeSepaMandates).where(eq(financeSepaMandates.id, mandateId)).get() ?? null;
}

// ── Vorbereiten ─────────────────────────────────────────────────────────────

function nextReferenceInternal(tx: DbOrTx, deps: Deps): string {
  const format = readSetting<MandateReferenceFormat>(deps, 'finance.sepa.mandateReferenceFormat');
  for (;;) {
    const row = tx.select().from(financeSepaCounter).where(eq(financeSepaCounter.id, 'mandate')).get();
    const next = (row?.last ?? 0) + 1;
    if (row) tx.update(financeSepaCounter).set({ last: next }).where(eq(financeSepaCounter.id, 'mandate')).run();
    else tx.insert(financeSepaCounter).values({ id: 'mandate', last: next }).run();
    const reference = `${format.prefix}${String(next).padStart(format.digits, '0')}`;
    if (reference.length > MANDATE_REFERENCE_MAX) throw new Error(`mandate reference exceeds ${MANDATE_REFERENCE_MAX} characters: ${reference}`);
    // Nach einem Wechsel des Formats könnte eine Referenz schon vergeben sein — nie wiederverwenden, weiterzählen.
    if (!tx.select({ id: financeSepaMandates.id }).from(financeSepaMandates).where(eq(financeSepaMandates.reference, reference)).get()) return reference;
  }
}

/**
 * Ein Mandat vorbereiten (in der Transaktion des Aufrufers; die Eingaben hat er mit `mandateDetailsSchema` geprüft):
 * Referenz aus Zähler und Format, Zustand vorbereitet. Die IBAN lernt der Kontakt als seine (Spec § 7.2). Protokoll:
 * nur die Referenz.
 */
export function prepareMandateInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, input: { contactId: string } & MandateDetails): FinanceSepaMandateRow {
  if (!isValidIban(input.iban)) throw new Error('prepareMandateInternal: invalid IBAN — validate with mandateDetailsSchema first');
  const now = isoNow(deps.clock);
  const row: FinanceSepaMandateRow = {
    id: newId(),
    contactId: input.contactId,
    reference: nextReferenceInternal(tx, deps),
    debtorName: input.debtorName,
    iban: normalizeIban(input.iban),
    bic: input.bic ?? null,
    sequence: 'recurring',
    preparedOn: todayIn(deps),
    signedOn: null,
    signedDocumentId: null,
    endedOn: null,
    endReason: null,
    lastCollectedOn: null,
    pendingAmendment: null,
    createdAt: now,
    updatedAt: now,
  };
  tx.insert(financeSepaMandates).values(row).run();
  learnContactIbanInternal(tx, deps, ctx, { contactId: input.contactId, iban: row.iban, learnedFrom: 'mandate' });
  financeAudit(tx, deps, ctx, { action: 'finance.mandate.prepare', entity: 'financeMandate', id: row.id, after: { reference: row.reference, sequence: row.sequence, preparedOn: row.preparedOn }, params: { reference: row.reference } });
  return row;
}

/** `finance.directDebit`: ein Mandat für einen Kontakt vorbereiten. */
export async function prepareMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, mandatePrepareSchema, input);
  if (!parsed.ok) return parsed;
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, parsed.value.contactId)).get()) return notFound('contact', parsed.value.contactId);
  const row = deps.db.transaction((tx: DbOrTx) => prepareMandateInternal(tx, deps, ctx, parsed.value));
  return ok(viewOf(deps, row, false));
}

// ── Korrigieren, aktivieren ─────────────────────────────────────────────────

/** Vor der Unterschrift: IBAN, Kontoinhaber, BIC an Ort und Stelle korrigieren. Danach ist es eine Änderung (`mandateSigned`). */
export async function correctMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, mandateCorrectSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = mandateRowInternal(deps.db, v.mandateId);
  if (!row) return notFound('financeMandate', v.mandateId);
  if (mandateState(row, todayIn(deps)) !== 'pending') return row.signedOn ? financeConflict('mandateSigned') : financeConflict('mandateEnded', { reference: row.reference, date: row.endedOn! });
  return deps.db.transaction((tx: DbOrTx) => {
    const fields = { debtorName: v.debtorName ?? row.debtorName, iban: v.iban ?? row.iban, bic: v.bic === undefined ? row.bic : v.bic, updatedAt: isoNow(deps.clock) };
    tx.update(financeSepaMandates).set(fields).where(eq(financeSepaMandates.id, row.id)).run();
    if (fields.iban !== row.iban) learnContactIbanInternal(tx, deps, ctx, { contactId: row.contactId, iban: fields.iban, learnedFrom: 'mandate' });
    financeAudit(tx, deps, ctx, { action: 'finance.mandate.correct', entity: 'financeMandate', id: row.id, after: { reference: row.reference }, params: { reference: row.reference } });
    return ok(viewOf(deps, mandateRowInternal(tx, row.id)!, false));
  });
}

/**
 * Gehört das Dokument zu diesem Mandat? Ja, wenn es die unterschriebene Fassung (`signedCopyOf`) eines Dokuments am
 * Mandat ist (des Formulars), oder ein Eingang, der am Mandat oder am zahlenden Kontakt hängt.
 */
function documentBelongsToMandate(db: DbOrTx, documentId: string, direction: string, mandate: FinanceSepaMandateRow): boolean {
  const linkedTo = (entityType: string, entityId: string, docId: string) =>
    !!db.select({ id: documentLinks.id }).from(documentLinks).where(and(eq(documentLinks.documentId, docId), eq(documentLinks.entityType, entityType), eq(documentLinks.entityId, entityId))).get();
  const originals = db.select({ id: documentRelations.relatedDocumentId }).from(documentRelations).where(and(eq(documentRelations.documentId, documentId), eq(documentRelations.kind, 'signedCopyOf'))).all();
  if (originals.some((o) => linkedTo(MANDATE_ENTITY, mandate.id, o.id))) return true;
  return direction === 'incoming' && (linkedTo(MANDATE_ENTITY, mandate.id, documentId) || linkedTo('contact', mandate.contactId, documentId));
}

/**
 * Mandat aktiv setzen (humanOnly): Das unterschriebene Mandat liegt festgeschrieben in der Akte — als unterschriebene
 * Fassung des Formulars oder als Eingang am Kontakt — und der Tag der Unterschrift ist nicht in der Zukunft. Das
 * Dokument wird mit dem Mandat verknüpft. Protokoll: Referenz und Tag.
 */
export async function activateMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, mandateActivateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.signedOn > todayIn(deps)) return invalid([{ path: 'signedOn', message: 'inFuture' }]);
  const row = mandateRowInternal(deps.db, v.mandateId);
  if (!row) return notFound('financeMandate', v.mandateId);
  const state = mandateState(row, todayIn(deps));
  if (state === 'ended') return financeConflict('mandateEnded', { reference: row.reference, date: row.endedOn! });
  if (state !== 'pending') return financeConflict('mandateSigned');
  const doc = deps.db.select({ id: documents.id, phase: documents.phase, status: documents.status, direction: documents.direction }).from(documents).where(eq(documents.id, v.signedDocumentId)).get();
  if (!doc) return notFound('document', v.signedDocumentId);
  if (doc.phase !== 'issued') return financeConflict('documentNotFinal');
  if (doc.status === 'voided') return financeConflict('documentVoided');
  if (!documentBelongsToMandate(deps.db, doc.id, doc.direction, row)) return financeConflict('mandateDocumentUnrelated');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeSepaMandates).set({ signedOn: v.signedOn, signedDocumentId: doc.id, updatedAt: isoNow(deps.clock) }).where(eq(financeSepaMandates.id, row.id)).run();
    linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: MANDATE_ENTITY, entityId: row.id });
    financeAudit(tx, deps, ctx, { action: 'finance.mandate.activate', entity: 'financeMandate', id: row.id, after: { reference: row.reference, signedOn: v.signedOn, signedDocumentId: doc.id }, params: { reference: row.reference, signedOn: v.signedOn } });
    return ok(viewOf(deps, mandateRowInternal(tx, row.id)!, false));
  });
}

// ── Ändern, beenden ─────────────────────────────────────────────────────────

/**
 * Nach der Unterschrift: neue IBAN, neuer Kontoinhaber oder BIC (Spec § 7.2). Jede Änderung kommt in den Verlauf; bei
 * einer neuen IBAN merkt sich das Mandat die IBAN des letzten Einzugs als Hinweis für den nächsten (`pendingAmendment`
 * — eine schon offene bleibt, denn die Bank kennt nur die zuletzt eingezogene). Das Mandat trägt sofort die neuen
 * Daten; `validFrom` steht im Verlauf für L2.
 */
export async function amendMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, mandateAmendSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = mandateRowInternal(deps.db, v.mandateId);
  if (!row) return notFound('financeMandate', v.mandateId);
  if (mandateState(row, todayIn(deps)) !== 'active') return financeConflict('mandateNotActive');
  const changes: { field: MandateChangeField; before: string | null; after: string | null }[] = [];
  if (v.iban !== undefined && v.iban !== row.iban) changes.push({ field: 'iban', before: row.iban, after: v.iban });
  if (v.debtorName !== undefined && v.debtorName !== row.debtorName) changes.push({ field: 'debtorName', before: row.debtorName, after: v.debtorName });
  if (v.bic !== undefined && (v.bic ?? null) !== row.bic) changes.push({ field: 'bic', before: row.bic, after: v.bic ?? null });
  if (changes.length === 0) return invalid([{ path: 'mandateId', message: 'nothingChanged' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const ibanChange = changes.find((c) => c.field === 'iban');
    const pendingAmendment: PendingAmendment | null = ibanChange ? (row.pendingAmendment?.originalIban ? row.pendingAmendment : { ...(row.pendingAmendment ?? {}), originalIban: row.iban, since: v.validFrom }) : row.pendingAmendment;
    tx.update(financeSepaMandates)
      .set({ iban: v.iban ?? row.iban, debtorName: v.debtorName ?? row.debtorName, bic: v.bic === undefined ? row.bic : v.bic, pendingAmendment, updatedAt: now })
      .where(eq(financeSepaMandates.id, row.id))
      .run();
    for (const change of changes) {
      const changeId = newId();
      tx.insert(financeSepaMandateChanges).values({ id: changeId, mandateId: row.id, ...change, validFrom: v.validFrom, createdAt: now, createdByUserId: ctx.userId ?? 'system' }).run();
      financeAudit(tx, deps, ctx, { action: 'finance.mandate.amend', entity: 'financeMandate', id: row.id, after: { reference: row.reference, changedField: change.field, validFrom: v.validFrom }, params: { reference: row.reference, field: change.field } });
    }
    if (ibanChange) learnContactIbanInternal(tx, deps, ctx, { contactId: row.contactId, iban: ibanChange.after!, learnedFrom: 'mandate' });
    return ok(viewOf(deps, mandateRowInternal(tx, row.id)!, false));
  });
}

/** Steckt das Mandat in einem angelegten, noch nicht gebuchten Einzug (ein Posten, nicht herausgenommen)? */
export function mandateInOpenRunInternal(db: DbOrTx, mandateId: string): boolean {
  return openRunItemsInternal(db, { mandateId }).length > 0;
}

/** Mandat beenden (humanOnly) — einmal; ein Mandat in einem offenen Einzug nicht (`mandateInOpenRun`). Protokoll: Referenz und Grund. */
export async function endMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, mandateEndSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = mandateRowInternal(deps.db, v.mandateId);
  if (!row) return notFound('financeMandate', v.mandateId);
  if (row.endedOn) return financeConflict('mandateEnded', { reference: row.reference, date: row.endedOn });
  // Ein Mandat aus der Zeit vor Kompass ist früher unterschrieben als vorbereitet — Maßstab ist die Unterschrift.
  if (row.signedOn && v.endedOn < row.signedOn) return invalid([{ path: 'endedOn', message: 'beforeSigned' }]);
  // M28: Ein Einzug vor der Bank (Entwurf, Datei) hält das Mandat — der Posten lässt sich dort herausnehmen. Ein
  // eingereichter nicht: Dann endet das Mandat frühestens am Tag nach dem Einzug, damit ein Widerruf sofort festgehalten ist.
  const open = openRunItemsInternal(deps.db, { mandateId: row.id, excludeRunIds: expiredRunIdsInternal(deps) });
  if (open.some((r) => r.status !== 'submitted')) return financeConflict('mandateInOpenRun');
  const lastSubmitted = open.map((r) => r.collectionDate).sort().at(-1);
  if (lastSubmitted && v.endedOn <= lastSubmitted) return financeConflict('mandateInSubmittedRun', { date: lastSubmitted, earliest: addCalendarDays(lastSubmitted, 1) });
  return deps.db.transaction((tx: DbOrTx) => {
    endMandateInternal(tx, deps, ctx, row, v.endedOn, v.reason);
    return ok(viewOf(deps, mandateRowInternal(tx, row.id)!, false));
  });
}

/** Das Mandat beenden, in der Transaktion des Aufrufers (geprüft hat er): auch aus „Rückgabe klären“ (Plan L3). */
export function endMandateInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, row: FinanceSepaMandateRow, endedOn: string, reason: (typeof MANDATE_END_REASONS)[number]): void {
  tx.update(financeSepaMandates).set({ endedOn, endReason: reason, updatedAt: isoNow(deps.clock) }).where(eq(financeSepaMandates.id, row.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.mandate.end', entity: 'financeMandate', id: row.id, after: { reference: row.reference, endedOn, endCause: reason }, params: { reference: row.reference, reason } });
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** `finance.read`: ein Mandat mit voller IBAN und Änderungsverlauf. */
export async function getMandate(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MandateDetailView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, mandateGetSchema, input);
  if (!parsed.ok) return parsed;
  const row = mandateRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('financeMandate', parsed.value.id);
  return ok(detailOf(deps, row));
}

/**
 * `finance.read`: Mandate mit maskierter IBAN, neueste zuerst. Der Zustand wird berechnet, deshalb filtert die Liste
 * nach dem Laden; die Suche trifft Referenz und Kontoinhaber.
 */
export async function listMandates(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: MandateView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, mandateListSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const search = v.search ? `%${v.search.replace(/[%_]/g, '')}%` : null;
  const rows = deps.db
    .select()
    .from(financeSepaMandates)
    .where(search ? or(like(financeSepaMandates.reference, search), like(financeSepaMandates.debtorName, search)) : undefined)
    .orderBy(desc(financeSepaMandates.preparedOn), desc(financeSepaMandates.reference))
    .all();
  const today = todayIn(deps);
  const filtered = v.state ? rows.filter((r) => mandateState(r, today) === v.state) : rows;
  return ok({ items: filtered.slice(v.offset, v.offset + v.limit).map((r) => viewOf(deps, r, true)), total: filtered.length });
}
