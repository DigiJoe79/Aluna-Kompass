'use server';

import type { Result } from '@kompass/core';
import {
  acceptElection,
  addMeetingItem,
  admitLateMotion,
  decideResolution,
  endMeeting,
  getMeeting,
  recordArrival,
  recordDeparture,
  recordFloorMotion,
  saveAttendance,
  saveDischarge,
  saveElectionRound,
  saveFindings,
  saveResolution,
  setAgendaNote,
  takeOverMinutes,
} from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions des Mitlaufs (Plan U1 Task 9/10): je Dienst eine, bei Erfolg `success` ohne Meldung — der
 * Speicherzustand steht in der Lageleiste, kein Toast. Die Warteschlange ruft sie über `runAction`; wirft eine, gilt
 * das als „keine Verbindung“. `data` trägt das Ergebnis des Dienstes (etwa die ID eines neuen Beschlusses).
 */
async function serve<T>(meetingId: string, run: (deps: Awaited<ReturnType<typeof requireSession>>['deps'], ctx: Awaited<ReturnType<typeof requireSession>>['ctx']) => Promise<Result<T>>): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await run(deps, ctx);
  revalidatePath(`/governance/meetings/${meetingId}/live`);
  if (!result.ok) return toActionState(result, t);
  return { status: 'success', data: result.value };
}

export interface ResultInput {
  meetingId: string;
  agendaItemId: string;
  /** Ohne: der vorhandene einfache Beschluss am TOP, sonst ein neuer. */
  resolutionId?: string;
  kind?: string;
  text: string;
  votedAt: string;
  unanimous?: boolean;
  votes?: { no: number; abstain: number; invalid: number; yes?: number };
  yesComputed?: boolean;
  details?: unknown;
  /** Die Feststellung; `null` lässt sie offen. */
  outcome: 'adopted' | 'rejected' | 'postponed' | 'withdrawn' | null;
  outcomeReason?: string | null;
}

/**
 * Ein Ergebnis an einem TOP: Stimmen speichern (`saveResolution`), dann feststellen (`decideResolution`) — eine
 * Sendung der Warteschlange, damit die Feststellung den Beschluss kennt. Ohne `resolutionId` nimmt sie den einen
 * Beschluss des TOP, den es schon gibt, statt einen zweiten anzulegen.
 */
export async function recordResultAction(input: ResultInput): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#recordResultAction', () => serve(input.meetingId, async (deps, ctx) => {
    let id = input.resolutionId;
    if (!id) {
      const detail = await getMeeting(deps, ctx, { id: input.meetingId });
      if (detail.ok) id = detail.value.resolutions.find((r) => r.agendaItemId === input.agendaItemId && r.kind !== 'election' && r.kind !== 'discharge')?.id;
    }
    const closed = input.outcome === 'postponed' || input.outcome === 'withdrawn';
    const saved = await saveResolution(deps, ctx, {
      ...(id ? { id } : {}),
      agendaItemId: input.agendaItemId,
      ...(input.kind ? { kind: input.kind } : {}),
      text: input.text,
      votedAt: input.votedAt,
      ...(closed ? {} : input.unanimous ? { unanimous: true } : input.votes ? { votes: input.votes, yesComputed: input.yesComputed === true } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
    });
    if (!saved.ok || input.outcome === null) return saved;
    return decideResolution(deps, ctx, { id: saved.value.id, outcome: input.outcome, outcomeReason: input.outcomeReason?.trim() || null });
  }));
}

/** Feststellung allein (Entlastung, Aufnahme eines Antrags: der Beschluss besteht schon). */
export async function decideAction(meetingId: string, input: { id: string; outcome: 'adopted' | 'rejected' | 'postponed' | 'withdrawn'; outcomeReason?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#decideAction', () => serve(meetingId, (deps, ctx) => decideResolution(deps, ctx, { ...input, outcomeReason: input.outcomeReason?.trim() || null })));
}

export async function arriveAction(meetingId: string, attendanceId: string, at: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#arriveAction', () => serve(meetingId, (deps, ctx) => recordArrival(deps, ctx, { attendanceId, at })));
}

export async function leaveAction(meetingId: string, attendanceId: string, at: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#leaveAction', () => serve(meetingId, (deps, ctx) => recordDeparture(deps, ctx, { attendanceId, at })));
}

/** Ein Gast (Name oder Funktion als Text) oder bei der Gründung eine Person (`founder`), danach „Kommt“. */
export async function addAttendeeAction(input: { meetingId: string; role: 'guest' | 'founder' | 'member'; guestLabel?: string; contactId?: string; at: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#addAttendeeAction', () => serve(input.meetingId, async (deps, ctx) => {
    const saved = await saveAttendance(deps, ctx, { meetingId: input.meetingId, role: input.role, ...(input.guestLabel ? { guestLabel: input.guestLabel } : {}), ...(input.contactId ? { contactId: input.contactId } : {}) });
    if (!saved.ok) return saved;
    return recordArrival(deps, ctx, { attendanceId: saved.value.id, at: input.at });
  }));
}

export async function saveFindingsAction(meetingId: string, findings: Record<string, unknown>): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#saveFindingsAction', () => serve(meetingId, (deps, ctx) => saveFindings(deps, ctx, { meetingId, findings })));
}

export async function setNoteAction(meetingId: string, itemId: string, note: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#setNoteAction', () => serve(meetingId, (deps, ctx) => setAgendaNote(deps, ctx, { itemId, note })));
}

export async function addItemAction(input: { meetingId: string; kind: string; title: string; afterItemId?: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#addItemAction', () => serve(input.meetingId, (deps, ctx) => addMeetingItem(deps, ctx, input)));
}

export async function takeOverAction(meetingId: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#takeOverAction', () => serve(meetingId, (deps, ctx) => takeOverMinutes(deps, ctx, { meetingId })));
}

/** „Mitlauf beenden“: danach zur Sitzung, Schritt „Protokoll“. */
export async function endMeetingAction(meetingId: string, endedAt: string): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#endMeetingAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endMeeting(deps, ctx, { meetingId, endedAt });
    revalidatePath(`/governance/meetings/${meetingId}`);
    if (!result.ok) return toActionState(result, t);
    redirect(`/governance/meetings/${meetingId}`);
  });
}

export async function saveElectionRoundAction(meetingId: string, input: { agendaItemId: string; officeId: string; votedAt: string; round: { number: number; runoff: boolean; candidates: { contactId: string; votes: number }[]; no: number; abstain: number; invalid: number; unanimousContactId: string | null } }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#saveElectionRoundAction', () => serve(meetingId, (deps, ctx) => saveElectionRound(deps, ctx, input)));
}

export async function acceptElectionAction(meetingId: string, input: { resolutionId: string; contactId: string; acceptedOn?: string; declined?: boolean }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#acceptElectionAction', () => serve(meetingId, (deps, ctx) => acceptElection(deps, ctx, input)));
}

export async function saveDischargeAction(meetingId: string, input: { agendaItemId: string; fiscalYearId: string; mode: 'individual' | 'collective'; contactIds?: string[]; votedAt: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#saveDischargeAction', () => serve(meetingId, (deps, ctx) => saveDischarge(deps, ctx, input)));
}

export interface DischargeResultInput {
  meetingId: string;
  agendaItemId: string;
  fiscalYearId: string;
  mode: 'individual' | 'collective';
  contactIds: string[];
  /** Einzeln: die Person des Beschlusses; gemeinsam `null`. */
  target: string | null;
  text: string;
  votedAt: string;
  unanimous?: boolean;
  votes?: { no: number; abstain: number; invalid: number; yes?: number };
  yesComputed?: boolean;
  outcome: 'adopted' | 'rejected' | 'postponed' | 'withdrawn' | null;
  outcomeReason?: string | null;
}

/**
 * Ein Ergebnis der Entlastung (Board 1e): Gibt es am TOP noch keinen Entlastungsbeschluss, legt `saveDischarge` sie
 * zuerst an (gemeinsam einer, einzeln je Person einer) — damit ist die Wahl gemeinsam/einzeln fest. Dann Stimmen und
 * Feststellung des einen Beschlusses, wie bei jedem Ergebnis.
 */
export async function recordDischargeResultAction(input: DischargeResultInput): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#recordDischargeResultAction', () =>
    serve(input.meetingId, async (deps, ctx): Promise<Result<unknown>> => {
      const detail = await getMeeting(deps, ctx, { id: input.meetingId });
      if (!detail.ok) return detail;
      let discharges = detail.value.resolutions.filter((r) => r.agendaItemId === input.agendaItemId && r.kind === 'discharge');
      if (discharges.length === 0) {
        const created = await saveDischarge(deps, ctx, { agendaItemId: input.agendaItemId, fiscalYearId: input.fiscalYearId, mode: input.mode, contactIds: input.contactIds, votedAt: input.votedAt });
        if (!created.ok) return created;
        discharges = created.value;
      }
      const target = input.target === null ? discharges[0] : discharges.find((r) => (r.details as { contactIds?: string[] } | null)?.contactIds?.[0] === input.target);
      if (!target) return saveDischarge(deps, ctx, { agendaItemId: input.agendaItemId, fiscalYearId: input.fiscalYearId, mode: input.mode, contactIds: input.contactIds, votedAt: input.votedAt });
      const closed = input.outcome === 'postponed' || input.outcome === 'withdrawn';
      const saved = await saveResolution(deps, ctx, { id: target.id, agendaItemId: input.agendaItemId, kind: 'discharge', text: input.text, votedAt: input.votedAt, ...(closed ? {} : input.unanimous ? { unanimous: true } : input.votes ? { votes: input.votes, yesComputed: input.yesComputed === true } : {}) });
      if (!saved.ok || input.outcome === null) return saved;
      return decideResolution(deps, ctx, { id: saved.value.id, outcome: input.outcome, outcomeReason: input.outcomeReason?.trim() || null });
    }),
  );
}

export async function admitLateMotionAction(meetingId: string, input: { motionId: string; votedAt: string; kind: string; unanimous?: boolean; votes?: { no: number; abstain: number; invalid: number; yes?: number }; yesComputed?: boolean; outcome: 'adopted' | 'rejected' | 'postponed' | 'withdrawn' | null; outcomeReason?: string | null }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#admitLateMotionAction', () => serve(meetingId, async (deps, ctx) => {
    const { outcome, outcomeReason, ...rest } = input;
    const closed = outcome === 'postponed' || outcome === 'withdrawn';
    const admitted = await admitLateMotion(deps, ctx, { motionId: rest.motionId, votedAt: rest.votedAt, kind: rest.kind, ...(closed ? {} : rest.unanimous ? { unanimous: true } : rest.votes ? { votes: rest.votes, yesComputed: rest.yesComputed === true } : {}) });
    if (!admitted.ok || outcome === null) return admitted.ok ? { ok: true as const, value: admitted.value.admission } : admitted;
    return decideResolution(deps, ctx, { id: admitted.value.admission.id, outcome, outcomeReason: outcomeReason?.trim() || null });
  }));
}

export async function recordFloorMotionAction(input: { meetingId: string; submittedByContactId: string | null; text: string; kind: string; afterItemId?: string }): Promise<ActionState> {
  return guardAction('(shell)/governance/meetings/[id]/live/actions.ts#recordFloorMotionAction', () => serve(input.meetingId, (deps, ctx) => recordFloorMotion(deps, ctx, input)));
}
