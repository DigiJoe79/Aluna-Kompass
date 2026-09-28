import { invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { getDocumentRecord } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { NOTICE_KINDS, noticeValidAt, noticeValidUntil, type NoticeKind } from '../ledger/notice-validity';
import type { PartnerBasis, PartnerStatus } from './evidence-rules';
import { partnerProofStatsInternal } from './partner-proof';
import { DEFAULT_PROOF_MONTHS, financePartnerNotices, financePartnerPayments, financePartnerProfiles, type FinancePartnerNoticeRow, type FinancePartnerProfileRow } from '../schema';

/**
 * Angaben zum Partner und seine Empfängerbescheide (F7 Task 2, Spec 8.1).
 * Alles unter `finance.entriesWrite`; lesen unter `finance.read`. Die übliche
 * Art folgt aus dem Status — nur bei einem Partner im Ausland ist sie eine
 * Pflichtwahl (Annahme 1).
 */

/** Wer transfer58 als Art wählen darf: nie ein Vermittler, nie eine Person. */
export function checkBasisAllowed(basis: PartnerBasis, status: PartnerStatus, contactKind: 'person' | 'organization'): Failure | null {
  if (basis !== 'transfer58') return null;
  if (status === 'agent') return financeConflict('partnerBasisNotForAgent');
  if (contactKind === 'person') return financeConflict('partnerBasisNeedsOrganization');
  return null;
}

/** Annahme 1: die übliche Art folgt aus dem Status — `null`, solange sie eine Pflichtwahl ist (`foreignBody`). */
function derivedBasis(status: PartnerStatus): PartnerBasis | null {
  if (status === 'agent') return 'agent57';
  if (status === 'foreignBody') return null;
  return 'transfer58';
}

export interface PartnerView extends FinancePartnerProfileRow {
  contactName: string;
  contactKind: 'person' | 'organization';
  /** `true`, solange die übliche Art aus dem Status folgt statt einer eigenen Wahl. */
  basisDerived: boolean;
  /** Rechtsform vom Kontakt der Organisation (Entscheidung 1) — am Partner nur angezeigt, nie doppelt geführt. */
  contactLegalForm: string | null;
  /** Freigegebene Zahlungen, deren Nachweise noch nicht anerkannt sind. */
  openProofCount: number;
  /** Davon über die Frist samt Kulanz (`finance.proofGraceDays`) hinaus. */
  overdueProofCount: number;
  lastPaidOn: string | null;
}

function contactRow(db: DbOrTx, contactId: string) {
  return db.select().from(contacts).where(eq(contacts.id, contactId)).get();
}

function toPartnerView(deps: Deps, db: DbOrTx, row: FinancePartnerProfileRow): PartnerView {
  const contact = contactRow(db, row.contactId)!;
  const stats = partnerProofStatsInternal(db, row.id, todayIn(deps), readSetting<number>(deps, 'finance.proofGraceDays'));
  return { ...row, contactName: displayName(contact), contactKind: contact.kind, contactLegalForm: contact.kind === 'organization' ? contact.legalForm : null, basisDerived: derivedBasis(row.status) !== null, ...stats };
}

const auditFields = (row: FinancePartnerProfileRow) => ({ status: row.status, usualBasis: row.usualBasis, usualProofMonths: row.usualProofMonths, isActive: row.isActive });

export const saveProfileBaseSchema = z.object({
    id: z.string().min(1).optional(),
    contactId: z.string().min(1),
    status: z.enum(['taxExemptBody', 'foreignBody', 'publicBody', 'agent']),
    /** Pflicht nur bei `foreignBody`; sonst wird sie überschrieben (Annahme 1). */
    usualBasis: z.enum(['transfer58', 'agent57']).nullable().optional(),
    /** Übliche Nachweisfrist in Monaten (Entscheidung 2) — Vorgabe jeder Zahlung, dort übersteuerbar. */
    usualProofMonths: z.number().int().min(1).max(60).default(DEFAULT_PROOF_MONTHS),
    registerDocumentId: z.string().min(1).nullable().optional(),
    agreementDocumentId: z.string().min(1).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().default(true),
  });

/** N5: die bedingte Pflicht (`usualBasis` bei `foreignBody`) prüft der Dienst — das Werkzeug zeigt `saveProfileBaseSchema`. */
export const saveProfileSchema = saveProfileBaseSchema.superRefine((v, c) => {
  if (v.status === 'foreignBody' && !v.usualBasis) c.addIssue({ code: 'custom', path: ['usualBasis'], message: 'usualBasisRequired' });
});

/** `finance.entriesWrite`: Angaben zum Partner anlegen oder ändern — je Kontakt höchstens eine Zeile. */
export async function savePartnerProfile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveProfileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financePartnerProfile', v.id);
  const contactId = before?.contactId ?? v.contactId;
  const contact = contactRow(deps.db, contactId);
  if (!contact) return notFound('contact', contactId);
  if (!before) {
    const existing = deps.db.select({ id: financePartnerProfiles.id }).from(financePartnerProfiles).where(eq(financePartnerProfiles.contactId, contactId)).get();
    if (existing) return financeConflict('partnerProfileInUse');
  }

  const derived = derivedBasis(v.status);
  const basis = derived ?? v.usualBasis!;
  const allowed = checkBasisAllowed(basis, v.status, contact.kind);
  if (allowed) return allowed;

  for (const [field, documentId] of [['registerDocumentId', v.registerDocumentId], ['agreementDocumentId', v.agreementDocumentId]] as const) {
    if (documentId && documentId !== (before as Record<string, unknown> | undefined)?.[field]) {
      const doc = await getDocumentRecord(deps, ctx, documentId);
      if (!doc.ok) return doc;
      if (doc.value.phase !== 'issued') return financeConflict('documentNotFinal');
      if (doc.value.status === 'voided') return financeConflict('documentVoided');
    }
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    const fields = {
      status: v.status, usualBasis: basis, usualProofMonths: v.usualProofMonths,
      registerDocumentId: v.registerDocumentId ?? null, agreementDocumentId: v.agreementDocumentId ?? null, note: v.note ?? null, isActive: v.isActive, updatedAt: now,
    };
    if (before) tx.update(financePartnerProfiles).set(fields).where(eq(financePartnerProfiles.id, id)).run();
    else tx.insert(financePartnerProfiles).values({ id, contactId, ...fields, createdAt: now, createdByUserId: ctx.userId ?? 'system' }).run();
    const after = tx.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerProfile.save', entity: 'financePartnerProfile', id, before: before ? auditFields(before) : undefined, after: auditFields(after), summary: `Angaben zum Partner ${id} ${before ? 'geändert' : 'angelegt'}` });
    return ok(toPartnerView(deps, tx, after));
  });
}

export const idSchema = z.object({ id: z.string().min(1) });

/** `finance.entriesWrite`: aktivieren/deaktivieren — ändert nichts an Vorgängen oder Bescheiden. */
export async function setPartnerActive(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema.extend({ isActive: z.boolean() }), input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, parsed.value.id)).get();
  if (!before) return notFound('financePartnerProfile', parsed.value.id);
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financePartnerProfiles).set({ isActive: parsed.value.isActive, updatedAt: now }).where(eq(financePartnerProfiles.id, before.id)).run();
    const after = tx.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerProfile.setActive', entity: 'financePartnerProfile', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Angaben zum Partner ${before.id} ${parsed.value.isActive ? 'aktiviert' : 'deaktiviert'}` });
    return ok(toPartnerView(deps, tx, after));
  });
}

/** `finance.entriesWrite`: löschen — nur ohne Vorgänge und ohne Bescheide (Annahme 15). */
export async function deletePartnerProfile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<null>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, parsed.value.id)).get();
  if (!before) return notFound('financePartnerProfile', parsed.value.id);
  const hasPayments = deps.db.select({ id: financePartnerPayments.id }).from(financePartnerPayments).where(eq(financePartnerPayments.partnerId, before.id)).limit(1).get();
  const hasNotices = deps.db.select({ id: financePartnerNotices.id }).from(financePartnerNotices).where(eq(financePartnerNotices.partnerId, before.id)).limit(1).get();
  if (hasPayments || hasNotices) return financeConflict('partnerProfileInUse');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.delete(financePartnerProfiles).where(eq(financePartnerProfiles.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.partnerProfile.delete', entity: 'financePartnerProfile', id: before.id, before: auditFields(before), summary: `Angaben zum Partner ${before.id} gelöscht` });
    return ok(null);
  });
}

/** N5: „id oder contactId“ prüft der Dienst; das Werkzeug zeigt `getBaseSchema`. */
export const getBaseSchema = z.object({ id: z.string().min(1).optional(), contactId: z.string().min(1).optional() });
export const getSchema = getBaseSchema.refine((v) => !!v.id || !!v.contactId, { message: 'idOrContactId' });

/** `finance.read`: die Angaben — über die eigene ID oder über den Kontakt. */
export async function getPartner(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerView | null>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  const row = parsed.value.id
    ? deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, parsed.value.id)).get()
    : deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.contactId, parsed.value.contactId!)).get();
  return ok(row ? toPartnerView(deps, deps.db, row) : null);
}

export const listSchema = z.object({ includeInactive: z.boolean().optional() });

/** `finance.read`: alle Partner, Name des Kontakts aufsteigend. */
export async function listPartners(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financePartnerProfiles).where(parsed.value.includeInactive ? undefined : eq(financePartnerProfiles.isActive, true)).all();
  const views = rows.map((row) => toPartnerView(deps, deps.db, row));
  return ok(views.sort((a, b) => a.contactName.localeCompare(b.contactName, 'de')));
}

// ── Empfängerbescheide ───────────────────────────────────────────────────────

export interface PartnerNoticeView extends FinancePartnerNoticeRow {
  validUntil: string;
  state: 'valid' | 'expired' | 'superseded' | 'voided' | 'future';
}


function noticeState(row: FinancePartnerNoticeRow, date: string, validUntil: string): PartnerNoticeView['state'] {
  if (row.voidedAt !== null) return 'voided';
  if (row.supersededOn !== null && row.supersededOn <= date) return 'superseded';
  if (row.noticeDate > date) return 'future';
  return date > validUntil ? 'expired' : 'valid';
}

function toNoticeView(row: FinancePartnerNoticeRow, date: string): PartnerNoticeView {
  const validUntil = row.kind === 'recognitionAbroad' ? (row.validUntil ?? row.noticeDate) : noticeValidUntil(row.kind, row.noticeDate);
  return { ...row, validUntil, state: noticeState(row, date, validUntil) };
}

/** Annahme 2, für Task 3/4/5: der jüngste Bescheid des Partners, der am Zahlungstag trägt. */
export function partnerNoticeValidAtInternal(db: DbOrTx, partnerId: string, date: string): FinancePartnerNoticeRow | null {
  // Nur die deutschen Bescheide tragen die Prüfung „am Zahlungstag gültig“ — die Anerkennung im Sitzland nie (Entscheidung 3).
  const rows = db.select().from(financePartnerNotices).where(eq(financePartnerNotices.partnerId, partnerId)).all().filter((n): n is FinancePartnerNoticeRow & { kind: NoticeKind } => n.kind !== 'recognitionAbroad');
  return noticeValidAt(rows, date)?.notice ?? null;
}

/** Die Arten am Partner: die deutschen Bescheide und, bei einem Partner im Ausland, die Anerkennung im Sitzland (Entscheidung 3). */
export const PARTNER_NOTICE_KINDS = [...NOTICE_KINDS, 'recognitionAbroad'] as const;

export const saveNoticeSchema = z.object({
  id: z.string().min(1).optional(),
  partnerId: z.string().min(1),
  kind: z.enum(PARTNER_NOTICE_KINDS),
  noticeDate: z.iso.date(),
  /** Pflicht bei `recognitionAbroad`: „gültig bis“ laut Anerkennung. Sonst ohne Wirkung — die deutschen Bescheide rechnen es selbst. */
  validUntil: z.iso.date().optional(),
  receivedOn: z.iso.date().optional(),
  documentId: z.string().min(1),
});

/** `finance.entriesWrite`: einen Bescheid des Partners erfassen — deutsche Bescheide bei `taxExemptBody` (Annahme 2), die Anerkennung im Sitzland bei `foreignBody` (Entscheidung 3). */
export async function savePartnerNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerNoticeView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, saveNoticeSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financePartnerNotices).where(eq(financePartnerNotices.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financePartnerNotice', v.id);
  if (before?.voidedAt) return financeConflict('noticeVoided');
  if (before?.supersededOn) return financeConflict('noticeSuperseded');
  const partnerId = before?.partnerId ?? v.partnerId;
  const partner = deps.db.select().from(financePartnerProfiles).where(eq(financePartnerProfiles.id, partnerId)).get();
  if (!partner) return notFound('financePartnerProfile', partnerId);
  const abroad = v.kind === 'recognitionAbroad';
  if (abroad ? partner.status !== 'foreignBody' : partner.status !== 'taxExemptBody') return financeConflict('partnerNoticeNotApplicable');
  if (abroad && !v.validUntil) return invalid([{ path: 'validUntil', message: 'required' }]);

  const doc = await getDocumentRecord(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  if (doc.value.phase !== 'issued') return financeConflict('documentNotFinal');
  if (doc.value.status === 'voided') return financeConflict('documentVoided');
  const receivedOn = v.receivedOn ?? (doc.value.documentDate ?? todayIn(deps));

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    const fields = { kind: v.kind, noticeDate: v.noticeDate, validUntil: abroad ? v.validUntil! : null, receivedOn, documentId: v.documentId, updatedAt: now };
    if (before) tx.update(financePartnerNotices).set(fields).where(eq(financePartnerNotices.id, id)).run();
    else tx.insert(financePartnerNotices).values({ id, partnerId, ...fields, createdAt: now, createdByUserId: ctx.userId ?? 'system' }).run();
    const after = tx.select().from(financePartnerNotices).where(eq(financePartnerNotices.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerNotice.save', entity: 'financePartnerNotice', id, after: { partnerId, kind: after.kind, noticeDate: after.noticeDate, receivedOn: after.receivedOn, supersededOn: after.supersededOn, voided: false }, summary: `Bescheid des Partners ${id} ${before ? 'geändert' : 'erfasst'}` });
    return ok(toNoticeView(after, todayIn(deps)));
  });
}

export const voidNoticeSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/** `finance.entriesWrite`: „irrtümlich erfasst“ — der Bescheid trug nie; die Begründung steht am Datensatz, nie im Protokoll. */
export async function voidPartnerNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerNoticeView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, voidNoticeSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financePartnerNotices).where(eq(financePartnerNotices.id, parsed.value.id)).get();
  if (!before) return notFound('financePartnerNotice', parsed.value.id);
  if (before.voidedAt) return financeConflict('noticeVoided');
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financePartnerNotices).set({ voidedAt: now, voidedByUserId: ctx.userId ?? 'system', voidNote: parsed.value.note, updatedAt: now }).where(eq(financePartnerNotices.id, before.id)).run();
    const after = tx.select().from(financePartnerNotices).where(eq(financePartnerNotices.id, before.id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.partnerNotice.void', entity: 'financePartnerNotice', id: before.id, after: { partnerId: before.partnerId, kind: before.kind, noticeDate: before.noticeDate, receivedOn: before.receivedOn, supersededOn: before.supersededOn, voided: true }, summary: `Bescheid des Partners ${before.id} als irrtümlich erfasst gekennzeichnet` });
    return ok(toNoticeView(after, todayIn(deps)));
  });
}

export const listNoticesSchema = z.object({ partnerId: z.string().min(1) });

/** `finance.read`: die Bescheide eines Partners, jüngste zuerst. */
export async function listPartnerNotices(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<PartnerNoticeView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listNoticesSchema, input);
  if (!parsed.ok) return parsed;
  const rows = deps.db.select().from(financePartnerNotices).where(eq(financePartnerNotices.partnerId, parsed.value.partnerId)).all();
  const sorted = [...rows].sort((a, b) => b.noticeDate.localeCompare(a.noticeDate));
  return ok(sorted.map((r) => toNoticeView(r, todayIn(deps))));
}
