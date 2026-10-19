import { notFound, ok, readSetting, requirePermission, todayIn, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { mandateRowInternal, mandateState } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { agreementAt } from './fee-agreement';
import { feeScheduleAt } from './fee-schedule';
import type { JoinYearRule } from './fee-calc';
import { admissionCreatesFees, computeChargesFor } from './fee-run';
import { letterRecipientOf, recipientFacts } from './letters/issue';
import { membershipStatus } from './status';
import { lastMemberNumber, formatMemberNumber } from './numbers';
import { memberMemberships } from './schema';
import type { MemberNumberFormat } from './settings';
import { membersConflict } from './errors';

export const admissionPreviewSchema = z.object({ membershipId: z.string().min(1), admittedOn: z.iso.date(), joinedOn: z.iso.date().optional() });

/** Was die Aufnahme tun würde (Handoff Mitglieder 3b): nächste Nummer, Beiträge des Eintrittsjahres, Brief möglich? */
export interface AdmissionPreview {
  nextNumber: string;
  year: number;
  /** Ob die Aufnahme die Beiträge des Jahres gleich anlegt (Jahr läuft oder hat einen Lauf). */
  createsFees: boolean;
  charges: { periodStart: string; periodEnd: string; amountCents: number; dueOn: string }[];
  joinYearRule: JoinYearRule;
  /** Anschrift oder E-Mail beim Empfänger der Aufnahmebestätigung — sonst bleibt der Haken aus (Entscheid Joe 6). */
  letterPossible: boolean;
  /** Der Empfänger, an dem Anschrift oder E-Mail zu ergänzen wäre. */
  recipientContactId: string;
  /** Lastschrift mit einem Mandat ohne Unterschrift: bis dahin wird nichts eingezogen. */
  mandatePending: boolean;
  /**
   * R8: warum für einen Zeitraum des Eintrittsjahres kein Beitrag entstünde — `noSchedule`: kein Stand der
   * Beitragsordnung gilt; `noRule`: der Stand hat keine Regel für die Art. `null`, wenn alles berechnet ist.
   */
  feeProblem: 'noSchedule' | 'noRule' | null;
}

/** Vorschau der Aufnahme eines offenen Antrags. Nur lesen, `members.read`; die Nummer wird erst beim Aufnehmen gezogen. */
export async function previewAdmission(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<AdmissionPreview>> {
  const denied = requirePermission(ctx, 'members.read');
  if (denied) return denied;
  const parsed = validate(deps, admissionPreviewSchema, input);
  if (!parsed.ok) return parsed;
  const { membershipId, admittedOn } = parsed.value;
  const joinedOn = parsed.value.joinedOn ?? admittedOn;
  const row = deps.db.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get();
  if (!row) return notFound('membership', membershipId);
  const today = todayIn(deps);
  if (membershipStatus(row, today) !== 'applied') return membersConflict('membershipNotApplied');
  const format = readSetting<MemberNumberFormat>(deps, 'members.numberFormat');
  const nextNumber = formatMemberNumber(lastMemberNumber(deps.db) + 1, format);
  const year = Number(joinedOn.slice(0, 4));
  const simulated = { ...row, admittedOn, joinedOn, memberNumber: nextNumber };
  const computed = computeChargesFor(deps.db, deps, simulated, year);
  const missing = computed.filter((c) => c.skip === 'noRule');
  const feeProblem = missing.length === 0 ? null : missing.some((c) => !feeScheduleAt(deps.db, c.dueOn)) ? 'noSchedule' : 'noRule';
  const charges = computed
    .filter((c) => !c.skip && c.amountCents > 0)
    .map(({ periodStart, periodEnd, amountCents, dueOn }) => ({ periodStart, periodEnd, amountCents, dueOn }));
  const recipientContactId = letterRecipientOf(row, today);
  const recipientExists = !!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, recipientContactId)).get();
  const agreement = agreementAt(deps.db, row.id, joinedOn);
  const mandate = agreement?.paymentMethod === 'directDebit' && agreement.mandateId ? mandateRowInternal(deps.db, agreement.mandateId) : null;
  return ok({
    nextNumber,
    year,
    createsFees: admissionCreatesFees(deps.db, deps, year),
    charges,
    joinYearRule: readSetting<JoinYearRule>(deps, 'members.joinYearRule'),
    letterPossible: recipientExists && recipientFacts(deps.db, recipientContactId).ok,
    recipientContactId,
    mandatePending: mandate ? mandateState(mandate, today) === 'pending' : false,
    feeProblem,
  });
}
