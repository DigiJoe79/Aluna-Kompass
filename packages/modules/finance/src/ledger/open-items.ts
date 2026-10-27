import { expectedVersionField, invalid, isoNow, newId, notFound, ok, requirePermission, staleVersion, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { getDocumentRecord, linkDocumentInternal } from '@kompass/module-dms';
import { and, desc, eq, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { financeEntries, financeMoneyLines, financeOpenItems, financeOpenItemSettlements, type FinanceOpenItemRow } from '../schema';
import { requireFinanceRead } from './access';
import { TAX_CODES } from './codes';
import { registeredOpenItemOrigins } from './origins';
import { fiscalYearForInternal, fiscalYearStatusInternal } from './fiscal-years';

/**
 * Rechenschaft D1 Task 10b (Befund A3): Eine offene Zahlung mit Datum in einem abgeschlossenen Geschäftsjahr änderte
 * dessen Stand (Kassenbericht, Vermögensübersicht) — abgeschlossen heißt fest. Anlegen und Ändern lehnen ab.
 */
function closedYearRefusal(db: DbOrTx, itemDate: string) {
  const year = fiscalYearForInternal(db, itemDate);
  return year && fiscalYearStatusInternal(db, year.id) === 'closed' ? financeConflict('fiscalYearClosed', { year: year.designation }) : null;
}

/** Eine Zeile der Zuordnungsvorlage — die Vorbelegung, mit der `bookFromTransaction` einen offenen Posten begleicht. */

export interface OpenItemView extends Omit<FinanceOpenItemRow, 'lineTemplate'> {
  settledCents: number;
  openCents: number;
  state: 'open' | 'settled' | 'overpaid' | 'cancelled';
  /** Befund 12: die Datenbank speichert JSON-Text; die Sicht liefert das schon geparste Array. */
  lineTemplate: LineTemplateEntry[] | null;
  /** Befund 6: Summe der Settlements an einem Entwurf — noch nicht "passiert", aber schon geplant. */
  draftSettlementCents: number;
}

function contactExists(db: DbOrTx, id: string): boolean {
  return !!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id)).get();
}

/**
 * Σ Settlements festgeschriebener, nicht stornierter Buchungen — ein Storno
 * gibt den Posten wieder frei, ohne dass eine Zeile gelöscht wird. Mit `asOf`
 * zählen nur Settlements, deren Buchungsdatum nicht danach liegt (Prüfstein 3:
 * am 31.12. ist die Zahlung vom Januar noch nicht „passiert“). Rück-Ausgleiche
 * (Spec Mitglieder und Lastschrift § 6.2) ziehen ab — aber nur, solange der
 * Ausgleich, den sie zurücknehmen, selbst noch zählt: Ist die zurückgegebene
 * Zahlung zurückgenommen, öffnete der Rück-Ausgleich sonst doppelt.
 */
function settledCentsFor(db: DbOrTx, itemId: string, asOf?: string): number {
  const rows = db
    .select({ id: financeOpenItemSettlements.id, amountCents: financeOpenItemSettlements.amountCents, reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, entryDate: financeEntries.entryDate, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, itemId))
    .all();
  const live = (r: (typeof rows)[number]) => r.status === 'final' && r.reversedByEntryId === null;
  const liveIds = new Set(rows.filter(live).map((r) => r.id));
  return rows
    .filter((r) => live(r) && (asOf === undefined || r.entryDate <= asOf))
    .filter((r) => r.reversesSettlementId === null || liveIds.has(r.reversesSettlementId))
    .reduce((s, r) => s + (r.reversesSettlementId === null ? r.amountCents : -r.amountCents), 0);
}

/**
 * Befund 6: Σ Settlements an einem Entwurf (noch nicht festgeschrieben) — „Zahlung liegt als Entwurf vor“ statt nur
 * „überfällig“. Ein Rück-Ausgleich im Entwurf ist keine Zahlung und zählt nicht.
 */
export function draftSettlementCentsInternal(db: DbOrTx, itemId: string): number {
  const rows = db
    .select({ amountCents: financeOpenItemSettlements.amountCents, reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, status: financeEntries.status })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, itemId))
    .all();
  return rows.filter((r) => r.status === 'draft' && r.reversesSettlementId === null).reduce((s, r) => s + r.amountCents, 0);
}

/**
 * Ob irgendein Settlement existiert — egal, ob an einem Entwurf oder
 * festgeschrieben: die Ändern-Sperre. (Die Vorschläge der Arbeitsliste
 * prüfen enger — nur Entwürfe vergeben eine Zahlung, `import/suggestions.ts`.)
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

function parsedLineTemplate(raw: string | null): LineTemplateEntry[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function openItemViewOf(db: DbOrTx, row: FinanceOpenItemRow): OpenItemView {
  const settledCents = settledCentsFor(db, row.id);
  // Befund 27: Ein Storno ist kein Betrag, der noch aussteht. Nur die Sicht sagt 0; `openCentsInternal` rechnet weiter mit dem Rest, weil seine Aufrufer `<= 0` als bezahlt lesen.
  const openCents = row.cancelledAt !== null ? 0 : row.amountCents - settledCents;
  const state: OpenItemView['state'] = row.cancelledAt !== null ? 'cancelled' : settledCents === row.amountCents ? 'settled' : settledCents > row.amountCents ? 'overpaid' : 'open';
  return { ...row, settledCents, openCents, state, lineTemplate: parsedLineTemplate(row.lineTemplate), draftSettlementCents: draftSettlementCentsInternal(db, row.id) };
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

/** Befund 3: der aktive (nicht stornierte) Posten zu einem Dokument — höchstens einer, auch der Index `finance_open_items_document_active_idx` trägt das. */
export function activeItemForDocumentInternal(db: DbOrTx, documentId: string, exceptId?: string): { id: string; paymentReference: string | null } | undefined {
  const conditions = [eq(financeOpenItems.documentId, documentId), isNull(financeOpenItems.cancelledAt)];
  if (exceptId) conditions.push(ne(financeOpenItems.id, exceptId));
  return db.select({ id: financeOpenItems.id, paymentReference: financeOpenItems.paymentReference }).from(financeOpenItems).where(and(...conditions)).get();
}

/**
 * Eine Zeile der Vorlage, aus der die Arbeitsliste beim Zahlungseingang die Zuordnung vorschlägt
 * (`import/suggestions.ts`): die Felder einer Zuordnungszeile, alle freiwillig — eine Vorlage aus einer Rechnung
 * trägt oft nur Steuerkennzeichen und Kontakt (A3: vorher ein freies Objekt).
 */
export const lineTemplateEntrySchema = z.object({
  categoryId: z.string().min(1).nullable().optional(),
  amountCents: z.number().int().optional(),
  taxCode: z.string().min(1).nullable().optional().describe(`Tax code of the line: ${TAX_CODES.join(', ')}.`),
  projectId: z.string().min(1).nullable().optional(),
  purposeId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  abroad: z.boolean().optional(),
});
export type LineTemplateEntry = z.infer<typeof lineTemplateEntrySchema>;
export const lineTemplateSchema = z.array(lineTemplateEntrySchema).nullable().optional();

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
  /** Befund Y: nur aus `createOpenItemFromInvoice`, wenn die Rechnung wahrscheinlich schon bezahlt ist. */
  probablyPaidReason: z.string().trim().min(1).max(500).nullable().optional(),
});

/** `finance.entriesWrite`: eine Forderung oder Verbindlichkeit anlegen — außerhalb des Journals. */
export async function createOpenItem(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<OpenItemView>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, createSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (isOwnedOrigin(deps, v.originType)) return financeConflict('openItemOriginOwned');
  const closed = closedYearRefusal(deps.db, v.itemDate);
  if (closed) return closed;
  if (v.contactId && !contactExists(deps.db, v.contactId)) return notFound('contact', v.contactId);
  const doc = await checkOptionalDocument(deps, ctx, v.documentId);
  if (!doc.ok) return doc;
  const existing = v.documentId ? activeItemForDocumentInternal(deps.db, v.documentId) : undefined;
  if (existing) return financeConflict('openItemExistsForDocument', { openItemId: existing.id, reference: existing.paymentReference ?? '' });

  return deps.db.transaction((tx: DbOrTx) => {
    const view = createOpenItemInternal(tx, deps, ctx, v);
    if (doc.value) linkDocumentInternal(tx, deps, { documentId: doc.value.id, entityType: 'financeOpenItem', entityId: view.id });
    return ok(view);
  });
}

/**
 * Einen Posten in einer bereits offenen Transaktion anlegen, ohne
 * Rechteprüfung und ohne Dokumentprüfung — für `createOpenItem` und Vorgänge,
 * die ihn im eigenen Namen anlegen (F8a: die Freigabe einer Auslage unter
 * `finance.approve`). Protokolliert wie `createOpenItem`.
 */
export function createOpenItemInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, v: z.infer<typeof createSchema>): OpenItemView {
  const now = isoNow(deps.clock);
  const row: FinanceOpenItemRow = {
    id: newId(), kind: v.kind, itemDate: v.itemDate, contactId: v.contactId ?? null, amountCents: v.amountCents, dueOn: v.dueOn ?? null,
    documentId: v.documentId ?? null, originType: v.originType ?? null, originId: v.originId ?? null, paymentReference: v.paymentReference ?? null,
    lineTemplate: v.lineTemplate ? JSON.stringify(v.lineTemplate) : null, cancelledAt: null, cancelledByUserId: null, cancelNote: null,
    probablyPaidReason: v.probablyPaidReason ?? null, createdByUserId: ctx.userId ?? 'system', createdAt: now, updatedAt: now,
  };
  tx.insert(financeOpenItems).values(row).run();
  financeAudit(tx, deps, ctx, { action: 'finance.openItem.create', entity: 'financeOpenItem', id: row.id, after: auditFields(row) });
  return openItemViewOf(tx, row);
}

/**
 * Ob ein Herkunftstyp einem anderen Modul gehört (Spec Mitglieder und Lastschrift § 6.1) — über alle installierten
 * Module, damit das Ausschalten eines Moduls seine Posten nicht für die öffentlichen Dienste freigibt.
 */
function isOwnedOrigin(deps: Deps, originType: string | null | undefined): boolean {
  return !!originType && registeredOpenItemOrigins(deps, { includeDisabled: true }).has(originType);
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
  if (isOwnedOrigin(deps, before.originType) || isOwnedOrigin(deps, v.originType)) return financeConflict('openItemOriginOwned');
  const stale = staleVersion(v.expectedVersion, before.updatedAt);
  if (stale) return stale;
  const closed = closedYearRefusal(deps.db, before.itemDate) ?? (v.itemDate ? closedYearRefusal(deps.db, v.itemDate) : null);
  if (closed) return closed;
  if (openItemHasAnySettlementInternal(deps.db, before.id)) return financeConflict('openItemInUse');
  if (v.contactId !== undefined && v.contactId !== null && !contactExists(deps.db, v.contactId)) return notFound('contact', v.contactId);
  const doc = v.documentId !== undefined ? await checkOptionalDocument(deps, ctx, v.documentId) : ok(null);
  if (!doc.ok) return doc;
  const existing = v.documentId && v.documentId !== before.documentId ? activeItemForDocumentInternal(deps.db, v.documentId, before.id) : undefined;
  if (existing) return financeConflict('openItemExistsForDocument', { openItemId: existing.id, reference: existing.paymentReference ?? '' });

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
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.update', entity: 'financeOpenItem', id: before.id, before: auditFields(before), after: auditFields(after) });
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
  const humanOnly = requireHumanChannelFinance(deps, ctx);
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
    financeAudit(tx, deps, ctx, { action: 'finance.openItem.cancel', entity: 'financeOpenItem', id: before.id, before: auditFields(before), after: auditFields(after) });
    return ok(openItemViewOf(tx, after));
  });
}

const originCreateSchema = z.object({
  originType: z.string().min(1),
  originId: z.string().min(1),
  contactId: z.string().min(1),
  amountCents: z.number().int().positive(),
  itemDate: z.string().date(),
  dueOn: z.string().date(),
  paymentReference: z.string().trim().min(1).max(120).nullable(),
  lineTemplate: z.array(lineTemplateEntrySchema),
});

/** Ein offener Posten mit Herkunft aus einem anderen Modul — immer eine Forderung (Spec Mitglieder und Lastschrift § 6.1). */
export type OriginOpenItemInput = z.infer<typeof originCreateSchema>;

/**
 * Interne API für Module mit `dependsOn: ['finance']` (Spec Mitglieder und Lastschrift § 6.1): eine Forderung mit
 * angemeldeter Herkunft anlegen, in der Transaktion des aufrufenden Dienstes. **Keine eigene Rechteprüfung** — der
 * Dienst des Moduls, der hier hereinruft, hat sein Recht geprüft (Prinzip 6 gilt für ihn). Protokolliert wie
 * `createOpenItem`.
 */
export function createOriginOpenItem(tx: DbOrTx, deps: Deps, ctx: CallContext, input: OriginOpenItemInput): Result<OpenItemView> {
  const parsed = validate(deps, originCreateSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const closed = closedYearRefusal(tx, v.itemDate);
  if (closed) return closed;
  if (!registeredOpenItemOrigins(deps).has(v.originType)) return financeConflict('openItemOriginUnknown');
  if (!contactExists(tx, v.contactId)) return notFound('contact', v.contactId);
  return ok(createOpenItemInternal(tx, deps, ctx, { ...v, kind: 'receivable' }));
}

/** Der Posten mit dieser Herkunft, nicht storniert — sonst der Grund. */
function ownOriginItem(tx: DbOrTx, openItemId: string, originType: string): Result<FinanceOpenItemRow> {
  const row = tx.select().from(financeOpenItems).where(eq(financeOpenItems.id, openItemId)).get();
  if (!row) return notFound('financeOpenItem', openItemId);
  if (row.originType !== originType) return financeConflict('openItemOriginOwned');
  if (row.cancelledAt !== null) return financeConflict('openItemCancelled');
  return ok(row);
}

const rescheduleSchema = z.object({ openItemId: z.string().min(1), originType: z.string().min(1), dueOn: z.string().date() });

/** Interne API (wie `createOriginOpenItem`, ohne eigene Rechteprüfung): die Fälligkeit eines eigenen Postens verschieben. */
export function rescheduleOriginOpenItem(tx: DbOrTx, deps: Deps, ctx: CallContext, input: z.infer<typeof rescheduleSchema>): Result<OpenItemView> {
  const parsed = validate(deps, rescheduleSchema, input);
  if (!parsed.ok) return parsed;
  const before = ownOriginItem(tx, parsed.value.openItemId, parsed.value.originType);
  if (!before.ok) return before;
  const after: FinanceOpenItemRow = { ...before.value, dueOn: parsed.value.dueOn, updatedAt: isoNow(deps.clock) };
  tx.update(financeOpenItems).set({ dueOn: after.dueOn, updatedAt: after.updatedAt }).where(eq(financeOpenItems.id, after.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.openItem.reschedule', entity: 'financeOpenItem', id: after.id, before: { dueOn: before.value.dueOn }, after: { dueOn: after.dueOn } });
  return ok(openItemViewOf(tx, after));
}

const originCancelSchema = z.object({ openItemId: z.string().min(1), originType: z.string().min(1), note: z.string().trim().min(1).max(500).nullable() });

/**
 * Interne API (wie `createOriginOpenItem`, ohne eigene Rechteprüfung): einen eigenen Posten ohne Zahlung erledigen —
 * nur, solange keine festgeschriebene, nicht zurückgenommene Zahlung daran hängt. Ein bloßer Entwurf hindert nicht;
 * er scheitert beim Festschreiben an `openItemCancelled`. Protokolliert wie `cancelOpenItem`.
 */
export function cancelOriginOpenItem(tx: DbOrTx, deps: Deps, ctx: CallContext, input: z.infer<typeof originCancelSchema>): Result<OpenItemView> {
  const parsed = validate(deps, originCancelSchema, input);
  if (!parsed.ok) return parsed;
  const before = ownOriginItem(tx, parsed.value.openItemId, parsed.value.originType);
  if (!before.ok) return before;
  if (settledCentsFor(tx, before.value.id) > 0) return financeConflict('openItemHasPayments');
  const now = isoNow(deps.clock);
  const after: FinanceOpenItemRow = { ...before.value, cancelledAt: now, cancelledByUserId: ctx.userId, cancelNote: parsed.value.note, updatedAt: now };
  tx.update(financeOpenItems).set(after).where(eq(financeOpenItems.id, after.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.openItem.cancel', entity: 'financeOpenItem', id: after.id, before: auditFields(before.value), after: auditFields(after) });
  return ok(openItemViewOf(tx, after));
}

const originReduceSchema = z.object({ openItemId: z.string().min(1), originType: z.string().min(1), amountCents: z.number().int().min(1).max(100_000_000) });

/**
 * Interne API (wie `cancelOriginOpenItem`, ohne eigene Rechteprüfung): einen eigenen Posten auf einen kleineren Betrag
 * kürzen — den Rest erlassen (Plan M4 Task 5b). Nicht unter die Summe der festgeschriebenen Zahlungen; ist er danach
 * ausgeglichen, ist er erledigt. Protokoll: der neue Betrag, keine Person, kein Freitext.
 */
export function reduceOriginOpenItem(tx: DbOrTx, deps: Deps, ctx: CallContext, input: z.infer<typeof originReduceSchema>): Result<OpenItemView> {
  const parsed = validate(deps, originReduceSchema, input);
  if (!parsed.ok) return parsed;
  const before = ownOriginItem(tx, parsed.value.openItemId, parsed.value.originType);
  if (!before.ok) return before;
  const { amountCents } = parsed.value;
  if (amountCents >= before.value.amountCents) return invalid([{ path: 'amountCents', message: 'notLower' }]);
  if (amountCents < settledCentsFor(tx, before.value.id)) return financeConflict('openItemBelowSettled');
  const after: FinanceOpenItemRow = { ...before.value, amountCents, updatedAt: isoNow(deps.clock) };
  tx.update(financeOpenItems).set({ amountCents, updatedAt: after.updatedAt }).where(eq(financeOpenItems.id, after.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.openItem.reduce', entity: 'financeOpenItem', id: after.id, before: { amountCents: before.value.amountCents }, after: { amountCents }, params: { amountCents } });
  return ok(openItemViewOf(tx, after));
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

  return ok(openItemSettlementsInternal(deps.db, parsed.value.openItemId));
}

/** Die festgeschriebenen, nicht stornierten Zahlungen eines Postens, ohne Rechteprüfung — für „ausgezahlt am“ der Auslagen (F8a). */
export function openItemSettlementsInternal(db: DbOrTx, openItemId: string): OpenItemSettlementView[] {
  const rows = db
    .select({
      entryId: financeEntries.id, entryNumber: financeEntries.number, entryDate: financeEntries.entryDate,
      amountCents: financeOpenItemSettlements.amountCents, reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId,
    })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, openItemId))
    .all();
  return rows
    .filter((r) => r.status === 'final' && r.reversedByEntryId === null)
    // Eine Rückgabe (Rück-Ausgleich, Spec Mitglieder und Lastschrift § 6.2) steht mit negativem Betrag darin — die Summe bleibt die von `settledCentsFor`.
    .map((r) => ({ entryId: r.entryId, entryNumber: r.entryNumber, amountCents: r.reversesSettlementId === null ? r.amountCents : -r.amountCents, entryDate: r.entryDate }));
}

/**
 * Die Zahlungen eines Postens, die noch zählen, ohne Rechteprüfung — für „ausgezahlt am“ von Auslagen und
 * Partnerzahlungen: gewöhnliche Ausgleiche an festgeschriebenen, nicht zurückgenommenen Buchungen, abzüglich der
 * Rück-Ausgleiche, die selbst zählen (Spec Mitglieder und Lastschrift § 6.2). Ganz zurückgegebene fallen weg; der
 * Betrag ist der Rest.
 */
export function countingPaymentsInternal(db: DbOrTx, openItemId: string): { entryDate: string; amountCents: number }[] {
  const rows = db
    .select({ id: financeOpenItemSettlements.id, amountCents: financeOpenItemSettlements.amountCents, reversesSettlementId: financeOpenItemSettlements.reversesSettlementId, entryDate: financeEntries.entryDate, status: financeEntries.status, reversedByEntryId: financeEntries.reversedByEntryId })
    .from(financeOpenItemSettlements)
    .innerJoin(financeMoneyLines, eq(financeOpenItemSettlements.moneyLineId, financeMoneyLines.id))
    .innerJoin(financeEntries, eq(financeMoneyLines.entryId, financeEntries.id))
    .where(eq(financeOpenItemSettlements.openItemId, openItemId))
    .all()
    .filter((r) => r.status === 'final' && r.reversedByEntryId === null);
  return rows
    .filter((r) => r.reversesSettlementId === null)
    .map((r) => ({ entryDate: r.entryDate, amountCents: r.amountCents - rows.filter((b) => b.reversesSettlementId === r.id).reduce((s, b) => s + b.amountCents, 0) }))
    .filter((r) => r.amountCents > 0);
}
