import { readSetting, todayIn, type DbOrTx, type Deps } from '@kompass/core';
import { addBusinessDays } from './business-days';
import { runFullyBookedInternal } from './booking';
import { and, asc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { financeDirectDebitItems, financeDirectDebitReturns, financeDirectDebitRuns, type DirectDebitReturnResolution, type DirectDebitRunStatus, type FinanceDirectDebitReturnRow } from '../schema';

/**
 * Plan N1 (M41): Einzüge, die nie eingereicht wurden und deren Einreichfenster vorbei ist (`submitBy` vor heute) — sie
 * gelten als verfallen (berechnet), binden ihre Posten nicht mehr und lassen sich nur noch verwerfen. Die Zeilen bleiben,
 * damit eine Gutschrift, die die Bank doch noch bucht, über die End-to-End-ID erkannt wird.
 */
export function expiredRunIdsInternal(deps: Deps, db: DbOrTx = deps.db): Set<string> {
  const today = todayIn(deps);
  const lead = readSetting<number>(deps, 'finance.sepa.leadBusinessDays');
  return new Set(
    db
      .select({ id: financeDirectDebitRuns.id, collectionDate: financeDirectDebitRuns.collectionDate })
      .from(financeDirectDebitRuns)
      .where(inArray(financeDirectDebitRuns.status, ['draft', 'fileCreated']))
      .all()
      .filter((r) => addBusinessDays(r.collectionDate, -lead) < today)
      .map((r) => r.id),
  );
}

/** Gespeicherte Zustände eines Einzugs, in denen seine Posten das Mandat und die Rate binden — bis zur Gutschrift (`openRunItemsInternal`). */
export const OPEN_RUN_STATUSES: readonly DirectDebitRunStatus[] = ['draft', 'fileCreated', 'submitted'];

/**
 * Die Posten in Einzügen, die nicht storniert sind, ohne herausgenommene — die Grundlage für „steckt schon in einem
 * Einzug“ (Plan L2, Review Focus 2). Ohne Rechteprüfung, für die Dienste der Lastschrift.
 */
export function activeRunItemsInternal(db: DbOrTx, where: { source?: 'openItem' | 'pledge'; sourceId?: string; mandateId?: string; statuses?: readonly DirectDebitRunStatus[]; installmentFrom?: string; excludeRunIds?: ReadonlySet<string> }) {
  const rows = db
    .select({ item: financeDirectDebitItems, collectionDate: financeDirectDebitRuns.collectionDate, status: financeDirectDebitRuns.status })
    .from(financeDirectDebitItems)
    .innerJoin(financeDirectDebitRuns, eq(financeDirectDebitRuns.id, financeDirectDebitItems.runId))
    .where(
      and(
        isNull(financeDirectDebitItems.removedAt),
        where.statuses ? inArray(financeDirectDebitRuns.status, [...where.statuses]) : ne(financeDirectDebitRuns.status, 'cancelled'),
        where.source ? eq(financeDirectDebitItems.source, where.source) : undefined,
        where.sourceId ? eq(financeDirectDebitItems.sourceId, where.sourceId) : undefined,
        where.mandateId ? eq(financeDirectDebitItems.mandateId, where.mandateId) : undefined,
        where.installmentFrom ? gte(financeDirectDebitItems.installmentOn, where.installmentFrom) : undefined,
      ),
    )
    .orderBy(asc(financeDirectDebitItems.installmentOn), asc(financeDirectDebitRuns.collectionDate))
    .all();
  // Plan N1 (M41): Ein verfallener Einzug (`expiredRunIdsInternal`) bindet seine Posten nicht mehr.
  return where.excludeRunIds ? rows.filter((r) => !where.excludeRunIds!.has(r.item.runId)) : rows;
}

/** Posten in Einzügen, die noch nicht gebucht sind (L3 Nacharbeit: „gebucht“ ist berechnet, gespeichert bleibt `submitted`). */
export function openRunItemsInternal(db: DbOrTx, where: Omit<Parameters<typeof activeRunItemsInternal>[1], 'statuses'>) {
  const rows = activeRunItemsInternal(db, { ...where, statuses: OPEN_RUN_STATUSES });
  const booked = new Map<string, boolean>();
  return rows.filter((r) => {
    if (r.status !== 'submitted') return true;
    if (!booked.has(r.item.runId)) booked.set(r.item.runId, runFullyBookedInternal(db, r.item.runId));
    return !booked.get(r.item.runId);
  });
}

/** Die Fälle „Rückgabe zu klären“ zu Posten, je Posten der jüngste (Plan L3). */
export function returnsByItemInternal(db: DbOrTx, itemIds: readonly string[]): Map<string, FinanceDirectDebitReturnRow> {
  if (itemIds.length === 0) return new Map();
  const rows = db.select().from(financeDirectDebitReturns).where(inArray(financeDirectDebitReturns.itemId, [...itemIds])).orderBy(asc(financeDirectDebitReturns.createdAt), asc(financeDirectDebitReturns.id)).all();
  return new Map(rows.map((r) => [r.itemId, r] as const));
}

/**
 * Die Raten einer Zusage in Einzügen, für `pledgeRates`: „im Einzug“ nur ohne Rückgabe; zurückgegebene mit dem Weg aus
 * „Rückgabe klären“ (Plan L3).
 */
export function pledgeRunItemsInternal(db: DbOrTx, pledgeId: string): { dueOn: string; state: 'inRun' }[] {
  return pledgeRunSourcesInternal(db, pledgeId).runItems;
}

export function pledgeRunSourcesInternal(db: DbOrTx, pledgeId: string, excludeRunIds?: ReadonlySet<string>): { runItems: { dueOn: string; state: 'inRun' }[]; returns: { dueOn: string; resolution: DirectDebitReturnResolution | null }[] } {
  const items = activeRunItemsInternal(db, { source: 'pledge', sourceId: pledgeId, excludeRunIds }).filter((r) => r.item.installmentOn);
  const returns = returnsByItemInternal(db, items.map((r) => r.item.id));
  return {
    runItems: items.filter((r) => !returns.has(r.item.id)).map((r) => ({ dueOn: r.item.installmentOn!, state: 'inRun' as const })),
    returns: items.flatMap((r) => {
      const back = returns.get(r.item.id);
      return back ? [{ dueOn: r.item.installmentOn!, resolution: back.status === 'open' ? null : back.resolution }] : [];
    }),
  };
}

/**
 * Plan L3: Wie steht ein offener Posten nach einer Rückgabe? `open` (noch zu klären — Kompass zieht nie von selbst
 * erneut ein), `transfer` (zur Überweisung aufgefordert), `recollect` (erneut einziehen, mit neuer Ankündigung), `none`.
 */
export function openItemReturnStateInternal(db: DbOrTx, openItemId: string): 'none' | 'open' | 'transfer' | 'recollect' {
  const items = db.select({ id: financeDirectDebitItems.id }).from(financeDirectDebitItems).where(and(eq(financeDirectDebitItems.source, 'openItem'), eq(financeDirectDebitItems.sourceId, openItemId))).all();
  const latest = [...returnsByItemInternal(db, items.map((i) => i.id)).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1);
  if (!latest) return 'none';
  if (latest.status === 'open') return 'open';
  if (latest.resolution === 'requestTransfer') return 'transfer';
  if (latest.resolution === 'recollect') return 'recollect';
  return 'none';
}

/** Posten in Einzügen ohne Rückgabe — die eine Rückgabe hat, binden nicht mehr (Plan L3). */
export function unreturnedRunItemsInternal(db: DbOrTx, where: Parameters<typeof activeRunItemsInternal>[1]) {
  const items = activeRunItemsInternal(db, where);
  const returns = returnsByItemInternal(db, items.map((r) => r.item.id));
  return items.filter((r) => !returns.has(r.item.id));
}

/** Steckt der offene Posten in einem Einzug, der bei der Bank eingereicht ist? Dann wird er nicht mehr neu berechnet (Spec § 7.4 Schritt 4). */
export function openItemInSubmittedRunInternal(db: DbOrTx, openItemId: string): boolean {
  return activeRunItemsInternal(db, { source: 'openItem', sourceId: openItemId, statuses: ['submitted', 'booked'] }).length > 0;
}

/**
 * Je Rate einer Zusage der jüngste Einzug, in dem sie steckt (nicht verworfen, nicht herausgenommen), und eine offene
 * Rückgabe dazu — für die Spalte „Einzug“ der Ratenliste und „Rückgabe klären“ an der Zusage (Handoff 2a § 1.5).
 */
export function pledgeRateRunsInternal(db: DbOrTx, pledgeId: string): Map<string, { runId: string; collectionDate: string; openReturnId: string | null }> {
  const items = activeRunItemsInternal(db, { source: 'pledge', sourceId: pledgeId }).filter((r) => r.item.installmentOn);
  const returns = returnsByItemInternal(db, items.map((r) => r.item.id));
  const out = new Map<string, { runId: string; collectionDate: string; openReturnId: string | null }>();
  for (const r of items) {
    const back = returns.get(r.item.id);
    const prev = out.get(r.item.installmentOn!);
    if (prev && prev.collectionDate > r.collectionDate) continue;
    out.set(r.item.installmentOn!, { runId: r.item.runId, collectionDate: r.collectionDate, openReturnId: back?.status === 'open' ? back.id : null });
  }
  return out;
}
