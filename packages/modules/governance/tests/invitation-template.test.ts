import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { invitationFactsInternal } from '../src/invitation/facts';
import { governanceDocumentTemplates, invitationBody, invitationTemplate, type InvitationInput } from '../src/invitation/template';
import { cancelMeeting, createMeeting } from '../src/meetings';
import { governanceMeetings, governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const head = { heldOn: '2026-09-05', startsAt: '19:00', form: 'inPerson' as const, place: 'Vereinsheim' };

async function rules(deps: GovernanceDeps, ctx: Ctx) {
  const mv = organ(deps, 'assembly');
  const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
  unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { noticeDays: 14, motionDeadlineDays: 7, repeatMeeting: { withinDays: 28, noQuorum: true } } } } }));
  return mv;
}

const sample: InvitationInput = { recipient: 'An die Mitglieder', greeting: 'Liebe Mitglieder,', organizationName: 'Beispielverein', subject: 'Einladung', intro: ['Text'], head: [{ label: 'Datum', value: '05.09.2026' }], agenda: [{ position: 1, title: 'Begrüßung', text: null, attachments: ['GRD-2026-001'] }], hints: [], closing: ['Mit freundlichen Grüßen'] };

describe('invitation template', () => {
  it('builds purely and keeps quotes and backslashes as text', () => {
    const template = invitationTemplate('governance-invitation', 'governance-invitation');
    const ctx = { number: 'ELD-2026-001', issuedAt: '2026-08-10T08:00:00.000Z', issuedDay: '2026-08-10', organization: {}, theme: {}, logo: null } as never;
    expect(template.build(sample, ctx)).toEqual(template.build(sample, ctx));
    const body = invitationBody({ ...sample, intro: ['Er sagte "#strong[x]" \\ und ging'] });
    expect(body).toContain('#"Er sagte \\"#strong[x]\\" \\\\ und ging";');
    expect(governanceDocumentTemplates.map((t) => [t.key, t.type, t.permission])).toEqual([
      ['governance-invitation', 'governance-invitation', 'governance.manage'],
      ['governance-invitation-letter', 'governance-invitation-letter', 'governance.manage'],
      ['governance-cancellation-letter', 'governance-invitation-letter', 'governance.manage'],
    ]);
  });
});

describe('invitationFactsInternal', () => {
  it('takes the hints from the rules of the meeting day: motion deadline, repeat without quorum, remote access', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = await rules(deps, ctx);
    const first = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...head }));
    const repeat = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'repeat', repeatOfId: first.id, ...head, form: 'hybrid', access: 'https://example.org/raum', remoteNote: 'Abstimmung im Chat' }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: repeat.id, kind: 'statute', title: 'Satzungsänderung', invitationText: 'Alt: § 3. Neu: § 3 neu.' }));
    const facts = invitationFactsInternal(deps.db, deps, repeat.id, 'invitation');
    expect(facts.hints).toEqual([
      'Anträge zur Tagesordnung reichen Sie bitte bis zum 28.08.2026 beim Vorstand ein.',
      'Die Versammlung ist ohne Rücksicht auf die Zahl der Erschienenen beschlussfähig.',
      'So nehmen Sie elektronisch teil und üben Ihre Rechte aus: Abstimmung im Chat',
      'Für den Beschluss zu TOP 1 sind drei Viertel der abgegebenen Stimmen nötig (§ 33 Abs. 1 S. 1 BGB).',
    ]);
    expect(facts.head.map((h) => h.value)).toContain('https://example.org/raum');
    expect(facts.agenda).toEqual([{ position: 1, title: 'Satzungsänderung', text: 'Alt: § 3. Neu: § 3 neu.', attachments: [] }]);
    expect(invitationFactsInternal(deps.db, deps, first.id, 'invitation').head.map((h) => h.label)).not.toContain('Zugang');
  });

  it('shows only the supplemented items in a supplement, and the reason in a cancellation', async () => {
    const { deps, ctx } = setupGovernance();
    const mv = await rules(deps, ctx);
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'extraordinary', ...head }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'other', title: 'Begrüßung' }));
    deps.db.update(governanceMeetings).set({ invitedOn: '2026-08-10' }).run();
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Neuer Punkt' }));
    expect(invitationFactsInternal(deps.db, deps, meeting.id, 'supplement').agenda.map((a) => a.title)).toEqual(['Neuer Punkt']);
    unwrap(await cancelMeeting(deps, ctx, { id: meeting.id, cancelledOn: '2026-08-20', reason: 'Raum fehlt' }));
    const cancellation = invitationFactsInternal(deps.db, deps, meeting.id, 'cancellation');
    expect(cancellation).toMatchObject({ agenda: [], head: [], hints: ['Grund: Raum fehlt'] });
  });
});

describe('annex with the changed paragraphs and the majority (U2)', () => {
  it('a statute item with two paragraphs gets an annex and a hint with the reference from the rules; without paragraphs no annex', async () => {
    const { buildContext, prepare } = await import('@kompass/core');
    const { deps, ctx } = setupGovernance();
    const mv = organ(deps, 'assembly');
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-07-20', resolutionId: null }], rules: { organs: { [mv]: { majorities: { statute: { fraction: { num: 2, den: 3 }, base: 'cast', abstentions: 'ignored' } } } }, references: { [mv]: { 'majorities.statute': '§ 99 Satzung' } } } }));
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'ordinary', ...head }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzung', wordingChanges: [{ label: '§ 5', before: 'Alt', after: 'Neu' }, { label: '§ 6', before: 'Alt 2', after: '' }] }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'purpose', title: 'Zweck' }));
    const facts = invitationFactsInternal(deps.db, deps, meeting.id, 'invitation');
    expect(facts.annexes).toHaveLength(1);
    expect(facts.annexes![0]!.rows).toHaveLength(2);
    expect(facts.hints.filter((h) => h.includes('§ 99 Satzung'))).toHaveLength(1);
    expect(facts.hints.filter((h) => h.includes('§ 33 Abs. 1 S. 2 BGB'))).toHaveLength(1);
    const prepared = unwrap(await prepare(deps, ctx, { templateKey: 'governance-invitation', input: facts }, { number: '' }));
    const context = await buildContext(deps, ctx, '');
    const { bytes } = await deps.documents.render({ baseId: prepared.baseId, bodyTypst: prepared.bodyTypst, slots: prepared.built.slots, context, images: prepared.images });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
  }, 60_000);
});
