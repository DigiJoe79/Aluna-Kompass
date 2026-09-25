import { invalid, isoNow, newId, notFound, ok, readSetting, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { documents, getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { and, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { CERTIFIABLE_INCOME_KINDS } from '../ledger/codes';
import { NOTICE_KINDS, noticeValidAt, noticeValidUntil, type NoticeKind } from '../ledger/notice-validity';
import { financeAllocationLines, financeCategories, financeEntries, financeNotices, type FinanceNoticeRow } from '../schema';

/**
 * Bescheide des Vereins (F6a Task 2, Spec 7.1): eine datierte Reihe, nie
 * gelöscht. Gültigkeit berechnet (`ledger/notice-validity.ts`), nie
 * gespeichert. Nach jeder Änderung schreibt Finanzen die vier Kern-Einstellungen
 * nach (E22) — in derselben Transaktion, Aktion `finance.notice`.
 */
export interface NoticeView extends FinanceNoticeRow {
  validUntil: string;
  state: 'valid' | 'expired' | 'superseded' | 'voided' | 'future';
  documentNumber: string | null;
  supersededDocumentNumber: string | null;
}

const today = (deps: Deps) => isoNow(deps.clock).slice(0, 10);

const allNotices = (db: DbOrTx) => db.select().from(financeNotices).all();

/** Der jüngste Bescheid, der am Stichtag trägt — für die Bestätigung (Task 5) und F7. */
export function noticeValidAtInternal(db: DbOrTx, date: string): FinanceNoticeRow | null {
  return noticeValidAt(allNotices(db), date)?.notice ?? null;
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Ganze Monate von `from` bis `to` (abgerundet). */
function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

/**
 * Der heute tragende Bescheid, sobald sein Ende höchstens `warnMonths` Monate
 * entfernt ist — für die Kachel „Bescheid läuft ab“ (Spec 9.7). Sonst `null`.
 */
export function noticeExpiryInternal(db: DbOrTx, todayIso: string, warnMonths: number): { noticeId: string; validUntil: string; monthsLeft: number } | null {
  const hit = noticeValidAt(allNotices(db), todayIso);
  if (!hit || hit.validUntil > addMonths(todayIso, warnMonths)) return null;
  return { noticeId: hit.notice.id, validUntil: hit.validUntil, monthsLeft: monthsBetween(todayIso, hit.validUntil) };
}

/** Ob es mindestens eine festgeschriebene, nicht zurückgenommene, bescheinigungsfähige Zeile mit Kontakt gibt — ohne Bescheid wäre sie nicht bestätigbar. */
export function certifiableLineExistsInternal(db: DbOrTx): boolean {
  return !!db
    .select({ id: financeAllocationLines.id })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(
      and(
        eq(financeEntries.status, 'final'),
        isNull(financeEntries.reversedByEntryId),
        isNull(financeEntries.reversesEntryId),
        inArray(financeCategories.incomeKind, [...CERTIFIABLE_INCOME_KINDS]),
        isNotNull(financeAllocationLines.contactId),
        gt(financeAllocationLines.amountCents, 0),
      ),
    )
    .limit(1)
    .get();
}

function stateOf(row: FinanceNoticeRow, rows: readonly FinanceNoticeRow[], date: string, validUntil: string): NoticeView['state'] {
  if (row.voidedAt !== null) return 'voided';
  if (row.supersededOn !== null && row.supersededOn <= date) return 'superseded';
  if (row.noticeDate > date) return 'future';
  // Ein § 60a-Bescheid, dem ein endgültiger folgt, ist damit ersetzt — auch ohne eigenes Datum.
  if (row.kind === 'section60a' && rows.some((o) => o.voidedAt === null && o.kind !== 'section60a' && o.noticeDate > row.noticeDate && o.noticeDate <= date)) return 'superseded';
  if (date > validUntil) return 'expired';
  return 'valid';
}

function toViews(db: DbOrTx, rows: readonly FinanceNoticeRow[], all: readonly FinanceNoticeRow[], date: string): NoticeView[] {
  const documentIds = [...new Set(rows.flatMap((r) => [r.documentId, r.supersededDocumentId]).filter((id): id is string => id !== null))];
  const numbers = new Map(documentIds.length === 0 ? [] : db.select({ id: documents.id, number: documents.number }).from(documents).where(inArray(documents.id, documentIds)).all().map((d) => [d.id, d.number] as const));
  return rows.map((row) => {
    const validUntil = noticeValidUntil(row.kind, row.noticeDate);
    return {
      ...row,
      validUntil,
      state: stateOf(row, all, date, validUntil),
      documentNumber: row.documentId ? (numbers.get(row.documentId) ?? null) : null,
      supersededDocumentNumber: row.supersededDocumentId ? (numbers.get(row.supersededDocumentId) ?? null) : null,
    };
  });
}

function viewInternal(db: DbOrTx, id: string, date: string): NoticeView {
  const all = allNotices(db);
  return toViews(db, all.filter((n) => n.id === id), all, date)[0]!;
}

const auditFields = (row: FinanceNoticeRow) => ({
  kind: row.kind, noticeDate: row.noticeDate, assessmentPeriod: row.assessmentPeriod, documentId: row.documentId,
  supersededOn: row.supersededOn, supersededDocumentId: row.supersededDocumentId, voided: row.voidedAt !== null,
});

/**
 * E22: Finanzamt, Steuernummer, Art und Datum des Bescheids in den
 * Vereinsdaten folgen der Reihe. Art und Datum sind die des heute tragenden
 * Bescheids (sonst „none“ und leer); Finanzamt und Steuernummer die des
 * tragenden, sonst des jüngsten nicht irrtümlich erfassten — sie verlieren
 * ihre Gültigkeit nicht mit dem Bescheid. Geschrieben wird nur, was sich
 * ändert.
 */
function syncCoreSettingsInternal(tx: DbOrTx, deps: Deps, ctx: CallContext): Result<null> {
  const rows = allNotices(tx);
  const valid = noticeValidAt(rows, today(deps))?.notice ?? null;
  const latest = valid ?? [...rows].filter((r) => r.voidedAt === null).sort((a, b) => b.noticeDate.localeCompare(a.noticeDate)).at(0) ?? null;
  const target: [string, string][] = [
    ['organization.exemptionNoticeType', valid ? valid.kind : 'none'],
    ['organization.exemptionNoticeDate', valid ? valid.noticeDate : ''],
  ];
  if (latest) target.push(['organization.taxOffice', latest.taxOffice], ['organization.taxNumber', latest.taxNumber]);
  for (const [key, value] of target) {
    if (readSetting<string>(deps, key) === value) continue;
    const written = writeSettingInternal(tx, deps, ctx, key, value, 'finance.notice');
    if (!written.ok) return written;
  }
  return ok(null);
}

/** Ein festgeschriebenes, nicht widerrufenes Dokument der Akte, das der Aufrufer lesen darf. */
async function readableDocument(deps: Deps, ctx: CallContext, documentId: string): Promise<Result<{ id: string }>> {
  const record = await getDocumentRecord(deps, ctx, documentId);
  if (!record.ok) return record;
  if (record.value.phase !== 'issued') return financeConflict('documentNotFinal');
  if (record.value.status === 'voided') return financeConflict('documentVoided');
  return ok({ id: record.value.id });
}

const saveNoticeSchema = z
  .object({
    id: z.string().min(1).optional(),
    kind: z.enum(NOTICE_KINDS),
    taxOffice: z.string().trim().min(1).max(200),
    taxNumber: z.string().trim().min(1).max(200),
    noticeDate: z.iso.date(),
    /** „2023“ oder „2021–2023“ — Pflicht beim endgültigen Bescheid, beim § 60a-Bescheid ohne Bedeutung. */
    assessmentPeriod: z.string().trim().min(1).max(20).nullable().optional(),
    purposesText: z.string().trim().min(1).max(2000),
    documentId: z.string().min(1).nullable().optional(),
  })
  .superRefine((v, c) => {
    if (v.kind !== 'section60a' && !v.assessmentPeriod) c.addIssue({ code: 'custom', path: ['assessmentPeriod'], message: 'assessmentPeriodRequired' });
  });

/**
 * Bescheid erfassen oder ändern — `finance.donationsIssue`. Ändern nur, solange
 * er weder ersetzt noch irrtümlich erfasst ist. Ein § 60a-Bescheid wird
 * abgelehnt, wenn schon ein endgültiger Bescheid bis zu seinem Datum vorliegt.
 * Das Dokument ist optional; wenn, dann festgeschrieben und lesbar.
 */
export async function saveNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<NoticeView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, saveNoticeSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = v.id ? deps.db.select().from(financeNotices).where(eq(financeNotices.id, v.id)).get() : undefined;
  if (v.id && !before) return notFound('financeNotice', v.id);
  if (before?.voidedAt) return financeConflict('noticeVoided');
  if (before?.supersededOn) return financeConflict('noticeSuperseded');

  if (v.kind === 'section60a') {
    const final = allNotices(deps.db).find((n) => n.id !== v.id && n.voidedAt === null && n.kind !== 'section60a' && n.noticeDate <= v.noticeDate);
    if (final) return financeConflict('noticeAfterExemption', { date: final.noticeDate });
  }

  const documentId = v.documentId ?? null;
  if (documentId && documentId !== before?.documentId) {
    const doc = await readableDocument(deps, ctx, documentId);
    if (!doc.ok) return doc;
  }

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const id = before?.id ?? newId();
    const fields = { kind: v.kind as NoticeKind, taxOffice: v.taxOffice, taxNumber: v.taxNumber, noticeDate: v.noticeDate, assessmentPeriod: v.kind === 'section60a' ? null : (v.assessmentPeriod ?? null), purposesText: v.purposesText, documentId, updatedAt: now };
    if (before) tx.update(financeNotices).set(fields).where(eq(financeNotices.id, id)).run();
    else tx.insert(financeNotices).values({ id, ...fields, createdAt: now, createdByUserId: ctx.userId ?? 'system' }).run();
    if (documentId) linkDocumentInternal(tx, deps, { documentId, entityType: 'financeNotice', entityId: id });

    const synced = syncCoreSettingsInternal(tx, deps, ctx);
    if (!synced.ok) return synced;
    const after = tx.select().from(financeNotices).where(eq(financeNotices.id, id)).get()!;
    financeAudit(tx, deps, ctx, { action: 'finance.notice.save', entity: 'financeNotice', id, before: before ? auditFields(before) : undefined, after: auditFields(after), summary: `Bescheid ${id} ${before ? 'geändert' : 'erfasst'}` });
    return ok(viewInternal(tx, id, today(deps)));
  });
}

const supersedeSchema = z.object({ id: z.string().min(1), supersededOn: z.iso.date(), documentId: z.string().min(1).nullable().optional() });

/** „Aufgehoben oder ersetzt am …“ — einmal; ab diesem Tag trägt der Bescheid nicht mehr. `finance.donationsIssue`. */
export async function supersedeNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<NoticeView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, supersedeSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = deps.db.select().from(financeNotices).where(eq(financeNotices.id, v.id)).get();
  if (!before) return notFound('financeNotice', v.id);
  if (before.voidedAt) return financeConflict('noticeVoided');
  if (before.supersededOn) return financeConflict('noticeSuperseded');
  if (v.supersededOn < before.noticeDate) return invalid([{ path: 'supersededOn', message: 'beforeNoticeDate' }]);

  const documentId = v.documentId ?? null;
  if (documentId) {
    const doc = await readableDocument(deps, ctx, documentId);
    if (!doc.ok) return doc;
  }

  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeNotices).set({ supersededOn: v.supersededOn, supersededDocumentId: documentId, updatedAt: isoNow(deps.clock) }).where(eq(financeNotices.id, v.id)).run();
    if (documentId) linkDocumentInternal(tx, deps, { documentId, entityType: 'financeNotice', entityId: v.id });
    const synced = syncCoreSettingsInternal(tx, deps, ctx);
    if (!synced.ok) return synced;
    financeAudit(tx, deps, ctx, { action: 'finance.notice.supersede', entity: 'financeNotice', id: v.id, after: { supersededOn: v.supersededOn, supersededDocumentId: documentId }, summary: `Bescheid ${v.id} aufgehoben oder ersetzt am ${v.supersededOn}` });
    return ok(viewInternal(tx, v.id, today(deps)));
  });
}

const voidSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(1000) });

/** „Irrtümlich erfasst“ — einmal; der Bescheid trug nie. Die Begründung steht am Datensatz, nie im Protokoll. `finance.donationsIssue`. */
export async function voidNotice(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<NoticeView>> {
  const denied = requirePermission(ctx, 'finance.donationsIssue');
  if (denied) return denied;
  const parsed = validate(deps, voidSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  const before = deps.db.select().from(financeNotices).where(eq(financeNotices.id, v.id)).get();
  if (!before) return notFound('financeNotice', v.id);
  if (before.voidedAt) return financeConflict('noticeVoided');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeNotices).set({ voidedAt: now, voidedByUserId: ctx.userId ?? 'system', voidNote: v.note, updatedAt: now }).where(eq(financeNotices.id, v.id)).run();
    const synced = syncCoreSettingsInternal(tx, deps, ctx);
    if (!synced.ok) return synced;
    financeAudit(tx, deps, ctx, { action: 'finance.notice.void', entity: 'financeNotice', id: v.id, after: { voided: true }, summary: `Bescheid ${v.id} als irrtümlich erfasst gekennzeichnet` });
    return ok(viewInternal(tx, v.id, today(deps)));
  });
}

const listSchema = z.object({ includeInactive: z.boolean().optional() });

/** Alle Bescheide, jüngste zuerst — ohne `includeInactive` nur die tragenden und künftigen. `finance.read`. */
export async function listNotices(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<NoticeView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const all = allNotices(deps.db);
  const sorted = [...all].sort((a, b) => b.noticeDate.localeCompare(a.noticeDate) || b.createdAt.localeCompare(a.createdAt));
  const views = toViews(deps.db, sorted, all, today(deps));
  return ok(parsed.value.includeInactive ? views : views.filter((n) => n.state === 'valid' || n.state === 'future'));
}
