import { enabledManifests, isoNow, timeZoneOf, newId, notFound, ok, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type Result } from '@kompass/core';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAudit } from '../audit';
import { financeConflict, requireHumanChannelFinance } from '../errors';
import { zonedDayOf } from '../zoned-days';
import { requireFinanceRead } from '../ledger/access';
import {
  DIRECT_DEBIT_RETURN_RESOLUTIONS,
  DIRECT_DEBIT_RETURN_STATUSES,
  financeDirectDebitItems,
  financeDirectDebitReturns,
  financeDirectDebitRuns,
  financeOpenItems,
  financePledgeRateMarks,
  financeRawTransactions,
  type FinanceDirectDebitReturnRow,
} from '../schema';
import { DIRECT_DEBIT_PERMISSION, endMandateInternal, mandateRowInternal, mandateState } from './mandates';
import { returnCodeInfo } from './return-codes';
import { separateReturnFeeCentsInternal } from './return-fee';
import { openCentsInternal } from '../ledger/open-items';

/**
 * Rückgabe klären (Plan L3, Spec § 7.7, Handoff 2a § 1.3 13d, Nachtrag Phase 2): Eine Rücklastschrift ist ein Fall, bis
 * ein Mensch den Weg entscheidet — gespeichert, weil es eine Entscheidung ist. Kompass zieht nie von selbst erneut ein.
 */
export const directDebitReturnResolveSchema = z.object({
  returnId: z.string().min(1),
  resolution: z.enum(DIRECT_DEBIT_RETURN_RESOLUTIONS),
  /** Mit dem Mandat nicht mehr einziehen (bei `AC04`, `MD01`, `MD06` vorgeschlagen); nicht zusammen mit `recollect`. */
  endMandate: z.boolean().default(false),
  /**
   * Nur `recollect` nach einem Widerspruch oder einem fehlenden Konto/Mandat (`AC04`, `MD01`, `MD06`): bestätigt, dass mit
   * dem Zahler gesprochen ist (M38) — sonst `recollectNeedsConfirmation`.
   */
  confirmedAfterObjection: z.boolean().default(false),
});
export const directDebitReturnListSchema = z.object({
  status: z.enum(DIRECT_DEBIT_RETURN_STATUSES).optional(),
  /** Nur die Rückgaben eines Einzugs bzw. eines Mandats (Seite des Einzugs, des Mandats). */
  runId: z.string().min(1).optional(),
  mandateId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export interface DirectDebitReturnView {
  id: string;
  itemId: string;
  runId: string;
  collectionDate: string;
  source: 'openItem' | 'pledge';
  sourceId: string;
  installmentOn: string | null;
  mandateId: string;
  mandateReference: string;
  /** Der Kontoinhaber des Mandats — so nennt die Bank den Zahler. */
  debtorName: string;
  amountCents: number;
  rawTransactionId: string;
  /** Buchungstag der Rücklastschrift auf dem Konto. */
  returnedOn: string;
  entryId: string;
  returnCode: string | null;
  /** Bei `AC04`, `MD01`, `MD06` schlägt Kompass „Mandat beenden“ vor (`RETURN_CODES`). */
  suggestEndMandate: boolean;
  /**
   * Das Entgelt der Bank: was der Umsatz über den Posten hinaus abbuchte, sonst eine eigene Entgeltbuchung desselben
   * Tages, wenn es an ihm genau eine Rückgabe gibt (U3, berechnet).
   */
  feeCents: number;
  /** U4 (Plan N3): Der Beitrag ist inzwischen nicht mehr offen — Weg `alreadyPaid`. Bei einer Rate immer `false`. */
  itemPaid: boolean;
  status: FinanceDirectDebitReturnRow['status'];
  resolution: FinanceDirectDebitReturnRow['resolution'];
  mandateEnded: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

/** `timeZone`: ohne Bankzeile ist der Tag der Rückgabe der Tag des Datensatzes in der Zone des Vereins (F-B3). */
export function returnViewInternal(db: DbOrTx, row: FinanceDirectDebitReturnRow, timeZone: string): DirectDebitReturnView {
  const item = db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.id, row.itemId)).get()!;
  const run = db.select({ collectionDate: financeDirectDebitRuns.collectionDate }).from(financeDirectDebitRuns).where(eq(financeDirectDebitRuns.id, item.runId)).get()!;
  const mandate = mandateRowInternal(db, item.mandateId)!;
  return {
    id: row.id,
    itemId: row.itemId,
    runId: item.runId,
    collectionDate: run.collectionDate,
    source: item.source,
    sourceId: item.sourceId,
    installmentOn: item.installmentOn,
    mandateId: item.mandateId,
    mandateReference: mandate.reference,
    debtorName: mandate.debtorName,
    amountCents: item.amountCents,
    rawTransactionId: row.rawTransactionId,
    returnedOn: db.select({ day: financeRawTransactions.bookingDate }).from(financeRawTransactions).where(eq(financeRawTransactions.id, row.rawTransactionId)).get()?.day ?? zonedDayOf(row.createdAt, timeZone),
    entryId: row.entryId,
    returnCode: row.returnCode,
    suggestEndMandate: row.returnCode ? returnCodeInfo(row.returnCode).suggestEndMandate : false,
    feeCents: row.feeCents > 0 ? row.feeCents : separateReturnFeeCentsInternal(db, row),
    itemPaid: itemPaidInternal(db, item),
    status: row.status,
    resolution: row.resolution,
    mandateEnded: row.mandateEnded,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

/** U4: Ist der Beitrag hinter einem Posten nicht mehr offen? Eine Rate kennt keinen offenen Betrag. */
function itemPaidInternal(db: DbOrTx, item: { source: 'openItem' | 'pledge'; sourceId: string }): boolean {
  return item.source === 'openItem' && openCentsInternal(db, item.sourceId) <= 0;
}

/** Wirft eine Ablehnung aus der Transaktion heraus, damit sie zurückrollt. */
class ResolveAborted extends Error {
  constructor(readonly failure: Failure) {
    super('resolve aborted');
  }
}

/**
 * „Nicht mehr einfordern“ für einen Beitrag: der Weg des Moduls, dem der Posten gehört (Haken `directDebitWaive`, bei
 * den Mitgliedern `waiveCharge`). Ein eigener Posten der Finanzen ohne Herkunft wird erledigt wie `cancelOpenItem`.
 */
function waiveOpenItemInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, openItemId: string): void {
  for (const manifest of enabledManifests(deps)) {
    const result = manifest.directDebitWaive?.(tx, deps, ctx, openItemId);
    if (result === null || result === undefined) continue;
    if (!result.ok) throw new ResolveAborted(result);
    return;
  }
  const item = tx.select().from(financeOpenItems).where(eq(financeOpenItems.id, openItemId)).get();
  if (!item || item.cancelledAt) return;
  if (item.originType) throw new ResolveAborted(financeConflict('openItemHasOrigin'));
  const now = isoNow(deps.clock);
  tx.update(financeOpenItems).set({ cancelledAt: now, cancelledByUserId: ctx.userId, updatedAt: now }).where(eq(financeOpenItems.id, item.id)).run();
  financeAudit(tx, deps, ctx, { action: 'finance.openItem.cancel', entity: 'financeOpenItem', id: item.id, before: { cancelled: false }, after: { cancelled: true } });
}

/**
 * `finance.directDebit`, humanOnly: den Weg einer offenen Rückgabe entscheiden.
 * - `recollect`: Der Beitrag bleibt offen, die Rate zurückgegeben („wird erneut eingezogen“); beide kommen in die
 *   nächste Vorschau, brauchen aber eine neue Ankündigung für den neuen Tag (sonst „Ankündigung zu spät“). Nicht mit
 *   `endMandate` und nicht mit einem Mandat, das nicht mehr aktiv ist (`recollectNeedsMandate`); nach `AC04`, `MD01`,
 *   `MD06` nur mit `confirmedAfterObjection` (M38); für einen inzwischen bezahlten Beitrag nicht (`nothingOpen`).
 * - `requestTransfer`: Vereinbarung bzw. Zusage bleiben; dieser Posten wird nicht mehr eingezogen, die Rate wieder
 *   erwartet (per Überweisung). Den Brief „zur Überweisung auffordern“ bringt Plan M4.
 * - `waive`: Beitrag erlassen (Weg des Moduls), Rate ausgelassen (`waivedAfterReturn`). Für einen inzwischen bezahlten
 *   Beitrag nicht (`nothingOpen`).
 * - `alreadyPaid` (U4, Plan N3): Der Beitrag war inzwischen anders bezahlt — nichts zu tun, die Rückgabe ist erledigt.
 *   Nur dann; bei offenem Beitrag oder einer Rate `notPaidOtherwise`.
 * - `endMandate`: das Mandat zum heutigen Tag beenden, Grund `returned`.
 * Protokoll: Weg und Rückgabe-Code.
 */
export async function resolveDirectDebitReturn(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<DirectDebitReturnView>> {
  const denied = requirePermission(ctx, DIRECT_DEBIT_PERMISSION);
  if (denied) return denied;
  const human = requireHumanChannelFinance(deps, ctx);
  if (human) return human;
  const parsed = validate(deps, directDebitReturnResolveSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const row = deps.db.select().from(financeDirectDebitReturns).where(eq(financeDirectDebitReturns.id, v.returnId)).get();
  if (!row) return notFound('financeDirectDebitReturn', v.returnId);
  if (row.status !== 'open') return financeConflict('returnResolved');
  const item = deps.db.select().from(financeDirectDebitItems).where(eq(financeDirectDebitItems.id, row.itemId)).get()!;
  const mandate = mandateRowInternal(deps.db, item.mandateId)!;
  const today = todayIn(deps);
  if (v.resolution === 'recollect' && (v.endMandate || mandateState(mandate, today) !== 'active')) return financeConflict('recollectNeedsMandate');
  const paid = itemPaidInternal(deps.db, item);
  if (v.resolution === 'alreadyPaid' && !paid) return financeConflict('notPaidOtherwise');
  if ((v.resolution === 'recollect' || v.resolution === 'waive') && paid) return financeConflict('nothingOpen');
  if (v.resolution === 'recollect' && row.returnCode && returnCodeInfo(row.returnCode).suggestEndMandate && !v.confirmedAfterObjection) return financeConflict('recollectNeedsConfirmation', { returnCode: row.returnCode });
  const endMandate = v.endMandate && !mandate.endedOn;
  try {
    return deps.db.transaction((tx: DbOrTx) => {
      const now = isoNow(deps.clock);
      if (v.resolution === 'waive' && item.source === 'openItem') waiveOpenItemInternal(tx, deps, ctx, item.sourceId);
      if (v.resolution === 'waive' && item.source === 'pledge' && item.installmentOn) {
        const marked = tx.select({ id: financePledgeRateMarks.id }).from(financePledgeRateMarks).where(and(eq(financePledgeRateMarks.pledgeId, item.sourceId), eq(financePledgeRateMarks.dueOn, item.installmentOn))).get();
        if (!marked) tx.insert(financePledgeRateMarks).values({ id: newId(), pledgeId: item.sourceId, dueOn: item.installmentOn, mark: 'skipped', reason: 'waivedAfterReturn' }).run();
      }
      if (endMandate) endMandateInternal(tx, deps, ctx, mandate, today < (mandate.signedOn ?? today) ? mandate.signedOn! : today, 'returned');
      tx.update(financeDirectDebitReturns)
        .set({ status: 'resolved', resolution: v.resolution, mandateEnded: endMandate, resolvedAt: now, resolvedByUserId: ctx.userId ?? 'system' })
        .where(eq(financeDirectDebitReturns.id, row.id))
        .run();
      financeAudit(tx, deps, ctx, {
        action: 'finance.directDebit.returnResolve',
        entity: 'financeDirectDebitReturn',
        id: row.id,
        before: { status: 'open' },
        after: { status: 'resolved', resolution: v.resolution, mandateEnded: endMandate },
        params: { resolution: v.resolution, returnCode: row.returnCode },
      });
      return ok(returnViewInternal(tx, tx.select().from(financeDirectDebitReturns).where(eq(financeDirectDebitReturns.id, row.id)).get()!, timeZoneOf(deps)));
    });
  } catch (error) {
    if (error instanceof ResolveAborted) return error.failure;
    throw error;
  }
}

/** `finance.read`: die Rückgaben, neueste zuerst; nach Zustand gefiltert (Startseite, Einzug, Mandat). */
export async function listDirectDebitReturns(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: DirectDebitReturnView[]; total: number }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, directDebitReturnListSchema, input ?? {});
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const rows = deps.db
    .select({ row: financeDirectDebitReturns })
    .from(financeDirectDebitReturns)
    .innerJoin(financeDirectDebitItems, eq(financeDirectDebitItems.id, financeDirectDebitReturns.itemId))
    .where(
      and(
        v.status ? eq(financeDirectDebitReturns.status, v.status) : undefined,
        v.runId ? eq(financeDirectDebitItems.runId, v.runId) : undefined,
        v.mandateId ? eq(financeDirectDebitItems.mandateId, v.mandateId) : undefined,
      ),
    )
    .orderBy(desc(financeDirectDebitReturns.createdAt), desc(financeDirectDebitReturns.id))
    .all()
    .map((r) => r.row);
  return ok({ items: rows.slice(v.offset, v.offset + v.limit).map((r) => returnViewInternal(deps.db, r, timeZoneOf(deps))), total: rows.length });
}
