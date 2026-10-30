import { unwrap, type CallContext } from '@kompass/core';
import { textPdf } from '@kompass/module-dms';
import { saveAgendaItem } from '../src/agenda';
import { backfillMeeting } from '../src/backfill';
import { fileSignedMinutes } from '../src/minutes/signed';
import { governanceRegisterOccasions, type OccasionKind } from '../src/schema';
import { sealMeeting } from '../src/seal/seal';
import { createStatuteDraft } from '../src/statutes';
import { endTerm, listTerms } from '../src/terms';
import { adopt, holders, officeOf, organOf, type GovernanceDeps } from './helpers';

const head = { startsAt: '18:00', endedAt: '20:00', form: 'inPerson' as const, place: 'Vereinsheim', present: 7, voting: 7, chairBy: 'consent' as const };

/**
 * Eine nachgetragene Versammlung am `heldOn`, die einen neuen Satzungsstand beschließt (Gründung: `founding`),
 * unterschrieben abgelegt und festgeschrieben. Liefert Sitzung, Stand und den Anlass, der dabei entstand.
 */
export async function statuteMeeting(deps: GovernanceDeps, ctx: CallContext, heldOn: string, opts: { founding?: boolean; basedOnId?: string; kind?: 'statute' | 'dissolution'; liquidatorContactIds?: string[] } = {}) {
  const statuteId = unwrap(await createStatuteDraft(deps, ctx, opts.basedOnId ? { basedOnId: opts.basedOnId } : {})).id;
  const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: opts.founding ? 'founding' : 'extraordinary', heldOn, ...head }));
  const kind = opts.kind ?? 'statute';
  const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind, title: kind, ...(kind === 'statute' ? { statuteId } : {}) })).id;
  await adopt(deps, ctx, item, { votedAt: '18:10', ...(kind === 'dissolution' ? { details: { liquidatorContactIds: opts.liquidatorContactIds ?? [] } } : {}) });
  const minutes = unwrap(await fileSignedMinutes(deps, ctx, { meetingId: meeting.id, bytes: textPdf(['Protokoll']) }));
  unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
  const occasionKind: OccasionKind = opts.founding ? 'initial' : kind;
  const occasion = deps.db.select().from(governanceRegisterOccasions).all().find((o) => o.meetingId === meeting.id && o.kind === occasionKind)!;
  return { meetingId: meeting.id, statuteId, occasionId: occasion.id, minutesDocumentId: minutes.documentId };
}

/** Rücktritt aus dem Vorsitz am `until` → gespeicherter Anlass `boardChange`. */
export async function chairResigns(deps: GovernanceDeps, ctx: CallContext, until = '2026-05-31') {
  await holders(deps, ctx, ['chair']);
  const [term] = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'chair') }));
  unwrap(await endTerm(deps, ctx, { id: term!.id, until, reason: 'resigned', receivedOn: until }));
  return deps.db.select().from(governanceRegisterOccasions).all().find((o) => o.termId === term!.id)!.id;
}
