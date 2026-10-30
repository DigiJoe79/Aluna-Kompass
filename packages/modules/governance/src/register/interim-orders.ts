import { completeFollowUpsInternal, createFollowUpInternal, invalid, isoNow, notFound, ok, readLocales, recordAudit, requirePermission, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { governanceConflict } from '../errors';
import { followUpTitle } from '../follow-up-titles';
import { day } from '../invitation/words';
import { governanceRegisterFilings, type InterimOrder } from '../schema';
import { filingRowInternal, filingStateOf, filingViewInternal, type FilingView } from './filings';

const DAY = z.iso.date();

export const interimOrderSchema = z.object({
  filingId: z.string().min(1),
  /** Tag der Zwischenverfügung. */
  on: DAY,
  /** Frist des Gerichts — dann eine Wiedervorlage an die aufrufende Person. */
  deadline: DAY.optional(),
  documentId: z.string().min(1).optional(),
});
export const interimResolveSchema = z.object({ filingId: z.string().min(1), index: z.number().int().min(0).max(50), resolvedOn: DAY });

/**
 * Hält eine Zwischenverfügung des Registergerichts fest (Spec § 7.1) — nur an einer eingereichten Anmeldung. Mit Frist
 * entsteht eine Wiedervorlage des Kerns am Fristtag für die aufrufende Person; erledigt wird sie im Kern.
 */
export async function recordInterimOrder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, interimOrderSchema, input);
  if (!parsed.ok) return parsed;
  const { filingId, on, deadline, documentId } = parsed.value;
  const before = filingRowInternal(deps.db, filingId);
  if (!before) return notFound('governanceRegisterFiling', filingId);
  const state = filingStateOf(before);
  if (state === 'registered') return governanceConflict('filingRegistered');
  if (state !== 'submitted' && state !== 'interimOrder') return governanceConflict('filingNotSubmitted');
  if (on < before.submittedOn!) return invalid([{ path: 'on', message: 'beforeSubmitted' }]);
  if (deadline && deadline < on) return invalid([{ path: 'deadline', message: 'beforeOrder' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const followUpId = deadline ? createFollowUpInternal(tx, deps, ctx, { entityType: 'governanceRegisterFiling', entityId: filingId, dueAt: deadline, title: followUpTitle(readLocales(deps)[0] ?? 'de', 'interimOrder', { date: day(on) }), assigneeUserId: ctx.userId ?? null }).id : null;
    const order: InterimOrder = { on, deadline: deadline ?? null, documentId: documentId ?? null, resolvedOn: null, followUpId };
    const interimOrders = [...before.interimOrders, order];
    tx.update(governanceRegisterFilings).set({ interimOrders, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, filingId)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.register.interimOrder', entityType: 'governanceRegisterFiling', entityId: filingId, after: order, params: { on, deadline: deadline ?? 'none' } });
    return ok(filingViewInternal(tx, deps, filingRowInternal(tx, filingId)!));
  });
}

/** W-12: Die Wiedervorlage einer behobenen Zwischenverfügung ist erledigt (im Kern, mit Protokoll). */
export function completeInterimFollowUpInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, filingId: string, order: InterimOrder): void {
  if (!order.followUpId) return;
  completeFollowUpsInternal(tx, deps, ctx, { entityType: 'governanceRegisterFiling', entityId: filingId, titlePrefix: followUpTitle(readLocales(deps)[0] ?? 'de', 'interimOrder', { date: day(order.on) }) });
}

/** Die Zwischenverfügung an Stelle `index` ist behoben; ihre Wiedervorlage ist damit erledigt (W-12). */
export async function resolveInterimOrder(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FilingView>> {
  const denied = requirePermission(ctx, 'governance.manage');
  if (denied) return denied;
  const parsed = validate(deps, interimResolveSchema, input);
  if (!parsed.ok) return parsed;
  const { filingId, index, resolvedOn } = parsed.value;
  const before = filingRowInternal(deps.db, filingId);
  if (!before) return notFound('governanceRegisterFiling', filingId);
  if (before.registeredOn) return governanceConflict('filingRegistered');
  const order = before.interimOrders[index];
  if (!order) return invalid([{ path: 'index', message: 'unknownInterimOrder' }]);
  if (order.resolvedOn !== null) return invalid([{ path: 'index', message: 'alreadyResolved' }]);
  if (resolvedOn < order.on) return invalid([{ path: 'resolvedOn', message: 'beforeOrder' }]);
  return deps.db.transaction((tx: DbOrTx) => {
    const interimOrders = before.interimOrders.map((o, i) => (i === index ? { ...o, resolvedOn } : o));
    tx.update(governanceRegisterFilings).set({ interimOrders, updatedAt: isoNow(deps.clock) }).where(eq(governanceRegisterFilings.id, filingId)).run();
    completeInterimFollowUpInternal(tx, deps, ctx, filingId, order);
    recordAudit(tx, deps, ctx, { action: 'governance.register.interimResolved', entityType: 'governanceRegisterFiling', entityId: filingId, before: { resolvedOn: null }, after: { resolvedOn }, params: { resolvedOn } });
    return ok(filingViewInternal(tx, deps, filingRowInternal(tx, filingId)!));
  });
}
