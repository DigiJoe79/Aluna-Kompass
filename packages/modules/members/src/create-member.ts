import { invalid, notFound, ok, readSetting, requireHumanChannel, requirePermission, todayIn, validate, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { catchAborted, MembersAborted } from './errors';
import { checkAgreementInternal, feeAgreementSetSchema, writeAgreementInternal } from './fee-agreement';
import { letterAfterStep } from './letters/issue';
import { activeType, admitInternal, applicationIssues, applyInternal, HUMAN_ONLY_SETTING, loadView, type MembershipWithLetter } from './memberships';
import { memberMemberships } from './schema';
import type { MemberNumberFormat } from './settings';

const day = z.iso.date();

/** Die Vereinbarung beim Anlegen: ohne `membershipId` und `validFrom` — sie gilt ab dem Antrag (bzw. der früheren Aufnahme). */
const agreementSchema = feeAgreementSetSchema.omit({ membershipId: true, validFrom: true });

export const memberCreateSchema = z.object({
  contactId: z.string().min(1),
  typeId: z.string().min(1),
  appliedOn: day,
  /** Leer: nur der Antrag. Mit Tag: gleich aufgenommen (nur ein Mensch). */
  admittedOn: day.nullable().optional(),
  /** Abweichender Beitrag, Zahlweg Lastschrift (IBAN und Kontoinhaber legen das Mandat vorbereitet an). Braucht `members.fees`. */
  agreement: agreementSchema.optional(),
  /** Aufnahmebestätigung nach der Aufnahme; Vorgabe ja. */
  letter: z.boolean().optional(),
});

/**
 * „Mitglied anlegen“ (Handoff Mitglieder 2.2) in **einer** Transaktion: Antrag, Vereinbarung samt vorbereitetem Mandat
 * und — mit Tag der Aufnahme — die Aufnahme. Lehnt ein Teil ab, entsteht nichts, auch kein Eintrag im Protokoll. Die
 * Aufnahmebestätigung folgt nach der Transaktion wie bei `admitMember`.
 */
export async function createMember(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<MembershipWithLetter>> {
  const denied = requirePermission(ctx, 'members.manage');
  if (denied) return denied;
  const parsed = validate(deps, memberCreateSchema, input);
  if (!parsed.ok) return parsed;
  // Plan N1 (M2): Antrag nicht in der Zukunft, Aufnahme nicht vor dem Antrag.
  const dateIssues = applicationIssues(todayIn(deps), parsed.value);
  if (dateIssues.length > 0) return invalid(dateIssues);
  const v = parsed.value;
  if (v.agreement) {
    const fees = requirePermission(ctx, 'members.fees');
    if (fees) return fees;
  }
  if (v.admittedOn) {
    const human = requireHumanChannel(deps, ctx, HUMAN_ONLY_SETTING);
    if (human) return human;
  }
  if (!deps.db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, v.contactId)).get()) return notFound('contact', v.contactId);
  const type = activeType(deps.db, v.typeId);
  if ('ok' in type) return type;
  if (v.agreement?.paymentMethod === 'directDebit' && !v.agreement.mandateId && (!v.agreement.iban || !v.agreement.debtorName)) {
    return invalid([...(v.agreement.iban ? [] : [{ path: 'iban', message: 'required' }]), ...(v.agreement.debtorName ? [] : [{ path: 'debtorName', message: 'required' }])]);
  }
  const validFrom = v.admittedOn && v.admittedOn < v.appliedOn ? v.admittedOn : v.appliedOn;
  const format = readSetting<MemberNumberFormat>(deps, 'members.numberFormat');

  const created = catchAborted(() =>
    deps.db.transaction((tx: DbOrTx) => {
      const membershipId = applyInternal(tx, deps, ctx, { contactId: v.contactId, typeId: v.typeId, appliedOn: v.appliedOn }, type);
      if (v.agreement) {
        const row = tx.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get()!;
        const agreement = { ...v.agreement, membershipId, validFrom };
        const checked = checkAgreementInternal(tx, deps, row, agreement);
        if ('ok' in checked) throw new MembersAborted(checked);
        writeAgreementInternal(tx, deps, ctx, row, agreement, checked);
      }
      if (v.admittedOn) {
        const application = tx.select().from(memberMemberships).where(eq(memberMemberships.id, membershipId)).get()!;
        admitInternal(tx, deps, ctx, { application, contactId: undefined, type, admittedOn: v.admittedOn, joinedOn: v.admittedOn, appliedOn: v.appliedOn, createFees: true, format });
      }
      return ok(loadView(tx, deps, membershipId));
    }),
  );
  if (!created.ok) return created;
  const letter = v.admittedOn ? await letterAfterStep(deps, ctx, v.letter, true, { kind: 'admission', membershipId: created.value.id }) : null;
  return ok({ ...created.value, letter });
}
