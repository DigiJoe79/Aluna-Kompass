'use server';

import { readSetting, requirePermission } from '@kompass/core';
import { admitMember, changeMemberType, createMember, deferCharge, markRunPostDispatched, moveRunLetters, sendRunMails, startDunningRun, startFeeRun, waiveCharge, deleteMembership, endMembership, previewAdmission, previewRecalculation, proposeResignationEnd, recordResignation, type ResignationNotice, rejectApplication, revokeEnd, issueMemberCountCertificate, membershipForContact, setFeeAgreement } from '@kompass/module-members';
import { resendDocumentEmail } from '@kompass/module-dms';
import { kickMailSender } from '@/lib/background';
import { compactIban } from '@kompass/module-finance/format';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Mitglieder (Plan U1). Jede ruft genau einen Dienst aus `@kompass/module-members`; Rechte, Prüfungen
 * und Protokoll stehen dort.
 */
function revalidate(): void {
  revalidatePath('/members');
  revalidatePath('/members/fees');
}

/** Bescheinigung über die Zahl der Mitglieder zum Stichtag (`members.manage`, nur ein Mensch). */
export async function issueCountCertificateAction(input: { date: string }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#issueCountCertificateAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await issueMemberCountCertificate(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('members.certificate.done', { number: result.value.number }), data: result.value };
  });
}

export interface CreateMemberInput {
  contactId: string;
  typeId: string;
  appliedOn: string;
  /** Leer: nur Antrag. */
  admittedOn: string;
  paymentMethod: 'transfer' | 'directDebit';
  iban: string;
  debtorName: string;
  /** Abweichender Betrag je Zeitraum in Cent; `null` nach der Beitragsordnung. */
  amountCents: number | null;
  reduction: 'none' | 'reduced';
}

/**
 * Mitglied anlegen (Handoff Mitglieder 2.2): ein Dienst, `createMember`, legt Antrag, Vereinbarung (mit vorbereitetem
 * Mandat) und mit Tag der Aufnahme die Aufnahme in einer Transaktion an — lehnt ein Teil ab, entsteht nichts.
 */
export async function createMemberAction(input: CreateMemberInput): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#createMemberAction', async (): Promise<ActionState> => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const needsAgreement = input.paymentMethod === 'directDebit' || input.amountCents !== null;
    const result = await createMember(deps, ctx, {
      contactId: input.contactId,
      typeId: input.typeId,
      appliedOn: input.appliedOn,
      ...(input.admittedOn ? { admittedOn: input.admittedOn } : {}),
      ...(needsAgreement
        ? {
            agreement: {
              paymentMethod: input.paymentMethod,
              ...(input.amountCents !== null ? { amountCents: input.amountCents, reduction: input.reduction } : {}),
              ...(input.paymentMethod === 'directDebit' ? { iban: compactIban(input.iban), debtorName: input.debtorName.trim() } : {}),
            },
          }
        : {}),
    });
    revalidate();
    if (!result.ok) {
      const state = toActionState(result, t);
      if (state.status !== 'error') return state;
      // Die Maske zeigt IBAN und Betrag ohne den Präfix der Vereinbarung.
      const fieldErrors = Object.fromEntries(Object.entries(state.fieldErrors).map(([k, v]) => [k.replace(/^agreement\./, ''), v]));
      if (result.error.type === 'conflict' && result.error.code === 'membershipRunning') {
        const existing = await membershipForContact(deps, ctx, input.contactId);
        if (existing.ok && existing.value) {
          const name = existing.value.contactName;
          return {
            ...state,
            fieldErrors,
            message: existing.value.memberNumber ? t('members.form.alreadyMember', { name, number: existing.value.memberNumber }) : t('members.form.alreadyApplied', { name }),
            detail: undefined,
            remedies: [{ label: t('members.form.openMember'), href: `/members/${existing.value.id}` }],
          };
        }
      }
      return { ...state, fieldErrors };
    }
    redirect(`/members/${result.value.id}`);
  });
}

/** Aufnehmen aus dem Dialog (Handoff 3b): Nummer, Beiträge des Eintrittsjahres auf Wunsch, Aufnahmebestätigung auf Wunsch. */
export async function admitMemberAction(input: { membershipId: string; admittedOn: string; createFees: boolean; letter: boolean }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#admitMemberAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await admitMember(deps, ctx, input);
    revalidate();
    revalidatePath(`/members/${input.membershipId}`);
    if (!result.ok) return toActionState(result, t);
    const { letter } = result.value;
    const message = t('members.admit.done', { name: result.value.contactName, number: result.value.memberNumber ?? '' });
    const refused = letter && 'refused' in letter ? letter.refused : null;
    const reason = refused && t.has(`members.errors.${refused}.reason`) ? t(`members.errors.${refused}.reason`) : refused;
    return { status: 'success', message, data: { letterRefused: reason ? t('members.admit.letterRefused', { reason }) : null } };
  });
}

/** Vorschau im Aufnahme-Dialog: nächste Nummer, Beiträge des Eintrittsjahres, Brief möglich (`members.read`). */
export async function previewAdmissionAction(input: { membershipId: string; admittedOn: string }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#previewAdmissionAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await previewAdmission(deps, ctx, input), t);
  });
}

/** Vorschau der Neuberechnung vor dem Speichern (Spec § 3.3): ersetzt, bleibt, neu. */
export async function previewRecalculationAction(input: unknown): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#previewRecalculationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await previewRecalculation(deps, ctx, input);
    if (!result.ok) return toActionState(result, t);
    const letters = result.value.transferKept.map((k) => k.documentDate).sort();
    // R4: Beiträge, die ein Brief als Einzug angekündigt hat und die auf Überweisung wechseln.
    const announced = result.value.debitAnnounced.map((k) => k.documentDate).sort();
    return { status: 'success', data: { replaced: result.value.replace.length, kept: result.value.keep.length, added: result.value.add.length, transferKept: result.value.transferKept.length, transferLetterOn: letters.at(-1) ?? null, debitAnnounced: result.value.debitAnnounced.length, debitLetterOn: announced.at(-1) ?? null } };
  });
}

export interface SaveMemberInput {
  membershipId: string;
  type: { typeId: string; validFrom: string } | null;
  agreement: { validFrom: string; paymentMethod: 'transfer' | 'directDebit'; amountCents: number | null; reduction: 'none' | 'reduced'; iban: string; debtorName: string } | null;
}

/** Speichern der Mitglied-Seite: Art ab einem Tag, Beitragsvereinbarung ab einem Tag — je ein Dienst. */
export async function saveMemberAction(input: SaveMemberInput): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#saveMemberAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    if (input.type) {
      const changed = await changeMemberType(deps, ctx, { membershipId: input.membershipId, ...input.type });
      if (!changed.ok) return toActionState(changed, t);
    }
    if (input.agreement) {
      const a = input.agreement;
      const set = await setFeeAgreement(deps, ctx, {
        membershipId: input.membershipId,
        validFrom: a.validFrom,
        paymentMethod: a.paymentMethod,
        ...(a.amountCents !== null ? { amountCents: a.amountCents, reduction: a.reduction } : {}),
        ...(a.paymentMethod === 'directDebit' && a.iban.trim() ? { iban: compactIban(a.iban), debtorName: a.debtorName.trim() } : {}),
      });
      if (!set.ok) return toActionState(set, t);
    }
    revalidate();
    revalidatePath(`/members/${input.membershipId}`);
    return { status: 'success', message: t('members.detail.saved') };
  });
}

/** Antrag ablehnen (nur ein Mensch). */
export async function rejectApplicationAction(input: { membershipId: string; rejectedOn: string; letter: boolean }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#rejectApplicationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await rejectApplication(deps, ctx, input);
    revalidate();
    revalidatePath(`/members/${input.membershipId}`);
    return toActionState(result, t, t('members.detail.reject.done'));
  });
}

/** Antrag löschen: nur ohne Beitrag (Handoff § 3). */
export async function deleteMembershipAction(membershipId: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#deleteMembershipAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteMembership(deps, ctx, { membershipId });
    revalidate();
    return toActionState(result, t);
  });
}

export type EndInput =
  | { membershipId: string; reason: 'resignation'; noticeOn: string; endsOn: string; letter: boolean }
  | { membershipId: string; reason: 'exclusion' | 'struckOff' | 'death' | 'other'; endsOn: string; documentId?: string | null };

/** „Mitgliedschaft beenden …“: Austritt über `recordResignation`, jeder andere Grund über `endMembership` (Bewertung D1). */
export async function endMembershipAction(input: EndInput): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#endMembershipAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result =
      input.reason === 'resignation'
        ? await recordResignation(deps, ctx, { membershipId: input.membershipId, noticeOn: input.noticeOn, endsOn: input.endsOn, letter: input.letter })
        : await endMembership(deps, ctx, { membershipId: input.membershipId, endsOn: input.endsOn, reason: input.reason, documentId: input.documentId ?? null });
    revalidate();
    revalidatePath(`/members/${input.membershipId}`);
    return toActionState(result, t, t('members.detail.end.done'));
  });
}

/** „Ende zurücknehmen“ an der Notice (Handoff D1): ohne Rückfrage, der Toast bietet die Gegenaktion. */
export async function revokeEndAction(membershipId: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#revokeEndAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await revokeEnd(deps, ctx, { membershipId });
    revalidate();
    revalidatePath(`/members/${membershipId}`);
    return toActionState(result, t);
  });
}

/** Ende nach der Kündigungsfrist der Einstellung zu einem Kündigungstag — Vorschlag im Dialog, änderbar. */
export async function proposeResignationEndAction(noticeOn: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#proposeResignationEndAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const denied = requirePermission(ctx, 'members.read');
    if (denied) return toActionState(denied, t);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeOn)) return { status: 'error', message: t('errors.validation'), fieldErrors: {} };
    return { status: 'success', data: { endsOn: proposeResignationEnd(noticeOn, readSetting<ResignationNotice>(deps, 'members.resignationNotice')) } };
  });
}

/** Beitragslauf starten (nur ein Mensch); angelegt wird danach über den Continue-Handler. */
export async function startFeeRunAction(input: { year: number; notices: 'directDebitOnly' | 'all' }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#startFeeRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startFeeRun(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('members.feeRun.started'), data: { id: result.value.id } };
  });
}

/** Mahnlauf starten (nur ein Mensch); die Briefe entstehen über den Continue-Handler. */
export async function startDunningRunAction(input: { asOf: string }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#startDunningRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startDunningRun(deps, ctx, input);
    revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', message: t('members.dunningRun.started'), data: { id: result.value.id } };
  });
}

/** „{n} per E-Mail senden“ im Schritt „Versand“ (Handoff 2b E3). */
export async function sendRunMailsAction(runRef: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#sendRunMailsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await sendRunMails(deps, ctx, { runRef });
    revalidate();
    if (!result.ok) return toActionState(result, t);
    // Den Sender gleich anstoßen statt bis zum nächsten Takt (30 s) zu warten.
    kickMailSender();
    return { status: 'success', message: t('dispatchStep.sending', { count: result.value.queued }) };
  });
}

/** „Versand vermerken …“ für Briefe der Post-Gruppe. */
export async function markRunPostAction(input: { runRef: string; documentIds: string[]; sentAt: string }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#markRunPostAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markRunPostDispatched(deps, ctx, input);
    revalidate();
    return toActionState(result, t);
  });
}

/** „Erneut senden“ an einer nicht zugestellten Zeile: eine neue Sendung, die alte bleibt im Ausgang. */
export async function resendRunMailAction(outboxId: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#resendRunMailAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resendDocumentEmail(deps, ctx, { outboxId });
    if (result.ok) kickMailSender();
    return toActionState(result, t, t('dispatchStep.resent'));
  });
}

/** „Per Post schicken“ / „Zurück zu E-Mail“ je Zeile des Versand-Schritts (Plan U4 Task 2). */
export async function moveRunLettersAction(input: { runRef: string; documentIds: string[]; to: 'post' | 'email' }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#moveRunLettersAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveRunLetters(deps, ctx, input);
    return toActionState(result, t, t(input.to === 'post' ? 'dispatchStep.movedToPost' : 'dispatchStep.movedToEmail'));
  });
}

/** Stunden (nur ein Mensch): neue Fälligkeit, bis dahin keine Mahnung. */
export async function deferChargeAction(input: { chargeId: string; dueOn: string }): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#deferChargeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deferCharge(deps, ctx, input);
    revalidate();
    return toActionState(result, t, t('members.fees.defer.done'));
  });
}

/** Erlassen (nur ein Mensch): der offene Rest fällt weg. */
export async function waiveChargeAction(chargeId: string): Promise<ActionState> {
  return guardAction('(shell)/members/actions.ts#waiveChargeAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await waiveCharge(deps, ctx, { chargeId });
    revalidate();
    return toActionState(result, t, t('members.fees.waive.done'));
  });
}
