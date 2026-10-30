import { hasPermission, notFound, ok, readSetting, timeZoneOf, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '../reporting/hash';
import { openConfirmationsForLinesInternal } from '../donations/check';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { toCorrectConfirmationsOfYearInternal } from '../donations/to-correct';
import { openTransactionsInPeriodOf, undocumentedEntriesOf } from '../ledger/period';
import { listVouchersWithoutEntry } from '../ledger/vouchers';
import { accountStatementsForYearInternal } from '../ledger/statement-documents';
import { computeAccountReconciliation } from '../reporting/reports/account-reconciliation';
import { computeCashReport } from '../reporting/reports/cash-report';
import {
  financeAccounts, financeAllocationLines, financeCategories, financeEntries, financeEntryDocuments, financeFiscalYears, financeImportCandidates, financeMoneyLines, financePartnerPayments, financePartnerProfiles, financePurposes, financeReserves,
  type FinanceFiscalYearRow,
} from '../schema';
import { auditorOfInternal, requireAuditRead } from './access';
import { remarkStatesByTargetInternal } from './remarks';
import { sampleStateInternal, samplesByEntryInternal, sectionReviewsInternal } from './samples';
import { anomalyRowsInternal } from './anomalies';
import { baselinesOfYearInternal, changedBetweenBaselinesInternal, entryFingerprintInternal } from './baseline';
import { auditResolutionsOf } from '../sources';
import { AUDIT_SECTIONS, type AuditSection } from './types';
import { zonedDayOf, zonedDayRange } from '../zoned-days';

/**
 * Das Prüfpaket als Abschnitte (Spec § D1 Schritt 2, Finanz-Spec § 9.4, Designer Runde 1 4b): je Abschnitt eine Liste,
 * aufklappbar bis zur Buchung. Die Zeile trägt Codes und Werte (`kind`, `labelParams`), den Satz baut die App.
 * Live gerechnet, nie gespeichert.
 */

export type AuditSampleState = 'none' | 'sampled' | 'recheck';

export interface AuditSectionRow {
  key: string;
  kind: string;
  entryId?: string;
  documentId?: string;
  date: string | null;
  amountCents: number | null;
  labelParams: Record<string, string | number | boolean | null>;
  /** Der Stand des Aufrufers (Kästchen der Stichprobe); nur an Buchungen. */
  sample?: AuditSampleState;
  /** Wie viele Prüfer die Buchung als Stichprobe haben (für die Schatzmeisterin). */
  samplesByAll?: number;
  /** Vermerke im Zustand „offen“ an der Zeile (Buchung und ihre Belege). */
  remarksOpen: number;
  /** Beantwortete, noch nicht geklärte Vermerke an der Zeile — die Marke trägt den Zustand (274/275). */
  remarksAnswered?: number;
  /** Abschnitt 9 (G-30): der Beschluss der Zeile, Ziel ihrer Vermerke. */
  resolutionId?: string;
}

const loadYear = (db: DbOrTx, id: string): FinanceFiscalYearRow | null => db.select().from(financeFiscalYears).where(eq(financeFiscalYears.id, id)).get() ?? null;

const names = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]));

// ── Journal ─────────────────────────────────────────────────────────────────

function journalRows(db: DbOrTx, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const accountName = names(db.select({ id: financeAccounts.id, name: financeAccounts.name }).from(financeAccounts).all());
  const categoryName = names(db.select({ id: financeCategories.id, name: financeCategories.name }).from(financeCategories).all());
  const purposeName = names(db.select({ id: financePurposes.id, name: financePurposes.name }).from(financePurposes).all());
  const entries = db.select().from(financeEntries).where(and(eq(financeEntries.fiscalYearId, year.id), eq(financeEntries.status, 'final'))).orderBy(asc(financeEntries.entryDate), asc(financeEntries.number)).all();
  return entries.map((e) => {
    const money = db.select().from(financeMoneyLines).where(eq(financeMoneyLines.entryId, e.id)).orderBy(asc(financeMoneyLines.position)).all();
    const allocation = db.select().from(financeAllocationLines).where(eq(financeAllocationLines.entryId, e.id)).orderBy(asc(financeAllocationLines.position)).all();
    const purposeOrCategory = [...new Set(allocation.map((a) => (a.purposeId ? purposeName.get(a.purposeId) : categoryName.get(a.categoryId)) ?? ''))].filter(Boolean).join(', ');
    const accounts = [...new Set(money.map((m) => accountName.get(m.accountId) ?? ''))].filter(Boolean).join(', ');
    const state = e.reversedByEntryId ? 'reversed' : e.reversesEntryId ? 'reversal' : 'final';
    return {
      key: `entry:${e.id}`, kind: 'entry', entryId: e.id, date: e.entryDate, amountCents: money.reduce((s, m) => s + m.amountCents, 0),
      labelParams: { number: e.number ?? '', text: e.text, purposeOrCategory, accountName: accounts, state }, remarksOpen: 0,
    };
  });
}

// ── Kontenabstimmung ────────────────────────────────────────────────────────

function reconciliationRows(db: DbOrTx, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const accountName = names(db.select({ id: financeAccounts.id, name: financeAccounts.name }).from(financeAccounts).all());
  const data = computeAccountReconciliation(db, { fiscalYearId: year.id });
  // Rechenschaft C Schritt 1: je Bankkonto, ob der Auszug als PDF den Stichtag abdeckt, fehlt oder begründet fehlt.
  const statements = new Map(accountStatementsForYearInternal(db, year.id).map((r) => [r.accountId, r]));
  const statementOf = (accountId: string): Record<string, string> => {
    const row = statements.get(accountId);
    if (!row || row.kind !== 'bank') return {};
    if (!row.needsPdf) return { statement: 'covers' };
    return row.confirmation?.kind === 'missingJustified' ? { statement: 'justified', justification: row.confirmation.note ?? '' } : { statement: 'missing' };
  };
  return data.accounts.map((a) => ({
    key: `account:${a.accountId}`, kind: 'account', date: a.against.date ?? data.date, amountCents: a.bookCents,
    labelParams: { accountName: accountName.get(a.accountId) ?? '', kind: a.kind, bookCents: a.bookCents, againstCents: a.against.cents, source: a.against.source, state: a.state, ...statementOf(a.accountId) }, remarksOpen: 0,
  }));
}

// ── Belege ──────────────────────────────────────────────────────────────────

/** Die Zeilen der Belegprüfung, die an Buchungen hängen (fehlend, Eigenbeleg, widerrufen) — ohne Akte, ohne Recht des Aufrufers. */
function voucherEntryRows(db: DbOrTx, year: FinanceFiscalYearRow, timeZone: string): AuditSectionRow[] {
  const rows: AuditSectionRow[] = [];
  const entryOf = (id: string) => db.select({ id: financeEntries.id, number: financeEntries.number, entryDate: financeEntries.entryDate }).from(financeEntries).where(eq(financeEntries.id, id)).get();
  for (const u of undocumentedEntriesOf(db, year.id)) {
    const e = entryOf(u.entryId)!;
    rows.push({ key: `missing:${u.entryId}`, kind: 'voucher', entryId: u.entryId, date: e.entryDate, amountCents: null, labelParams: { reason: u.justified ? 'missingJustified' : 'missing', number: u.number ?? '' }, remarksOpen: 0 });
  }
  const links = db
    .select({ id: financeEntryDocuments.id, entryId: financeEntryDocuments.entryId, documentId: financeEntryDocuments.documentId, documentNumber: financeEntryDocuments.documentNumber, revokedAt: financeEntryDocuments.revokedAt, typeKey: documents.typeKey, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate })
    .from(financeEntryDocuments)
    .innerJoin(financeEntries, eq(financeEntries.id, financeEntryDocuments.entryId))
    .leftJoin(documents, eq(documents.id, financeEntryDocuments.documentId))
    .where(and(eq(financeEntries.fiscalYearId, year.id), eq(financeEntries.status, 'final')))
    .orderBy(asc(financeEntries.entryDate), asc(financeEntryDocuments.documentNumber))
    .all();
  for (const l of links) {
    if (l.revokedAt === null && l.typeKey === 'voucher-own') rows.push({ key: `own:${l.id}`, kind: 'voucher', entryId: l.entryId, ...(l.documentId ? { documentId: l.documentId } : {}), date: l.entryDate, amountCents: null, labelParams: { reason: 'own', number: l.entryNumber ?? '', subject: l.documentNumber }, remarksOpen: 0 });
    if (l.revokedAt !== null && zonedDayOf(l.revokedAt, timeZone) >= year.startsOn) rows.push({ key: `revoked:${l.id}`, kind: 'voucher', entryId: l.entryId, ...(l.documentId ? { documentId: l.documentId } : {}), date: zonedDayOf(l.revokedAt, timeZone), amountCents: null, labelParams: { reason: 'revoked', number: l.entryNumber ?? '', subject: l.documentNumber }, remarksOpen: 0 });
  }
  return rows;
}

async function voucherRows(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow): Promise<AuditSectionRow[]> {
  const rows = voucherEntryRows(deps.db, year, timeZoneOf(deps));
  // Belege ohne Buchung liest die Akte mit dem Recht des Aufrufers (Prinzip 6) — ohne `finance.read` bleiben sie weg.
  if (hasPermission(ctx, 'finance.read')) {
    for (let offset = 0; ; offset += 200) {
      const page = await listVouchersWithoutEntry(deps, ctx, { limit: 200, offset });
      if (!page.ok) break;
      for (const d of page.value.documents) {
        if (d.documentDate < year.startsOn || d.documentDate > year.endsOn) continue;
        rows.push({ key: `withoutEntry:${d.id}`, kind: 'voucher', documentId: d.id, date: d.documentDate, amountCents: null, labelParams: { reason: 'withoutEntry', number: d.number ?? '', subject: d.subject }, remarksOpen: 0 });
      }
      if (offset + 200 >= page.value.total) break;
    }
  }
  return rows;
}

// ── Importabgleich ──────────────────────────────────────────────────────────

function importRows(db: DbOrTx, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const rows: AuditSectionRow[] = [];
  const decided = db.select().from(financeImportCandidates).where(isNotNull(financeImportCandidates.decision)).all();
  for (const c of decided) {
    const line = JSON.parse(c.line) as { bookingDate?: string; amountCents?: number; counterpartyName?: string | null; purpose?: string };
    if (!line.bookingDate || line.bookingDate < year.startsOn || line.bookingDate > year.endsOn) continue;
    rows.push({ key: `decision:${c.id}`, kind: 'import', date: line.bookingDate, amountCents: line.amountCents ?? null, labelParams: { kind: 'decision', decision: c.decision, counterparty: line.counterpartyName ?? null, purpose: line.purpose ?? null }, remarksOpen: 0 });
  }
  for (const t of openTransactionsInPeriodOf(db, year)) rows.push({ key: `open:${t.id}`, kind: 'import', date: t.bookingDate, amountCents: t.amountCents, labelParams: { kind: 'open', accountName: t.accountName }, remarksOpen: 0 });
  return rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
}

// ── Zweckmittel und Rücklagen ───────────────────────────────────────────────

function purposeReserveRows(db: DbOrTx, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const purposeName = names(db.select({ id: financePurposes.id, name: financePurposes.name }).from(financePurposes).all());
  const reserveName = names(db.select({ id: financeReserves.id, name: financeReserves.name }).from(financeReserves).all());
  const { bindings } = computeCashReport(db, { fiscalYearId: year.id });
  return [
    ...bindings.purposes.map((p) => ({ key: `purpose:${p.purposeId}`, kind: 'purpose', date: year.endsOn, amountCents: p.closingCents, labelParams: { name: purposeName.get(p.purposeId) ?? '', carryForwardCents: p.carryForwardCents, inflowCents: p.inflowCents, usedCents: p.usedCents, closingCents: p.closingCents }, remarksOpen: 0 })),
    ...bindings.reserves.map((r) => ({ key: `reserve:${r.reserveId}`, kind: 'reserve', date: year.endsOn, amountCents: r.closingCents, labelParams: { name: reserveName.get(r.reserveId) ?? '', carryForwardCents: r.openingCents, inflowCents: r.addedCents, usedCents: r.releasedCents, closingCents: r.closingCents }, remarksOpen: 0 })),
  ];
}

// ── Spenden ─────────────────────────────────────────────────────────────────

function donationRows(deps: Deps, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const db = deps.db;
  const feesCertifiable = readSetting<boolean>(deps, 'finance.membershipFeesCertifiable');
  const kinds = CERTIFIABLE_INCOME_KINDS.filter((k) => feesCertifiable || k !== 'membershipFee');
  const lines = db
    .select({ lineId: financeAllocationLines.id, amountCents: financeAllocationLines.amountCents, contactId: financeAllocationLines.contactId })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .innerJoin(financeCategories, eq(financeCategories.id, financeAllocationLines.categoryId))
    .where(and(eq(financeEntries.status, 'final'), eq(financeEntries.fiscalYearId, year.id), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId), inArray(financeCategories.incomeKind, [...kinds])))
    .all()
    .filter((l) => l.amountCents > 0);
  const open = openConfirmationsForLinesInternal(db, lines.map((l) => l.lineId));
  const without = lines.filter((l) => l.contactId !== null && !open.has(l.lineId));
  const toCorrect = toCorrectConfirmationsOfYearInternal(db, year.id);
  const sum = (ls: { amountCents: number }[]) => ls.reduce((s, l) => s + l.amountCents, 0);
  return [
    { key: 'donations:total', kind: 'donations', date: null, amountCents: sum(lines), labelParams: { kind: 'total', count: lines.length }, remarksOpen: 0 },
    { key: 'donations:withoutConfirmation', kind: 'donations', date: null, amountCents: sum(without), labelParams: { kind: 'withoutConfirmation', count: without.length }, remarksOpen: 0 },
    { key: 'donations:toCorrect', kind: 'donations', date: null, amountCents: null, labelParams: { kind: 'toCorrect', count: toCorrect.length }, remarksOpen: 0 },
  ];
}

// ── Zahlungen an Partner ────────────────────────────────────────────────────

function partnerPaymentRows(db: DbOrTx, year: FinanceFiscalYearRow, timeZone: string): AuditSectionRow[] {
  const inYear = zonedDayRange(year.startsOn, year.endsOn, timeZone);
  const payments = db
    .select({ p: financePartnerPayments, contactId: financePartnerProfiles.contactId })
    .from(financePartnerPayments)
    .innerJoin(financePartnerProfiles, eq(financePartnerProfiles.id, financePartnerPayments.partnerId))
    .where(and(eq(financePartnerPayments.state, 'approved'), gte(financePartnerPayments.approvedAt, inYear.start), lt(financePartnerPayments.approvedAt, inYear.end)))
    .orderBy(asc(financePartnerPayments.approvedAt))
    .all();
  return payments.map(({ p, contactId }) => {
    const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    const proofState = p.acknowledgedAt ? 'acknowledged' : p.proofDueOn && p.proofDueOn < year.endsOn ? 'overdue' : 'open';
    return { key: `partnerPayment:${p.id}`, kind: 'partnerPayment', date: zonedDayOf(p.approvedAt!, timeZone), amountCents: null, labelParams: { number: p.number ?? '', partnerName: contact ? displayName(contact) : '', proofState, proofDueOn: p.proofDueOn }, remarksOpen: 0 };
  });
}

// ── Beschlüsse (G-30) ───────────────────────────────────────────────────────

/**
 * Die finanzwirksamen, festgeschriebenen Beschlüsse des Prüfjahres aus einer registrierten Quelle (Gremien): nach
 * Datum, mit Codes und Werten, das Protokoll mit seiner Nummer (die Nummer eines Dokuments darf man kennen, V12).
 */
function resolutionRows(deps: Deps, year: FinanceFiscalYearRow): AuditSectionRow[] {
  const found = auditResolutionsOf(deps, deps.db, year) ?? [];
  const ids = [...new Set(found.flatMap((r) => (r.minutesDocumentId ? [r.minutesDocumentId] : [])))];
  const numbers = new Map(ids.length > 0 ? deps.db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, ids)).all().map((d) => [d.id, d.number]) : []);
  return [...found]
    .sort((a, b) => a.decidedOn.localeCompare(b.decidedOn) || a.number.localeCompare(b.number))
    .map((r) => ({
      key: `resolution:${r.id}`, kind: 'resolution', resolutionId: r.id, date: r.decidedOn, amountCents: r.facts.amountCents ?? null,
      labelParams: {
        number: r.number, resolutionKind: r.kind, outcome: r.outcome, organ: r.organ, viaCircular: r.viaCircular,
        minutesDocumentId: r.minutesDocumentId, minutesNumber: r.minutesDocumentId ? (numbers.get(r.minutesDocumentId) ?? null) : null,
        ...Object.fromEntries(Object.entries(r.facts).filter(([, v]) => v !== undefined)),
      },
      remarksOpen: 0,
    }));
}

/** Gibt es Abschnitt 9 für das Jahr? Nur, wenn eine Quelle registriert und ihr Modul eingeschaltet ist. */
export function resolutionsSectionActiveInternal(deps: Deps, year: FinanceFiscalYearRow): boolean {
  return auditResolutionsOf(deps, deps.db, year) !== null;
}

/** Die Abschnitte des Jahres in Prüferreihenfolge: acht, mit Gremien neun. */
export function activeAuditSectionsInternal(deps: Deps, year: FinanceFiscalYearRow): AuditSection[] {
  const withResolutions = resolutionsSectionActiveInternal(deps, year);
  return AUDIT_SECTIONS.filter((s) => s !== 'resolutions' || withResolutions);
}

/** Die Protokolle der Beschlüsse in Abschnitt 9 — der berechnete Bezug, unter dem die Akte sie der Prüferin gibt. */
export function auditResolutionMinutesInternal(deps: Deps, fiscalYearId: string): string[] {
  const year = loadYear(deps.db, fiscalYearId);
  if (!year) return [];
  return (auditResolutionsOf(deps, deps.db, year) ?? []).flatMap((r) => (r.minutesDocumentId ? [r.minutesDocumentId] : []));
}

// ── Verteiler ───────────────────────────────────────────────────────────────

/** Alle Zeilen eines Abschnitts, ohne Rechteprüfung und ohne Filter. */
export async function sectionRowsInternal(deps: Deps, ctx: CallContext, year: FinanceFiscalYearRow, section: AuditSection): Promise<AuditSectionRow[]> {
  switch (section) {
    case 'journal': return journalRows(deps.db, year);
    case 'reconciliation': return reconciliationRows(deps.db, year);
    case 'vouchers': return voucherRows(deps, ctx, year);
    case 'imports': return importRows(deps.db, year);
    case 'anomalies': return anomalyRowsInternal(deps, year);
    case 'purposesReserves': return purposeReserveRows(deps.db, year);
    case 'donations': return donationRows(deps, year);
    case 'partnerPayments': return partnerPaymentRows(deps.db, year, timeZoneOf(deps));
    case 'resolutions': return resolutionRows(deps, year);
  }
}

/**
 * Die Zeilen eines Abschnitts synchron und ohne Recht des Aufrufers: Die Belege ohne Buchung aus der Akte liest nur
 * `sectionRowsInternal` mit dem Recht des Aufrufers (Prinzip 6); hier fehlen sie.
 */
function sectionRowsSyncInternal(deps: Deps, year: FinanceFiscalYearRow, section: AuditSection): AuditSectionRow[] {
  switch (section) {
    case 'journal': return journalRows(deps.db, year);
    case 'reconciliation': return reconciliationRows(deps.db, year);
    case 'vouchers': return voucherEntryRows(deps.db, year, timeZoneOf(deps));
    case 'imports': return importRows(deps.db, year);
    case 'anomalies': return anomalyRowsInternal(deps, year);
    case 'purposesReserves': return purposeReserveRows(deps.db, year);
    case 'donations': return donationRows(deps, year);
    case 'partnerPayments': return partnerPaymentRows(deps.db, year, timeZoneOf(deps));
    case 'resolutions': return resolutionRows(deps, year);
  }
}

/** Die Buchungen, die in den Zeilen eines Abschnitts stehen (ohne die Belege ohne Buchung, die keine tragen). */
export function sectionEntryIdsInternal(deps: Deps, year: FinanceFiscalYearRow, section: AuditSection): Set<string> {
  return new Set(sectionRowsSyncInternal(deps, year, section).flatMap((r) => (r.entryId ? [r.entryId] : [])));
}

/** Beschriftungen der Zeilen, die nur Namen sind — nicht Teil des Fingerabdrucks. */
const NAME_PARAMS = new Set(['accountName', 'purposeOrCategory', 'name', 'partnerName', 'contactName', 'organ', 'organs', 'persons']);

/**
 * Fingerabdruck eines Abschnitts (Plan D1e Task 0): SHA-256 über seine Zeilen in kanonischer Form, eine Zeile mit
 * Buchung samt deren Fingerabdruck — so zählt auch eine Änderung, die der Zeilentext nicht zeigt (Zuordnung, Beleg).
 * Ohne die Belege ohne Buchung aus der Akte, weil die nur mit dem Recht des Aufrufers lesbar sind.
 */
export function sectionRowsHashInternal(deps: Deps, year: FinanceFiscalYearRow, section: AuditSection): string {
  const rows = sectionRowsSyncInternal(deps, year, section)
    // Ein leeres Konto ohne Gegenwert (später angelegt, still gelegt) ist keine Zahl, die der Prüfer gesehen hat.
    .filter((r) => !(r.kind === 'account' && r.amountCents === 0 && r.labelParams.source === 'none'))
    .map((r) => {
      // Namen ändern keine Zahl: Wer eine Kategorie, ein Konto, einen Zweck oder einen Kontakt umbenennt, setzt keine
      // Durchsicht zurück. Die Zeile steht über ihre Kennung (`key`) und die Buchung über ihren Fingerabdruck.
      const labelParams = Object.fromEntries(Object.entries(r.labelParams).filter(([k]) => !NAME_PARAMS.has(k)));
      const { remarksOpen: _remarks, ...rest } = r;
      return { ...rest, labelParams, ...(r.entryId ? { fingerprint: entryFingerprintInternal(deps.db, r.entryId) } : {}) };
    });
  return createHash('sha256').update(canonicalJson(rows)).digest('hex');
}

export interface SectionReviewState {
  section: AuditSection;
  auditorId: string;
  at: string;
  /** Gilt für den jüngsten Prüfstand (Spec § D1 „Prüfstand“, Plan D1d Task 1). */
  current: boolean;
}

/**
 * „Durchgesehen“ (Plan D1e Task 0): Eine Durchsicht hält den Fingerabdruck der Abschnittszeilen fest und gilt für den
 * jüngsten Prüfstand, solange er dem heutigen gleicht — auch für Abschnitte ohne Buchungszeilen und wenn eine Buchung
 * den Abschnitt verlassen hat. Sonst fordert die Nachprüfung den Abschnitt neu an.
 *
 * Durchsichten ohne Fingerabdruck (von vor der Spalte) folgen der Regel aus D1d: Sie gehören zu dem Prüfstand, der beim
 * Durchsehen der jüngste war, und gelten für den jüngsten, wenn sie nach ihm entstanden oder keine Buchung, die sich
 * zwischen ihrem und dem jüngsten Prüfstand geändert hat, in den Zeilen des Abschnitts steht.
 */
export function sectionReviewStatesInternal(deps: Deps, fiscalYearId: string): SectionReviewState[] {
  const db: DbOrTx = deps.db;
  const reviews = sectionReviewsInternal(db, fiscalYearId);
  if (reviews.length === 0) return [];
  const year = loadYear(db, fiscalYearId)!;
  const baselines = baselinesOfYearInternal(db, fiscalYearId);
  const latest = baselines.at(-1);
  const hashes = new Map<AuditSection, string>();
  const entryIds = new Map<AuditSection, Set<string>>();
  const changedSince = new Map<string, Set<string>>();
  return reviews.map((r) => {
    const section = r.section as AuditSection;
    const state = { section, auditorId: r.auditorId, at: r.at };
    if (r.rowsHash !== null) {
      if (!hashes.has(section)) hashes.set(section, sectionRowsHashInternal(deps, year, section));
      return { ...state, current: hashes.get(section) === r.rowsHash };
    }
    if (!latest || r.at >= latest.createdAt) return { ...state, current: true };
    const own = baselines.filter((b) => b.createdAt <= r.at).at(-1) ?? baselines[0]!;
    if (own.id === latest.id) return { ...state, current: true };
    if (!changedSince.has(own.id)) changedSince.set(own.id, changedBetweenBaselinesInternal(db, own.id, latest.id));
    const changed = changedSince.get(own.id)!;
    if (changed.size === 0) return { ...state, current: true };
    if (!entryIds.has(section)) entryIds.set(section, sectionEntryIdsInternal(deps, year, section));
    const inSection = entryIds.get(section)!;
    return { ...state, current: ![...changed].some((id) => inSection.has(id)) };
  });
}

/** Je Abschnitt die Durchsichten, die nur noch für einen früheren Prüfstand gelten: wer, und wann zuletzt. */
export function previousReviewsInternal(states: readonly SectionReviewState[]): { section: AuditSection; auditorIds: string[]; at: string }[] {
  return AUDIT_SECTIONS.flatMap((section) => {
    const old = states.filter((s) => s.section === section && !s.current);
    return old.length ? [{ section, auditorIds: old.map((s) => s.auditorId), at: old.map((s) => s.at).sort().at(-1)! }] : [];
  });
}

/**
 * Stichprobe und offene Vermerke an die Zeilen hängen: `sample` ist der Stand des Aufrufers (sein Kästchen),
 * `samplesByAll` die Zahl aller Prüfer — die Schatzmeisterin sieht nur Zahlen (Designer N4).
 */
export function decorateRowsInternal(db: DbOrTx, ctx: CallContext, fiscalYearId: string, rows: AuditSectionRow[]): AuditSectionRow[] {
  const me = auditorOfInternal(db, ctx.userId, fiscalYearId);
  const byAll = samplesByEntryInternal(db, fiscalYearId);
  const remarks = remarkStatesByTargetInternal(db, fiscalYearId);
  return rows.map((r) => {
    const at = [r.entryId ? remarks.get(`entry:${r.entryId}`) : undefined, r.documentId ? remarks.get(`document:${r.documentId}`) : undefined, r.resolutionId ? remarks.get(`resolution:${r.resolutionId}`) : undefined];
    const counts = { remarksOpen: at.reduce((n, s) => n + (s?.open ?? 0), 0), remarksAnswered: at.reduce((n, s) => n + (s?.answered ?? 0), 0) };
    return r.entryId ? { ...r, sample: sampleStateInternal(db, me?.id ?? null, r.entryId), samplesByAll: byAll.get(r.entryId) ?? 0, ...counts } : { ...r, ...counts };
  });
}

/** „12,50“, „12.50“, „1.234,56“, „-30“ → Cent; sonst `null`. */
function amountOf(text: string): number | null {
  const t = text.trim().replace(/\s|€/g, '');
  if (!/^-?[\d.]+(,\d{1,2})?$/.test(t) && !/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export interface AuditSectionFilter {
  text?: string;
  sample?: 'all' | 'sampled' | 'open' | 'recheck';
  accountId?: string;
  entryIds?: string[];
}

/** Die Filter der Abschnittsseite (Designer 4b): Text, Nummer oder Betrag; Stichprobe; Konto; bestimmte Buchungen. */
export function filterRowsInternal(db: DbOrTx, rows: AuditSectionRow[], filter: AuditSectionFilter): AuditSectionRow[] {
  let out = rows;
  if (filter.entryIds) {
    const wanted = new Set(filter.entryIds);
    out = out.filter((r) => r.entryId && wanted.has(r.entryId));
  }
  if (filter.accountId) {
    const entries = new Set(db.select({ entryId: financeMoneyLines.entryId }).from(financeMoneyLines).where(eq(financeMoneyLines.accountId, filter.accountId)).all().map((m) => m.entryId));
    out = out.filter((r) => (r.entryId ? entries.has(r.entryId) : r.key === `account:${filter.accountId}`));
  }
  if (filter.sample && filter.sample !== 'all') {
    const want = filter.sample;
    out = out.filter((r) => r.sample !== undefined && (want === 'sampled' ? r.sample !== 'none' : want === 'open' ? r.sample === 'none' : r.sample === 'recheck'));
  }
  const text = filter.text?.trim().toLowerCase();
  if (text) {
    const cents = amountOf(text);
    out = out.filter((r) => (cents !== null && r.amountCents !== null && Math.abs(r.amountCents) === Math.abs(cents)) || Object.values(r.labelParams).some((v) => typeof v === 'string' && v.toLowerCase().includes(text)));
  }
  return out;
}

const sectionSchema = z.object({
  fiscalYearId: z.string().min(1),
  section: z.enum(AUDIT_SECTIONS),
  text: z.string().max(200).optional(),
  sample: z.enum(['all', 'sampled', 'open', 'recheck']).optional(),
  accountId: z.string().min(1).optional(),
  entryIds: z.array(z.string().min(1)).max(2000).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Wer einen Abschnitt für den jüngsten Prüfstand durchgesehen hat, und die frühere Durchsicht, wenn sie nicht mehr gilt. */
export function reviewedByInternal(deps: Deps, fiscalYearId: string, section: AuditSection): { reviewedBy: { auditorId: string; at: string }[]; previousReview: { auditorIds: string[]; at: string } | null } {
  const states = sectionReviewStatesInternal(deps, fiscalYearId).filter((s) => s.section === section);
  const previous = previousReviewsInternal(states)[0];
  return { reviewedBy: states.filter((s) => s.current).map((s) => ({ auditorId: s.auditorId, at: s.at })), previousReview: previous ? { auditorIds: previous.auditorIds, at: previous.at } : null };
}

/**
 * `finance.read` oder `finance.audit`, auch über MCP: ein Abschnitt des Prüfpakets, gefiltert und blätterbar (Vorgabe
 * 50, höchstens 200 Zeilen), mit dem Stand der Stichproben und wer ihn für den jüngsten Prüfstand durchgesehen hat
 * (`previousReview`: eine frühere Durchsicht, die nach einer Änderung im Abschnitt nicht mehr gilt).
 */
export async function getAuditSection(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ rows: AuditSectionRow[]; total: number; reviewedBy: { auditorId: string; at: string }[]; previousReview: { auditorIds: string[]; at: string } | null }>> {
  const denied = requireAuditRead(ctx);
  if (denied) return denied;
  const parsed = validate(deps, sectionSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const year = loadYear(deps.db, v.fiscalYearId);
  if (!year) return notFound('financeFiscalYear', v.fiscalYearId);
  if (!activeAuditSectionsInternal(deps, year).includes(v.section)) return notFound('financeAuditSection', v.section);
  const rows = filterRowsInternal(deps.db, decorateRowsInternal(deps.db, ctx, year.id, await sectionRowsInternal(deps, ctx, year, v.section)), v);
  return ok({ rows: rows.slice(v.offset, v.offset + v.limit), total: rows.length, ...reviewedByInternal(deps, year.id, v.section) });
}
