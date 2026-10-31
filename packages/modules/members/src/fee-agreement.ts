import { isoNow, newId, notFound, ok, recordAudit, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Failure, type MandateUsageInput, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { financeConflict, mandateDetailsSchema, mandateRowInternal, mandateState, prepareMandateInternal } from '@kompass/module-finance';
import { and, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, membersConflict } from './errors';
import { recalculateChargesInternal } from './fee-recalc';
import { INTERVAL_MONTHS } from './fee-period';
import { feeRuleAt, feeScheduleAt } from './fee-schedule';
import { periodAt } from './memberships';
import { syncPaymentMethodsInternal, type TransferKept } from './payment-method';
import { FEE_INTERVALS, FEE_MAX_CENTS, FEE_REDUCTIONS, memberFeeAgreements, memberMemberships, memberTypePeriods, memberTypes, PAYMENT_METHODS, type FeeAgreementRow, type FeeInterval, type MembershipRow, type PaymentMethod } from './schema';

const day = z.iso.date();
const id = z.string().min(1);

export const feeAgreementSetSchema = z.object({
  membershipId: id,
  validFrom: day,
  /** Leer: Betrag nach Ordnung. Bei einer Mindestbetrag-Regel nicht darunter, außer ermäßigt. */
  amountCents: z.number().int().min(0).max(FEE_MAX_CENTS).nullable().optional(),
  /** Leer: Rhythmus nach Ordnung; sonst einer der erlaubten der Regel. */
  interval: z.enum(FEE_INTERVALS).nullable().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('transfer'),
  /** Mandat bei Lastschrift: vorbereitet oder aktiv, nicht beendet oder verfallen (Plan L1). */
  mandateId: id.nullable().optional(),
  /** Bei Lastschrift ohne Mandat: mit Kontoinhaber entsteht eines (vorbereitet). */
  iban: mandateDetailsSchema.shape.iban.optional(),
  debtorName: mandateDetailsSchema.shape.debtorName.optional(),
  /** Wer zahlt, wenn nicht das Mitglied — etwa die Eltern eines Minderjährigen (Spec § 4.2). Vorgabe: das Mitglied. */
  payerContactId: id.optional(),
  /** Härtefall ohne Freitext-Grund (Spec § 4.2); der Antrag liegt, wenn überhaupt, als Dokument im Schutzbereich. */
  reduction: z.enum(FEE_REDUCTIONS).default('none'),
  reductionDocumentId: id.nullable().optional(),
});

/** Was am Tag für eine Mitgliedschaft zu zahlen ist — Vereinbarung vor Ordnung. */
export type EffectiveFee =
  | { amountCents: number; interval: FeeInterval; paymentMethod: PaymentMethod; exempt: boolean; source: 'schedule' | 'agreement' }
  | { none: 'noRule' | 'noSchedule' };

/**
 * Haken `mandateUsages` (Plan L1 Task 6): Mitgliedschaften, deren Beitragsvereinbarung das Mandat nennt — beschriftet
 * mit der Nummer, nie mit dem Namen.
 */
export function membersMandateUsages(deps: Deps, mandateId: string): MandateUsageInput[] {
  const rows = deps.db
    .select({ membershipId: memberFeeAgreements.membershipId, memberNumber: memberMemberships.memberNumber })
    .from(memberFeeAgreements)
    .innerJoin(memberMemberships, eq(memberMemberships.id, memberFeeAgreements.membershipId))
    .where(eq(memberFeeAgreements.mandateId, mandateId))
    .orderBy(memberFeeAgreements.validFrom)
    .all();
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.membershipId)) return [];
    seen.add(r.membershipId);
    return [{ kind: 'membership', id: r.membershipId, label: r.memberNumber ? { key: 'members.records.member', params: { memberNumber: r.memberNumber } } : { key: 'members.records.application' } }];
  });
}

/** Die Vereinbarung, die am Tag gilt. */
export function agreementAt(db: DbOrTx, membershipId: string, on: string): FeeAgreementRow | null {
  return db.select().from(memberFeeAgreements).where(and(eq(memberFeeAgreements.membershipId, membershipId), lte(memberFeeAgreements.validFrom, on))).orderBy(desc(memberFeeAgreements.validFrom)).get() ?? null;
}

/** Die Art einer Mitgliedschaft am Tag samt Beitragsfreiheit. */
export function typeAt(db: DbOrTx, membershipId: string, on: string): { typeId: string; exempt: boolean } | null {
  const period = periodAt(db.select().from(memberTypePeriods).where(eq(memberTypePeriods.membershipId, membershipId)).all(), on);
  if (!period) return null;
  const type = db.select().from(memberTypes).where(eq(memberTypes.id, period.typeId)).get();
  return type ? { typeId: type.id, exempt: type.feeExempt } : null;
}

/** Plan R1 (M4): ein Betrag von einem Rhythmus auf einen anderen umgerechnet (kaufmännisch gerundet). */
export const convertInterval = (amountCents: number, from: FeeInterval, to: FeeInterval) => (from === to ? amountCents : Math.round((amountCents * INTERVAL_MONTHS[to]) / INTERVAL_MONTHS[from]));

/** Ein Mindestbetrag im Rhythmus der Vereinbarung: wie `convertInterval`, aber abgerundet. */
const minimumInInterval = (amountCents: number, from: FeeInterval, to: FeeInterval) => (from === to ? amountCents : Math.floor((amountCents * INTERVAL_MONTHS[to]) / INTERVAL_MONTHS[from]));

/**
 * Der Beitrag am Tag (intern): Art beitragsfrei oder Vereinbarung „erlassen“ → `exempt`; sonst Betrag und Rhythmus aus
 * der Vereinbarung, wo sie welche nennt, im Übrigen aus der Regel des geltenden Stands. Nennt die Vereinbarung nur einen
 * anderen Rhythmus, wird der Regelbetrag auf ihn umgerechnet (M4: 120 € jährlich → 10 € monatlich).
 */
export function effectiveFee(db: DbOrTx, membershipId: string, on: string): EffectiveFee {
  const type = typeAt(db, membershipId, on);
  const agreement = agreementAt(db, membershipId, on);
  const paymentMethod = agreement?.paymentMethod ?? 'transfer';
  const rule = type ? feeRuleAt(db, type.typeId, on) : null;
  if (type?.exempt || agreement?.reduction === 'waived') return { amountCents: 0, interval: agreement?.interval ?? rule?.interval ?? 'yearly', paymentMethod, exempt: true, source: agreement?.reduction === 'waived' ? 'agreement' : 'schedule' };
  if (!feeScheduleAt(db, on)) return { none: 'noSchedule' };
  if (!rule && (agreement?.amountCents == null || agreement.interval == null)) return { none: 'noRule' };
  const fromAgreement = agreement !== null && (agreement.amountCents !== null || agreement.interval !== null);
  const interval = agreement?.interval ?? rule!.interval;
  const amountCents = agreement?.amountCents ?? convertInterval(rule!.amountCents, rule!.interval, interval);
  return { amountCents, interval, paymentMethod, exempt: false, source: fromAgreement ? 'agreement' : 'schedule' };
}

/**
 * Vereinbarung ab einem Tag setzen (Spec § 4.2); eine am selben Tag wird ersetzt. Protokoll: Nummer und Tag — kein
 * Betrag, kein Grund in den Werten.
 */
/** Das Ergebnis mit den Folgen für offene Beiträge (R16, R4): was Überweisung bleibt, was als Einzug angekündigt war. */
export type FeeAgreementResult = FeeAgreementRow & { transferKept: TransferKept[]; debitAnnounced: TransferKept[] };

export async function setFeeAgreement(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<FeeAgreementResult>> {
  const denied = requirePermission(ctx, 'members.fees');
  if (denied) return denied;
  const parsed = validate(deps, feeAgreementSetSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const membership = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, v.membershipId)).get();
  if (!membership) return notFound('membership', v.membershipId);
  const checked = checkAgreementInternal(deps.db, deps, membership, v);
  if ('ok' in checked) return checked;
  return catchAborted(() => deps.db.transaction((tx: DbOrTx) => ok(writeAgreementInternal(tx, deps, ctx, membership, v, checked))));
}

export type FeeAgreementInput = z.infer<typeof feeAgreementSetSchema>;

/**
 * Die Prüfungen einer Vereinbarung (Plan L1 Task 6, Spec § 4.2) ohne Rechte und ohne zu schreiben — in der Transaktion
 * des Aufrufers, wenn die Mitgliedschaft dort eben erst entstand (`createMember`). Lastschrift braucht ein nutzbares
 * Mandat: ein gewähltes, das der Vereinbarung desselben Tages, oder ein neues aus IBAN und Kontoinhaber.
 */
export function checkAgreementInternal(db: DbOrTx, deps: Deps, membership: { id: string; contactId: string }, v: FeeAgreementInput): Failure | { mandateId: string | null; payerContactId: string } {
  const directDebit = v.paymentMethod === 'directDebit';
  const sameDay = db.select().from(memberFeeAgreements).where(and(eq(memberFeeAgreements.membershipId, membership.id), eq(memberFeeAgreements.validFrom, v.validFrom))).get();
  const mandateId = directDebit ? (v.mandateId ?? (sameDay?.paymentMethod === 'directDebit' ? sameDay.mandateId : null)) : null;
  if (mandateId) {
    const mandate = mandateRowInternal(db, mandateId);
    if (!mandate) return notFound('financeMandate', mandateId);
    const state = mandateState(mandate, todayIn(deps));
    if (state === 'ended' || state === 'expired') return financeConflict('mandateNotUsable', { reference: mandate.reference });
  }
  const payerContactId = v.payerContactId ?? membership.contactId;
  if (directDebit && !mandateId) {
    if (!v.iban || !v.debtorName) return financeConflict('mandateRequired');
    if (!db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, payerContactId)).get()) return notFound('contact', payerContactId);
  }
  const type = typeAt(db, membership.id, v.validFrom);
  const rule = type ? feeRuleAt(db, type.typeId, v.validFrom) : null;
  if (rule) {
    // M4, Nachlauf R1: Verglichen wird im Rhythmus der Vereinbarung mit dem umgerechneten Regelbetrag, abgerundet: Geht
    // die Rechnung nicht auf, liegt niemand wegen der Rundung darunter (10,41 €/Monat bei 125 €/Jahr, Joe 2026-10-31).
    const minimumInAgreedInterval = minimumInInterval(rule.amountCents, rule.interval, v.interval ?? rule.interval);
    if (rule.minimum && v.amountCents != null && v.amountCents < minimumInAgreedInterval && v.reduction !== 'reduced') return membersConflict('feeBelowMinimum', { minimumCents: minimumInAgreedInterval }, ['minimumCents']);
    if (v.interval != null && !rule.allowedIntervals.includes(v.interval)) return membersConflict('intervalNotAllowed');
  }
  return { mandateId, payerContactId };
}

/** Schreibt die geprüfte Vereinbarung in der Transaktion des Aufrufers: Mandat vorbereiten, Zeile, Protokoll, Nachrechnung. */
export function writeAgreementInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, membership: MembershipRow, v: FeeAgreementInput, checked: { mandateId: string | null; payerContactId: string }): FeeAgreementResult {
  const { mandateId, payerContactId } = checked;
  const directDebit = v.paymentMethod === 'directDebit';
  const now = isoNow(deps.clock);
  const before = tx.select().from(memberFeeAgreements).where(and(eq(memberFeeAgreements.membershipId, membership.id), eq(memberFeeAgreements.validFrom, v.validFrom))).get();
  const prepared = directDebit && !mandateId ? prepareMandateInternal(tx, deps, ctx, { contactId: payerContactId, debtorName: v.debtorName!, iban: v.iban!, bic: null }) : null;
  const fields = { amountCents: v.amountCents ?? null, interval: v.interval ?? null, paymentMethod: v.paymentMethod, mandateId: prepared?.id ?? mandateId, reduction: v.reduction, reductionDocumentId: v.reductionDocumentId ?? null, updatedAt: now };
  const agreementId = before?.id ?? newId();
  if (before) tx.update(memberFeeAgreements).set(fields).where(eq(memberFeeAgreements.id, agreementId)).run();
  else tx.insert(memberFeeAgreements).values({ id: agreementId, membershipId: membership.id, validFrom: v.validFrom, ...fields, createdAt: now }).run();
  recordAudit(tx, deps, ctx, {
    action: 'members.feeAgreement.set',
    entityType: 'membership',
    entityId: membership.id,
    before: before ? { validFrom: before.validFrom, interval: before.interval, paymentMethod: before.paymentMethod, reduction: before.reduction, amountCents: before.amountCents } : null,
    after: { validFrom: v.validFrom, interval: fields.interval, paymentMethod: fields.paymentMethod, reduction: fields.reduction, amountCents: fields.amountCents },
    params: { memberNumber: membership.memberNumber, validFrom: v.validFrom },
  });
  recalculateChargesInternal(tx, deps, ctx, membership.id, v.validFrom);
  // Offene Beiträge ziehen beim Zahlweg mit, außer ein Brief forderte schon zur Überweisung auf (Plan N1 E3).
  const sync = syncPaymentMethodsInternal(tx, deps, ctx, membership.id, v.validFrom);
  return { ...tx.select().from(memberFeeAgreements).where(eq(memberFeeAgreements.id, agreementId)).get()!, transferKept: sync.transferKept, debitAnnounced: sync.debitAnnounced };
}
