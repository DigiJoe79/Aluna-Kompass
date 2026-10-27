import { expectedVersionField, getEffectivePermissions, invalid, isoNow, loadUserSummary, newId, notFound, ok, removeRoleInternal, requirePermission, roleIdByOrigin, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactIdForUserInternal, contactRoles, contacts, displayName, userIdForContactInternal } from '@kompass/module-contacts';
import { abortReceive, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkPickedDocument } from '../allocation/reserves';
import { originOfLine } from '../allocation/people';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import { financeAllocationLines, financeAuditAuditors, financeEntries, financeFiscalYears, type FinanceAuditAuditorRow, type FinanceFiscalYearRow } from '../schema';
import { auditorsFrozenInternal, auditorWorkInternal, auditorsOfYearInternal, currentAuditYearInternal, requireAuditRead } from './access';
import { ensureBaselineInternal } from './baseline';
import { treasurerContactIdAtInternal } from '../ledger/treasurer';
import { AUDIT_MODES, type AuditorAccess, type AuditorIndependence, type AuditorView, type AuditMode } from './types';

/**
 * Prüfer je Jahr (Spec Rechenschaft 0.4.0 § D1 „Prüfer je Jahr“, Designer Runde 3 12a–12c, 12h): eintragen, ändern,
 * austragen, Zugang beenden, Vertraulichkeitserklärung ablegen. Pflege mit `finance.periodClose`; lesen mit
 * `finance.read` oder `finance.audit`. Unabhängigkeit sind Hinweise ohne Sperre.
 */

export const AUDITOR_ROLE_ORIGIN = 'finance:auditor';
/** Art der Vertraulichkeitserklärung (modul-eigen, `install.ts`). */
export const AUDIT_CONFIDENTIALITY_TYPE_KEY = 'finance-audit-confidentiality';

const loadYear = (db: DbOrTx, id: string): FinanceFiscalYearRow | null => db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get() ?? null;
const loadAuditor = (db: DbOrTx, id: string): FinanceAuditAuditorRow | null => db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.id, id)).get() ?? null;

/** Zugang berechnet (Finanz-Spec § 9.4): verknüpfter Nutzer, aktiv, mit der Prüferrolle. */
export function auditorAccessInternal(db: DbOrTx, deps: Pick<Deps, 'registry'>, contactId: string, endedAt: string | null): AuditorAccess {
  const userId = userIdForContactInternal(db, contactId);
  const roleId = roleIdByOrigin(db, AUDITOR_ROLE_ORIGIN);
  const user = userId ? loadUserSummary(db, userId) : null;
  // Ohne die Rolle mit Herkunft (gelöscht) zählt das Recht selbst, damit der Hinweis nicht lügt.
  const hasRole = user ? (roleId ? user.roles.some((r) => r.id === roleId) : getEffectivePermissions(db, deps.registry, user.id).has('finance.audit')) : false;
  return { userId, userActive: user?.isActive ?? false, hasRole, lastLoginAt: user?.lastLoginAt ?? null, endedAt, roleMissingOrigin: roleId === null };
}

/** Hinweise zur Unabhängigkeit (Spec § D1, Designer 12a): Vorstandsrolle im Jahr, beteiligte Buchungen. Keine Sperre. */
export function auditorIndependenceInternal(db: DbOrTx, year: FinanceFiscalYearRow, contactId: string): AuditorIndependence {
  const board = db
    .select({ since: contactRoles.since, until: contactRoles.until })
    .from(contactRoles)
    .where(and(eq(contactRoles.contactId, contactId), eq(contactRoles.role, 'board-member'), sql`${contactRoles.since} <= ${year.endsOn}`, sql`(${contactRoles.until} is null or ${contactRoles.until} >= ${year.startsOn})`))
    .orderBy(contactRoles.since)
    .get();
  const userId = userIdForContactInternal(db, contactId);
  const lines = db
    .select({ id: financeAllocationLines.id, entryId: financeAllocationLines.entryId, contactId: financeAllocationLines.contactId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(and(eq(financeEntries.status, 'final'), eq(financeEntries.fiscalYearId, year.id)))
    .all();
  const involved = new Set<string>();
  for (const line of lines) {
    if (involved.has(line.entryId)) continue;
    if (line.contactId === contactId) involved.add(line.entryId);
    else if (userId && originOfLine(db, line.id, line.entryId).approvedByUserId === userId) involved.add(line.entryId);
  }
  return { boardRole: board ? { since: board.since, until: board.until } : null, involvedEntryIds: [...involved].sort() };
}

function contactNameInternal(db: DbOrTx, contactId: string): string {
  const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return contact ? displayName(contact) : '';
}

export function auditorViewInternal(db: DbOrTx, deps: Pick<Deps, 'registry'>, row: FinanceAuditAuditorRow): AuditorView {
  const year = loadYear(db, row.fiscalYearId)!;
  return {
    id: row.id, fiscalYearId: row.fiscalYearId, contactId: row.contactId, contactName: contactNameInternal(db, row.contactId), mode: row.mode,
    confidential: row.confidential, confidentialityDocumentId: row.confidentialityDocumentId, electedOn: row.electedOn, minutesDocumentId: row.minutesDocumentId,
    access: auditorAccessInternal(db, deps, row.contactId, row.accessEndedAt),
    independence: auditorIndependenceInternal(db, year, row.contactId),
    hasWork: auditorWorkInternal(db, row.id),
    version: row.updatedAt,
  };
}

const auditFields = (row: FinanceAuditAuditorRow) => ({ fiscalYearId: row.fiscalYearId, mode: row.mode, confidential: row.confidential, electedOn: row.electedOn, confidentialityDocumentId: row.confidentialityDocumentId, minutesDocumentId: row.minutesDocumentId, accessEndedAt: row.accessEndedAt });

// ── Lesen ───────────────────────────────────────────────────────────────────

const yearSchema = z.object({ fiscalYearId: z.string().min(1) });

/** `finance.read` oder `finance.audit`: die Prüfer eines Jahres mit Zugang und Unabhängigkeit. */
export async function listAuditors(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ auditors: AuditorView[]; treasurerName: string | null }>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, yearSchema, input);
  if (!parsed.ok) return parsed;
  if (!loadYear(deps.db, parsed.value.fiscalYearId)) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  const rows = deps.db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.fiscalYearId, parsed.value.fiscalYearId)).orderBy(financeAuditAuditors.createdAt, financeAuditAuditors.id).all();
  // Wer heute Schatzmeister ist, beantwortet Fragen: der Name aus der Kontaktrolle (Designer Runde 7, 281).
  const treasurerId = treasurerContactIdAtInternal(deps.db, todayIn(deps));
  const treasurer = treasurerId ? deps.db.select().from(contacts).where(eq(contacts.id, treasurerId)).get() : undefined;
  return ok({ auditors: rows.map((row) => auditorViewInternal(deps.db, deps, row)), treasurerName: treasurer ? displayName(treasurer) : null });
}

/** `finance.read` oder `finance.audit`: die Jahre, die der Aufrufer selbst „in Kompass“ prüft, neueste zuerst (Designer 12c). */
export async function listMyAuditYears(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ years: { fiscalYearId: string; designation: string; auditorId: string; mode: AuditMode }[] }>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  const contactId = ctx.userId ? contactIdForUserInternal(deps.db, ctx.userId) : null;
  if (!contactId) return ok({ years: [] });
  const rows = deps.db
    .select({ auditorId: financeAuditAuditors.id, mode: financeAuditAuditors.mode, fiscalYearId: financeFiscalYears.id, designation: financeFiscalYears.designation })
    .from(financeAuditAuditors)
    .innerJoin(financeFiscalYears, eq(financeFiscalYears.id, financeAuditAuditors.fiscalYearId))
    .where(and(eq(financeAuditAuditors.contactId, contactId), eq(financeAuditAuditors.mode, 'kompass')))
    .orderBy(desc(financeFiscalYears.endsOn))
    .all();
  return ok({ years: rows });
}

// ── Pflegen ─────────────────────────────────────────────────────────────────

const saveSchema = z.object({
  id: z.string().min(1).optional(),
  expectedVersion: expectedVersionField,
  fiscalYearId: z.string().min(1),
  contactId: z.string().min(1),
  mode: z.enum(AUDIT_MODES),
  confidential: z.boolean().default(false),
  /** Erklärung aus der Akte (festgeschrieben, nicht widerrufen); hochladen geht über `fileConfidentialityDeclaration`. */
  confidentialityDocumentId: z.string().min(1).nullable().optional(),
  electedOn: z.iso.date().nullable().optional(),
  /** Protokoll der MV aus der Akte. */
  minutesDocumentId: z.string().min(1).nullable().optional(),
});

/**
 * `finance.periodClose`: einen Prüfer eintragen (ohne `id`) oder ändern. Je Jahr und Kontakt ein Eintrag; der
 * Kontakt ist eine Person; „gewählt am“ liegt nicht in der Zukunft. Kein Zwang zu Zugang oder Unabhängigkeit — die
 * Hinweise stehen in der Liste (Spec: Hinweise ohne Sperre).
 */
export async function saveAuditor(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditorView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, saveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = loadYear(deps.db, v.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  const before = v.id ? loadAuditor(deps.db, v.id) : null;
  if (v.id && !before) return notFound('financeAuditAuditor', v.id);
  if (before) {
    if (before.fiscalYearId !== v.fiscalYearId) return invalid([{ path: 'fiscalYearId', message: 'yearFixed' }]);
    // Vermerke, Stichproben und Unterschriften bleiben bei der Person, die sie gab.
    if ((before.contactId !== v.contactId || before.mode !== v.mode) && auditorWorkInternal(deps.db, before.id)) return financeConflict('auditorHasWork');
    const stale = staleVersion(v.expectedVersion, before.updatedAt);
    if (stale) return stale;
  }
  if (!before && auditorsFrozenInternal(deps.db, year.id)) return financeConflict('auditReportReadyToSign');
  if (v.electedOn && v.electedOn > todayIn(deps)) return invalid([{ path: 'electedOn', message: 'inFuture' }]);
  const contact = deps.db.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, v.contactId)).get();
  if (!contact) return notFound('contact', v.contactId);
  if (contact.kind !== 'person') return financeConflict('auditorNotPerson');
  const taken = deps.db.select({ id: financeAuditAuditors.id }).from(financeAuditAuditors).where(and(eq(financeAuditAuditors.fiscalYearId, year.id), eq(financeAuditAuditors.contactId, v.contactId))).get();
  if (taken && taken.id !== before?.id) return financeConflict('auditorAlreadyListed');
  for (const documentId of [v.confidentialityDocumentId, v.minutesDocumentId]) {
    if (!documentId || documentId === before?.confidentialityDocumentId || documentId === before?.minutesDocumentId) continue;
    const problem = await checkPickedDocument(deps, ctx, documentId);
    if (problem) return problem;
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const values = {
      contactId: v.contactId, mode: v.mode, confidential: v.confidential,
      confidentialityDocumentId: v.confidentialityDocumentId === undefined ? (before?.confidentialityDocumentId ?? null) : v.confidentialityDocumentId,
      electedOn: v.electedOn === undefined ? (before?.electedOn ?? null) : v.electedOn,
      minutesDocumentId: v.minutesDocumentId === undefined ? (before?.minutesDocumentId ?? null) : v.minutesDocumentId,
      updatedAt: now,
    };
    const id = before?.id ?? newId();
    if (before) tx.update(financeAuditAuditors).set(values).where(eq(financeAuditAuditors.id, id)).run();
    else tx.insert(financeAuditAuditors).values({ id, fiscalYearId: year.id, ...values, accessEndedAt: null, accessEndedByUserId: null, createdAt: now }).run();
    // Ein Jahr, das vor D1 abgeschlossen wurde, hat keinen Prüfstand: Er entsteht mit dem ersten Prüfer (Plan D1a, Review 6).
    if (fiscalYearStatusInternal(tx, year.id) === 'closed') ensureBaselineInternal(tx, deps, ctx, year.id, 'initial');
    const after = loadAuditor(tx, id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.audit.auditor.save', entity: 'financeAuditAuditor', id, before: before ? auditFields(before) : undefined, after: auditFields(after), params: { mode: after.mode } });
    return ok(auditorViewInternal(tx, deps, after));
  });
}

const idSchema = z.object({ id: z.string().min(1) });

/** `finance.periodClose`: austragen, solange keine Arbeit daran hängt (Vermerke, Stichproben, Bericht). */
export async function removeAuditor(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ id: string }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadAuditor(deps.db, parsed.value.id);
  if (!row) return notFound('financeAuditAuditor', parsed.value.id);
  if (auditorWorkInternal(deps.db, row.id)) return financeConflict('auditorHasWork');
  if (auditorsFrozenInternal(deps.db, row.fiscalYearId)) return financeConflict('auditReportReadyToSign');
  return deps.db.transaction((tx: DbOrTx) => {
    if (auditorWorkInternal(tx, row.id)) return financeConflict('auditorHasWork');
    tx.delete(financeAuditAuditors).where(eq(financeAuditAuditors.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.auditor.remove', entity: 'financeAuditAuditor', id: row.id, before: auditFields(row), params: { mode: row.mode } });
    return ok({ id: row.id });
  });
}

/**
 * `finance.periodClose`, persönlicher Schritt (humanOnly): „Zugang beenden …“ (Designer 12h, Nachtrag Prüferzugang) entzieht
 * dem verknüpften Nutzer die Rolle mit Herkunft `finance:auditor` — nur diese — und hält fest, wer wann. Vermerke und
 * Stichproben bleiben.
 */
export async function endAuditorAccess(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditorView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadAuditor(deps.db, parsed.value.id);
  if (!row) return notFound('financeAuditAuditor', parsed.value.id);
  const userId = userIdForContactInternal(deps.db, row.contactId);
  if (!userId) return financeConflict('auditorNotLinked');
  const roleId = roleIdByOrigin(deps.db, AUDITOR_ROLE_ORIGIN);
  const holds = roleId !== null && (loadUserSummary(deps.db, userId)?.roles.some((r) => r.id === roleId) ?? false);
  if (!roleId || !holds) return financeConflict('auditorAccessAlreadyEnded');
  return deps.db.transaction((tx: DbOrTx) => {
    const removed = removeRoleInternal(tx, deps, ctx, { userId, roleId });
    if (!removed.ok) return removed;
    const now = isoNow(deps.clock);
    tx.update(financeAuditAuditors).set({ accessEndedAt: now, accessEndedByUserId: ctx.userId ?? 'system', updatedAt: now }).where(eq(financeAuditAuditors.id, row.id)).run();
    const after = loadAuditor(tx, row.id)!;
    financeAudit(tx, deps, ctx, { action: 'finance.audit.auditor.accessEnd', entity: 'financeAuditAuditor', id: row.id, before: auditFields(row), after: auditFields(after), params: {} });
    return ok(auditorViewInternal(tx, deps, after));
  });
}

const confidentialitySchema = z.object({
  auditorId: z.string().min(1),
  bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }),
  /** Wie die Datei hieß — nur für die Oberfläche; die Akte vergibt Nummer und Betreff selbst. */
  fileName: z.string().trim().max(300).optional(),
});

/**
 * `finance.periodClose`: die unterschriebene Vertraulichkeitserklärung als PDF am Prüfer ablegen (Bezug
 * `financeAuditor`, kein Recht der Akte nötig) und am Eintrag setzen. Persönlicher Schritt (humanOnly); über MCP als
 * Base64 (`finance_audit_confidentiality_file`).
 */
export async function fileConfidentialityDeclaration(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditorView>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, confidentialitySchema, input);
  if (!parsed.ok) return parsed;
  const row = loadAuditor(deps.db, parsed.value.auditorId);
  if (!row) return notFound('financeAuditAuditor', parsed.value.auditorId);
  const year = loadYear(deps.db, row.fiscalYearId)!;
  const result = await receiveGeneratedUpload(deps, ctx, {
    bytes: parsed.value.bytes,
    typeKey: AUDIT_CONFIDENTIALITY_TYPE_KEY,
    subject: `Vertraulichkeitserklärung Kassenprüfung ${year.designation}`,
    documentDate: todayIn(deps),
    links: [{ entityType: 'financeAuditor', entityId: row.id }],
    afterReceive: (tx, doc) => {
      const now = isoNow(deps.clock);
      const changed = tx.update(financeAuditAuditors).set({ confidentialityDocumentId: doc.id, confidential: true, updatedAt: now }).where(eq(financeAuditAuditors.id, row.id)).run().changes;
      if (changed !== 1) abortReceive(notFound('financeAuditAuditor', row.id));
      financeAudit(tx, deps, ctx, { action: 'finance.audit.auditor.confidentiality', entity: 'financeAuditAuditor', id: row.id, before: auditFields(row), after: auditFields(loadAuditor(tx, row.id)!), params: { documentNumber: doc.number } });
      return null;
    },
  });
  if (!result.ok) return result;
  return ok(auditorViewInternal(deps.db, deps, loadAuditor(deps.db, row.id)!));
}

// ── Für die Oberfläche ──────────────────────────────────────────────────────

/**
 * `finance.read` oder `finance.audit`: die laufende Kassenprüfung (`currentAuditYearInternal`) mit ihren Prüfern —
 * Vorgabe der Übersicht und Liste „im Beisein von“ im Zähldialog. `null`, wenn keine läuft.
 */
export async function currentAuditYear(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fiscalYearId: string; designation: string; auditors: { id: string; contactId: string; contactName: string; mode: AuditMode }[] } | null>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, z.object({}).strict(), input ?? {});
  if (!parsed.ok) return parsed;
  const yearId = currentAuditYearInternal(deps.db);
  if (!yearId) return ok(null);
  const year = loadYear(deps.db, yearId)!;
  const auditors = auditorsOfYearInternal(deps.db, yearId).map((a) => ({ id: a.id, contactId: a.contactId, contactName: contactNameInternal(deps.db, a.contactId), mode: a.mode }));
  return ok({ fiscalYearId: yearId, designation: year.designation, auditors });
}

const previewSchema = z.object({ fiscalYearId: z.string().min(1), contactId: z.string().min(1), mode: z.enum(AUDIT_MODES) });

/** `finance.periodClose`: Zugang und Unabhängigkeit eines Kontakts, ohne zu speichern (Dialog 12b zeigt die Hinweise vorher). */
export async function previewAuditor(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ access: AuditorAccess; independence: AuditorIndependence }>> {
  const denied = requirePermission(ctx, 'finance.periodClose');
  if (denied) return denied;
  const parsed = validate(deps, previewSchema, input);
  if (!parsed.ok) return parsed;
  const year = loadYear(deps.db, parsed.value.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, parsed.value.contactId)).get()) return notFound('contact', parsed.value.contactId);
  return ok({ access: auditorAccessInternal(deps.db, deps, parsed.value.contactId, null), independence: auditorIndependenceInternal(deps.db, year, parsed.value.contactId) });
}
