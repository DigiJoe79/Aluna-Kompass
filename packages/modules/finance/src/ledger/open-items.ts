import { expectedVersionField, isoNow, newId, notFound, ok, requireHumanChannel, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict } from '../errors';
import { financeEntries, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, type FinanceOpenItemRow } from '../schema';
import { requireFinanceRead } from './access';

export interface OpenItemView extends FinanceOpenItemRow {
  settledCents: number;
  openCents: number;
  state: 'open' | 'settled' | 'overpaid' | 'cancelled';
}

function contactExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
}

/**
 * Σ Settlements festgeschriebener, nicht stornierter Buchungen — ein Storno
 * gibt den Posten wieder frei, ohne dass eine Zeile gelöscht wird. Mit `asOf`
 * zählen nur Settlements, deren Buchungsdatum nicht danach liegt (Prüfstein 3:
 * am 31.12. ist die Zahlung vom Januar noch nicht „passiert“).
 */
function settledCentsFor(db: DbOrTx, itemId: string, asOf?: string): number {
  const rows = db
    .select({ amountCents: financeOpenItemSettlements.amountCents, entryDate: financeEntries.entryDate, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, itemId))
    .all();
  return rows
    .filter((r) => r.status === 'final' && r.reversedByEntryId === null && (asOf === undefined || r.entryDate <= asOf))
    .reduce((s, r) => s + r.amountCents, 0);
}

/**
 * Ob irgendein Settlement existiert — egal, ob an einem Entwurf oder
 * festgeschrieben: die Ändern-Sperre, und für die Vorschläge der Arbeitsliste
 * (F5) „schon vergeben“ — eine Zahlung, die ein Entwurf begleicht, wird kein
 * zweites Mal vorgeschlagen.
 */
export function openItemHasAnySettlementInternal(db: DbOrTx, itemId: string): boolean {
  return !!db.select({ id: financeOpenItemSettlements.id }).from(financeOpenItemSettlements).where(eq(financeOpenItemSettlements.openItemId, itemId)).get();
}

/** Ob eine festgeschriebene, nicht stornierte Zahlung daran hängt (Storno-Sperre für `cancelOpenItem`). */
function hasActiveSettlement(db: DbOrTx, itemId: string): boolean {
  return settledCentsFor(db, itemId) !== 0;
}

/** `openCentsInternal`: Betrag − Σ aktive Settlements, ohne Rechteprüfung — für F2c und interne Verwendung. */
export function openCentsInternal(db: DbOrTx, itemId: string, asOf?: string): number {
  const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, itemId)).get();
  if (!item) return 0;
  return item.amountCents - settledCentsFor(db, itemId, asOf);
}

/** Was am Stichtag offen war — für die Vermögensübersicht (F2c). Reine Abfrage, ohne Rechteprüfung. */
export function openItemsAtInternal(db: DbOrTx, date: string): { id: string; kind: 'receivable' | 'payable'; openCents: number }[] {
  const items = db.select().from(financeOpenItems).where(lte(financeOpenItems.itemDate, date)).all();
  return items
    .filter((item) => item.cancelledAt === null)
    .map((item) => ({ id: item.id, kind: item.kind as 'receivable' | 'payable', openCents: item.amountCents - settledCentsFor(db, item.id, date) }))
    .filter((r) => r.openCents !== 0);
}

/**
 * Überfällige offene Zahlungen, ohne Rechteprüfung — für die Kachel unter
 * `finance.overview` (Stufe unter `finance.read`, das `listOpenItems`
 * verlangt) und den Reiter „Fällig“ der Arbeitsliste (F5): nicht stornierte
 * Posten mit Fälligkeit vor `today` und noch offenem Betrag
 * (`openCentsInternal`, Spec 5.6 — nie gespeichert).
 */
export function overdueOpenItemsInternal(db: DbOrTx, today: string, kind?: 'receivable' | 'payable'): (FinanceOpenItemRow & { openCents: number })[] {
  const where = kind ? and(isNull(financeOpenItems.cancelledAt), eq(financeOpenItems.kind, kind)) : isNull(financeOpenItems.cancelledAt);
  const rows = db.select().from(financeOpenItems).where(where).all();
  return rows
    .filter((r) => r.dueOn !== null && r.dueOn < today)
    .map((r) => ({ ...r, openCents: openCentsInternal(db, r.id) }))
    .filter((r) => r.openCents !== 0);
}

function openItemViewOf(db: DbOrTx, row: FinanceOpenItemRow): OpenItemView {
  const settledCents = settledCentsFor(db, row.id);
  const openCents = row.amountCents - settledCents;
  const state: OpenItemView['state'] = row.cancelledAt !== null ? 'cancelled' : settledCents === row.amountCents ? 'settled' : settledCents > row.amountCents ? 'overpaid' : 'open';
  return { ...row, settledCents, openCents, state };
}

/** Nur Zählwerte und IDs (Spec 10.3): nie die Zahlungsreferenz, nie die Notiz, nie der Kontakt. */
function auditFields(row: FinanceOpenItemRow): Record<string, unknown> {
  return { kind: row.kind, itemDate: row.itemDate, amountCents: row.amountCents, dueOn: row.dueOn, documentId: row.documentId, originType: row.originType, originId: row.originId, cancelled: row.cancelledAt !== null };
}

/** Prüft ein optionales Dokument wie `attachDocument` — festgeschrieben, nicht storniert. `null`, wenn keins angegeben. */
async function checkOptionalDocument(deps: Deps, ctx: CallContext, documentId: string | null | undefined): Promise<Result<{ id: string } | null>> {
  if (!documentId) return ok(null);
  const record = await getDocumentRecord(deps, ctx, documentId);
  if (!record.ok) return record;
  if (record.value.phase !== 'issued') return financeConflict('documentNotFinal');
  if (record.value.status === 'voided') return financeConflict('documentVoided');
  return ok({ id: record.value.id });
}

const lineTemplateSchema = z.array(z.record(z.string(), z.unknown())).nullable().optional();

const createSchema = z.object({
  kind: z.enum(['receivable', 'payable']),
  itemDate: z.string().date(),
  contactId: z.string().min(1).nullable().optional(),
  amountCents: z.number().int().positive(),
  dueOn: z.string().date().nullable().optional(),
  documentId: z.string().min(1).nullable().optional(),
  originType: z.string().min(1).nullable().optional(),
  originId: z.string().min(1).nullable().optional(),
  paymentReference: z.string().trim().min(1).max(120).nullable().optional(),
  lineTemplate: lineTemplateSchema,
});

/** `finance.entriesWrite`: eine Forderung oder Verbindlichkeit anlegen — außerhalb des Journals. */
export async function createOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (v.contactId && !contactExists(deps.db, v.contactId)) return notFound('contact', v.contactId);
  const doc = await checkOptionalDocument(deps, ctx, v.documentId);
  if (!doc.ok) return doc;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const row: FinanceOpenItemRow = {
      id: newId(), kind: v.kind, itemDate: v.itemDate, contactId: v.contactId ?? null, amountCents: v.amountCents, dueOn: v.dueOn ?? null,
      documentId: v.documentId ?? null, originType: v.originType ?? null, originId: v.originId ?? null, paymentReference: v.paymentReference ?? null,
      lineTemplate: v.lineTemplate ? JSON.stringify(v.lineTemplate) : null, cancelledAt: null, cancelledByUserId: null, cancelNote: null,
      createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now,
    };
    tx.insert(financeOpenItems).values(row).run();
    if (doc.value) linkDocumentInternal(tx, deps, { documentId: doc.value.id, entityType: 'financeOpenItem', entityId: row.id });
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.create', entity: 'financeOpenItem', id: row.id, after: auditFields(row), summary: `Posten ${row.id} angelegt` });
    return ok(openItemViewOf(tx, row));
  });
}

const updateSchema = z.object({
  id: z.string().min(1),
  expectedVersion: expectedVersionField,
  itemDate: z.string().date().optional(),
  contactId: z.string().min(1).nullable().optional(),
  amountCents: z.number().int().positive().optional(),
  dueOn: z.string().date().nullable().optional(),
  documentId: z.string().min(1).nullable().optional(),
  originType: z.string().min(1).nullable().optional(),
  originId: z.string().min(1).nullable().optional(),
  paymentReference: z.string().trim().min(1).max(120).nullable().optional(),
  lineTemplate: lineTemplateSchema,
});

/** `finance.entriesWrite`: ändern, solange kein Settlement existiert — auch keines an einem Entwurf (`openItemInUse`). */
export async function updateOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, updateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const before = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, v.id)).get();
  if (!before) return notFound('financeOpenItem', v.id);
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  if (openItemHasAnySettlementInternal(deps.db, before.id)) return financeConflict('openItemInUse');
  if (v.contactId !== undefined && v.contactId !== null && !contactExists(deps.db, v.contactId)) return notFound('contact', v.contactId);
  const doc = v.documentId !== undefined ? await checkOptionalDocument(deps, ctx, v.documentId) : ok(null);
  if (!doc.ok) return doc;

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after: FinanceOpenItemRow = {
      ...before,
      itemDate: v.itemDate ?? before.itemDate,
      contactId: v.contactId === undefined ? before.contactId : v.contactId,
      amountCents: v.amountCents ?? before.amountCents,
      dueOn: v.dueOn === undefined ? before.dueOn : v.dueOn,
      documentId: v.documentId === undefined ? before.documentId : v.documentId,
      originType: v.originType === undefined ? before.originType : v.originType,
      originId: v.originId === undefined ? before.originId : v.originId,
      paymentReference: v.paymentReference === undefined ? before.paymentReference : v.paymentReference,
      lineTemplate: v.lineTemplate === undefined ? before.lineTemplate : v.lineTemplate ? JSON.stringify(v.lineTemplate) : null,
      updatedAt: now,
    };
    tx.update(financeOpenItems).set(after).where(eq(financeOpenItems.id, before.id)).run();
    if (doc.value) linkDocumentInternal(tx, deps, { documentId: doc.value.id, entityType: 'financeOpenItem', entityId: before.id });
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.update', entity: 'financeOpenItem', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Posten ${before.id} geändert` });
    return ok(openItemViewOf(tx, after));
  });
}

const cancelSchema = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(500) });

/**
 * `finance.entriesFinalize`, **`humanOnly`**: ein Irrtum wird ohne Zahlung
 * erledigt, nie gelöscht — ein endgültiger Schritt, wie das Festschreiben
 * selbst. Nur wenn nichts Festgeschriebenes daran hängt, und nie für einen
 * Posten mit Herkunft (`originType`) — der wird über seinen Vorgang erledigt.
 */
export async function cancelOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesFinalize');
  if (denied) return denied;
  const humanOnly = requireHumanChannel(deps, ctx, 'finance.mcpHumanOnlyAllowed');
  if (humanOnly) return humanOnly;
  const parsed = validate(deps, cancelSchema, input);
  if (!parsed.ok) return parsed;
  const before = deps.db.select().from(financeOpenItems).where(eq(financeOpenItems.id, parsed.value.id)).get();
  if (!before) return notFound('financeOpenItem', parsed.value.id);
  if (before.originType !== null) return financeConflict('openItemHasOrigin');
  if (hasActiveSettlement(deps.db, before.id)) return financeConflict('openItemHasPayments');

  return deps.db.transaction((tx: DbOrTx) => {
    const now = isoNow(deps.clock);
    const after: FinanceOpenItemRow = { ...before, cancelledAt: now, cancelledByUserId: ctx.userId, cancelNote: parsed.value.note, updatedAt: now };
    tx.update(financeOpenItems).set(after).where(eq(financeOpenItems.id, before.id)).run();
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.cancel', entity: 'financeOpenItem', id: before.id, before: auditFields(before), after: auditFields(after), summary: `Posten ${before.id} ohne Zahlung erledigt` });
    return ok(openItemViewOf(tx, after));
  });
}

const listSchema = z.object({
  kind: z.enum(['receivable', 'payable']).optional(),
  state: z.enum(['open', 'settled', 'overpaid', 'cancelled', 'all']).default('open'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** `finance.read`. Die EÜR sieht offene Posten nie — sie stehen außerhalb des Journals. */
export async function listOpenItems(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: OpenItemView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const f = parsed.value;
  const where = f.kind ? and(eq(financeOpenItems.kind, f.kind)) : undefined;
  const rows = deps.db.select().from(financeOpenItems).where(where).orderBy(desc(financeOpenItems.itemDate)).all();
  const views = rows.map((r) => openItemViewOf(deps.db, r)).filter((v) => f.state === 'all' || v.state === f.state);
  const total = views.length;
  const items = views.slice(f.offset, f.offset + f.limit);
  return ok({ items, total });
}

/** `finance_open_item_save` (Spec 10.2): ein Verteiler statt zweier Werkzeuge — `id` dabei entscheidet. */
export async function saveOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const hasId = typeof input === 'object' && input !== null && typeof (input as Record<string, unknown>).id === 'string';
  return hasId ? updateOpenItem(deps, ctx, input) : createOpenItem(deps, ctx, input);
}

export interface OpenItemSettlementView {
  entryId: string;
  entryNumber: string | null;
  amountCents: number;
  entryDate: string;
}

const listSettlementsSchema = z.object({ openItemId: z.string().min(1) });

/**
 * `finance.read`: welche festgeschriebenen, nicht stornierten Buchungen
 * einen offenen Posten begleichen — für „Wird beglichen durch“ (Task 3, A6).
 * Dieselbe Auswahl wie `settledCentsFor`, hier mit Buchungsnummer statt nur
 * der Summe.
 */
export async function listOpenItemSettlements(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemSettlementView[]>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, listSettlementsSchema, input);
  if (!parsed.ok) return parsed;
  const item = deps.db.select({ id: financeOpenItems.id }).from(financeOpenItems).where(eq(financeOpenItems.id, parsed.value.openItemId)).get();
  if (!item) return notFound('financeOpenItem', parsed.value.openItemId);

  const rows = deps.db
    .select({
      entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate,
      amountCents: financeOpenItemSettlements.amountCents, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId,
    })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, parsed.value.openItemId))
    .all();
  const settlements = rows
    .filter((r) => r.status === 'final' && r.reversedByEntryId === null)
    .map((r) => ({ entryId: r.entryId, entryNumber: r.entryNumber, amountCents: r.amountCents, entryDate: r.entryDate }));
  return ok(settlements);
}
