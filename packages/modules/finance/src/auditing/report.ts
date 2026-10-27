import { expectedVersionField, invalid, isoNow, newId, notFound, ok, requirePermission, staleVersion, userNamesFor, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { fiscalYearStatusInternal } from '../ledger/fiscal-years';
import {
  financeAuditAuditors, financeAuditBaselines, financeClosingConfirmations, financeAuditReportDeviations, financeAuditReportResults, financeAuditReports, financeAuditReportScans, financeFiscalYears, financePeriodEvents,
  type FinanceAuditReportRow, type FinanceFiscalYearRow,
} from '../schema';
import { auditorOfInternal, auditorsOfYearInternal, isReportEditorInternal, reportEditorRefusalInternal, requireAuditRead } from './access';
import { carryOverClosesFollowUpInternal } from './carry-over';
import { cashCountsAfterInternal } from './cash-witnesses';
import { baselineReportRefs, changedSinceInternal, ensureBaselineInternal, latestBaselineInternal, referenceBaselineInternal } from './baseline';
import { remarkViewInternal, remarksOfYearInternal } from './remarks';
import { sampleCountInternal } from './samples';
import { sectionReviewStatesInternal } from './sections';
import { AUDIT_SECTIONS, type AuditCashCount, type AuditMode, type AuditRemarkView } from './types';

/**
 * Der Prüfbericht (Spec § D1 Schritt 5–6, Designer Runde 3 12d–12g): Entwurf in vier Blöcken — Gegenstand (von
 * Kompass), Prüfung und Ergebnis (von den Prüfern), Feststellungen und offene Fragen (aus den Vermerken) — und
 * Unterschriften. Jede Karte speichert für sich mit eigenem Stand. Bearbeiten nur Bearbeiter (Prüfer des Jahres in
 * Kompass ohne Schreibrecht), persönlicher Schritt (humanOnly).
 */

export type AuditReportKind = 'report' | 'followUp';
export type AuditReportState = 'draft' | 'readyToSign' | 'filed';
export type SignatureMode = 'both' | 'one' | 'separate';

/** N15 (Joe 2026-10-27): Hinweise am Prüfbericht — die Entscheidung gehört den Prüfern. */
export type AuditReportNotice = 'cleanWithOpenRemarks';

export interface AuditReportView {
  id: string;
  fiscalYearId: string;
  kind: AuditReportKind;
  origin: 'kompass' | 'blank';
  state: AuditReportState;
  subject: {
    designation: string;
    startsOn: string;
    endsOn: string;
    baseline: { id: string; createdAt: string; kind: 'initial' | 'followUp' };
    reports: { key: string; shortHash: string }[];
    samples: { sampledEntries: number; totalEntries: number };
    sectionsReviewed: { reviewed: number; total: number };
    /** Die gewählte oder die neueste Zählung mit Zeugen nach dem Prüfstand (Task 8). */
    cash: AuditCashCount | null;
    /** Nur beim Nachtrag: seit dem Prüfstand des abgelegten Berichts geänderte Buchungen. */
    changedEntryIds: string[];
  };
  examination: { dates: string[]; place: string | null; notTested: string | null; cashCountId: string | null; updatedAt: string | null; updatedByUserId: string | null; version: string };
  /** Die Zählungen mit Zeugen, die der Bericht zeigen kann (nach seinem Prüfstand), neueste zuerst — die Auswahl der Karte „Prüfung“. */
  cashCounts: AuditCashCount[];
  findings: AuditRemarkView[];
  openQuestions: AuditRemarkView[];
  /** Vorschlag im View: „mit Feststellungen“, sobald es eine gibt. */
  suggestedResult: 'clean' | 'withFindings';
  /** N15: Vermerke des Jahres, die noch nicht geklärt sind (offen oder beantwortet) — wie `remarksUnresolved` der Kassenprüfung. */
  openRemarks: number;
  /** N15: `cleanWithOpenRemarks`, wenn ein Ergebnis „ohne Beanstandung“ lautet, obwohl Vermerke ungeklärt sind — ein Hinweis, keine Sperre. */
  notices: AuditReportNotice[];
  results: { auditorId: string | null; result: 'clean' | 'withFindings' | null; recommendation: 'discharge' | 'noDischarge' | 'none'; updatedAt: string | null; updatedByUserId: string | null; version: string }[];
  deviations: { auditorId: string; text: string; updatedAt: string }[];
  signatures: { mode: SignatureMode; nonSignerAuditorId: string | null; nonSignerReason: string | null; updatedAt: string | null; updatedByUserId: string | null; version: string };
  auditors: { id: string; contactName: string; mode: AuditMode }[];
  scans: { auditorId: string | null; documentId: string; filedAt: string }[];
  scansExpected: number;
  readyAt: string | null;
  filedAt: string | null;
  lastPrintedAt: string | null;
  editorNames: string[];
  lastEditedAt: string | null;
  canEdit: boolean;
  myAuditorId: string | null;
}

// ── Lesen ───────────────────────────────────────────────────────────────────

export const loadReport = (db: DbOrTx, id: string): FinanceAuditReportRow | null => db.select().from(financeAuditReports).where(eq(financeAuditReports.id, id)).get() ?? null;

/** Der jüngste Bericht des Jahres dieser Art — oder ohne Art der jüngste überhaupt. */
export function currentReportInternal(db: DbOrTx, fiscalYearId: string, kind?: AuditReportKind): FinanceAuditReportRow | null {
  return db.select().from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), kind ? eq(financeAuditReports.kind, kind) : undefined)).orderBy(desc(financeAuditReports.createdAt), desc(financeAuditReports.id)).get() ?? null;
}

/** Der zuletzt abgelegte Bericht (oder Nachtrag) des Jahres. */
export function lastFiledReportInternal(db: DbOrTx, fiscalYearId: string): FinanceAuditReportRow | null {
  return db.select().from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, fiscalYearId), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt), desc(financeAuditReports.id)).get() ?? null;
}

/**
 * Nachprüfung offen (Spec § D1 „Wiederöffnen nach der Prüfung“): ein Bericht ist abgelegt, und danach wurde das Jahr
 * wieder geöffnet — bis auf dem neuen Prüfstand ein Nachtrag abgelegt ist.
 */
export function followUpOpenInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const filed = lastFiledReportInternal(db, fiscalYearId);
  if (!filed?.filedAt) return false;
  const reopened = db.select({ id: financePeriodEvents.id }).from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, fiscalYearId), eq(financePeriodEvents.kind, 'reopened'), gt(financePeriodEvents.at, filed.filedAt))).get();
  const open = Boolean(reopened) || latestBaselineInternal(db, fiscalYearId)?.id !== filed.baselineId;
  // Rechenschaft C: nach der MV schließt auch die Übernahme ins Folgejahr die Nachprüfung (nur auf ihrem Prüfstand).
  return open && !carryOverClosesFollowUpInternal(db, fiscalYearId) && !followUpConfirmedUnchangedInternal(db, fiscalYearId);
}

/**
 * Der Stand einer offenen Nachprüfung für „Berichte“ (279 Telefon): `unchanged`, wenn seit dem Prüfstand keine Buchung
 * geändert ist (Schritt 10 bestätigt dann nur), `changed` mit Nachtrag oder Übernahme, `null` ohne offene Nachprüfung.
 */
export function followUpStateInternal(db: DbOrTx, fiscalYearId: string): 'unchanged' | 'changed' | null {
  if (!followUpOpenInternal(db, fiscalYearId)) return null;
  const reference = referenceBaselineInternal(db, fiscalYearId);
  return reference && changedSinceInternal(db, fiscalYearId, reference).length > 0 ? 'changed' : 'unchanged';
}

/**
 * Nachprüfung ohne geänderte Buchung (Befund 3, E1): Schritt 10 ist nach dem jüngsten Wiederöffnen bestätigt, und seit
 * dem Prüfstand hat sich keine Buchung geändert — dann gilt der Prüfbericht weiter. Die Bestätigung liest `schema`
 * direkt, nicht über `closing/` (kein Kreisimport).
 */
export function followUpConfirmedUnchangedInternal(db: DbOrTx, fiscalYearId: string): boolean {
  const confirmedAt = followUpConfirmedAtInternal(db, fiscalYearId);
  if (!confirmedAt) return false;
  const reference = referenceBaselineInternal(db, fiscalYearId);
  return reference !== null && changedSinceInternal(db, fiscalYearId, reference).length === 0;
}

/** Für „Berichte“ (347): der zuletzt abgelegte Prüfbericht und die Bestätigung einer Nachprüfung ohne Änderung. */
export function releaseAuditFactsInternal(db: DbOrTx, fiscalYearId: string): { reportFiledAt: string | null; followUpConfirmedAt: string | null } | null {
  const filed = lastFiledReportInternal(db, fiscalYearId);
  if (!filed) return null;
  return { reportFiledAt: filed.filedAt, followUpConfirmedAt: followUpConfirmedUnchangedInternal(db, fiscalYearId) ? followUpConfirmedAtInternal(db, fiscalYearId) : null };
}

/** Die jüngste Bestätigung von Schritt 10, wenn sie nach dem jüngsten Wiederöffnen liegt. */
export function followUpConfirmedAtInternal(db: DbOrTx, fiscalYearId: string): string | null {
  const confirmation = db.select({ at: financeClosingConfirmations.at }).from(financeClosingConfirmations).where(and(eq(financeClosingConfirmations.fiscalYearId, fiscalYearId), eq(financeClosingConfirmations.step, 'auditReport'))).orderBy(desc(financeClosingConfirmations.at)).get();
  if (!confirmation) return null;
  const reopened = db.select({ at: financePeriodEvents.at }).from(financePeriodEvents).where(and(eq(financePeriodEvents.fiscalYearId, fiscalYearId), eq(financePeriodEvents.kind, 'reopened'))).orderBy(desc(financePeriodEvents.at)).get();
  return !reopened || confirmation.at > reopened.at ? confirmation.at : null;
}

/** Wie viele Scans der Bericht braucht: je Prüfer einen bei getrennten Berichten, sonst einen. */
export function scansExpectedInternal(db: DbOrTx, row: FinanceAuditReportRow): number {
  return row.signatureMode === 'separate' ? Math.max(auditorsOfYearInternal(db, row.fiscalYearId).length, 1) : 1;
}

export function scansOfInternal(db: DbOrTx, reportId: string) {
  return db.select().from(financeAuditReportScans).where(eq(financeAuditReportScans.reportId, reportId)).orderBy(asc(financeAuditReportScans.filedAt)).all();
}

const contactName = (db: DbOrTx, contactId: string) => {
  const c = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return c ? displayName(c) : '';
};

function versionOf(...stamps: (string | null | undefined)[]): string {
  return stamps.find((s): s is string => Boolean(s)) ?? '';
}

/** Der Gegenstand, live gerechnet: Berichte, Umfang, Kassenbestand, beim Nachtrag die geänderten Buchungen. */
function liveSubjectInternal(deps: Deps, row: FinanceAuditReportRow): AuditReportView['subject'] {
  const db: DbOrTx = deps.db;
  const year = db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  const baseline = db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.id, row.baselineId)).get()!;
  const reviewed = new Set(sectionReviewStatesInternal(deps, row.fiscalYearId).filter((r) => r.current).map((r) => r.section));
  const counts = cashCountsAfterInternal(db, row.fiscalYearId, baseline);
  const cash = (row.examCashCountId ? counts.find((c) => c.countId === row.examCashCountId) : null) ?? counts[0] ?? null;
  // Beim Nachtrag zählt „geändert“ gegen den Prüfstand des zuletzt abgelegten Berichts.
  const filedBefore = row.kind === 'followUp' ? db.select().from(financeAuditReports).where(and(eq(financeAuditReports.fiscalYearId, row.fiscalYearId), eq(financeAuditReports.state, 'filed'))).orderBy(desc(financeAuditReports.filedAt)).all().find((r) => r.id !== row.id) : null;
  return {
    designation: year.designation, startsOn: year.startsOn, endsOn: year.endsOn,
    baseline: { id: baseline.id, createdAt: baseline.createdAt, kind: baseline.kind },
    reports: baselineReportRefs(baseline).map((r) => ({ key: r.key, shortHash: r.hash.slice(0, 8) })),
    samples: sampleCountInternal(db, row.fiscalYearId),
    sectionsReviewed: { reviewed: reviewed.size, total: AUDIT_SECTIONS.length },
    cash,
    changedEntryIds: row.kind === 'followUp' && filedBefore ? changedSinceInternal(db, row.fiscalYearId, filedBefore.baselineId) : [],
  };
}

/** Der Gegenstand als Schnappschuss (JSON) für „zum Unterschreiben freigeben“ und die Ablage. */
export function subjectSnapshotInternal(deps: Deps, row: FinanceAuditReportRow): string {
  return JSON.stringify(liveSubjectInternal(deps, row));
}

export function reportViewInternal(deps: Deps, ctx: CallContext, row: FinanceAuditReportRow): AuditReportView {
  const db: DbOrTx = deps.db;
  const auditors = auditorsOfYearInternal(db, row.fiscalYearId);
  const remarks = remarksOfYearInternal(db, row.fiscalYearId).map((r) => remarkViewInternal(db, r));
  const findings = remarks.filter((r) => r.kind === 'finding');
  const openRemarks = remarks.filter((r) => r.state !== 'resolved').length;
  const results = db.select().from(financeAuditReportResults).where(eq(financeAuditReportResults.reportId, row.id)).all();
  const deviations = db.select().from(financeAuditReportDeviations).where(eq(financeAuditReportDeviations.reportId, row.id)).all();
  const scans = scansOfInternal(db, row.id);
  const editors = [row.examUpdatedByUserId, row.signaturesUpdatedByUserId, ...results.map((r) => r.updatedByUserId)].filter((id): id is string => Boolean(id));
  const stamps = [row.examUpdatedAt, row.signaturesUpdatedAt, ...results.map((r) => r.updatedAt), ...deviations.map((d) => d.updatedAt)].filter((s): s is string => Boolean(s)).sort();
  const resultRows = row.signatureMode === 'separate'
    ? auditors.map((a) => results.find((r) => r.auditorId === a.id) ?? null).map((r, i) => ({ auditorId: auditors[i]!.id, result: r?.result ?? null, recommendation: r?.recommendation ?? 'none', updatedAt: r?.updatedAt ?? null, updatedByUserId: r?.updatedByUserId ?? null, version: versionOf(r?.updatedAt, row.createdAt) }))
    : [results.find((r) => r.auditorId === null)].map((r) => ({ auditorId: null, result: r?.result ?? null, recommendation: r?.recommendation ?? 'none', updatedAt: r?.updatedAt ?? null, updatedByUserId: r?.updatedByUserId ?? null, version: versionOf(r?.updatedAt, row.createdAt) }));
  return {
    id: row.id, fiscalYearId: row.fiscalYearId, kind: row.kind, origin: row.origin, state: row.state,
    // Ab „zum Unterschreiben freigeben“ steht der Gegenstand fest (Spec § D1 „Prüfstand“), bis die Freigabe zurückgeht.
    subject: row.subjectSnapshot ? (JSON.parse(row.subjectSnapshot) as AuditReportView['subject']) : liveSubjectInternal(deps, row),
    cashCounts: cashCountsAfterInternal(db, row.fiscalYearId, db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.id, row.baselineId)).get()!),
    examination: { dates: JSON.parse(row.examDates) as string[], place: row.examPlace, notTested: row.examNotTested, cashCountId: row.examCashCountId, updatedAt: row.examUpdatedAt, updatedByUserId: row.examUpdatedByUserId, version: versionOf(row.examUpdatedAt, row.createdAt) },
    findings,
    openQuestions: remarks.filter((r) => r.kind === 'question' && r.state !== 'resolved'),
    suggestedResult: findings.length > 0 ? 'withFindings' : 'clean',
    openRemarks,
    notices: openRemarks > 0 && resultRows.some((r) => r.result === 'clean') ? ['cleanWithOpenRemarks'] : [],
    results: resultRows,
    deviations: deviations.map((d) => ({ auditorId: d.auditorId, text: d.text, updatedAt: d.updatedAt })),
    signatures: { mode: row.signatureMode, nonSignerAuditorId: row.nonSignerAuditorId, nonSignerReason: row.nonSignerReason, updatedAt: row.signaturesUpdatedAt, updatedByUserId: row.signaturesUpdatedByUserId, version: versionOf(row.signaturesUpdatedAt, row.createdAt) },
    auditors: auditors.map((a) => ({ id: a.id, contactName: contactName(db, a.contactId), mode: a.mode })),
    scans: scans.map((s) => ({ auditorId: s.auditorId, documentId: s.documentId, filedAt: s.filedAt })),
    scansExpected: scansExpectedInternal(db, row),
    readyAt: row.readyAt, filedAt: row.filedAt, lastPrintedAt: row.lastPrintedAt,
    editorNames: [...userNamesFor(deps, [...new Set(editors)]).values()].sort((a, b) => a.localeCompare(b, 'de')),
    lastEditedAt: stamps.at(-1) ?? null,
    canEdit: row.state === 'draft' && row.origin === 'kompass' && isReportEditorInternal(db, ctx, row.fiscalYearId),
    myAuditorId: auditorOfInternal(db, ctx.userId, row.fiscalYearId)?.id ?? null,
  };
}

const getSchema = z.object({ fiscalYearId: z.string().min(1), kind: z.enum(['report', 'followUp']).optional() });

/** `finance.read` oder `finance.audit`, auch über MCP: der Bericht des Jahres (ohne Art der jüngste), `null` ohne. */
export async function getAuditReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView | null>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, getSchema, input);
  if (!parsed.ok) return parsed;
  if (!deps.db.select({ id: financeFiscalYears.id }).from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get()) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  const row = currentReportInternal(deps.db, parsed.value.fiscalYearId, parsed.value.kind);
  return ok(row ? reportViewInternal(deps, ctx, row) : null);
}

// ── Anlegen ─────────────────────────────────────────────────────────────────

/**
 * Einen Bericht anlegen, ohne Rechteprüfung (auch für den Vordruck, `print.ts`). `report` am Referenz-Prüfstand
 * (vor dem ersten Bericht: der erste), `followUp` am jüngsten.
 */
export function createReportInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow, kind: AuditReportKind, origin: 'kompass' | 'blank'): FinanceAuditReportRow {
  const baselineId = kind === 'followUp' ? latestBaselineInternal(tx, year.id)!.id : ensureBaselineInternal(tx, deps, ctx, year.id, 'initial');
  const id = newId();
  const now = isoNow(deps.clock);
  tx.insert(financeAuditReports).values({ id, fiscalYearId: year.id, kind, origin, baselineId, state: origin === 'blank' ? 'readyToSign' : 'draft', createdAt: now, ...(origin === 'blank' ? { readyAt: now, readyByUserId: ctx.userId ?? 'system' } : {}) }).run();
  financeAudit(tx, deps, ctx, { action: 'finance.audit.report.create', entity: 'financeAuditReport', id, after: { fiscalYearId: year.id, kind, origin, state: origin === 'blank' ? 'readyToSign' : 'draft' }, params: { designation: year.designation, kind } });
  return loadReport(tx, id)!;
}

/** Ob für das Jahr und die Art ein Bericht angelegt werden darf — sonst der Code der Ablehnung. */
export function reportCreatableInternal(db: DbOrTx, year: FinanceFiscalYearRow, kind: AuditReportKind): 'auditReportYearOpen' | 'auditReportExists' | 'auditFollowUpNotOpen' | null {
  if (fiscalYearStatusInternal(db, year.id) !== 'closed') return 'auditReportYearOpen';
  if (kind === 'report') return currentReportInternal(db, year.id, 'report') ? 'auditReportExists' : null;
  if (!followUpOpenInternal(db, year.id)) return 'auditFollowUpNotOpen';
  const latest = latestBaselineInternal(db, year.id)!;
  return db.select({ id: financeAuditReports.id }).from(financeAuditReports).where(eq(financeAuditReports.baselineId, latest.id)).get() ? 'auditReportExists' : null;
}

/** Bearbeiter des Prüfberichts (gemeinsam für alle Karten); den Kanal prüft jeder Dienst gleich nach dem Recht. */
function requireEditor(deps: Deps, ctx: CallContext, fiscalYearId: string, designation: string) {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const refusal = reportEditorRefusalInternal(deps.db, ctx, fiscalYearId);
  if (refusal === 'auditorHasWriteRights') return financeConflict('auditorHasWriteRights');
  if (refusal) return financeConflict('auditorRequired', { designation });
  return null;
}

const createSchema = z.object({ fiscalYearId: z.string().min(1), kind: z.enum(['report', 'followUp']) });

/** `finance.audit`, Bearbeiter, persönlicher Schritt (humanOnly): den Entwurf anlegen (Bericht oder Nachtrag). */
export async function createAuditReportDraft(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, parsed.value.fiscalYearId)).get();
  if (!year) return notFound('financeFiscalYear', parsed.value.fiscalYearId);
  const refused = requireEditor(deps, ctx, year.id, year.designation);
  if (refused) return refused;
  const blocked = reportCreatableInternal(deps.db, year, parsed.value.kind);
  if (blocked) return financeConflict(blocked, { designation: year.designation });
  return deps.db.transaction((tx: DbOrTx) => ok(reportViewInternal({ ...deps, db: tx }, ctx, createReportInternal(tx, deps, ctx, year, parsed.value.kind, 'kompass'))));
}

// ── Karten ──────────────────────────────────────────────────────────────────

/** Bericht laden, Bearbeiter prüfen, Zustand `draft` verlangen. */
function editableReport(deps: Deps, ctx: CallContext, reportId: string): Result<{ row: FinanceAuditReportRow; year: FinanceFiscalYearRow }> {
  const row = loadReport(deps.db, reportId);
  if (!row) return notFound('financeAuditReport', reportId);
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  const refused = requireEditor(deps, ctx, row.fiscalYearId, year.designation);
  if (refused) return refused;
  if (row.state !== 'draft' || row.origin !== 'kompass') return financeConflict('auditReportReadyToSign');
  return ok({ row, year });
}

const isoDay = z.iso.date();

const examinationSchema = z.object({
  reportId: z.string().min(1),
  expectedVersion: expectedVersionField,
  dates: z.array(isoDay).max(20),
  place: z.string().trim().max(200).nullable().optional(),
  notTested: z.string().trim().max(2000).nullable().optional(),
  cashCountId: z.string().min(1).nullable().optional(),
});

/** Karte „Prüfung“: Geprüft am (ein oder mehr Tage), Ort, „Nicht geprüft“, gewählte Kassenzählung. */
export async function saveAuditReportExamination(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, examinationSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = editableReport(deps, ctx, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, year } = loaded.value;
  if (v.cashCountId) {
    // Nur eine Zählung, die der Bericht zeigen kann (`cashCounts` der Ansicht, nach seinem eigenen Prüfstand) — sonst
    // nähme der Gegenstand still eine andere (Schlussdurchsicht D1d, I-3).
    const baseline = deps.db.select().from(financeAuditBaselines).where(eq(financeAuditBaselines.id, row.baselineId)).get()!;
    if (!cashCountsAfterInternal(deps.db, row.fiscalYearId, baseline).some((c) => c.countId === v.cashCountId)) return invalid([{ path: 'cashCountId', message: 'notACashCountOfAudit' }]);
  }
  const stale = staleVersion(v.expectedVersion, versionOf(row.examUpdatedAt, row.createdAt));
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeAuditReports).set({ examDates: JSON.stringify([...new Set(v.dates)].sort()), examPlace: v.place || null, examNotTested: v.notTested || null, examCashCountId: v.cashCountId ?? null, examUpdatedAt: now, examUpdatedByUserId: ctx.userId ?? 'system' }).where(eq(financeAuditReports.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.examination', entity: 'financeAuditReport', id: row.id, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, dateCount: v.dates.length }, params: { designation: year.designation, kind: row.kind } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}

const resultSchema = z.object({
  reportId: z.string().min(1),
  expectedVersion: expectedVersionField,
  result: z.enum(['clean', 'withFindings']).nullable(),
  recommendation: z.enum(['discharge', 'noDischarge', 'none']).default('none'),
});

/**
 * Karte „Ergebnis“: gemeinsam — oder bei getrennten Berichten nur das eigene (Ergebnis und Empfehlung je Prüfer,
 * Rückmeldung Runde 3). Für Papier-Prüfer bleibt es leer (Druck: leere Kästchen).
 */
export async function saveAuditReportResult(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, resultSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = editableReport(deps, ctx, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, year } = loaded.value;
  const auditorId = row.signatureMode === 'separate' ? auditorOfInternal(deps.db, ctx.userId, row.fiscalYearId)!.id : null;
  const where = and(eq(financeAuditReportResults.reportId, row.id), auditorId ? eq(financeAuditReportResults.auditorId, auditorId) : isNull(financeAuditReportResults.auditorId));
  const existing = deps.db.select().from(financeAuditReportResults).where(where).get();
  const stale = staleVersion(v.expectedVersion, existing?.updatedAt ?? row.createdAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const values = { result: v.result, recommendation: v.recommendation, updatedAt: now, updatedByUserId: ctx.userId ?? 'system' };
    if (existing) tx.update(financeAuditReportResults).set(values).where(eq(financeAuditReportResults.id, existing.id)).run();
    else tx.insert(financeAuditReportResults).values({ id: newId(), reportId: row.id, auditorId, ...values }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.result', entity: 'financeAuditReport', id: row.id, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, result: v.result, recommendation: v.recommendation, separate: auditorId !== null }, params: { designation: year.designation, kind: row.kind } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}

const deviationSchema = z.object({ reportId: z.string().min(1), expectedVersion: expectedVersionField, text: z.string().trim().max(4000) });

/** Karte „Abweichende Feststellungen · <Name>“: nur das eigene Feld; leer heißt keine. */
export async function saveAuditReportDeviation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, deviationSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = editableReport(deps, ctx, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, year } = loaded.value;
  const auditorId = auditorOfInternal(deps.db, ctx.userId, row.fiscalYearId)!.id;
  const where = and(eq(financeAuditReportDeviations.reportId, row.id), eq(financeAuditReportDeviations.auditorId, auditorId));
  const existing = deps.db.select().from(financeAuditReportDeviations).where(where).get();
  const stale = staleVersion(v.expectedVersion, existing?.updatedAt ?? row.createdAt);
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    if (existing) tx.update(financeAuditReportDeviations).set({ text: v.text, updatedAt: now }).where(where).run();
    else tx.insert(financeAuditReportDeviations).values({ reportId: row.id, auditorId, text: v.text, updatedAt: now }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.deviation', entity: 'financeAuditReport', id: row.id, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, auditorId }, params: { designation: year.designation, kind: row.kind } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}

const signaturesSchema = z.object({
  reportId: z.string().min(1),
  expectedVersion: expectedVersionField,
  mode: z.enum(['both', 'one', 'separate']),
  nonSignerAuditorId: z.string().min(1).nullable().optional(),
  nonSignerReason: z.string().trim().max(300).nullable().optional(),
});

/**
 * Karte „Unterschriften“ (Designer 12d): beide einen Bericht (Vorgabe), einer unterschreibt (wer nicht und warum,
 * Pflicht), oder jeder einen eigenen Bericht. Der Wechsel zu „getrennt“ verwirft kein gemeinsames Ergebnis — es zählt
 * nur nicht mehr.
 */
export async function saveAuditReportSignatures(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, signaturesSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = editableReport(deps, ctx, v.reportId);
  if (!loaded.ok) return loaded;
  const { row, year } = loaded.value;
  if (v.mode === 'one') {
    const issues: { path: string; message: string }[] = [];
    const nonSigner = v.nonSignerAuditorId ? deps.db.select().from(financeAuditAuditors).where(eq(financeAuditAuditors.id, v.nonSignerAuditorId)).get() : null;
    if (!nonSigner || nonSigner.fiscalYearId !== row.fiscalYearId) issues.push({ path: 'nonSignerAuditorId', message: 'required' });
    if (!v.nonSignerReason) issues.push({ path: 'nonSignerReason', message: 'required' });
    if (issues.length) return invalid(issues);
  }
  const stale = staleVersion(v.expectedVersion, versionOf(row.signaturesUpdatedAt, row.createdAt));
  if (stale) return stale;
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeAuditReports).set({ signatureMode: v.mode, nonSignerAuditorId: v.mode === 'one' ? v.nonSignerAuditorId! : null, nonSignerReason: v.mode === 'one' ? v.nonSignerReason! : null, signaturesUpdatedAt: now, signaturesUpdatedByUserId: ctx.userId ?? 'system' }).where(eq(financeAuditReports.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.signatures', entity: 'financeAuditReport', id: row.id, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, signatureMode: v.mode }, params: { designation: year.designation, kind: row.kind, mode: v.mode } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}

// ── Zum Unterschreiben freigeben ────────────────────────────────────────────

const reportIdSchema = z.object({ reportId: z.string().min(1) });

/**
 * „Zum Unterschreiben freigeben …“ (Designer 12d): danach steht der Text fest, der Gegenstand als Schnappschuss. Verlangt mindestens einen Prüfungstag
 * und ein Ergebnis — gemeinsam, oder bei getrennten Berichten von jedem Prüfer in Kompass.
 */
export async function markAuditReportReadyToSign(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reportIdSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = editableReport(deps, ctx, parsed.value.reportId);
  if (!loaded.ok) return loaded;
  const { row, year } = loaded.value;
  const view = reportViewInternal(deps, ctx, row);
  const kompassAuditors = new Set(view.auditors.filter((a) => a.mode === 'kompass').map((a) => a.id));
  const missingResult = row.signatureMode === 'separate' ? view.results.some((r) => r.auditorId && kompassAuditors.has(r.auditorId) && r.result === null) : view.results[0]?.result == null;
  if (view.examination.dates.length === 0 || missingResult) return financeConflict('auditReportIncomplete');
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeAuditReports).set({ state: 'readyToSign', readyAt: now, readyByUserId: ctx.userId ?? 'system', subjectSnapshot: subjectSnapshotInternal({ ...deps, db: tx }, row) }).where(eq(financeAuditReports.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.ready', entity: 'financeAuditReport', id: row.id, before: { state: 'draft' }, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, state: 'readyToSign' }, params: { designation: year.designation, kind: row.kind } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}

/** „Freigabe zurücknehmen“ — bis der erste Scan liegt. Bearbeiter, persönlicher Schritt (humanOnly). */
export async function revokeAuditReportReadyToSign(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AuditReportView>> {
  const denied = requirePermission(ctx, 'finance.audit');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, reportIdSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadReport(deps.db, parsed.value.reportId);
  if (!row) return notFound('financeAuditReport', parsed.value.reportId);
  const year = deps.db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, row.fiscalYearId)).get()!;
  const refused = requireEditor(deps, ctx, row.fiscalYearId, year.designation);
  if (refused) return refused;
  // Erst der Scan: Nach der Ablage ist der Bericht `filed` — „nicht freigegeben“ wäre der falsche Grund (Befund MCP 3).
  if (scansOfInternal(deps.db, row.id).length > 0) return financeConflict('auditReportScanFiled');
  if (row.state !== 'readyToSign' || row.origin !== 'kompass') return financeConflict('auditReportNotReadyToSign');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeAuditReports).set({ state: 'draft', readyAt: null, readyByUserId: null, subjectSnapshot: null }).where(eq(financeAuditReports.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.audit.report.readyRevoke', entity: 'financeAuditReport', id: row.id, before: { state: 'readyToSign' }, after: { fiscalYearId: row.fiscalYearId, kind: row.kind, state: 'draft' }, params: { designation: year.designation, kind: row.kind } });
    return ok(reportViewInternal({ ...deps, db: tx }, ctx, loadReport(tx, row.id)!));
  });
}
