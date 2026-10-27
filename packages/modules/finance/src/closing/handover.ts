import { buildContext, expectedVersionField, invalid, isoDay, isoNow, newId, notFound, ok, paperDate, prepare, readSetting, requirePermission, staleVersion, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contactRoles, contacts, displayName } from '@kompass/module-contacts';
import { linkDocumentInternal, receiveGeneratedUpload } from '@kompass/module-dms';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { formatAmount } from '../format/amount';
import { treasurerContactIdAtInternal } from '../ledger/treasurer';
import { requireFinanceRead } from '../ledger/access';
import { countCash } from '../ledger/cash';
import { fiscalYearForInternal } from '../ledger/fiscal-years';
import { accountBalancesAt } from '../ledger/queries';
import { cashReportDefinition, type CashReport } from '../reporting/reports/cash-report';
import { runReportInternal } from '../reporting/service';
import type { ReportParams } from '../reporting/types';
import { financeAccounts, financeCashCounts, financeHandoverItems, financeHandovers, type FinanceFiscalYearRow, type FinanceHandoverRow } from '../schema';
import { HANDOVER_ITEM_PAPER, HANDOVER_PRINT_TEMPLATE_KEY, HANDOVER_PROTOCOL_TYPE_KEY, type HandoverPrintInput } from './handover-template';
import type { HandoverSummary } from './types';
import { addDaysInternal } from '../allocation/partner-proof';

export type { HandoverSummary } from './types';

/**
 * Rechenschaft C (Spec § C, Finanz-Spec § 9.6, Prüfung Vereinsrecht): die Amtsübergabe des Schatzmeisters —
 * Zwischenbericht „Jahresbeginn bis Übergabetag“ (vorläufig, Hash am Datensatz, § 666 BGB), Kassenzählung am
 * Übergabetag im Beisein der Nachfolge, Übergabepunkte (§ 667 BGB), Protokoll zum Unterschreiben durch beide, Scan
 * ablegen. Recht `finance.setup`.
 */

export type HandoverItemKey = 'cash' | 'records' | 'bankAccess' | 'paymentServices' | 'kompass' | 'custom';
const STANDARD_ITEMS: readonly Exclude<HandoverItemKey, 'custom'>[] = ['cash', 'records', 'bankAccess', 'paymentServices', 'kompass'];

export interface HandoverView extends HandoverSummary {
  fiscalYearId: string;
  fromContactId: string;
  toContactId: string;
  interimReport: { params: ReportParams; hash: string; shortHash: string; at: string } | null;
  /**
   * Jede aktive Kasse mit Buchbestand ≠ 0 am Übergabetag, mit der jüngsten Zählung dieses Tages (14c). Schritt 2 ist
   * erledigt, wenn jede eine Zählung ohne Differenz hat.
   */
  cashAccounts: { accountId: string; name: string; bookCents: number; count: { countId: string; countedCents: number; differenceCents: number } | null }[];
  cashRequired: boolean;
  items: { id: string; key: HandoverItemKey; label: string | null; note: string | null; checked: boolean }[];
  protocolDocumentId: string | null;
  /** Erledigte der drei Schritte: Zwischenbericht, Zählung (falls nötig), Protokoll. */
  doneCount: number;
  /** Einstellung `finance.reports.treasurerIsStatutoryBoard` — `null`: nicht angegeben. */
  statutoryBoard: boolean | null;
  version: string;
}


const nameOf = (db: DbOrTx, contactId: string) => {
  const c = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  return c ? displayName(c) : '';
};

/**
 * Die Kassen, die am Übergabetag gezählt werden müssen: aktiv, bis dahin eröffnet, mit Buchbestand ≠ 0 (14c, Entscheidung
 * d). Je Kasse zählt die jüngste Zählung genau dieses Tages; `financeHandovers.cashCountId` braucht es dafür nicht.
 */
function handoverCashInternal(db: DbOrTx, handoverOn: string): HandoverView['cashAccounts'] {
  const boxes = db.select().from(financeAccounts).where(and(eq(financeAccounts.kind, 'cash'), eq(financeAccounts.isActive, true))).all().filter((a) => a.openingDate === null || a.openingDate <= handoverOn);
  if (boxes.length === 0) return [];
  const book = new Map(accountBalancesAt(db, handoverOn).map((b) => [b.accountId, b.balanceCents]));
  return boxes
    .map((a) => ({ account: a, bookCents: book.get(a.id) ?? 0 }))
    .filter((b) => b.bookCents !== 0)
    .sort((a, b) => a.account.name.localeCompare(b.account.name, 'de'))
    .map(({ account, bookCents }) => {
      const count = db.select().from(financeCashCounts).where(and(eq(financeCashCounts.accountId, account.id), eq(financeCashCounts.countedOn, handoverOn))).orderBy(desc(financeCashCounts.createdAt), desc(financeCashCounts.id)).get();
      return { accountId: account.id, name: account.name, bookCents, count: count ? { countId: count.id, countedCents: count.countedCents, differenceCents: count.differenceCents } : null };
    });
}

/** Schritt 2: jede Pflichtkasse gezählt, ohne Differenz. */
const cashDone = (cash: HandoverView['cashAccounts']) => cash.every((a) => a.count !== null && a.count.differenceCents === 0);

function summaryOf(db: DbOrTx, row: FinanceHandoverRow): HandoverSummary {
  return { id: row.id, handoverOn: row.handoverOn, fromName: nameOf(db, row.fromContactId), toName: nameOf(db, row.toContactId), state: row.state };
}

export function handoverViewInternal(deps: Deps, row: FinanceHandoverRow): HandoverView {
  const db = deps.db;
  const items = db.select().from(financeHandoverItems).where(eq(financeHandoverItems.handoverId, row.id)).orderBy(asc(financeHandoverItems.position)).all();
  const cashAccounts = handoverCashInternal(db, row.handoverOn);
  const interim = row.interimParams && row.interimHash && row.interimAt ? { params: JSON.parse(row.interimParams) as ReportParams, hash: row.interimHash, shortHash: row.interimHash.slice(0, 8), at: row.interimAt } : null;
  const doneCount = (interim ? 1 : 0) + (cashDone(cashAccounts) ? 1 : 0) + (row.protocolDocumentId ? 1 : 0);
  return {
    ...summaryOf(db, row),
    fiscalYearId: row.fiscalYearId,
    fromContactId: row.fromContactId,
    toContactId: row.toContactId,
    interimReport: interim,
    cashAccounts,
    cashRequired: cashAccounts.length > 0,
    items: items.map((i) => ({ id: i.id, key: i.key, label: i.label, note: i.note, checked: i.checked })),
    protocolDocumentId: row.protocolDocumentId,
    doneCount,
    statutoryBoard: readSetting<boolean | null>(deps, 'finance.reports.treasurerIsStatutoryBoard'),
    version: row.updatedAt,
  };
}

/** Die Übergaben eines Jahres (oder alle), jüngste zuerst — ohne Rechteprüfung, für den Stand des Jahresabschlusses. */
export function handoversOfYearInternal(db: DbOrTx, fiscalYearId?: string): HandoverSummary[] {
  return db
    .select()
    .from(financeHandovers)
    .where(fiscalYearId ? eq(financeHandovers.fiscalYearId, fiscalYearId) : undefined)
    .orderBy(desc(financeHandovers.handoverOn), desc(financeHandovers.createdAt))
    .all()
    .map((r) => summaryOf(db, r));
}

/** Für die Entlastungsliste (`closing/assembly.ts`): abgeschlossene Übergaben des Jahres grenzen Von und An ab. */
export function handoverAssemblyPersons(db: DbOrTx, year: FinanceFiscalYearRow): { contactId: string; since?: string; until?: string }[] {
  return db
    .select()
    .from(financeHandovers)
    .where(and(eq(financeHandovers.fiscalYearId, year.id), eq(financeHandovers.state, 'done')))
    .all()
    .flatMap((h) => [{ contactId: h.fromContactId, until: h.handoverOn }, { contactId: h.toContactId, since: addDaysInternal(h.handoverOn, 1) }]);
}

function loadHandover(db: DbOrTx, id: string): FinanceHandoverRow | null {
  return db.select().from(financeHandovers).where(eq(financeHandovers.id, id)).get() ?? null;
}

const defaultsSchema = z.object({ handoverOn: z.string().date() });

/** `finance.read`: der Vorschlag für „Von“ — der Kontakt mit der Rolle Schatzmeister am Übergabetag. */
export async function handoverDefaults(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ fromContactId: string | null }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, defaultsSchema, input);
  if (!parsed.ok) return parsed;
  return ok({ fromContactId: treasurerContactIdAtInternal(deps.db, parsed.value.handoverOn) });
}


/** Zwei verschiedene Personen aus den Kontakten. */
function checkPersons(db: DbOrTx, fromContactId: string, toContactId: string) {
  if (fromContactId === toContactId) return financeConflict('handoverSamePerson');
  for (const [path, id] of [['fromContactId', fromContactId], ['toContactId', toContactId]] as const) {
    const c = db.select().from(contacts).where(eq(contacts.id, id)).get();
    if (!c) return notFound('contact', id);
    if (c.kind !== 'person') return invalid([{ path, message: 'notAPerson' }]);
  }
  return null;
}

const startSchema = z.object({ handoverOn: z.string().date(), fromContactId: z.string().min(1), toContactId: z.string().min(1) });

/** `finance.setup`: eine Übergabe beginnen — eine offene zur Zeit; das Jahr des Tages darf offen oder abgeschlossen sein. */
export async function startHandover(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, startSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const persons = checkPersons(deps.db, v.fromContactId, v.toContactId);
  if (persons) return persons;
  const year = fiscalYearForInternal(deps.db, v.handoverOn);
  if (!year) return notFound('financeFiscalYear', v.handoverOn);
  if (deps.db.select({ id: financeHandovers.id }).from(financeHandovers).where(eq(financeHandovers.state, 'open')).get()) return financeConflict('handoverOpen');
  return deps.db.transaction((tx: DbOrTx) => {
    const id = newId();
    const now = isoNow(deps.clock);
    tx.insert(financeHandovers).values({ id, fiscalYearId: year.id, fromContactId: v.fromContactId, toContactId: v.toContactId, handoverOn: v.handoverOn, state: 'open', createdAt: now, updatedAt: now }).run();
    STANDARD_ITEMS.forEach((key, position) => tx.insert(financeHandoverItems).values({ id: newId(), handoverId: id, key, label: null, note: null, checked: false, position }).run());
    financeAudit(tx, deps, ctx, { action: 'finance.handover.start', entity: 'financeHandover', id, after: { fiscalYearId: year.id, handoverOn: v.handoverOn, state: 'open' }, params: { handoverOn: v.handoverOn } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, id)!));
  });
}

const updateSchema = z.object({ id: z.string().min(1), handoverOn: z.string().date().optional(), fromContactId: z.string().min(1).optional(), toContactId: z.string().min(1).optional(), expectedVersion: expectedVersionField });

/** `finance.setup`: Tag oder Personen ändern — nur, solange der Zwischenbericht nicht festgehalten ist. */
export async function updateHandover(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadHandover(deps.db, v.id);
  if (!row) return notFound('financeHandover', v.id);
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  if (row.interimAt) return financeConflict('handoverInterimRecorded');
  const stale = staleVersion(v.expectedVersion, row.updatedAt);
  if (stale) return stale;
  const next = { handoverOn: v.handoverOn ?? row.handoverOn, fromContactId: v.fromContactId ?? row.fromContactId, toContactId: v.toContactId ?? row.toContactId };
  const persons = checkPersons(deps.db, next.fromContactId, next.toContactId);
  if (persons) return persons;
  const year = fiscalYearForInternal(deps.db, next.handoverOn);
  if (!year) return notFound('financeFiscalYear', next.handoverOn);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeHandovers).set({ ...next, fiscalYearId: year.id, updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.handover.update', entity: 'financeHandover', id: row.id, before: { fiscalYearId: row.fiscalYearId, handoverOn: row.handoverOn }, after: { fiscalYearId: year.id, handoverOn: next.handoverOn }, params: { handoverOn: next.handoverOn } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!));
  });
}

const idSchema = z.object({ id: z.string().min(1) });

/** `finance.setup`: eine Übergabe abbrechen — bis das Protokoll abgelegt ist. Der Datensatz bleibt (`cancelled`). */
export async function cancelHandover(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadHandover(deps.db, parsed.value.id);
  if (!row) return notFound('financeHandover', parsed.value.id);
  if (row.state === 'done') return financeConflict('handoverDone');
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeHandovers).set({ state: 'cancelled', updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.handover.cancel', entity: 'financeHandover', id: row.id, before: { state: row.state }, after: { state: 'cancelled' }, params: { handoverOn: row.handoverOn } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!));
  });
}

/** `finance.read`: eine Übergabe mit Zwischenbericht, Zählung, Punkten und Protokoll. */
export async function getHandover(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadHandover(deps.db, parsed.value.id);
  if (!row) return notFound('financeHandover', parsed.value.id);
  return ok(handoverViewInternal(deps, row));
}

const listSchema = z.object({ fiscalYearId: z.string().min(1).optional() });

/** `finance.read`: die Übergaben, wahlweise eines Jahres, jüngste zuerst. */
export async function listHandovers(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverSummary[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  return ok(handoversOfYearInternal(deps.db, parsed.value.fiscalYearId));
}

/**
 * `finance.setup`: den Kassenbericht vom Jahresbeginn bis zum Übergabetag als Zwischenbericht festhalten — Parameter
 * und voller Hash am Datensatz, keine Ablage (vorläufig, solange das Jahr offen ist).
 */
export async function recordHandoverInterimReport(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadHandover(deps.db, parsed.value.id);
  if (!row) return notFound('financeHandover', parsed.value.id);
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  if (row.handoverOn > todayIn(deps)) return financeConflict('handoverInFuture', { date: row.handoverOn });
  const params: ReportParams = { fiscalYearId: row.fiscalYearId, date: row.handoverOn };
  const run = runReportInternal(deps, deps.db, cashReportDefinition, params);
  return deps.db.transaction((tx: DbOrTx) => {
    tx.update(financeHandovers).set({ interimParams: JSON.stringify(params), interimHash: run.hash, interimAt: isoNow(deps.clock), updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.handover.interimReport', entity: 'financeHandover', id: row.id, after: { handoverOn: row.handoverOn }, params: { handoverOn: row.handoverOn, shortHash: run.shortHash } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!));
  });
}

const countSchema = z.object({
  id: z.string().min(1),
  accountId: z.string().min(1),
  countedCents: z.number().int().min(0),
  counterOneContactId: z.string().min(1),
  counterTwoContactId: z.string().min(1),
  note: z.string().trim().min(1).max(500).optional(),
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});

/**
 * `finance.setup` und `finance.entriesFinalize`, **`humanOnly`** (wie `countCash`): eine Kasse am Übergabetag zählen —
 * jede mit Bestand, je Aufruf eine (`accountId`); die Nachfolge ist Zeugin, wenn sie nicht selbst zählt (Claude). Nach
 * einer Zählung mit Differenz darf neu gezählt werden, nach einer ohne nicht (`handoverCashCounted`).
 */
export async function countCashForHandover(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, countSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadHandover(deps.db, v.id);
  if (!row) return notFound('financeHandover', v.id);
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  const cash = handoverCashInternal(deps.db, row.handoverOn);
  if (cash.length === 0) return financeConflict('handoverNoCash');
  const box = cash.find((a) => a.accountId === v.accountId);
  if (!box) return financeConflict('handoverCashNotRequired');
  if (box.count && box.count.differenceCents === 0) return financeConflict('handoverCashCounted');
  const counters = [v.counterOneContactId, v.counterTwoContactId];
  const counted = await countCash(deps, ctx, {
    accountId: v.accountId,
    countedOn: row.handoverOn,
    countedCents: v.countedCents,
    counterOneContactId: v.counterOneContactId,
    counterTwoContactId: v.counterTwoContactId,
    ...(v.note ? { note: v.note } : {}),
    ...(v.denominations ? { denominations: v.denominations } : {}),
    ...(counters.includes(row.toContactId) ? {} : { witnessContactIds: [row.toContactId] }),
  });
  if (!counted.ok) return counted;
  return deps.db.transaction((tx: DbOrTx) => {
    // `cashCountId` bleibt für Altdaten lesbar, neue Zählungen setzen es nicht mehr: Die Sicht leitet je Kasse aus
    // `financeCashCounts` ab (14c). Die Spalte bleibt ungenutzt stehen, ohne Migration.
    tx.update(financeHandovers).set({ updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.handover.cashCount', entity: 'financeHandover', id: row.id, after: { handoverOn: row.handoverOn }, params: { handoverOn: row.handoverOn, documentNumber: counted.value.documentNumber } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!));
  });
}

const itemsSchema = z.object({
  id: z.string().min(1),
  items: z
    .array(z.object({ id: z.string().min(1).optional(), key: z.enum(['cash', 'records', 'bankAccess', 'paymentServices', 'kompass', 'custom']), label: z.string().trim().min(1).max(200).nullable().optional(), note: z.string().trim().max(500).nullable().optional(), checked: z.boolean() }))
    .max(50)
    .superRefine((items, c) => items.forEach((i, n) => {
      if (i.key === 'custom' && !i.label) c.addIssue({ code: 'custom', path: [n, 'label'], message: 'required' });
    })),
  expectedVersion: expectedVersionField,
});

/** `finance.setup`: Punkte abhaken, mit Notiz, eigene dazu. Nicht genannte Punkte bleiben, wie sie sind; keiner verschwindet. */
export async function saveHandoverItems(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, itemsSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = loadHandover(deps.db, v.id);
  if (!row) return notFound('financeHandover', v.id);
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  const stale = staleVersion(v.expectedVersion, row.updatedAt);
  if (stale) return stale;
  const existing = new Map(deps.db.select().from(financeHandoverItems).where(eq(financeHandoverItems.handoverId, row.id)).all().map((i) => [i.id, i]));
  const wrong = v.items.findIndex((i) => i.id !== undefined && existing.get(i.id)?.key !== i.key);
  if (wrong >= 0) return invalid([{ path: `items.${wrong}.id`, message: 'notAnItemOfHandover' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    let position = Math.max(-1, ...[...existing.values()].map((i) => i.position));
    for (const item of v.items) {
      const label = item.key === 'custom' ? (item.label ?? null) : null;
      if (item.id) tx.update(financeHandoverItems).set({ label, note: item.note ?? null, checked: item.checked }).where(eq(financeHandoverItems.id, item.id)).run();
      else tx.insert(financeHandoverItems).values({ id: newId(), handoverId: row.id, key: item.key, label, note: item.note ?? null, checked: item.checked, position: ++position }).run();
    }
    tx.update(financeHandovers).set({ updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
    const all = tx.select().from(financeHandoverItems).where(eq(financeHandoverItems.handoverId, row.id)).all();
    financeAudit(tx, deps, ctx, { action: 'finance.handover.items', entity: 'financeHandover', id: row.id, after: { handoverOn: row.handoverOn }, params: { handoverOn: row.handoverOn, checked: all.filter((i) => i.checked).length, total: all.length } });
    return ok(handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!));
  });
}

/** Was das Protokoll druckt — Zwischenbericht und Zählung live aus dem Datensatz, fertig formatiert. */
function printInputInternal(deps: Deps, view: HandoverView): HandoverPrintInput {
  const subject: HandoverPrintInput['subject'] = [
    { label: 'Verein', value: String(readSetting<string>(deps, 'organization.name') ?? '') },
    { label: 'Übergabetag', value: paperDate(view.handoverOn as never) },
    { label: 'Bisher', value: view.fromName },
    { label: 'Neu', value: view.toName },
  ];
  if (view.interimReport) {
    const run = runReportInternal(deps, deps.db, cashReportDefinition, view.interimReport.params);
    const data = run.data as CashReport;
    const closing = data.accounts.reduce((s, a) => s + a.closingCents, 0);
    subject.push({ label: 'Zwischenbericht', value: `Kassenbericht ${paperDate(data.year.startsOn as never)} bis ${paperDate(view.handoverOn as never)}, ${view.interimReport.shortHash}${run.hash === view.interimReport.hash ? '' : ' (Datenstand seither geändert)'}` });
    subject.push({ label: 'Ergebnis bis zum Übergabetag', value: `${formatAmount(data.income.resultCents)} €` });
    subject.push({ label: 'Bestände am Übergabetag', value: `${formatAmount(closing)} €` });
  } else subject.push({ label: 'Zwischenbericht', value: 'noch nicht festgehalten' });
  subject.push({
    label: 'Kassenbestand laut Zählung',
    value: view.cashRequired ? `${view.cashAccounts.map((a) => `${a.name} ${a.count ? `${formatAmount(a.count.countedCents)} €` : 'noch nicht gezählt'}`).join(', ')} am ${paperDate(view.handoverOn as never)}` : 'keine Kasse mit Bestand',
  });
  return {
    title: `Übergabeprotokoll ${paperDate(view.handoverOn as never)}`,
    footerNote: view.interimReport ? `Zwischenbericht ${view.interimReport.shortHash}` : 'Ohne Zwischenbericht',
    subject,
    items: view.items.map((i) => ({ label: i.key === 'custom' ? (i.label ?? '') : HANDOVER_ITEM_PAPER[i.key], note: i.note, checked: i.checked })),
    registerHint: view.statutoryBoard !== false,
    fromName: view.fromName,
    toName: view.toName,
  };
}

/** `finance.read`: das Protokoll zum Unterschreiben drucken — ohne Ablage, ohne Nummer. Liefert Bytes: kein MCP-Werkzeug. */
export async function printHandoverProtocol(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ bytes: Uint8Array; filename: string }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, idSchema, input);
  if (!parsed.ok) return parsed;
  const row = loadHandover(deps.db, parsed.value.id);
  if (!row) return notFound('financeHandover', parsed.value.id);
  const view = handoverViewInternal(deps, row);
  // `prepare` prüft das Recht der Vorlage (`finance.read`) — dasselbe wie hier.
  const prepared = await prepare(deps, ctx, { templateKey: HANDOVER_PRINT_TEMPLATE_KEY, input: printInputInternal(deps, view) }, { number: '' });
  if (!prepared.ok) return prepared;
  const { built, baseId, bodyTypst, images } = prepared.value;
  const context = await buildContext(deps, ctx, '');
  const { bytes } = await deps.documents.render({ baseId, bodyTypst, slots: built.slots, context, images });
  return ok({ bytes, filename: `Uebergabeprotokoll-${paperDate(isoDay(row.handoverOn))}.pdf` });
}

const fileSchema = z.object({ id: z.string().min(1), bytes: z.custom<Uint8Array>((val) => val instanceof Uint8Array, { message: 'invalidBytes' }), fileName: z.string().trim().max(300).optional() });
const PROTOCOL_MAX_BYTES = 10 * 1024 * 1024;

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
}

/**
 * `finance.setup`, **`humanOnly`** (persönliche Erklärung beider): das unterschriebene Protokoll (PDF bis 10 MB) als
 * `finance-handover-protocol` an Übergabe und Geschäftsjahr ablegen — erst mit Zwischenbericht und (falls nötig)
 * Zählung. Danach ist die Übergabe abgeschlossen.
 */
export async function fileHandoverProtocol(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<HandoverView>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const humanOnly = requireHumanChannelFinance(deps, ctx);
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, fileSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.bytes.length > PROTOCOL_MAX_BYTES) return invalid([{ path: 'bytes', message: 'tooLarge' }]);
  if (!isPdf(v.bytes)) return invalid([{ path: 'bytes', message: 'notPdf' }]);
  const row = loadHandover(deps.db, v.id);
  if (!row) return notFound('financeHandover', v.id);
  if (row.state === 'done') return financeConflict('handoverDone');
  if (row.state !== 'open') return financeConflict('handoverNotOpen');
  if (!row.interimAt || !cashDone(handoverCashInternal(deps.db, row.handoverOn))) return financeConflict('handoverStepsOpen');
  const filed = await receiveGeneratedUpload(deps, ctx, {
    bytes: v.bytes,
    typeKey: HANDOVER_PROTOCOL_TYPE_KEY,
    subject: `Übergabeprotokoll ${paperDate(row.handoverOn as never)}`,
    documentDate: row.handoverOn,
    links: [{ entityType: 'financeHandover', entityId: row.id }],
    afterReceive: (tx, doc) => {
      linkDocumentInternal(tx, deps, { documentId: doc.id, entityType: 'financeFiscalYear', entityId: row.fiscalYearId });
      tx.update(financeHandovers).set({ state: 'done', protocolDocumentId: doc.id, updatedAt: isoNow(deps.clock) }).where(eq(financeHandovers.id, row.id)).run();
      financeAudit(tx, deps, ctx, { action: 'finance.handover.protocolFile', entity: 'financeHandover', id: row.id, before: { state: row.state }, after: { state: 'done', documentId: doc.id }, params: { handoverOn: row.handoverOn, documentNumber: doc.number ?? '' } });
      return handoverViewInternal({ ...deps, db: tx }, loadHandover(tx, row.id)!);
    },
  });
  if (!filed.ok) return filed;
  return ok(filed.value.after!);
}
