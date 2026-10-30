import { hasPermission, isModuleEnabled, todayIn } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getMeeting, getMeetingContext, invitationDispatchState, listOrgans, listStatutes, listMeetings, RUN_REF_PREFIX } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ForbiddenCard } from '@/components/forbidden-card';
import { Page } from '@/components/page';
import { RelatedDocuments } from '@/components/related-documents';
import { dateFormatOf } from '@/lib/date-format';
import { meetingTitle } from '@/lib/governance/meeting-state';
import { requireSession } from '@/lib/request-context';
import { MeetingView } from './meeting-view';

/**
 * Sitzung als Vorgang (Plan U1 Task 5, Board 2a–2d): Lesen mit `governance.read`, vorbereiten mit `governance.manage`,
 * beginnen mit `governance.record`. Die Seite hängt nicht in der Navigation; der Rückweg führt zur Liste.
 */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deps, ctx } = await requireSession();
  if (!hasPermission(ctx, 'governance.read')) return <Page width="standard"><ForbiddenCard permission="governance.read" /></Page>;
  const [detail, context] = await Promise.all([getMeeting(deps, ctx, { id }), getMeetingContext(deps, ctx, { meetingId: id })]);
  if (!detail.ok || !context.ok) notFound();
  const m = detail.value;
  const c = context.value;
  const t = await getTranslations('governance');
  const fmt = dateFormatOf(deps);
  const [organs, statutes, meetings] = await Promise.all([listOrgans(deps, ctx, { includeInactive: true }), listStatutes(deps, ctx, {}), listMeetings(deps, ctx, { organId: m.organId })]);
  const organList = organs.ok ? organs.value : [];

  // Versand des Einladungslaufs (nur Mitgliederversammlung): fertig, wenn jeder Brief draußen ist.
  const run = m.runs.filter((r) => r.kind === 'invitation').at(-1);
  const dispatch = run ? await invitationDispatchState(deps, ctx, { runId: run.id }) : null;
  const dispatchDone = run ? (dispatch?.ok ? dispatch.value.done : false) : null;

  const canDms = isModuleEnabled(deps, 'dms') && hasPermission(ctx, 'dms.view');
  const docIds = [...new Set([...m.agenda.flatMap((i) => i.attachmentDocumentIds), ...m.motions.flatMap((mo) => (mo.documentId ? [mo.documentId] : []))])];
  const documentLabels: Record<string, string> = {};
  if (canDms) {
    for (const docId of docIds) {
      const doc = await getDocumentRecord(deps, ctx, docId);
      if (doc.ok) documentLabels[docId] = doc.value.number ? `${doc.value.number} · ${doc.value.subject}` : doc.value.subject;
    }
  }
  const invitationDocument = canDms && m.invitationDocumentId ? await getDocumentRecord(deps, ctx, m.invitationDocumentId) : null;
  const title = meetingTitle((key, values) => t(key, values), fmt.date, m, c.organ.name);
  const openPoints = m.resolutions.filter((r) => r.kind !== 'election' && r.outcome === null).length;

  return (
    <Page width="standard">
      <MeetingView
        meeting={m}
        context={c}
        title={title}
        back={{ href: '/governance/meetings', label: t('meetings.listTitle') }}
        today={todayIn(deps)}
        dispatchDone={dispatchDone}
        openPoints={openPoints}
        statutes={(statutes.ok ? statutes.value : [])
          .filter((s) => s.state === 'draft' || s.state === 'resolved')
          .map((s) => ({ id: s.id, label: [t(`states.statute.${s.state}`, { date: '' }), s.lastResolvedOn ? fmt.date(s.lastResolvedOn) : null, s.note].filter(Boolean).join(' · ') }))}
        documentLabels={documentLabels}
        perms={{ manage: hasPermission(ctx, 'governance.manage'), record: hasPermission(ctx, 'governance.record'), contacts: hasPermission(ctx, 'contacts.view'), dms: canDms }}
        head={{
          organs: organList.map((o) => ({ id: o.id, name: o.name, kind: o.kind })),
          meeting: { organId: m.organId, kind: m.kind, heldOn: m.heldOn, startsAt: m.startsAt, form: m.form, place: m.place, access: m.access, remoteNote: m.remoteNote, repeatOfId: m.repeatOfId },
          repeatCandidates: (meetings.ok ? meetings.value : []).filter((x) => x.id !== m.id && (x.state === 'recorded' || x.state === 'signed')).map((x) => ({ id: x.id, organId: x.organId, label: meetingTitle((key, values) => t(key, values), fmt.date, x, c.organ.name) })),
          canPickContacts: hasPermission(ctx, 'contacts.view'),
          chair: m.plannedChairContactId ? { id: m.plannedChairContactId, name: c.names[m.plannedChairContactId] ?? '' } : null,
          minuteTaker: m.plannedMinuteTakerContactId ? { id: m.plannedMinuteTakerContactId, name: c.names[m.plannedMinuteTakerContactId] ?? '' } : null,
        }}
        invitation={{ runs: m.runs, runRefPrefix: RUN_REF_PREFIX, dispatch: dispatch?.ok ? dispatch.value : null, documentNumber: invitationDocument?.ok ? invitationDocument.value.number : null }}
        documents={<RelatedDocuments deps={deps} ctx={ctx} entityType="governanceMeeting" entityId={m.id} />}
      />
    </Page>
  );
}
