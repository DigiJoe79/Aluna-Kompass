import { isoNow, newId, notFound, ok, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { and, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, type FinanceErrorCode } from '../errors';
import { financeAllocationLines, financeCategories, financeConfirmationLines, financeEntries, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, financeRawTransactions, type FinanceOpenItemRow } from '../schema';
import { requireFinanceRead } from './access';
import { fiscalYearForInternal, fiscalYearStatusInternal } from './fiscal-years';
import { openCentsInternal, openItemInDirectDebitInternal, openItemViewInternal, type OpenItemView } from './open-items';
import { registeredOpenItemOrigins } from './origins';
import { liveSettlementCondition, settlementHasReturnInternal } from './settlement-live';

/**
 * Spec Zahlung zuordnen (0.5.2, B10): Eine festgeschriebene Einnahme wird nachträglich einem offenen Posten (Forderung)
 * zugeordnet — ein eigener Ausgleich mit `assignedAt`, die Buchung bleibt, wie sie ist. Hier die Kandidaten, die
 * Prüfungen (§ 3.2) und, in den Diensten weiter unten, Zuordnen und Aufheben. Oberfläche und MCP rufen dieselben.
 */

/** Zuwendungsarten (Spec § 3.2, K ohne Vorlage): eine so gebuchte Zahlung wird einseitig nie zum Beitrag (§ 3.2a). */
const GIFT_KINDS = ['donation', 'inKindDonation', 'expenseWaiver'];

export interface AssignableCandidate {
  moneyLineId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: string;
  accountId: string;
  entryText: string;
  /** Kategorien der Zuordnungszeilen mit dem zahlenden Kontakt. */
  categoryIds: string[];
  lineCents: number;
  /** Betrag der Geldzeile minus alle lebenden Ausgleiche an ihr — berechnet, nie gespeichert. */
  freeCents: number;
  assignedTo: { openItemId: string; paymentReference: string | null; contactId: string | null; amountCents: number }[];
  /** Verwendungszweck des Bankumsatzes — die Tilgungsbestimmung des Zahlenden (§ 366 Abs. 1 BGB). */
  purpose: string | null;
  payerContactId: string;
  /** Die Zahlung kommt nicht vom Kontakt des Postens, sondern über den Haken der Herkunft (Erziehungsberechtigte). */
  viaGuardian: boolean;
  categoryFits: boolean;
  amountFits: boolean;
  purposeHint: { kind: 'otherYear'; year: string } | { kind: 'otherItem'; paymentReference: string } | null;
  blockedBy: FinanceErrorCode | null;
  /** Die Werte zum Satz der Sperre (Jahr, Bestätigung …), wie `financeConflict` sie setzt. */
  blockedParams: Record<string, string | number> | null;
}

/** Was eine Prüfung über eine Geldzeile wissen muss. */
export interface AssignLine {
  id: string;
  entryId: string;
  amountCents: number;
  accountId: string;
  rawTransactionId: string | null;
  entryNumber: string | null;
  entryDate: string;
  entryText: string;
  status: 'draft' | 'final';
  reversedByEntryId: string | null;
  reversesEntryId: string | null;
}

export function assignLineInternal(db: DbOrTx, moneyLineId: string): AssignLine | null {
  return (
    db
      .select({
        id: financeMoneyLines.id, entryId: financeMoneyLines.entryId, amountCents: financeMoneyLines.amountCents, accountId: financeMoneyLines.accountId, rawTransactionId: financeMoneyLines.rawTransactionId,
        entryNumber: financeEntries.number, entryDate: financeEntries.entryDate, entryText: financeEntries.text, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId, reversesEntryId: financeEntries.reversesEntryId,
      })
      .from(financeMoneyLines)
      .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
      .where(eq(financeMoneyLines.id, moneyLineId))
      .get() ?? null
  );
}

/** Die Kontakte, deren Zahlung vom Tag `paymentDate` den Posten tilgen darf: der Kontakt des Postens und der Haken der Herkunft (§ 3.2b). */
export function payerContactsInternal(deps: Deps, db: DbOrTx, item: FinanceOpenItemRow, paymentDate: string): string[] {
  const own = item.contactId ? [item.contactId] : [];
  if (!item.originType || !item.originId) return own;
  const owner = registeredOpenItemOrigins(deps).get(item.originType);
  const manifest = deps.registry.manifests.find((m) => m.key === owner);
  const hook = manifest?.openItemOrigins?.find((o) => o.type === item.originType)?.payerContacts;
  const extra = hook ? hook(deps, db, { originId: item.originId, paymentDate }) : [];
  return [...new Set([...own, ...extra])];
}

/** Die Zuordnungszeilen der Buchung mit einem der Kontakte, samt Kategorie. */
function payerLines(db: DbOrTx, entryId: string, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  return db
    .select({ id: financeAllocationLines.id, contactId: financeAllocationLines.contactId, categoryId: financeAllocationLines.categoryId, incomeKind: financeCategories.incomeKind })
    .from(financeAllocationLines)
    .innerJoin(financeCategories, eq(financeAllocationLines.categoryId, financeCategories.id))
    .where(and(eq(financeAllocationLines.entryId, entryId), inArray(financeAllocationLines.contactId, [...contactIds])))
    .all();
}

function templateCategoryIds(item: FinanceOpenItemRow): string[] {
  if (!item.lineTemplate) return [];
  try {
    const parsed = JSON.parse(item.lineTemplate) as { categoryId?: string | null }[];
    return Array.isArray(parsed) ? parsed.flatMap((e) => (e.categoryId ? [e.categoryId] : [])) : [];
  } catch {
    return [];
  }
}

/** K (Spec § 3.2): mit Vorlage trägt jede Zeile des Zahlers eine Kategorie der Vorlage; ohne Vorlage keine eine Zuwendungsart. */
function categoryRefusal(item: FinanceOpenItemRow, lines: ReturnType<typeof payerLines>): Failure | null {
  const template = templateCategoryIds(item);
  const gift = lines.some((l) => l.incomeKind !== null && GIFT_KINDS.includes(l.incomeKind));
  if (template.length === 0) return gift ? financeConflict('assignCategoryMismatch') : null;
  if (lines.every((l) => template.includes(l.categoryId))) return null;
  return gift ? financeConflict('assignCategoryMismatch') : financeConflict('assignCategoryNotTemplate');
}

/** Z: eine Zeile des Zahlers als Zuwendung in einer gültigen (nicht freigegebenen) Bestätigung. */
function confirmedRefusal(db: DbOrTx, lines: ReturnType<typeof payerLines>): Failure | null {
  const gifts = lines.filter((l) => l.incomeKind !== null && GIFT_KINDS.includes(l.incomeKind)).map((l) => l.id);
  if (gifts.length === 0) return null;
  const held = db.select({ id: financeConfirmationLines.id }).from(financeConfirmationLines).where(and(inArray(financeConfirmationLines.lineId, gifts), isNull(financeConfirmationLines.releasedAt))).get();
  return held ? financeConflict('assignPaymentConfirmed') : null;
}

/** J: Das spätere der beiden Daten liegt in einem abgeschlossenen Geschäftsjahr — sonst änderte die Zuordnung dessen Stand. */
export function assignClosedYearRefusal(db: DbOrTx, itemDate: string, paymentDate: string): Failure | null {
  const later = itemDate > paymentDate ? itemDate : paymentDate;
  const year = fiscalYearForInternal(db, later);
  return year && fiscalYearStatusInternal(db, year.id) === 'closed' ? financeConflict('fiscalYearClosed', { year: year.designation }) : null;
}

/** R, nur der Posten: Forderung, nicht storniert, noch offen. */
function itemRefusal(db: DbOrTx, item: FinanceOpenItemRow): Failure | null {
  if (item.kind !== 'receivable') return financeConflict('settlementWrongDirection');
  if (item.cancelledAt !== null) return financeConflict('openItemCancelled');
  if (openCentsInternal(db, item.id) <= 0) return financeConflict('openItemNotOpen');
  return null;
}

/**
 * Die Prüfungen R, F, C, K, Z, L, J der Spec (§ 3.2) in dieser Reihenfolge, ohne B (Betrag) — für die Kandidaten
 * (`blockedBy`), für das Zuordnen und für „Rückgängig“. `null`: nichts hindert.
 */
export function assignRefusalInternal(deps: Deps, db: DbOrTx, item: FinanceOpenItemRow, line: AssignLine): Failure | null {
  return assignRefusalBeforeAmount(deps, db, item, line) ?? assignRefusalAfterAmount(deps, db, item, line);
}

/** R, F, C, K, Z — was vor der Prüfung des Betrags (B) steht. */
function assignRefusalBeforeAmount(deps: Deps, db: DbOrTx, item: FinanceOpenItemRow, line: AssignLine): Failure | null {
  const r = itemRefusal(db, item) ?? (line.amountCents > 0 ? null : financeConflict('settlementWrongDirection'));
  if (r) return r;
  if (line.status !== 'final' || line.reversedByEntryId !== null || line.reversesEntryId !== null) return financeConflict('assignEntryNotFinal');
  const lines = payerLines(db, line.entryId, payerContactsInternal(deps, db, item, line.entryDate));
  if (lines.length === 0) return financeConflict('assignContactMismatch');
  return categoryRefusal(item, lines) ?? confirmedRefusal(db, lines);
}

/** L, J — nach dem Betrag. */
function assignRefusalAfterAmount(deps: Deps, db: DbOrTx, item: FinanceOpenItemRow, line: AssignLine): Failure | null {
  const run = openItemInDirectDebitInternal(deps, db, item.id);
  if (run && run.status !== 'draft') return financeConflict('assignInDirectDebit', { runId: run.runId, status: run.status });
  return assignClosedYearRefusal(db, item.itemDate, line.entryDate);
}

/** Lebende Ausgleiche an einer Geldzeile, mit Posten. */
function liveSettlementsAtLine(db: DbOrTx, moneyLineId: string) {
  return db
    .select({ openItemId: financeOpenItemSettlements.openItemId, amountCents: financeOpenItemSettlements.amountCents, paymentReference: financeOpenItems.paymentReference, contactId: financeOpenItems.contactId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeOpenItems, eq(financeOpenItemSettlements.openItemId, financeOpenItems.id))
    .where(and(eq(financeOpenItemSettlements.moneyLineId, moneyLineId), isNull(financeOpenItemSettlements.reversesSettlementId), liveSettlementCondition()))
    .all();
}

/** Freier Rest der Geldzeile: Betrag minus alle lebenden Ausgleiche an ihr. */
export function freeCentsOfLineInternal(db: DbOrTx, moneyLineId: string, lineCents: number): number {
  return lineCents - liveSettlementsAtLine(db, moneyLineId).reduce((s, r) => s + r.amountCents, 0);
}

/** § 3.5: die Zahlungsreferenz eines anderen offenen Postens desselben Kontakts oder ein anderes Jahr als das des Postens. */
function purposeHintOf(db: DbOrTx, item: FinanceOpenItemRow, purpose: string | null): AssignableCandidate['purposeHint'] {
  if (!purpose) return null;
  const text = purpose.toLowerCase();
  if (item.contactId) {
    const others = db
      .select({ id: financeOpenItems.id, paymentReference: financeOpenItems.paymentReference })
      .from(financeOpenItems)
      .where(and(eq(financeOpenItems.contactId, item.contactId), ne(financeOpenItems.id, item.id), isNull(financeOpenItems.cancelledAt)))
      .all();
    const named = others.find((o) => o.paymentReference && text.includes(o.paymentReference.toLowerCase()) && !(item.paymentReference && item.paymentReference.toLowerCase().includes(o.paymentReference.toLowerCase())) && openCentsInternal(db, o.id) > 0);
    if (named) return { kind: 'otherItem', paymentReference: named.paymentReference! };
  }
  const own = item.itemDate.slice(0, 4);
  const other = [...purpose.matchAll(/\b20\d\d\b/g)].map((m) => m[0]).find((y) => y !== own);
  return other ? { kind: 'otherYear', year: other } : null;
}

/** Die Geldzeilen festgeschriebener, nicht zurückgenommener Einnahmen mit Zeilen dieser Kontakte. */
function incomeLinesOfContacts(db: DbOrTx, contactIds: readonly string[]) {
  if (contactIds.length === 0) return [];
  const entryIds = [
    ...new Set(
      db
        .select({ entryId: financeAllocationLines.entryId })
        .from(financeAllocationLines)
        .innerJoin(financeEntries, eq(financeAllocationLines.entryId, financeEntries.id))
        .where(and(inArray(financeAllocationLines.contactId, [...contactIds]), eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId)))
        .all()
        .map((r) => r.entryId),
    ),
  ];
  if (entryIds.length === 0) return [];
  return db.select({ id: financeMoneyLines.id }).from(financeMoneyLines).where(and(inArray(financeMoneyLines.entryId, entryIds), gt(financeMoneyLines.amountCents, 0))).all();
}

/**
 * Die Kontakte, die je nach Buchungstag zahlen dürften: der Haken der Herkunft wird je Tag einer Buchung gefragt, an der
 * überhaupt ein Kontakt hängt — er kennt die Zeitbindung (§ 3.2b), die Finanzen kennen sie nicht.
 */
function possiblePayers(deps: Deps, db: DbOrTx, item: FinanceOpenItemRow): string[] {
  const own = item.contactId ? [item.contactId] : [];
  if (!item.originType || !item.originId) return own;
  const days = db
    .selectDistinct({ day: financeEntries.entryDate })
    .from(financeEntries)
    .innerJoin(financeAllocationLines, eq(financeAllocationLines.entryId, financeEntries.id))
    .where(and(eq(financeEntries.status, 'final'), isNull(financeEntries.reversedByEntryId)))
    .all()
    .map((r) => r.day);
  return [...new Set([...own, ...days.flatMap((day) => payerContactsInternal(deps, db, item, day))])];
}

/** § 3.5, ohne Rechteprüfung: alle passenden Zahlungen zu einem Posten, mit Sperre und Hinweis, in der Reihenfolge der Spec. */
export function assignablePaymentsInternal(deps: Deps, db: DbOrTx, openItemId: string): AssignableCandidate[] {
  const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, openItemId)).get();
  if (!item) return [];
  const openCents = openCentsInternal(db, item.id);
  const out: AssignableCandidate[] = [];
  for (const { id } of incomeLinesOfContacts(db, possiblePayers(deps, db, item))) {
    const line = assignLineInternal(db, id)!;
    const payers = payerContactsInternal(deps, db, item, line.entryDate);
    const lines = payerLines(db, line.entryId, payers);
    if (lines.length === 0) continue;
    const settled = liveSettlementsAtLine(db, line.id);
    const freeCents = line.amountCents - settled.reduce((s, r) => s + r.amountCents, 0);
    if (freeCents <= 0) continue;
    const purpose = line.rawTransactionId ? (db.select({ purpose: financeRawTransactions.purpose }).from(financeRawTransactions).where(eq(financeRawTransactions.id, line.rawTransactionId)).get()?.purpose ?? null) : null;
    const payerContactId = lines.find((l) => l.contactId === item.contactId)?.contactId ?? lines[0]!.contactId!;
    const refusal = assignRefusalInternal(deps, db, item, line);
    const blocked = refusal && refusal.error.type === 'conflict' ? refusal.error : null;
    out.push({
      moneyLineId: line.id, entryId: line.entryId, entryNumber: line.entryNumber, entryDate: line.entryDate, accountId: line.accountId, entryText: line.entryText,
      categoryIds: [...new Set(lines.map((l) => l.categoryId))], lineCents: line.amountCents, freeCents,
      assignedTo: settled.map((s) => ({ openItemId: s.openItemId, paymentReference: s.paymentReference, contactId: s.contactId, amountCents: s.amountCents })),
      purpose, payerContactId, viaGuardian: payerContactId !== item.contactId,
      categoryFits: categoryRefusal(item, lines) === null, amountFits: freeCents === openCents,
      purposeHint: purposeHintOf(db, item, purpose),
      blockedBy: blocked ? (blocked.code as FinanceErrorCode) : null,
      blockedParams: blocked ? ((blocked as { params?: Record<string, string | number> }).params ?? {}) : null,
    });
  }
  const group = (c: AssignableCandidate) => (c.blockedBy ? 2 : c.purposeHint ? 1 : 0);
  return out.sort((a, b) => group(a) - group(b) || Number(b.amountFits) - Number(a.amountFits) || b.entryDate.localeCompare(a.entryDate) || a.moneyLineId.localeCompare(b.moneyLineId));
}

const listSchema = z.object({ openItemId: z.string().min(1) });

/** `finance.read`: die passenden Zahlungen eines Postens (§ 3.5) — auch gesperrte, je mit Grund. */
export async function listAssignablePayments(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AssignableCandidate[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input);
  if (!parsed.ok) return parsed;
  const item = deps.db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(eq(financeOpenItems.id, parsed.value.openItemId)).get();
  if (!item) return notFound('financeOpenItem', parsed.value.openItemId);
  return ok(assignablePaymentsInternal(deps, deps.db, item.id));
}

const assignSchema = z.object({
  openItemId: z.string().min(1),
  moneyLineId: z.string().min(1),
  /** Ohne Angabe das Kleinere aus offenem Rest und freiem Rest der Geldzeile. */
  amountCents: z.number().int().positive().optional(),
});

/**
 * `finance.entriesWrite`, Agent erlaubt (umkehrbar, protokolliert, Entscheidung 4): eine festgeschriebene Einnahme dem
 * offenen Posten zuordnen — ganz oder als Teilbetrag. Prüfungen R, F, C, K, Z, B, L, J (§ 3.2); B und das Schreiben in
 * derselben Transaktion, damit zwei Zuordnungen derselben Geldzeile zusammen nie mehr als ihren freien Rest nehmen. Die
 * Buchung bleibt, wie sie ist; das Protokoll nennt nur Buchungsnummer und Betrag.
 */
export async function assignPaymentToOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, assignSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  return deps.db.transaction((tx: DbOrTx): Result<OpenItemView> => {
    const item = tx.select().from(financeOpenItems).where(eq(financeOpenItems.id, v.openItemId)).get();
    if (!item) return notFound('financeOpenItem', v.openItemId);
    const line = assignLineInternal(tx, v.moneyLineId);
    if (!line) return notFound('financeMoneyLine', v.moneyLineId);
    const before = assignRefusalBeforeAmount(deps, tx, item, line);
    if (before) return before;
    const openCents = openCentsInternal(tx, item.id);
    const freeCents = freeCentsOfLineInternal(tx, line.id, line.amountCents);
    const amountCents = v.amountCents ?? Math.min(openCents, freeCents);
    if (amountCents > openCents) return financeConflict('assignExceedsOpen', { open: openCents });
    if (amountCents > freeCents || amountCents <= 0) return financeConflict('assignExceedsLine', { free: Math.max(freeCents, 0) });
    const after = assignRefusalAfterAmount(deps, tx, item, line);
    if (after) return after;
    tx.insert(financeOpenItemSettlements).values({ id: newId(), moneyLineId: line.id, openItemId: item.id, amountCents, reversesSettlementId: null, assignedAt: isoNow(deps.clock), assignedByUserId: ctx.userId ?? null }).run();
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.assignPayment', entity: 'financeOpenItem', id: item.id, params: { entryNumber: line.entryNumber ?? '', amountCents } });
    return ok(openItemViewInternal(tx, item));
  });
}

const unassignSchema = z.object({ settlementId: z.string().min(1) });

/**
 * `finance.entriesWrite`, Agent erlaubt: eine nachträgliche Zuordnung aufheben (Spec § 3.3) — `releasedAt` wird gesetzt,
 * die Zeile bleibt als Spur. Ein Ausgleich aus dem Buchen gehört zur Buchung (`settlementNotAssigned`, dort der Storno);
 * eine gebuchte Rückgabe hält die Zuordnung (`assignmentHasReturn`); J wie beim Zuordnen. Der Posten ist danach wieder
 * offen; Mahnstufen zählen weiter aus den vorhandenen Vermerken.
 */
export async function unassignPaymentFromOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, unassignSchema, input);
  if (!parsed.ok) return parsed;
  const { settlementId } = parsed.value;
  return deps.db.transaction((tx: DbOrTx): Result<OpenItemView> => {
    const settlement = tx.select().from(financeOpenItemSettlements).where(and(eq(financeOpenItemSettlements.id, settlementId), liveSettlementCondition())).get();
    if (!settlement) return notFound('financeOpenItemSettlement', settlementId);
    const item = tx.select().from(financeOpenItems).where(eq(financeOpenItems.id, settlement.openItemId)).get()!;
    const line = assignLineInternal(tx, settlement.moneyLineId)!;
    if (settlement.assignedAt === null || settlement.reversesSettlementId !== null) return financeConflict('settlementNotAssigned');
    if (settlementHasReturnInternal(tx, settlement.id)) return financeConflict('assignmentHasReturn');
    const closed = assignClosedYearRefusal(tx, item.itemDate, line.entryDate);
    if (closed) return closed;
    tx.update(financeOpenItemSettlements).set({ releasedAt: isoNow(deps.clock), releasedByUserId: ctx.userId ?? null }).where(eq(financeOpenItemSettlements.id, settlement.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.unassignPayment', entity: 'financeOpenItem', id: item.id, params: { entryNumber: line.entryNumber ?? '', amountCents: settlement.amountCents } });
    return ok(openItemViewInternal(tx, item));
  });
}
