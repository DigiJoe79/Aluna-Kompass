import { isoNow, newId, type DbOrTx, type Deps } from '@kompass/core';
import { and, eq, gt, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { financeAllocationLines, financeDirectDebitItems, financeDirectDebitReturns, financeEntries, financeMoneyLines, financeRawTransactions, type DirectDebitRunStatus } from '../schema';

/**
 * Gutschrift und Einzug (Plan L3): Welche Posten eines Einzugs durch eine Buchung zugeordnet sind, steht an den
 * Zuordnungszeilen (`direct_debit_item_id`), nie am Posten. Ohne Rechteprüfung, für die Dienste der Finanzen.
 */

/**
 * Posten, die eine Buchung schon trägt — auch ein Entwurf (dann sind sie vergeben); eine zurückgenommene nicht. Nur
 * die Zeilen der Gutschrift (Betrag > 0); die Zeile einer Rückgabe trägt denselben Posten mit negativem Betrag.
 */
export function takenItemIdsInternal(db: DbOrTx): Set<string> {
  return new Set(
    db
      .select({ itemId: financeAllocationLines.directDebitItemId })
      .from(financeAllocationLines)
      .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .where(and(isNotNull(financeAllocationLines.directDebitItemId), gt(financeAllocationLines.amountCents, 0), isNull(financeEntries.reversedByEntryId), isNull(financeEntries.reversesEntryId)))
      .all()
      .map((r) => r.itemId!),
  );
}

/** Zeilen von Buchungen, die weder zurückgenommen noch selbst eine Rücknahme sind, die Posten von Einzügen tragen. */
function itemLineRowsInternal(db: DbOrTx, opts: { itemIds?: readonly string[]; final: boolean; sign: 'credit' | 'return' }) {
  return db
    .select({ line: financeAllocationLines, entryNumber: financeEntries.number, entryStatus: financeEntries.status })
    .from(financeAllocationLines)
    .innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
    .where(
      and(
        opts.itemIds ? inArray(financeAllocationLines.directDebitItemId, [...opts.itemIds]) : isNotNull(financeAllocationLines.directDebitItemId),
        opts.sign === 'credit' ? gt(financeAllocationLines.amountCents, 0) : lt(financeAllocationLines.amountCents, 0),
        opts.final ? eq(financeEntries.status, 'final') : undefined,
        isNull(financeEntries.reversedByEntryId),
        isNull(financeEntries.reversesEntryId),
      ),
    )
    .all();
}

/** Posten, deren Rückgabe festgeschrieben ist (eine negative Zeile mit dem Posten in einer festgeschriebenen Buchung). */
export function returnedItemIdsInternal(db: DbOrTx, itemIds?: readonly string[]): Set<string> {
  if (itemIds && itemIds.length === 0) return new Set();
  return new Set(itemLineRowsInternal(db, { itemIds, final: true, sign: 'return' }).map((r) => r.line.directDebitItemId!));
}

/**
 * Die Zeilen festgeschriebener, nicht zurückgenommener Buchungen, die Posten von Einzügen buchen — mit Buchung und ob
 * der Posten inzwischen zurückgegeben ist.
 */
export function bookedItemLinesInternal(db: DbOrTx, itemIds?: readonly string[]): { lineId: string; itemId: string; entryId: string; entryNumber: string; returned: boolean }[] {
  if (itemIds && itemIds.length === 0) return [];
  const lines = itemLineRowsInternal(db, { itemIds, final: true, sign: 'credit' });
  if (lines.length === 0) return [];
  const returned = returnedItemIdsInternal(db, [...new Set(lines.map((l) => l.line.directDebitItemId!))]);
  return lines.map((l) => ({ lineId: l.line.id, itemId: l.line.directDebitItemId!, entryId: l.line.entryId, entryNumber: l.entryNumber!, returned: returned.has(l.line.directDebitItemId!) }));
}

/** Die Zeilen der Gutschrift eines Postens — auch aus einem Entwurf —, solange seine Rückgabe nicht festgeschrieben ist. Für Vorschlag (2). */
export function creditLinesOfItemInternal(db: DbOrTx, itemId: string): { line: typeof financeAllocationLines.$inferSelect; entryNumber: string | null; entryStatus: 'draft' | 'final' }[] {
  if (returnedItemIdsInternal(db, [itemId]).size > 0) return [];
  return itemLineRowsInternal(db, { itemIds: [itemId], final: false, sign: 'credit' }).map((r) => ({ ...r, entryStatus: r.entryStatus as 'draft' | 'final' }));
}

/** Die gebuchten Raten einer Zusage, für `pledgeRates`: Tag der Rate und die Buchung, die sie trägt — ohne zurückgegebene. */
export function pledgeBookedLinesInternal(db: DbOrTx, pledgeId: string): { dueOn: string; entryId: string; entryNumber: string }[] {
  const items = db
    .select({ id: financeDirectDebitItems.id, installmentOn: financeDirectDebitItems.installmentOn })
    .from(financeDirectDebitItems)
    .where(and(eq(financeDirectDebitItems.source, 'pledge'), eq(financeDirectDebitItems.sourceId, pledgeId), isNull(financeDirectDebitItems.removedAt)))
    .all();
  const dueOf = new Map(items.map((i) => [i.id, i.installmentOn] as const));
  return bookedItemLinesInternal(db, items.map((i) => i.id))
    .filter((l) => !l.returned && dueOf.get(l.itemId))
    .map((l) => ({ dueOn: dueOf.get(l.itemId)!, entryId: l.entryId, entryNumber: l.entryNumber }));
}

/** Ist jeder Posten des Einzugs über eine festgeschriebene Buchung zugeordnet? Berechnet aus den Zuordnungen. */
export function runFullyBookedInternal(db: DbOrTx, runId: string): boolean {
  const items = db.select({ id: financeDirectDebitItems.id }).from(financeDirectDebitItems).where(and(eq(financeDirectDebitItems.runId, runId), isNull(financeDirectDebitItems.removedAt))).all();
  if (items.length === 0) return false;
  const booked = new Set(bookedItemLinesInternal(db, items.map((i) => i.id)).map((l) => l.itemId));
  return items.every((i) => booked.has(i.id));
}

/**
 * Der Zustand eines Einzugs zur Anzeige (L3 Nacharbeit): „gebucht“ wird berechnet, nie gespeichert — ein eingereichter
 * Einzug, dessen Posten alle über festgeschriebene, nicht zurückgenommene Buchungen zugeordnet sind. Wird die
 * Gutschrift zurückgenommen, ist er wieder „eingereicht“. Der gespeicherte Zustand endet bei `submitted`.
 */
export function runStatusInternal(db: DbOrTx, row: { id: string; status: DirectDebitRunStatus }): DirectDebitRunStatus {
  return row.status === 'submitted' && runFullyBookedInternal(db, row.id) ? 'booked' : row.status;
}

/**
 * Beim Festschreiben einer Rückgabe (Plan L3, Spec § 7.7): Für jeden Posten, dessen Zeile die Buchung negativ trägt,
 * entsteht der Fall „Rückgabe zu klären“ — mit Rückgabe-Code des Umsatzes und dem Entgelt der Bank (was der Umsatz
 * über den Posten hinaus abbucht). Einmal je Umsatz und Posten.
 */
export function recordReturnsInternal(tx: DbOrTx, deps: Deps, entryId: string): void {
  const lines = tx.select().from(financeAllocationLines).where(and(eq(financeAllocationLines.entryId, entryId), isNotNull(financeAllocationLines.directDebitItemId), lt(financeAllocationLines.amountCents, 0))).all();
  if (lines.length === 0) return;
  const money = tx.select({ rawTransactionId: financeMoneyLines.rawTransactionId }).from(financeMoneyLines).where(and(eq(financeMoneyLines.entryId, entryId), isNotNull(financeMoneyLines.rawTransactionId))).get();
  if (!money?.rawTransactionId) return;
  const raw = tx.select().from(financeRawTransactions).where(eq(financeRawTransactions.id, money.rawTransactionId)).get();
  if (!raw) return;
  const byItem = new Map<string, number>();
  for (const l of lines) byItem.set(l.directDebitItemId!, (byItem.get(l.directDebitItemId!) ?? 0) - l.amountCents);
  let feeCents = Math.max(0, -raw.amountCents - [...byItem.values()].reduce((sum, c) => sum + c, 0));
  const now = isoNow(deps.clock);
  for (const itemId of byItem.keys()) {
    const known = tx.select({ id: financeDirectDebitReturns.id }).from(financeDirectDebitReturns).where(and(eq(financeDirectDebitReturns.rawTransactionId, raw.id), eq(financeDirectDebitReturns.itemId, itemId))).get();
    if (known) continue;
    tx.insert(financeDirectDebitReturns).values({ id: newId(), itemId, rawTransactionId: raw.id, entryId, returnCode: raw.returnCode, feeCents, status: 'open', createdAt: now }).run();
    feeCents = 0;
  }
}
