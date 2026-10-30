import { enabledManifests, invalid, isoDay, isoDayIn, isoNow, newId, notFound, ok, paperDate, readSetting, requirePermission, todayIn, validate, versionOf, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { abortIssue, issueGeneratedDocument, voidDocumentInternal } from '@kompass/module-dms';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { maskIban } from '../format/iban';
import { requireFinanceRead } from '../ledger/access';
import { financeOpenItems } from '../schema';
import { openCentsInternal } from '../ledger/open-items';
import {
  DIRECT_DEBIT_RUN_STATUSES,
  financeAccounts,
  financeDirectDebitItems,
  financeDirectDebitRuns,
  financePledges,
  financeSepaMandates,
  type DirectDebitSource,
  type FinanceAccountRow,
  type FinanceDirectDebitItemRow,
  type FinanceDirectDebitRunRow,
  type FinancePledgeRow,
  type FinanceSepaMandateRow,
  type PledgeInterval,
} from '../schema';
import { addBusinessDays, addCalendarDays, addCalendarMonths, isTargetBusinessDay } from './business-days';
import { buildLastschriftCsv } from './csv';
import { creditorNameInternal } from './forms';
import { buildPain008, type Pain008Group } from './pain008';
import { RUN_SUMMARY_TEMPLATE_KEY, RUN_SUMMARY_TITLE, type RunSummaryInput } from './templates/run-summary';
import { DIRECT_DEBIT_PERMISSION, mandateRowInternal, mandateState, type MandateState } from './mandates';
import { marksOf } from './pledges';
import { coveringEntriesInternal } from './prenotifications';
import { pledgeRates } from './rates';
import { bookedItemLinesInternal, pledgeBookedLinesInternal, runStatusInternal } from './booking';
import { activeRunItemsInternal, expiredRunIdsInternal, OPEN_RUN_STATUSES, openItemReturnStateInternal, pledgeRunSourcesInternal, returnsByItemInternal, unreturnedRunItemsInternal } from './run-items';
import { sepaAccountInternal } from './settings';

// ── Fenster ─────────────────────────────────────────────────────────────────

/**
 * Die Fälligkeitstage, die ein heute angelegter Einzug haben kann (Spec § 7.1, § 7.4): frühestens `leadBusinessDays`
 * Bankarbeitstage nach heute — an einem Wochenende oder Feiertag zählt erst der nächste Bankarbeitstag als Tag der
 * Einreichung —, spätestens ein Jahr voraus; beide Enden sind Bankarbeitstage. Die Frist „frühestens `maxLeadDays`
 * vor Fälligkeit“ betrifft nicht das Anlegen, sondern die Einreichung: Sie steht im Einreichfenster des Einzugs
 * (`submitWindowInternal`).
 */
export function collectionWindow(deps: Deps, today: string): { earliest: string; latest: string } {
  const lead = readSetting<number>(deps, 'finance.sepa.leadBusinessDays');
  const submitted = isTargetBusinessDay(today) ? today : addBusinessDays(today, 1);
  let latest = addCalendarMonths(today, 12);
  while (!isTargetBusinessDay(latest)) latest = addCalendarDays(latest, -1);
  return { earliest: addBusinessDays(submitted, lead), latest };
}

export const directDebitWindowSchema = z.object({});

/** `finance.read`: heute und die wählbaren Fälligkeitstage eines neuen Einzugs. */
export async function getCollectionWindow(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ today: string; earliest: string; latest: string; days: string[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, directDebitWindowSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const today = todayIn(deps);
  const window = collectionWindow(deps, today);
  // Die wählbaren Fälligkeitstage: jeder Bankarbeitstag im Fenster (Handoff 2a § 1.2 — andere Tage sind nicht wählbar).
  const days: string[] = [];
  for (let day = window.earliest; day <= window.latest; day = addCalendarDays(day, 1)) if (isTargetBusinessDay(day)) days.push(day);
  return ok({ today, ...window, days });
}

/** Der letzte Tag, an dem der Einzug bei der Bank sein muss. */
export function submitByInternal(deps: Deps, collectionDate: string): string {
  return addBusinessDays(collectionDate, -readSetting<number>(deps, 'finance.sepa.leadBusinessDays'));
}

/** Der erste Tag, an dem die Bank die Datei annimmt: `maxLeadDays` Kalendertage vor Fälligkeit, auf den nächsten Bankarbeitstag. */
export function submitFromInternal(deps: Deps, collectionDate: string): string {
  const from = addCalendarDays(collectionDate, -readSetting<number>(deps, 'finance.sepa.maxLeadDays'));
  return isTargetBusinessDay(from) ? from : addBusinessDays(from, 1);
}

/**
 * Das Einreichfenster eines Einzugs (berechnet, nie gespeichert): frühestens `submitFrom` — liegt der Tag schon
 * zurück und ist das Fenster noch offen, heute —, spätestens `submitBy`.
 */
export function submitWindowInternal(deps: Deps, collectionDate: string, today: string): { submitFrom: string; submitBy: string } {
  const submitBy = submitByInternal(deps, collectionDate);
  const from = submitFromInternal(deps, collectionDate);
  return { submitFrom: from < today && today <= submitBy ? today : from, submitBy };
}

/**
 * Der früheste Fälligkeitstag, an dem alle Posten unter „Ankündigung zu spät“ gedeckt wären — mit einer heute
 * ausgestellten Ankündigung, die genau diesen Tag nennt (`noticeCoversFrom`, auf den nächsten Bankarbeitstag), und im
 * Fenster eines neuen Einzugs. Ist das der gewählte Tag selbst, genügt eine Ankündigung heute (F8). `null` ohne
 * verspätete Posten oder außerhalb des Fensters.
 */
export function earliestCoveredDay(preview: Pick<DirectDebitPreview, 'collectionDate' | 'noticeCoversFrom' | 'excluded'>, window: { earliest: string; latest: string }): string | null {
  const late = preview.excluded.find((g) => g.reason === 'noticeLate')?.items ?? [];
  if (late.length === 0) return null;
  let day = [preview.noticeCoversFrom, window.earliest, ...late.map((i) => i.coverOn)].sort().at(-1)!;
  if (!isTargetBusinessDay(day)) day = addBusinessDays(day, 1);
  return day >= preview.collectionDate && day <= window.latest ? day : null;
}

function checkCollectionDate(deps: Deps, collectionDate: string) {
  const window = collectionWindow(deps, todayIn(deps));
  if (!isTargetBusinessDay(collectionDate) || collectionDate < window.earliest || collectionDate > window.latest) return financeConflict('invalidCollectionDate', window);
  return null;
}

// ── Vorschau ────────────────────────────────────────────────────────────────

export const EXCLUSION_REASONS = ['inOtherRun', 'mandateInactive', 'noticeLate'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface DirectDebitPreviewItem {
  source: DirectDebitSource;
  /** Der offene Posten bzw. die Zusage. */
  sourceId: string;
  /** Nur bei einer Zusage: der Tag der Rate. */
  installmentOn: string | null;
  mandateId: string;
  mandateReference: string;
  mandateState: MandateState;
  contactId: string;
  debtorName: string;
  amountCents: number;
  dueOn: string;
  remittance: string;
  /** Der Tag, den eine Ankündigung nennen muss: der Fälligkeitstag des Einzugs (Plan N1 E1). */
  coverOn: string;
}

export interface DirectDebitPreview {
  collectionDate: string;
  accountId: string;
  /** Der früheste Fälligkeitstag, den eine heute ausgestellte Ankündigung deckt. */
  noticeCoversFrom: string;
  /** Das Einreichfenster für diesen Fälligkeitstag: frühester und spätester Tag der Einreichung bei der Bank. */
  submitFrom: string;
  submitBy: string;
  /** Der früheste Fälligkeitstag, an dem alle Posten unter „Ankündigung zu spät“ gedeckt wären (`earliestCoveredDay`). */
  noticeLateCoveredOn: string | null;
  /** M40: Raten von Zusagen per Lastschrift, mehr als 30 Tage vor dem Tag und nie eingezogen — Kompass zieht sie nicht mehr ein. */
  missedRates: { pledgeId: string; dueOn: string; amountCents: number; mandateReference: string }[];
  included: DirectDebitPreviewItem[];
  excluded: { reason: ExclusionReason; items: DirectDebitPreviewItem[] }[];
  totals: { count: number; sumCents: number };
}

const day = z.iso.date();
export const directDebitRunInputSchema = z.object({ collectionDate: day, accountId: z.string().min(1).optional() });
export const directDebitRunGetSchema = z.object({ id: z.string().min(1) });
export const directDebitRunItemSchema = z.object({ itemId: z.string().min(1) });
export const directDebitRunListSchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  status: z.enum(DIRECT_DEBIT_RUN_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

const pad = (n: number) => String(n).padStart(2, '0');

/** Raten, die mehr als so viele Tage vor dem Fälligkeitstag des Einzugs lagen, sind verpasst (L2 Nacharbeit 2). */
export const MISSED_RATE_DAYS = 30;

/** Verwendungszweck einer Rate: `Spende 2026-11`, `Spende 2026 Q4`, `Spende 2026 H2`, `Spende 2026` — wie die Beiträge. */
export function pledgeRemittance(interval: PledgeInterval, dueOn: string): string {
  const year = dueOn.slice(0, 4);
  const month = Number(dueOn.slice(5, 7));
  if (interval === 'monthly') return `Spende ${year}-${pad(month)}`;
  if (interval === 'quarterly') return `Spende ${year} Q${Math.floor((month - 1) / 3) + 1}`;
  if (interval === 'halfYearly') return `Spende ${year} H${month <= 6 ? 1 : 2}`;
  return `Spende ${year}`;
}

/** Das Konto des Einzugs: angegeben oder aus der Einstellung; muss ein aktives Bankkonto mit IBAN sein. */
function accountFor(deps: Deps, accountId: string | undefined): Result<FinanceAccountRow> {
  const account = accountId ? deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, accountId)).get() : sepaAccountInternal(deps);
  if (accountId && !account) return notFound('financeAccount', accountId);
  if (!account) return financeConflict('sepaNotReady');
  if (account.kind !== 'bank' || !account.isActive || !account.iban) return financeConflict('directDebitAccountUnusable', { account: account.name });
  return ok(account);
}

function requireSepaReady(deps: Deps) {
  if (!readSetting<boolean>(deps, 'finance.sepa.enabled') || !readSetting<string | null>(deps, 'finance.sepa.creditorId')) return financeConflict('sepaNotReady');
  return null;
}

/** Darf vom Mandat zum Tag eingezogen werden? Aktiv; ein einmaliges nur, solange es nicht schon eingezogen ist. */
function mandateCollectable(mandate: FinanceSepaMandateRow, collectionDate: string): boolean {
  if (mandateState(mandate, collectionDate) !== 'active') return false;
  return mandate.sequence !== 'oneOff' || mandate.lastCollectedOn === null;
}

/**
 * Die Vorschau ohne Rechteprüfung: fällige offene Posten der Module (Haken `directDebitSources`) und die Raten der
 * Zusagen mit Lastschrift bis zum Tag, je eingeordnet — schon in einem Einzug, Mandat nicht aktiv, Ankündigung zu spät
 * (in dieser Reihenfolge), sonst eingezogen.
 */
export function computePreviewInternal(db: DbOrTx, deps: Deps, collectionDate: string, account: FinanceAccountRow): DirectDebitPreview {
  const mandates = new Map<string, FinanceSepaMandateRow | null>();
  // Plan N1 (M41): Posten verfallener Einzüge sind frei für einen neuen.
  const expired = expiredRunIdsInternal(deps, db);
  const missedRates: DirectDebitPreview['missedRates'] = [];
  const mandateOf = (id: string) => {
    if (!mandates.has(id)) mandates.set(id, mandateRowInternal(db, id));
    return mandates.get(id)!;
  };
  // `coverOn`: der Tag, den die Ankündigung nennen muss — immer der Einzugstag, auch für überfällige Posten und nach
  // „erneut einziehen“ (Plan N1 E1): Die Ankündigung nennt dem Zahler den Tag der Belastung, nicht die Fälligkeit.
  const candidates: { item: DirectDebitPreviewItem; inRun: boolean }[] = [];
  const push = (base: Omit<DirectDebitPreviewItem, 'mandateReference' | 'mandateState' | 'contactId' | 'debtorName' | 'coverOn'>, inRun: boolean) => {
    const mandate = mandateOf(base.mandateId);
    if (!mandate) return;
    candidates.push({ item: { ...base, mandateReference: mandate.reference, mandateState: mandateState(mandate, collectionDate), contactId: mandate.contactId, debtorName: mandate.debtorName, coverOn: collectionDate }, inRun });
  };

  for (const manifest of enabledManifests(deps)) {
    for (const s of manifest.directDebitSources?.(deps, { until: collectionDate }) ?? []) {
      // Plan L3: Nach einer Rückgabe zieht Kompass nie von selbst erneut ein — erst „erneut einziehen“; „zur Überweisung“ nie mehr.
      const back = openItemReturnStateInternal(db, s.openItemId);
      if (back === 'open' || back === 'transfer') continue;
      const inRun = unreturnedRunItemsInternal(db, { source: 'openItem', sourceId: s.openItemId, excludeRunIds: expired }).length > 0;
      push({ source: 'openItem', sourceId: s.openItemId, installmentOn: null, mandateId: s.mandateId, amountCents: s.amountCents, dueOn: s.dueOn, remittance: s.remittance }, inRun);
    }
  }
  const pledges = db.select().from(financePledges).where(and(eq(financePledges.paymentMethod, 'directDebit'), lte(financePledges.firstDueOn, collectionDate))).orderBy(asc(financePledges.createdAt)).all();
  for (const pledge of pledges as FinancePledgeRow[]) {
    if (!pledge.mandateId) continue;
    // Kompass zieht nie rückwirkend ein: Raten vor dem Anlegen der Zusage oder mehr als 30 Tage vor dem Tag sind verpasst.
    const created = isoDayIn(deps, new Date(pledge.createdAt));
    const recent = addCalendarDays(collectionDate, -MISSED_RATE_DAYS);
    const from = [pledge.firstDueOn, created, recent].sort().at(-1)!;
    const sources = { marks: marksOf(db, pledge.id), ...pledgeRunSourcesInternal(db, pledge.id, expired), bookedLines: pledgeBookedLinesInternal(db, pledge.id) };
    // M40: was davor noch erwartet wäre, ist verpasst — eine Zeile in der Vorschau, damit es nicht still verschwindet.
    const since = [pledge.firstDueOn, created].sort().at(-1)!;
    if (since < recent) {
      const reference = mandateOf(pledge.mandateId)?.reference ?? '';
      for (const rate of pledgeRates(pledge, { from: since, to: addCalendarDays(recent, -1), ...sources, missedBefore: recent })) if (rate.state === 'missed') missedRates.push({ pledgeId: pledge.id, dueOn: rate.dueOn, amountCents: rate.amountCents, mandateReference: reference });
    }
    const rates = pledgeRates(pledge, { from, to: collectionDate, ...sources });
    for (const rate of rates) {
      const collectable = (rate.state === 'expected' && !rate.transfer) || rate.state === 'inRun' || (rate.state === 'returned' && rate.recollect);
      if (!collectable) continue;
      push({ source: 'pledge', sourceId: pledge.id, installmentOn: rate.dueOn, mandateId: pledge.mandateId, amountCents: rate.amountCents, dueOn: rate.dueOn, remittance: pledgeRemittance(pledge.interval, rate.dueOn) }, rate.state === 'inRun');
    }
  }

  const days = readSetting<number>(deps, 'finance.sepa.preNotificationDays');
  const groups: Record<ExclusionReason, DirectDebitPreviewItem[]> = { inOtherRun: [], mandateInactive: [], noticeLate: [] };
  const included: DirectDebitPreviewItem[] = [];
  const ordered = candidates.sort((a, b) => a.item.dueOn.localeCompare(b.item.dueOn) || a.item.mandateReference.localeCompare(b.item.mandateReference) || a.item.sourceId.localeCompare(b.item.sourceId));
  // Jede Planzeile einer Ankündigung deckt einen Posten (E1 b): Zuerst bekommen die jüngsten Posten ihre Zeile — der
  // pünktliche vor einem überfälligen mit gleichem Betrag, der nicht angekündigt war.
  const entries = new Map<string, { amountCents: number }[]>();
  const covered = new Set<DirectDebitPreviewItem>();
  for (const { item, inRun } of [...ordered].reverse()) {
    if (inRun || !mandateCollectable(mandateOf(item.mandateId)!, collectionDate)) continue;
    if (!entries.has(item.mandateId)) entries.set(item.mandateId, coveringEntriesInternal(deps, item.mandateId, collectionDate, days));
    const left = entries.get(item.mandateId)!;
    const at = left.findIndex((e) => e.amountCents === item.amountCents);
    if (at < 0) continue;
    left.splice(at, 1);
    covered.add(item);
  }
  for (const { item, inRun } of ordered) {
    if (inRun) groups.inOtherRun.push(item);
    else if (!mandateCollectable(mandateOf(item.mandateId)!, collectionDate)) groups.mandateInactive.push(item);
    else if (!covered.has(item)) groups.noticeLate.push(item);
    else included.push(item);
  }
  const today = todayIn(deps);
  const noticeCoversFrom = addCalendarDays(today, days);
  const excluded = EXCLUSION_REASONS.filter((r) => groups[r].length > 0).map((reason) => ({ reason, items: groups[reason] }));
  return {
    collectionDate,
    accountId: account.id,
    noticeCoversFrom,
    ...submitWindowInternal(deps, collectionDate, today),
    noticeLateCoveredOn: earliestCoveredDay({ collectionDate, noticeCoversFrom, excluded }, collectionWindow(deps, today)),
    missedRates: missedRates.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.pledgeId.localeCompare(b.pledgeId)),
    included,
    excluded,
    totals: { count: included.length, sumCents: included.reduce((sum, i) => sum + i.amountCents, 0) },
  };
}

/** `finance.read`: was zum Tag eingezogen würde und was nicht, mit Grund (Spec § 7.4 Schritt 1, Handoff 1.2). */
export async function previewDirectDebitRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitPreview>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, directDebitRunInputSchema, input);
  if (!parsed.ok) return parsed;
  const setup = requireSepaReady(deps);
  if (setup) return setup;
  const wrongDay = checkCollectionDate(deps, parsed.value.collectionDate);
  if (wrongDay) return wrongDay;
  const account = accountFor(deps, parsed.value.accountId);
  if (!account.ok) return account;
  return ok(computePreviewInternal(deps.db, deps, parsed.value.collectionDate, account.value));
}

// ── Ansicht ─────────────────────────────────────────────────────────────────

export interface DirectDebitRunItemView {
  id: string;
  source: DirectDebitSource;
  sourceId: string;
  installmentOn: string | null;
  mandateId: string;
  mandateReference: string;
  contactId: string;
  debtorName: string;
  amountCents: number;
  endToEndId: string;
  remittance: string;
  /** Trägt der Posten den Änderungshinweis des Mandats? */
  amended: boolean;
  removedAt: string | null;
  /** Bei einem offenen Posten seine Herkunft (Beitrag): Beschriftung und Link über `recordLabels` des Moduls. */
  origin: { type: string; id: string } | null;
  /** Die Rückgabe des Postens, falls er zurückkam. */
  returnId: string | null;
  returnStatus: 'open' | 'resolved' | null;
  /**
   * Plan N2 Task 2 (R2): Der Posten ist inzwischen anders bezahlt (etwa per Überweisung), aber der Einzug ist eingereicht
   * und seine Gutschrift nicht gebucht — die Bank zieht trotzdem ein. Rückgabe bei der Bank veranlassen oder erstatten.
   */
  paidOtherwise: boolean;
}

export interface DirectDebitRunSummary {
  id: string;
  collectionDate: string;
  accountId: string;
  status: FinanceDirectDebitRunRow['status'];
  messageId: string;
  fileName: string | null;
  fileCreatedAt: string | null;
  submittedOn: string | null;
  cancelledAt: string | null;
  summaryDocumentId: string | null;
  createdAt: string;
  /** Wer die Datei erzeugt und wer die Einreichung vermerkt hat (Nutzer-IDs; Namen löst die Oberfläche auf). */
  fileCreatedByUserId: string | null;
  submittedByUserId: string | null;
  /** Das Einreichfenster: frühester (ab heute) und spätester Tag der Einreichung bei der Bank. */
  submitFrom: string;
  submitBy: string;
  /** Posten ohne herausgenommene; Summe berechnet. */
  count: number;
  sumCents: number;
  /** Rückgaben zu Posten des Einzugs, davon noch zu klären (Handoff 2a § 1.1: „Rückgabe zu klären“ statt „gebucht“). */
  returns: number;
  openReturns: number;
  /** Posten, die schon anders bezahlt sind, während der Einzug eingereicht ist (`DirectDebitRunItemView.paidOtherwise`). */
  paidOtherwise: number;
}

export interface DirectDebitRunView extends DirectDebitRunSummary {
  items: DirectDebitRunItemView[];
}

/** Entität der Akte für den Begleitzettel am Einzug. */
export const DIRECT_DEBIT_RUN_ENTITY = 'financeDirectDebitRun';

export function runRowInternal(db: DbOrTx, runId: string): FinanceDirectDebitRunRow | null {
  return db.select().from(financeDirectDebitRuns).where(eq(financeDirectDebitRuns.id, runId)).get() ?? null;
}

export function runItemsInternal(db: DbOrTx, runId: string): FinanceDirectDebitItemRow[] {
  return db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.runId, runId)).orderBy(asc(financeDirectDebitItems.createdAt), asc(financeDirectDebitItems.endToEndId)).all();
}

/**
 * Plan N2 Task 2 (R2): Posten eines eingereichten Einzugs, deren offener Posten schon anders ausgeglichen ist — nicht
 * herausgenommen, nicht zurückgegeben, ohne gebuchte Gutschrift. Berechnet, nie gespeichert.
 */
export function paidOtherwiseItemIdsInternal(db: DbOrTx, row: Pick<FinanceDirectDebitRunRow, 'status'>, items: readonly FinanceDirectDebitItemRow[]): Set<string> {
  if (row.status !== 'submitted') return new Set();
  const live = items.filter((i) => i.removedAt === null && i.source === 'openItem');
  if (live.length === 0) return new Set();
  const returns = returnsByItemInternal(db, live.map((i) => i.id));
  const credited = new Set(bookedItemLinesInternal(db, live.map((i) => i.id)).map((l) => l.itemId));
  return new Set(live.filter((i) => !returns.has(i.id) && !credited.has(i.id) && openCentsInternal(db, i.sourceId) <= 0).map((i) => i.id));
}

function summaryOf(deps: Deps, db: DbOrTx, row: FinanceDirectDebitRunRow, items: FinanceDirectDebitItemRow[]): DirectDebitRunSummary {
  const live = items.filter((i) => i.removedAt === null);
  const returns = [...returnsByItemInternal(db, items.map((i) => i.id)).values()];
  return {
    id: row.id,
    collectionDate: row.collectionDate,
    accountId: row.accountId,
    status: runStatusOnInternal(deps, db, row),
    messageId: row.messageId,
    fileName: row.fileName,
    fileCreatedAt: row.fileCreatedAt,
    submittedOn: row.submittedOn,
    cancelledAt: row.cancelledAt,
    summaryDocumentId: row.summaryDocumentId,
    createdAt: row.createdAt,
    fileCreatedByUserId: row.fileCreatedByUserId,
    submittedByUserId: row.submittedByUserId,
    ...submitWindowInternal(deps, row.collectionDate, todayIn(deps)),
    count: live.length,
    sumCents: live.reduce((sum, i) => sum + i.amountCents, 0),
    returns: returns.length,
    openReturns: returns.filter((r) => r.status === 'open').length,
    paidOtherwise: paidOtherwiseItemIdsInternal(db, row, items).size,
  };
}

/** Der Zustand zur Anzeige: `booked` (berechnet aus den Buchungen) und `expired` (M41: nie eingereicht, Fenster vorbei). */
export function runStatusOnInternal(deps: Deps, db: DbOrTx, row: FinanceDirectDebitRunRow): FinanceDirectDebitRunRow['status'] {
  if ((row.status === 'draft' || row.status === 'fileCreated') && submitByInternal(deps, row.collectionDate) < todayIn(deps)) return 'expired';
  return runStatusInternal(db, row);
}

export function runViewInternal(db: DbOrTx, deps: Deps, row: FinanceDirectDebitRunRow): DirectDebitRunView {
  const items = runItemsInternal(db, row.id);
  const mandates = new Map(db.select().from(financeSepaMandates).all().filter((m) => items.some((i) => i.mandateId === m.id)).map((m) => [m.id, m]));
  const returns = returnsByItemInternal(db, items.map((i) => i.id));
  const paidOtherwise = paidOtherwiseItemIdsInternal(db, row, items);
  const originOf = (i: FinanceDirectDebitItemRow) => {
    if (i.source !== 'openItem') return null;
    const item = db.select({ originType: financeOpenItems.originType, originId: financeOpenItems.originId }).from(financeOpenItems).where(eq(financeOpenItems.id, i.sourceId)).get();
    return item?.originType && item.originId ? { type: item.originType, id: item.originId } : null;
  };
  return {
    ...summaryOf(deps, db, row, items),
    items: items.map((i) => {
      const mandate = mandates.get(i.mandateId)!;
      const back = returns.get(i.id);
      return {
        id: i.id,
        source: i.source,
        sourceId: i.sourceId,
        installmentOn: i.installmentOn,
        mandateId: i.mandateId,
        mandateReference: mandate.reference,
        contactId: mandate.contactId,
        debtorName: mandate.debtorName,
        amountCents: i.amountCents,
        endToEndId: i.endToEndId,
        remittance: i.remittance,
        amended: i.amendment !== null,
        removedAt: i.removedAt,
        origin: originOf(i),
        returnId: back?.id ?? null,
        returnStatus: back?.status ?? null,
        paidOtherwise: paidOtherwise.has(i.id),
      };
    }),
  };
}

// ── Anlegen ─────────────────────────────────────────────────────────────────

/**
 * Einzug anlegen (humanOnly, `finance.directDebit`; Spec § 7.4 Schritt 2): hält fest, was die Vorschau einziehen würde
 * — nur das. `MsgId` ist die ID des Einzugs, je Posten eine `EndToEndId` aus ihr und der laufenden Nummer (beide
 * höchstens 35 Zeichen, nur Buchstaben, Ziffern, Bindestrich). Der erste Posten je Mandat übernimmt dessen offenen
 * Änderungshinweis. Protokoll: Tag, Zahl, Summe.
 */
/** M32: Hinweise beim Anlegen — ein anderer Einzug im Entwurf für denselben Tag und dasselbe Konto. */
export type DirectDebitRunHint = { code: 'runSameDayDraft'; runId: string };

export async function createDirectDebitRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView & { hints: DirectDebitRunHint[] }>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, directDebitRunInputSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const setup = requireSepaReady(deps);
  if (setup) return setup;
  const wrongDay = checkCollectionDate(deps, v.collectionDate);
  if (wrongDay) return wrongDay;
  const account = accountFor(deps, v.accountId);
  if (!account.ok) return account;
  return deps.db.transaction((tx: DbOrTx) => {
    const preview = computePreviewInternal(tx, deps, v.collectionDate, account.value);
    if (preview.included.length === 0) return financeConflict('nothingToCollect', { date: v.collectionDate });
    const now = isoNow(deps.clock);
    const runId = newId();
    tx.insert(financeDirectDebitRuns)
      .values({ id: runId, collectionDate: v.collectionDate, accountId: account.value.id, status: 'draft', messageId: runId, createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now })
      .run();
    const amended = new Set<string>();
    preview.included.forEach((item, index) => {
      const mandate = mandateRowInternal(tx, item.mandateId)!;
      const amendment = mandate.pendingAmendment && !amended.has(mandate.id) ? mandate.pendingAmendment : null;
      amended.add(mandate.id);
      tx.insert(financeDirectDebitItems)
        .values({ id: newId(), runId, mandateId: item.mandateId, source: item.source, sourceId: item.sourceId, installmentOn: item.installmentOn, amountCents: item.amountCents, endToEndId: `${runId}-${index + 1}`, remittance: item.remittance, amendment, createdAt: now })
        .run();
    });
    const { count, sumCents } = preview.totals;
    financeAudit(tx, deps, ctx, { action: 'finance.directDebit.create', entity: 'financeDirectDebitRun', id: runId, after: { collectionDate: v.collectionDate, accountId: account.value.id, status: 'draft', count, sumCents }, params: { collectionOn: v.collectionDate, count, sumCents } });
    const sameDay = tx
      .select({ id: financeDirectDebitRuns.id, status: financeDirectDebitRuns.status })
      .from(financeDirectDebitRuns)
      .where(and(eq(financeDirectDebitRuns.collectionDate, v.collectionDate), eq(financeDirectDebitRuns.accountId, account.value.id)))
      .orderBy(asc(financeDirectDebitRuns.createdAt))
      .all()
      .filter((r) => r.id !== runId && (r.status === 'draft' || r.status === 'fileCreated'));
    const hints: DirectDebitRunHint[] = sameDay.map((r) => ({ code: 'runSameDayDraft', runId: r.id }));
    return ok({ ...runViewInternal(tx, deps, runRowInternal(tx, runId)!), hints });
  });
}

/** Der Konflikt, wenn ein Einzug nicht mehr im Entwurf ist: eingereicht bzw. gebucht, oder storniert. */
export function runLockedConflict(row: FinanceDirectDebitRunRow) {
  if (row.status === 'cancelled') return financeConflict('runCancelled');
  return financeConflict('runSubmitted');
}

/**
 * Einen Posten aus dem Einzug nehmen (`finance.directDebit`; Ausweg, wenn ein Mandat inzwischen beendet ist): nur vor
 * der Einreichung. Der Posten bleibt als Zeile mit Zeitpunkt und erscheint in der nächsten Vorschau wieder.
 */
export async function removeRunItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const parsed = validate(deps, directDebitRunItemSchema, input);
  if (!parsed.ok) return parsed;
  const item = deps.db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.id, parsed.value.itemId)).get();
  if (!item) return notFound('financeDirectDebitItem', parsed.value.itemId);
  const run = runRowInternal(deps.db, item.runId)!;
  if (run.status !== 'draft' && run.status !== 'fileCreated') return runLockedConflict(run);
  if (item.removedAt) return financeConflict('runItemRemoved');
  const result = deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeDirectDebitItems).set({ removedAt: now, removedByUserId: ctx.userId ?? 'system' }).where(eq(financeDirectDebitItems.id, item.id)).run();
    // Nach der Datei passt sie nicht mehr zu den Posten: zurück in den Entwurf, die Datei entsteht neu.
    const reset = run.status === 'fileCreated' ? { status: 'draft' as const, fileName: null, fileCreatedAt: null, fileCreatedByUserId: null, fileMandates: null, summaryDocumentId: null } : {};
    if (run.status === 'fileCreated') voidSummaryInternal(tx, deps, ctx, run, SUMMARY_VOID_CHANGED);
    tx.update(financeDirectDebitRuns).set({ ...reset, updatedAt: now }).where(eq(financeDirectDebitRuns.id, run.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.directDebit.removeItem', entity: 'financeDirectDebitRun', id: run.id, after: { itemId: item.id, status: run.status === 'fileCreated' ? 'draft' : run.status }, params: { collectionOn: run.collectionDate } });
    return ok(runViewInternal(tx, deps, runRowInternal(tx, run.id)!));
  });
  if (run.status === 'fileCreated') await deleteRunFilesInternal(deps, run.fileName);
  return result;
}

// ── Lesen ───────────────────────────────────────────────────────────────────

/** `finance.read`: ein Einzug mit seinen Posten (Zahler als Kontoinhaber des Mandats, keine IBAN). */
export async function getDirectDebitRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, directDebitRunGetSchema, input);
  if (!parsed.ok) return parsed;
  const row = runRowInternal(deps.db, parsed.value.id);
  if (!row) return notFound('financeDirectDebitRun', parsed.value.id);
  return ok(runViewInternal(deps.db, deps, row));
}

/** `finance.read`: Einzüge nach Jahr des Fälligkeitstags und Zustand, neueste zuerst; dazu die Jahre mit Einzügen (Rahmen der Liste). */
export async function listDirectDebitRuns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: DirectDebitRunSummary[]; total: number; years: number[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, directDebitRunListSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const rows = deps.db
    .select()
    .from(financeDirectDebitRuns)
    .where(
      and(
        v.year ? gte(financeDirectDebitRuns.collectionDate, `${v.year}-01-01`) : undefined,
        v.year ? lte(financeDirectDebitRuns.collectionDate, `${v.year}-12-31`) : undefined,
        // „Gebucht“ ist berechnet, gespeichert steht `submitted` (L3 Nacharbeit).
        // „verfallen“ ist berechnet aus Entwurf oder Datei erzeugt (M41).
        v.status && v.status !== 'expired' ? eq(financeDirectDebitRuns.status, v.status === 'booked' ? 'submitted' : v.status) : undefined,
      ),
    )
    .orderBy(desc(financeDirectDebitRuns.collectionDate), desc(financeDirectDebitRuns.createdAt))
    .all()
    .filter((r) => !v.status || runStatusOnInternal(deps, deps.db, r) === v.status);
  const years = [...new Set(deps.db.select({ day: financeDirectDebitRuns.collectionDate }).from(financeDirectDebitRuns).all().map((r) => Number(r.day.slice(0, 4))))].sort((a, b) => b - a);
  return ok({ items: rows.slice(v.offset, v.offset + v.limit).map((r) => summaryOf(deps, deps.db, r, runItemsInternal(deps.db, r.id))), total: rows.length, years });
}

// ── Datei ───────────────────────────────────────────────────────────────────

export const DIRECT_DEBIT_FILE_KINDS = ['xml', 'csv'] as const;
export const directDebitFileSchema = z.object({ runId: z.string().min(1) });
export const directDebitFileStreamSchema = z.object({ runId: z.string().min(1), kind: z.enum(DIRECT_DEBIT_FILE_KINDS) });

/**
 * Schlüssel im Dateispeicher der Finanzen — flach, weil der Speicher keine Unterordner kennt. N2: je Anlauf ein eigener
 * Name (`attempt`), damit ein verlorener Anlauf in einem zweiten Tab nur seine eigenen Dateien löscht; ohne `attempt`
 * der Name aus der Zeit davor.
 */
export const runFileKey = (runId: string, kind: (typeof DIRECT_DEBIT_FILE_KINDS)[number], attempt?: string) => `direct-debit-${runId.toLowerCase()}${attempt ? `-${attempt.toLowerCase()}` : ''}.${kind}`;

/** Der Schlüssel einer Art zu dem, den der Einzug als `fileName` trägt (immer der der XML). */
const runFileKeyOf = (fileName: string, kind: (typeof DIRECT_DEBIT_FILE_KINDS)[number]) => fileName.replace(/\.xml$/, `.${kind}`);

/** Gründe am stornierten Begleitzettel (stehen am Dokument, nicht im Protokoll). Deutsch wie die Vorlage. */
const SUMMARY_VOID_DISCARDED = 'Einzug verworfen';
const SUMMARY_VOID_CHANGED = 'Einzug geändert';

/**
 * Der Begleitzettel passt nicht mehr zum Einzug (verworfen, oder ein Posten nach der Datei herausgenommen): in der Akte
 * stornieren (L2 Nacharbeit 1). Wirft bei einem unerwarteten Zustand — dann rollt die Transaktion zurück.
 */
function voidSummaryInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, run: FinanceDirectDebitRunRow, reason: string): void {
  if (!run.summaryDocumentId) return;
  const voided = voidDocumentInternal(tx, deps, ctx, { id: run.summaryDocumentId, reason });
  if (!voided.ok && !(voided.error.type === 'conflict' && voided.error.code === 'documentAlreadyVoided')) throw new Error(`summary ${run.summaryDocumentId} of run ${run.id} not voided: ${JSON.stringify(voided.error)}`);
}

async function deleteRunFilesInternal(deps: Deps, fileName: string | null): Promise<void> {
  if (!fileName) return;
  for (const kind of DIRECT_DEBIT_FILE_KINDS) await deps.files('finance').delete(runFileKeyOf(fileName, kind));
}

/** Prüft die Posten vor der Datei erneut: Mandat noch aktiv, offener Posten noch so offen wie angelegt (Review Focus 3). */
/** M15: der Stand eines Mandats, wie ihn die Datei trägt — Prüfsumme, keine IBAN im Klartext am Einzug. */
const mandateVersion = (m: FinanceSepaMandateRow) => versionOf({ iban: m.iban, bic: m.bic, debtorName: m.debtorName, amendment: m.pendingAmendment ?? null });

/**
 * M15: Hat sich ein Mandat des Einzugs geändert, nachdem die Datei erzeugt wurde (neue IBAN, Name, BIC), trägt die
 * Datei die alten Angaben — sie ist veraltet und muss neu erzeugt werden. `null`, wenn sie noch passt.
 */
function outdatedFileInternal(db: DbOrTx, run: FinanceDirectDebitRunRow): { reference: string } | null {
  if (run.status !== 'fileCreated' || !run.fileMandates) return null;
  for (const [mandateId, version] of Object.entries(run.fileMandates)) {
    const mandate = mandateRowInternal(db, mandateId);
    if (mandate && mandateVersion(mandate) !== version) return { reference: mandate.reference };
  }
  return null;
}

function checkItemsInternal(db: DbOrTx, run: FinanceDirectDebitRunRow, items: FinanceDirectDebitItemRow[]) {
  for (const item of items) {
    const mandate = mandateRowInternal(db, item.mandateId)!;
    if (mandateState(mandate, run.collectionDate) === 'ended') return financeConflict('mandateEndedInRun', { reference: mandate.reference, date: mandate.endedOn! });
    if (!mandateCollectable(mandate, run.collectionDate)) return financeConflict('mandateInactiveInRun', { reference: mandate.reference });
    if (item.source === 'openItem') {
      const open = db.select({ cancelledAt: financeOpenItems.cancelledAt }).from(financeOpenItems).where(eq(financeOpenItems.id, item.sourceId)).get();
      if (!open || open.cancelledAt !== null || openCentsInternal(db, item.sourceId) < item.amountCents) return financeConflict('runItemChanged', { reference: mandate.reference });
    }
  }
  return null;
}

/**
 * M1: Vor „eingereicht“ die Posten noch einmal prüfen wie vor der Datei — und dazu, ob ein Posten inzwischen in einem
 * anderen, nicht verfallenen Einzug steckt (ein verfallener Einzug gibt seine Posten frei, ein neuer kann sie tragen;
 * ebenso ein Posten mit Rückgabe, der nach „erneut einziehen“ in einem neuen Einzug steckt).
 * Jede Änderung seit der Datei heißt `runItemsChanged`: Der Einzug ist dann nicht mehr der, den die Datei beschreibt.
 */
function itemsChangedSinceFileInternal(deps: Deps, db: DbOrTx, run: FinanceDirectDebitRunRow, items: FinanceDirectDebitItemRow[]) {
  const expired = expiredRunIdsInternal(deps, db);
  for (const item of items) {
    const elsewhere = unreturnedRunItemsInternal(db, { source: item.source, sourceId: item.sourceId, statuses: OPEN_RUN_STATUSES, excludeRunIds: expired }).some(
      (r) => r.item.runId !== run.id && (item.source !== 'pledge' || r.item.installmentOn === item.installmentOn),
    );
    if (elsewhere || checkItemsInternal(db, run, [item])) return financeConflict('runItemsChanged', { reference: mandateRowInternal(db, item.mandateId)!.reference });
  }
  return null;
}

/**
 * Die Datei erzeugen (humanOnly, `finance.directDebit`; Spec § 7.4 Schritt 3): nur im Entwurf und solange der Tag
 * noch im Fenster liegt. Prüft die Mandate erneut, schreibt pain.008 und die CSV in den Dateispeicher der Finanzen,
 * stellt den Begleitzettel in der Akte aus (Art `sepa-run-summary`, am Einzug) und setzt „Datei erzeugt“. Protokoll:
 * Tag und Zahl.
 */
export async function buildDirectDebitFile(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, directDebitFileSchema, input);
  if (!parsed.ok) return parsed;
  const run = runRowInternal(deps.db, parsed.value.runId);
  if (!run) return notFound('financeDirectDebitRun', parsed.value.runId);
  // M15: Eine veraltete Datei entsteht neu; eine passende nicht zweimal.
  const outdated = outdatedFileInternal(deps.db, run);
  if (run.status === 'fileCreated' && !outdated) return financeConflict('runFileCreated');
  if (run.status !== 'draft' && !outdated) return runLockedConflict(run);
  const setup = requireSepaReady(deps);
  if (setup) return setup;
  const wrongDay = checkCollectionDate(deps, run.collectionDate);
  if (wrongDay) return wrongDay;
  const account = accountFor(deps, run.accountId);
  if (!account.ok) return account;
  const items = runItemsInternal(deps.db, run.id).filter((i) => i.removedAt === null);
  if (items.length === 0) return financeConflict('nothingToCollect', { date: run.collectionDate });
  const changed = checkItemsInternal(deps.db, run, items);
  if (changed) return changed;
  if (outdated) {
    // Zurück in den Entwurf: der alte Begleitzettel storniert, der Änderungshinweis je Mandat neu vom ersten Posten getragen.
    deps.db.transaction((tx: DbOrTx) => {
      voidSummaryInternal(tx, deps, ctx, run, SUMMARY_VOID_CHANGED);
      const seen = new Set<string>();
      for (const item of items) {
        const mandate = mandateRowInternal(tx, item.mandateId)!;
        const amendment = !seen.has(mandate.id) ? (mandate.pendingAmendment ?? null) : null;
        seen.add(mandate.id);
        tx.update(financeDirectDebitItems).set({ amendment }).where(eq(financeDirectDebitItems.id, item.id)).run();
      }
      tx.update(financeDirectDebitRuns).set({ status: 'draft', fileName: null, fileCreatedAt: null, fileCreatedByUserId: null, fileMandates: null, summaryDocumentId: null, updatedAt: isoNow(deps.clock) }).where(eq(financeDirectDebitRuns.id, run.id)).run();
    });
    items.splice(0, items.length, ...runItemsInternal(deps.db, run.id).filter((i) => i.removedAt === null));
  }

  const creditorId = readSetting<string>(deps, 'finance.sepa.creditorId');
  const creditorName = creditorNameInternal(deps);
  const rows = items.map((item) => ({ item, mandate: mandateRowInternal(deps.db, item.mandateId)! }));
  const groups: Pain008Group[] = (['recurring', 'oneOff'] as const).flatMap((sequence) => {
    const of = rows.filter((r) => r.mandate.sequence === sequence);
    return of.length === 0
      ? []
      : [{ collectionDate: run.collectionDate, sequence, items: of.map(({ item, mandate }) => ({ endToEndId: item.endToEndId, amountCents: item.amountCents, mandateReference: mandate.reference, signedOn: mandate.signedOn!, amendment: item.amendment, debtorName: mandate.debtorName, debtorIban: mandate.iban, debtorBic: mandate.bic, remittance: item.remittance })) }];
  });
  const now = isoNow(deps.clock);
  const xml = buildPain008({ messageId: run.messageId, createdAt: now, initiatingParty: creditorName, creditor: { name: creditorName, iban: account.value.iban!, creditorId }, batchBooking: readSetting<boolean>(deps, 'finance.sepa.batchBooking'), groups });
  const csv = buildLastschriftCsv(rows.map(({ item, mandate }) => ({ creditorIban: account.value.iban!, creditorId, debtorName: mandate.debtorName, debtorIban: mandate.iban, debtorBic: mandate.bic, amountCents: item.amountCents, remittance: item.remittance, mandateReference: mandate.reference, signedOn: mandate.signedOn!, sequence: mandate.sequence })));

  const store = deps.files('finance');
  // N2: Dateien dieses Anlaufs unter eigenem Namen — ein zweiter Tab überschreibt sie nicht und löscht nur seine.
  const fileName = runFileKey(run.id, 'xml', newId());
  await store.write(fileName, new TextEncoder().encode(xml));
  await store.write(runFileKeyOf(fileName, 'csv'), csv);

  const count = items.length;
  const sumCents = items.reduce((total, i) => total + i.amountCents, 0);
  const summary: RunSummaryInput = {
    collectionDate: run.collectionDate,
    accountName: account.value.name,
    accountIban: maskIban(account.value.iban!),
    creditorId,
    messageId: run.messageId,
    count,
    sumCents,
    items: rows.map(({ item, mandate }) => ({ reference: mandate.reference, amountCents: item.amountCents })),
  };
  const issued = await issueGeneratedDocument(deps, ctx, {
    templateKey: RUN_SUMMARY_TEMPLATE_KEY,
    input: summary,
    subject: `${RUN_SUMMARY_TITLE} ${paperDate(isoDay(run.collectionDate))}`,
    documentDate: todayIn(deps),
    links: [{ entityType: DIRECT_DEBIT_RUN_ENTITY, entityId: run.id }],
    afterIssue: (tx: DbOrTx, doc) => {
      const current = runRowInternal(tx, run.id)!;
      if (current.status !== 'draft') abortIssue(current.status === 'fileCreated' ? financeConflict('runFileCreated') : runLockedConflict(current));
      tx.update(financeDirectDebitRuns)
        .set({ status: 'fileCreated', fileName, fileCreatedAt: now, fileCreatedByUserId: ctx.userId ?? 'system', fileMandates: Object.fromEntries(rows.map(({ mandate }) => [mandate.id, mandateVersion(mandate)])), summaryDocumentId: doc.id, updatedAt: now })
        .where(eq(financeDirectDebitRuns.id, run.id))
        .run();
      financeAudit(tx, deps, ctx, { action: 'finance.directDebit.file', entity: 'financeDirectDebitRun', id: run.id, after: { collectionDate: run.collectionDate, status: 'fileCreated', count, sumCents, summaryDocumentId: doc.id }, params: { collectionOn: run.collectionDate, count } });
      return null;
    },
  });
  if (!issued.ok) {
    await deleteRunFilesInternal(deps, fileName);
    return issued;
  }
  // Eine veraltete Datei (M15) ist ersetzt: ihre Dateien gehen.
  if (run.fileName && run.fileName !== fileName) await deleteRunFilesInternal(deps, run.fileName);
  return ok(runViewInternal(deps.db, deps, runRowInternal(deps.db, run.id)!));
}

const MIME: Record<(typeof DIRECT_DEBIT_FILE_KINDS)[number], string> = { xml: 'application/xml', csv: 'text/csv' };

/**
 * Die Datei für die Bank (`finance.directDebit`), nur für den Route Handler der Oberfläche: Sie enthält die IBAN jedes
 * Zahlers und gehört nie in den Modellkontext — über MCP abgelehnt (`fileNotForAgents`), und es gibt kein Werkzeug.
 */
export async function directDebitFileStream(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; fileName: string; mimeType: string }>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  if (ctx.channel === 'mcp') return financeConflict('fileNotForAgents');
  const parsed = validate(deps, directDebitFileStreamSchema, input);
  if (!parsed.ok) return parsed;
  const run = runRowInternal(deps.db, parsed.value.runId);
  if (!run) return notFound('financeDirectDebitRun', parsed.value.runId);
  const key = run.fileName ? runFileKeyOf(run.fileName, parsed.value.kind) : null;
  if (!key || run.status === 'cancelled' || !(await deps.files('finance').exists(key))) return financeConflict('runFileMissing');
  const bytes = new Uint8Array(await deps.files('finance').read(key));
  return ok({ bytes, fileName: `Lastschrift-${run.collectionDate}.${parsed.value.kind}`, mimeType: MIME[parsed.value.kind] });
}

// ── Eingereicht, zurücksetzen, stornieren ───────────────────────────────────

export const directDebitSubmitSchema = z.object({ runId: z.string().min(1), submittedOn: day });
export const directDebitRunIdSchema = z.object({ runId: z.string().min(1) });

const sameAmendment = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Je Mandat des Einzugs der Posten, der den Änderungshinweis trägt (der erste je Mandat), sonst `null`. */
function amendmentsByMandate(items: FinanceDirectDebitItemRow[]): Map<string, FinanceDirectDebitItemRow['amendment']> {
  const out = new Map<string, FinanceDirectDebitItemRow['amendment']>();
  for (const item of items) if (!out.has(item.mandateId) || (out.get(item.mandateId) === null && item.amendment !== null)) out.set(item.mandateId, item.amendment);
  return out;
}

async function runForStep(deps: Deps, ctx: CallContext, schema: z.ZodType<{ runId: string }>, input: unknown) {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, schema, input);
  if (!parsed.ok) return parsed;
  const run = runRowInternal(deps.db, parsed.value.runId);
  if (!run) return notFound('financeDirectDebitRun', parsed.value.runId);
  return ok({ run, value: parsed.value });
}

/**
 * Als eingereicht markieren (humanOnly; Spec § 7.4 Schritt 4): Der Mensch hat die Datei bei der Bank hochgeladen und
 * freigegeben. Nur nach der Datei und nur im Einreichfenster (`submitTooEarly`, `submitTooLate`). Je Mandat zählt der Einzug als letzter (verlängert die 36 Monate), und ein
 * Änderungshinweis, den der Einzug trägt, ist quittiert. Ab hier werden die Beiträge nicht mehr neu berechnet. Hat sich
 * seit der Datei ein Posten geändert (anderer Einzug, storniert, Mandat beendet), abgelehnt: `runItemsChanged` (M1).
 */
export async function markDirectDebitRunSubmitted(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const found = await runForStep(deps, ctx, directDebitSubmitSchema, input);
  if (!found.ok) return found;
  const { run, value } = found.value as { run: FinanceDirectDebitRunRow; value: z.infer<typeof directDebitSubmitSchema> };
  if (value.submittedOn > todayIn(deps)) return invalid([{ path: 'submittedOn', message: 'inFuture' }]);
  if (run.status === 'draft') return financeConflict('runFileMissing');
  if (run.status !== 'fileCreated') return runLockedConflict(run);
  const outdated = outdatedFileInternal(deps.db, run);
  if (outdated) return financeConflict('runFileOutdated', outdated);
  // Das Einreichfenster der Bank: frühestens `maxLeadDays` vor, spätestens `leadBusinessDays` Bankarbeitstage vor Fälligkeit.
  const submitFrom = submitFromInternal(deps, run.collectionDate);
  if (value.submittedOn < submitFrom) return financeConflict('submitTooEarly', { date: submitFrom, collectionOn: run.collectionDate });
  const submitBy = submitByInternal(deps, run.collectionDate);
  if (value.submittedOn > submitBy) return financeConflict('submitTooLate', { date: submitBy, collectionOn: run.collectionDate });
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const items = runItemsInternal(tx, run.id).filter((i) => i.removedAt === null);
    const changed = itemsChangedSinceFileInternal(deps, tx, run, items);
    if (changed) return changed;
    for (const [mandateId, amendment] of amendmentsByMandate(items)) {
      const mandate = mandateRowInternal(tx, mandateId)!;
      const lastCollectedOn = mandate.lastCollectedOn && mandate.lastCollectedOn > run.collectionDate ? mandate.lastCollectedOn : run.collectionDate;
      const pendingAmendment = amendment && sameAmendment(amendment, mandate.pendingAmendment) ? null : mandate.pendingAmendment;
      tx.update(financeSepaMandates).set({ lastCollectedOn, pendingAmendment, updatedAt: now }).where(eq(financeSepaMandates.id, mandateId)).run();
    }
    tx.update(financeDirectDebitRuns).set({ status: 'submitted', submittedOn: value.submittedOn, submittedByUserId: ctx.userId ?? 'system', updatedAt: now }).where(eq(financeDirectDebitRuns.id, run.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.directDebit.submit', entity: 'financeDirectDebitRun', id: run.id, after: { status: 'submitted', submittedOn: value.submittedOn }, params: { collectionOn: run.collectionDate } });
    return ok(runViewInternal(tx, deps, runRowInternal(tx, run.id)!));
  });
}

/**
 * „Als nicht eingereicht zurücksetzen“ (humanOnly; Handoff 2a § 3): nur am selben Vereinstag wie die Einreichung. Der
 * letzte Einzug je Mandat ergibt sich wieder aus den übrigen eingereichten Einzügen, ein quittierter Änderungshinweis
 * kommt aus dem Posten zurück.
 */
export async function resetDirectDebitRunSubmitted(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const found = await runForStep(deps, ctx, directDebitRunIdSchema, input);
  if (!found.ok) return found;
  const { run } = found.value as { run: FinanceDirectDebitRunRow };
  if (run.status !== 'submitted') return financeConflict('runNotSubmitted');
  if (run.submittedOn !== todayIn(deps)) return financeConflict('runResetTooLate', { date: run.submittedOn! });
  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeDirectDebitRuns).set({ status: 'fileCreated', submittedOn: null, submittedByUserId: null, updatedAt: now }).where(eq(financeDirectDebitRuns.id, run.id)).run();
    const items = runItemsInternal(tx, run.id).filter((i) => i.removedAt === null);
    for (const [mandateId, amendment] of amendmentsByMandate(items)) {
      const mandate = mandateRowInternal(tx, mandateId)!;
      const others = activeRunItemsInternal(tx, { mandateId, statuses: ['submitted', 'booked'] }).map((r) => r.collectionDate).sort();
      const lastCollectedOn = others.at(-1) ?? null;
      const pendingAmendment = mandate.pendingAmendment ?? amendment ?? null;
      tx.update(financeSepaMandates).set({ lastCollectedOn, pendingAmendment, updatedAt: now }).where(eq(financeSepaMandates.id, mandateId)).run();
    }
    financeAudit(tx, deps, ctx, { action: 'finance.directDebit.resetSubmit', entity: 'financeDirectDebitRun', id: run.id, after: { status: 'fileCreated', submittedOn: null }, params: { collectionOn: run.collectionDate } });
    return ok(runViewInternal(tx, deps, runRowInternal(tx, run.id)!));
  });
}

/**
 * Stornieren (humanOnly; Spec § 7.4 Schritt 6): vor der Einreichung frei — die Posten werden frei und erscheinen in der
 * nächsten Vorschau, die Dateien verschwinden (sie tragen IBANs), der Begleitzettel bleibt in der Akte. Nach der
 * Einreichung abgelehnt: Stornieren geht dann nur bei der Bank (`runSubmitted`, Auswege in der Sprachdatei).
 */
export async function cancelDirectDebitRun(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitRunView>> {
  const found = await runForStep(deps, ctx, directDebitRunIdSchema, input);
  if (!found.ok) return found;
  const { run } = found.value as { run: FinanceDirectDebitRunRow };
  if (run.status !== 'draft' && run.status !== 'fileCreated') return runLockedConflict(run);
  const result = deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    tx.update(financeDirectDebitRuns).set({ status: 'cancelled', cancelledAt: now, cancelledByUserId: ctx.userId ?? 'system', updatedAt: now }).where(eq(financeDirectDebitRuns.id, run.id)).run();
    voidSummaryInternal(tx, deps, ctx, run, SUMMARY_VOID_DISCARDED);
    financeAudit(tx, deps, ctx, { action: 'finance.directDebit.cancel', entity: 'financeDirectDebitRun', id: run.id, after: { status: 'cancelled' }, params: { collectionOn: run.collectionDate } });
    return ok(runViewInternal(tx, deps, runRowInternal(tx, run.id)!));
  });
  await deleteRunFilesInternal(deps, run.fileName);
  return result;
}
