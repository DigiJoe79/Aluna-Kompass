import { invalid, notFound, ok, recordAudit, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { cancelOriginOpenItem, countingPaymentsInternal, financeOpenItems, openCentsInternal, reduceOriginOpenItem, rescheduleOriginOpenItem, type FinanceOpenItemRow } from '@kompass/module-finance';
import { eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { dunningLevelsSplit } from './dunning-levels';
import { typeAt } from './fee-agreement';
import { periodLabel } from './fee-period';
import { chargeableIn, computeChargesFor, FEE_ORIGIN } from './fee-run';
import { catchAborted, MembersAborted, membersConflict } from './errors';
import { memberFeeCharges, memberMemberships, type FeeChargeRow, type PaymentMethod } from './schema';

const HUMAN_ONLY_SETTING = 'members.mcpHumanOnlyAllowed';

/** Zustand eines Beitrags (Handoff D2): berechnet aus dem offenen Posten, nie gespeichert. `overdue` steht als Marke daneben. */
export const FEE_STATES = ['open', 'partlyPaid', 'paid', 'waived', 'overdue'] as const;
export type FeeState = (typeof FEE_STATES)[number];

export interface FeeStateInfo {
  state: Exclude<FeeState, 'overdue'>;
  overdue: boolean;
  openCents: number;
  paidCents: number;
}

/**
 * Der Zustand aus Beitrag und Posten (rein): storniert → erlassen; voll ausgeglichen → bezahlt; teilweise → teilweise
 * bezahlt; sonst offen. Überfällig, wenn noch etwas offen ist und die Fälligkeit (des Postens, nach Stundung) vor heute liegt.
 */
export function feeStateOf(charge: { amountCents: number; dueOn: string }, openItem: { amountCents: number; settledCents: number; cancelledAt: string | null; dueOn: string | null } | null, today: string): FeeStateInfo {
  if (!openItem) return { state: 'open', overdue: false, openCents: charge.amountCents, paidCents: 0 };
  const paidCents = openItem.settledCents;
  if (openItem.cancelledAt !== null) return { state: 'waived', overdue: false, openCents: 0, paidCents };
  const openCents = Math.max(0, openItem.amountCents - paidCents);
  if (openCents === 0) return { state: 'paid', overdue: false, openCents, paidCents };
  const dueOn = openItem.dueOn ?? charge.dueOn;
  return { state: paidCents > 0 ? 'partlyPaid' : 'open', overdue: dueOn < today, openCents, paidCents };
}

/** Ein Beitrag, wie Liste und Mitglied-Seite ihn zeigen. `dueOn` ist die Fälligkeit des Postens (nach Stundung). */
export interface FeeView extends FeeStateInfo {
  chargeId: string;
  membershipId: string;
  memberNumber: string;
  name: string;
  typeId: string;
  periodStart: string;
  periodEnd: string;
  period: string;
  amountCents: number;
  dueOn: string;
  deferredTo: string | null;
  openItemId: string | null;
  /** Erlassen: ganz (storniert) oder der Rest eines teilweise bezahlten Beitrags (Plan M4 Task 5b) — berechnet aus Beitrag und Posten. */
  waivedCents: number;
  /** Erreichte Mahnstufe (Schlüssel aus `members.dunningLevels`), nur solange offen; sie ersetzt „überfällig“ (Handoff D2). */
  dunningLevel: string | null;
  /** R17: nach einer Stundung die Stufe, die vorher erreicht war (die Zählung beginnt neu); sonst `null`. */
  dunningLevelBeforeDeferral: string | null;
  /** Tag der letzten zählenden Zahlung („Bezahlt am“, Handoff 3c); `null` ohne Zahlung. */
  paidOn: string | null;
  /** R16: der Zahlweg am Beitrag (Plan N1 E3). */
  paymentMethod: PaymentMethod;
}

/** Die Ansichten der lebenden Beiträge (nicht ersetzt, nicht übersprungen) mit wenigen Abfragen. */
export function feeViewsInternal(db: DbOrTx, deps: Deps, charges: FeeChargeRow[]): FeeView[] {
  if (charges.length === 0) return [];
  const today = todayIn(deps);
  const memberships = new Map(db.select().from(memberMemberships).where(inArray(memberMemberships.id, [...new Set(charges.map((c) => c.membershipId))])).all().map((m) => [m.id, m]));
  const contactIds = [...new Set([...memberships.values()].map((m) => m.contactId))];
  const names = new Map(db.select().from(contacts).where(inArray(contacts.id, contactIds)).all().map((c) => [c.id, displayName(c)]));
  const itemIds = charges.flatMap((c) => (c.openItemId ? [c.openItemId] : []));
  const items = new Map<string, FinanceOpenItemRow>(itemIds.length ? db.select().from(financeOpenItems).where(inArray(financeOpenItems.id, itemIds)).all().map((i) => [i.id, i]) : []);
  const views = charges.map((c) => {
    const m = memberships.get(c.membershipId)!;
    const item = c.openItemId ? items.get(c.openItemId) : undefined;
    const settledCents = item ? item.amountCents - openCentsInternal(db, item.id) : 0;
    const info = feeStateOf(c, item ? { amountCents: item.amountCents, settledCents, cancelledAt: item.cancelledAt, dueOn: item.dueOn } : null, today);
    return {
      ...info,
      chargeId: c.id,
      membershipId: c.membershipId,
      memberNumber: m.memberNumber ?? '',
      name: names.get(m.contactId) ?? '',
      typeId: typeAt(db, c.membershipId, c.periodStart)?.typeId ?? '',
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      period: periodLabel(c.periodStart, c.periodEnd),
      amountCents: c.amountCents,
      dueOn: item?.dueOn ?? c.dueOn,
      deferredTo: c.deferredTo,
      openItemId: c.openItemId,
      waivedCents: !item ? 0 : (item.cancelledAt !== null ? item.amountCents - settledCents : 0) + Math.max(0, c.amountCents - item.amountCents),
      dunningLevel: null as string | null,
      dunningLevelBeforeDeferral: null as string | null,
      paidOn: item && settledCents > 0 ? (countingPaymentsInternal(db, item.id).map((p) => p.entryDate).sort().at(-1) ?? null) : null,
      paymentMethod: c.paymentMethod,
    };
  });
  const levels = dunningLevelsSplit(db, deps, views);
  return views.map((v) => ({ ...v, dunningLevel: levels.current.get(v.chargeId) ?? null, dunningLevelBeforeDeferral: levels.beforeDeferral.get(v.chargeId) ?? null }));
}

export const liveCharges = (db: DbOrTx) => db.select().from(memberFeeCharges).where(ne(memberFeeCharges.state, 'replaced')).all().filter((c) => c.state !== 'skipped');

export const feeListSchema = z.object({
  year: z.number().int().min(2000).max(9999),
  /** Zustände; `overdue` trifft offene und teilweise bezahlte Beiträge mit Fälligkeit vor heute. */
  status: z.array(z.enum(FEE_STATES)).optional(),
  typeId: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  /** Nur Rückstände: offen und überfällig. */
  onlyArrears: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Die Beiträge eines Jahres, eine Zeile je Beitrag, nach Nummer und Zeitraum; dazu die Summen über die Auswahl (Handoff 2.4). */
export async function listFees(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ items: FeeView[]; total: number; totals: { dueCents: number; paidCents: number; openCents: number; dunnedCents: number }; exempt: { typeId: string; count: number }[] }>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, feeListSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const needle = v.search?.toLocaleLowerCase('de') ?? '';
  const all = feeViewsInternal(deps.db, deps, liveCharges(deps.db).filter((c) => c.periodStart.startsWith(`${v.year}-`)))
    .filter((f) => !v.status || v.status.length === 0 || v.status.some((s) => (s === 'overdue' ? f.overdue : f.state === s)))
    .filter((f) => !v.typeId || f.typeId === v.typeId)
    .filter((f) => !v.onlyArrears || f.overdue)
    .filter((f) => needle === '' || f.name.toLocaleLowerCase('de').includes(needle) || f.memberNumber.toLocaleLowerCase('de').includes(needle))
    .sort((a, b) => a.memberNumber.localeCompare(b.memberNumber) || a.periodStart.localeCompare(b.periodStart));
  const counted = all.filter((f) => f.state !== 'waived');
  const totals = { dueCents: counted.reduce((s, f) => s + f.amountCents - f.waivedCents, 0), paidCents: all.reduce((s, f) => s + f.paidCents, 0), openCents: counted.reduce((s, f) => s + f.openCents, 0), dunnedCents: counted.filter((f) => f.dunningLevel !== null).reduce((s, f) => s + f.openCents, 0) };
  return ok({ items: all.slice(v.offset, v.offset + v.limit), total: all.length, totals, exempt: exemptInYear(deps, v.year) });
}

/**
 * „Ohne Beitrag“ unter dem Summenkasten (Handoff 2.4): Mitgliedschaften des Jahres, für die nur beitragsfreie Zeiträume
 * anfallen, gezählt je Art (am Jahresbeginn bzw. Eintritt).
 */
function exemptInYear(deps: Deps, year: number): { typeId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of deps.db.select().from(memberMemberships).all()) {
    if (!chargeableIn(row, year)) continue;
    const charges = computeChargesFor(deps.db, deps, row, year);
    if (charges.length === 0 || !charges.every((c) => c.skip === 'exempt')) continue;
    const typeId = typeAt(deps.db, row.id, charges[0]!.periodStart)?.typeId ?? '';
    counts.set(typeId, (counts.get(typeId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([typeId, count]) => ({ typeId, count }));
}

/** Alle Beiträge einer Mitgliedschaft, neueste zuerst. */
export async function feesForMembership(deps: Deps, ctx: CallContext, membershipId: string): Promise<Result<FeeView[]>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  if (!deps.db.select({ id: memberMemberships.id }).from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get()) return notFound('membership', membershipId);
  const charges = liveCharges(deps.db).filter((c) => c.membershipId === membershipId);
  return ok(feeViewsInternal(deps.db, deps, charges).sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
}

/** Ein angelegter Beitrag mit offenem, nicht storniertem Posten — sonst der Grund. */
function openCharge(deps: Deps, chargeId: string, db: DbOrTx = deps.db): Result<{ charge: FeeChargeRow; memberNumber: string; openCents: number }> {
  const charge = db.select().from(memberFeeCharges).where(eq(memberFeeCharges.id, chargeId)).get();
  if (!charge) return notFound('memberFeeCharge', chargeId);
  if (charge.state !== 'created' || !charge.openItemId) return membersConflict('feeChargeNotOpen');
  const item = db.select().from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId)).get();
  if (!item || item.cancelledAt !== null) return membersConflict('feeChargeNotOpen');
  const memberNumber = db.select({ n: memberMemberships.memberNumber }).from(memberMemberships).where(eq(memberMemberships.id, charge.membershipId)).get()?.n ?? '';
  return ok({ charge, memberNumber, openCents: openCentsInternal(db, item.id) });
}

export const feeDeferSchema = z.object({ chargeId: z.string().min(1), dueOn: z.iso.date() });
export const feeWaiveSchema = z.object({ chargeId: z.string().min(1) });

/** Stunden (nur ein Mensch): verschiebt die Fälligkeit des offenen Postens (Spec § 4.4). */
export async function deferCharge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, feeDeferSchema, input);
  if (!parsed.ok) return parsed;
  const found = openCharge(deps, parsed.value.chargeId);
  if (!found.ok) return found;
  const { charge, memberNumber, openCents } = found.value;
  if (openCents <= 0) return membersConflict('feeChargeNotOpen');
  // M33: Eine Stundung schiebt hinaus — nach der bisherigen Fälligkeit und nicht vor heute.
  const current = charge.deferredTo ?? charge.dueOn;
  if (parsed.value.dueOn <= current) return invalid([{ path: 'dueOn', message: 'deferNotLater' }]);
  if (parsed.value.dueOn < todayIn(deps)) return invalid([{ path: 'dueOn', message: 'beforeToday' }]);
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const moved = rescheduleOriginOpenItem(tx, deps, ctx, { openItemId: charge.openItemId!, originType: FEE_ORIGIN, dueOn: parsed.value.dueOn });
      if (!moved.ok) throw new MembersAborted(moved);
      tx.update(memberFeeCharges).set({ deferredTo: parsed.value.dueOn }).where(eq(memberFeeCharges.id, charge.id)).run();
      recordAudit(tx, deps, ctx, { action: 'members.fee.defer', entityType: 'memberFeeCharge', entityId: charge.id, before: { deferredTo: charge.deferredTo }, after: { deferredTo: parsed.value.dueOn }, params: { memberNumber, dueOn: parsed.value.dueOn } });
      return ok(feeViewsInternal(tx, deps, [tx.select().from(memberFeeCharges).where(eq(memberFeeCharges.id, charge.id)).get()!])[0]!);
    }),
  );
}

/**
 * Erlassen (nur ein Mensch, Spec § 4.4): ohne Zahlung wird der Posten storniert; ist er teilweise bezahlt, wird er auf
 * den bezahlten Betrag gekürzt — der Rest ist erlassen, der Beitrag danach bezahlt (Plan M4 Task 5b).
 */
export async function waiveCharge(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeView>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
  if (human) return human;
  const parsed = validate(deps, feeWaiveSchema, input);
  if (!parsed.ok) return parsed;
  const found = openCharge(deps, parsed.value.chargeId);
  if (!found.ok) return found;
  if (found.value.openCents <= 0) return membersConflict('feeChargeNotOpen');
  return catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const waived = waiveChargeInternal(tx, deps, ctx, found.value);
      if (!waived.ok) throw new MembersAborted(waived);
      return ok(feeViewsInternal(tx, deps, [found.value.charge])[0]!);
    }),
  );
}

/**
 * Erlassen in der Transaktion des Aufrufers (geprüft hat er): ohne Zahlung den Posten stornieren, mit Teilzahlung auf
 * den bezahlten Betrag kürzen; protokolliert mit der Mitgliedsnummer.
 */
function waiveChargeInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, found: { charge: FeeChargeRow; memberNumber: string; openCents: number }): Result<null> {
  const { charge, memberNumber, openCents } = found;
  const item = tx.select().from(financeOpenItems).where(eq(financeOpenItems.id, charge.openItemId!)).get()!;
  const paid = item.amountCents - openCents;
  if (paid > 0) {
    const reduced = reduceOriginOpenItem(tx, deps, ctx, { openItemId: item.id, originType: FEE_ORIGIN, amountCents: paid });
    if (!reduced.ok) return reduced;
  } else {
    const cancelled = cancelOriginOpenItem(tx, deps, ctx, { openItemId: item.id, originType: FEE_ORIGIN, note: null });
    if (!cancelled.ok) return cancelled.error.type === 'conflict' && cancelled.error.code === 'openItemHasPayments' ? membersConflict('feeHasPayment') : cancelled;
  }
  recordAudit(tx, deps, ctx, { action: 'members.fee.waive', entityType: 'memberFeeCharge', entityId: charge.id, after: { waived: true, waivedCents: openCents }, params: { memberNumber } });
  return ok(null);
}

/**
 * Haken `directDebitWaive` (Plan L3): „Rückgabe klären“ → „nicht mehr einfordern“ erlässt den Beitrag, dessen Posten
 * eine Rücklastschrift wieder geöffnet hat — derselbe Weg wie `waiveCharge`, in der Transaktion der Finanzen; die
 * Rechte hat „Rückgabe klären“ geprüft. `null`, wenn der Posten kein Beitrag ist.
 */
export function membersDirectDebitWaive(tx: DbOrTx, deps: Deps, ctx: CallContext, openItemId: string): Result<null> | null {
  const charge = tx.select({ id: memberFeeCharges.id }).from(memberFeeCharges).where(eq(memberFeeCharges.openItemId, openItemId)).get();
  if (!charge) return null;
  const found = openCharge(deps, charge.id, tx);
  if (!found.ok) return found;
  if (found.value.openCents <= 0) return membersConflict('feeChargeNotOpen');
  return waiveChargeInternal(tx, deps, ctx, found.value);
}
