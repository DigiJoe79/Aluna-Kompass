import { newId, notFound, ok, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { cancelOriginOpenItem, categoryIdByKeyInternal, expiredRunIdsInternal, financeOpenItems, openCentsInternal, openItemInSubmittedRunInternal } from '@kompass/module-finance';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MembersAborted, membersConflict } from './errors';
import type { ComputedCharge } from './fee-calc';
import { computeChargesFor, FEE_CATEGORY_KEY, FEE_ORIGIN, insertChargeInternal } from './fee-run';
import { planPaymentMethodSyncInternal, type TransferKept } from './payment-method';
import { FEE_INTERVALS, FEE_MAX_CENTS, FEE_REDUCTIONS, memberFeeAgreements, memberFeeCharges, memberMemberships, memberTypePeriods, PAYMENT_METHODS, type FeeChargeRow, type MembershipRow } from './schema';

const day = z.iso.date();
const id = z.string().min(1);

/** Was sich durch eine Änderung ab `from` ändert: ersetzt, bleibt trotz Änderung (bezahlt, gestundet), neu. */
export interface RecalculationPlan {
  replace: FeeChargeRow[];
  keep: FeeChargeRow[];
  add: ComputedCharge[];
  /** Bei einem Wechsel auf Lastschrift: Beiträge, die Überweisung bleiben, weil ein Brief dazu aufforderte (Plan N1 E3). */
  transferKept: TransferKept[];
  /** R4: bei einem Wechsel auf Überweisung die Beiträge, die ein Brief als Einzug angekündigt hat. */
  debitAnnounced: TransferKept[];
}

/**
 * Ob ein Beitrag ersetzt werden darf: vorgemerkt im Lauf, oder angelegt mit offenem, nicht stornierten Posten ohne
 * zählenden Ausgleich, nicht gestundet und nicht in einem Einzug, der bei der Bank eingereicht ist (Plan L2).
 */
function replaceable(db: DbOrTx, charge: FeeChargeRow): boolean {
  if (charge.state === 'pending') return true;
  if (charge.state !== 'created' || !charge.openItemId || charge.deferredTo !== null) return false;
  const item = db.select({ cancelledAt: financeOpenItems.cancelledAt }).from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId)).get();
  if (!item || item.cancelledAt !== null) return false;
  if (openItemInSubmittedRunInternal(db, charge.openItemId)) return false;
  return openCentsInternal(db, charge.openItemId) === charge.amountCents;
}

const isWaived = (db: DbOrTx, charge: FeeChargeRow): boolean =>
  !!charge.openItemId && db.select({ cancelledAt: financeOpenItems.cancelledAt }).from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId)).get()?.cancelledAt != null;

const overlaps = (a: { periodStart: string; periodEnd: string }, b: { periodStart: string; periodEnd: string }) => a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;

/** Plant die Neuberechnung für jedes Jahr mit Beiträgen ab dem Jahr von `from` — ohne zu schreiben. */
export function planRecalculationInternal(db: DbOrTx, deps: Deps, membership: MembershipRow, from: string): RecalculationPlan {
  const plan: RecalculationPlan = { replace: [], keep: [], add: [], transferKept: [], debitAnnounced: [] };
  if (!membership.memberNumber) return plan;
  const all = db.select().from(memberFeeCharges).where(eq(memberFeeCharges.membershipId, membership.id)).all();
  const fromYear = Number(from.slice(0, 4));
  const years = [...new Set(all.map((c) => Number(c.periodStart.slice(0, 4))))].filter((y) => y >= fromYear).sort();
  for (const year of years) {
    const computed = computeChargesFor(db, deps, membership, year).filter((c) => !c.skip && c.periodStart >= from);
    const existing = all.filter((c) => c.state !== 'replaced' && c.state !== 'skipped' && c.periodStart.startsWith(`${year}-`) && c.periodStart >= from).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const kept: FeeChargeRow[] = [];
    for (const charge of existing) {
      const match = computed.find((c) => c.periodStart === charge.periodStart);
      const unchanged = match && match.periodEnd === charge.periodEnd && match.amountCents === charge.amountCents && match.dueOn === charge.dueOn;
      if (unchanged || isWaived(db, charge)) kept.push(charge);
      else if (replaceable(db, charge)) plan.replace.push(charge);
      else {
        kept.push(charge);
        plan.keep.push(charge);
      }
    }
    plan.add.push(...computed.filter((c) => !kept.some((k) => overlaps(k, c))));
  }
  return plan;
}

/**
 * Rechnet die Beiträge einer Mitgliedschaft ab `from` neu (Plan M3, Task 5) und schreibt: ersetzte Posten storniert,
 * neue angelegt. In der Transaktion des aufrufenden Dienstes; wirft `MembersAborted`. Protokolliert nur, wenn sich
 * etwas ändert.
 */
export function recalculateChargesInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membershipId: string, from: string): { replaced: number; added: number } {
  const membership = tx.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  if (!membership) return { replaced: 0, added: 0 };
  const plan = planRecalculationInternal(tx, deps, membership, from);
  if (plan.replace.length === 0 && plan.add.length === 0) return { replaced: 0, added: 0 };
  const categoryId = plan.add.length > 0 ? categoryIdByKeyInternal(tx, FEE_CATEGORY_KEY) : null;
  if (plan.add.length > 0 && !categoryId) throw new MembersAborted(membersConflict('membershipFeeCategoryMissing'));
  // Erst ersetzen, dann anlegen: Ein Zeitraum steht nie zweimal (Index ohne ersetzte Zeilen).
  for (const charge of plan.replace) {
    if (charge.openItemId) {
      const cancelled = cancelOriginOpenItem(tx, deps, ctx, { openItemId: charge.openItemId, originType: FEE_ORIGIN, note: null });
      if (!cancelled.ok) throw new MembersAborted(cancelled);
    }
    tx.update(memberFeeCharges).set({ state: 'replaced' }).where(eq(memberFeeCharges.id, charge.id)).run();
  }
  const added = plan.add.map((c) => insertChargeInternal(tx, deps, ctx, membership, c, null, categoryId));
  for (const charge of plan.replace) {
    const successor = added.find((a) => a.periodStart === charge.periodStart);
    if (successor) tx.update(memberFeeCharges).set({ replacedById: successor.id }).where(eq(memberFeeCharges.id, charge.id)).run();
  }
  const result = { replaced: plan.replace.length, added: added.length };
  recordAudit(tx, deps, ctx, { action: 'members.fees.recalculate', entityType: 'membership', entityId: membership.id, after: { from, ...result }, params: { memberNumber: membership.memberNumber, ...result } });
  return result;
}

export const recalculationPreviewSchema = z.object({
  membershipId: id,
  from: day,
  /** Die geplante Änderung, deren Folge die Vorschau zeigt; ohne sie der heutige Stand gegen die Rechnung. */
  change: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('type'), typeId: id }),
      z.object({ kind: z.literal('end'), endsOn: day }),
      z.object({ kind: z.literal('revokeEnd') }),
      z.object({
        kind: z.literal('agreement'),
        amountCents: z.number().int().min(0).max(FEE_MAX_CENTS).nullable().optional(),
        interval: z.enum(FEE_INTERVALS).nullable().optional(),
        paymentMethod: z.enum(PAYMENT_METHODS).default('transfer'),
        reduction: z.enum(FEE_REDUCTIONS).default('none'),
      }),
    ])
    .optional(),
});

class PreviewDone extends Error {
  constructor(readonly plan: RecalculationPlan) {
    super('preview');
  }
}

/** Vorschau für den Hinweis vor dem Speichern („2 Posten werden ersetzt, 1 bleibt“): spielt die Änderung durch und verwirft sie. */
export async function previewRecalculation(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<RecalculationPlan>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, recalculationPreviewSchema, input);
  if (!parsed.ok) return parsed;
  const { membershipId, from, change } = parsed.value;
  const membership = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  if (!membership) return notFound('membership', membershipId);
  if (!change) return ok(planRecalculationInternal(deps.db, deps, membership, from));
  try {
    deps.db.transaction((tx: DbOrTx) => {
      if (change.kind === 'type') {
        tx.delete(memberTypePeriods).where(and(eq(memberTypePeriods.membershipId, membershipId), eq(memberTypePeriods.validFrom, from))).run();
        tx.insert(memberTypePeriods).values({ id: newId(), membershipId, typeId: change.typeId, validFrom: from }).run();
      } else if (change.kind === 'end' || change.kind === 'revokeEnd') {
        tx.update(memberMemberships).set({ endsOn: change.kind === 'end' ? change.endsOn : null }).where(eq(memberMemberships.id, membershipId)).run();
      } else {
        tx.delete(memberFeeAgreements).where(and(eq(memberFeeAgreements.membershipId, membershipId), eq(memberFeeAgreements.validFrom, from))).run();
        tx.insert(memberFeeAgreements)
          .values({ id: newId(), membershipId, validFrom: from, amountCents: change.amountCents ?? null, interval: change.interval ?? null, paymentMethod: change.paymentMethod, reduction: change.reduction, createdAt: '', updatedAt: '' })
          .run();
      }
      const changed = tx.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get()!;
      const plan = planRecalculationInternal(tx, deps, changed, from);
      if (change.kind === 'agreement') {
        const sync = planPaymentMethodSyncInternal(tx, membershipId, from, expiredRunIdsInternal(deps, tx));
        plan.transferKept = sync.transferKept;
        plan.debitAnnounced = sync.debitAnnounced;
      }
      throw new PreviewDone(plan);
    });
  } catch (error) {
    if (error instanceof PreviewDone) return ok(error.plan);
    throw error;
  }
  throw new Error('unreachable');
}
