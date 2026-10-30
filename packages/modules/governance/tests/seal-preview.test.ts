import { schema, setSetting, unwrap, type Deps } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { linkUserToContact } from '@kompass/module-contacts';
import { textPdf } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { acceptElection, saveElectionRound } from '../src/elections';
import { followUpTitle } from '../src/follow-up-titles';
import { composeMinutesInternal, contactNameInternal } from '../src/minutes/compose';
import { MINUTES_WORDS } from '../src/minutes/words';
import { fileSignedMinutes } from '../src/minutes/signed';
import { previewSeal } from '../src/seal/preview';
import { endMeeting } from '../src/session';
import { governanceOffices } from '../src/schema';
import { sealMeeting } from '../src/seal/seal';
import { createStatuteDraft } from '../src/statutes';
import { listTerms } from '../src/terms';
import { adopt, elect, holders, officeOf, organOf, person, RECORDING, session, setupGovernance } from './helpers';

const kinds = (preview: { consequences: { kind: string }[] }) => preview.consequences.map((c) => c.kind);

async function sealable(deps: ReturnType<typeof setupGovernance>['deps'], ctx: ReturnType<typeof setupGovernance>['ctx'], meetingId: string) {
  unwrap(await endMeeting(deps, ctx, { meetingId, endedAt: '21:00' }));
  unwrap(await fileSignedMinutes(deps, ctx, { meetingId, bytes: textPdf(['Protokoll']) }));
}

const followUpsOf = (deps: Deps) => deps.db.select().from(schema.followUps).all();

describe('previewSeal — elections', () => {
  it('Review Focus 1: an adopted holder from a role row is linked, not doubled', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [chair] = await holders(deps, ctx, ['chair'], '2026-07-20');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3, heldOn: '2026-07-20' });
    const election = await elect(deps, ctx, items[0]!.id, officeOf(deps, 'chair'), chair!);
    await sealable(deps, ctx, meeting.id);
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    const term = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'chair') }))[0]!;
    expect(preview.blockers).toEqual([]);
    expect(kinds(preview)).toEqual(['numberResolution', 'linkTerm']);
    expect(preview.consequences[0]).toMatchObject({ resolutionId: election.id, params: { number: 'B-2026-001' } });
    expect(preview.consequences[1]).toMatchObject({ resolutionId: election.id, params: { termId: term.id, contactId: chair, acceptedOn: '2026-07-20' } });
  });

  it('Review Focus 2: re-election of the same person ends and restarts without register occasion; another person is a board change', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [chair] = await holders(deps, ctx, ['chair'], '2024-09-05');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    await elect(deps, ctx, items[0]!.id, officeOf(deps, 'chair'), chair!);
    await sealable(deps, ctx, meeting.id);
    const same = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(kinds(same)).toEqual(['numberResolution', 'endPredecessor', 'startTerm']);
    expect(same.consequences[1]!.params).toMatchObject({ contactId: chair, until: '2026-09-04' });

    const other = setupGovernance(RECORDING);
    const [old] = await holders(other.deps, other.ctx, ['chair'], '2024-09-05');
    const s = await session(other.deps, other.ctx, { items: ['election'], voters: 3 });
    const successor = await person(other.deps, 'Nachfolgerin');
    await elect(other.deps, other.ctx, s.items[0]!.id, officeOf(other.deps, 'chair'), successor);
    await sealable(other.deps, other.ctx, s.meeting.id);
    const changed = unwrap(await previewSeal(other.deps, other.ctx, { meetingId: s.meeting.id }));
    expect(kinds(changed)).toEqual(['numberResolution', 'endPredecessor', 'startTerm', 'registerOccasion']);
    expect(changed.consequences[1]!.params).toMatchObject({ contactId: old, until: '2026-09-04' });
    expect(changed.consequences[3]!.params).toMatchObject({ kind: 'boardChange', occurredOn: '2026-09-05' });
  });

  it('G-2: a re-elected auditor without acceptance keeps her seat, the other holder makes room; the minutes name her as elected', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [kept, other] = await holders(deps, ctx, ['auditor', 'auditor'], '2024-09-05');
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 4 });
    const newcomer = await person(deps, 'Neu');
    const officeId = officeOf(deps, 'auditor');
    const third = await person(deps, 'Dritte');
    const round = (number: number, candidates: [string, number][]) => ({ number, runoff: number > 1, candidates: candidates.map(([contactId, votes]) => ({ contactId, votes })), no: 0, abstain: 0, invalid: 0, unanimousContactId: null });
    unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '19:30', round: round(1, [[kept!, 4], [newcomer, 2], [third, 2]]) }));
    const r = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: items[0]!.id, officeId, votedAt: '19:40', round: round(2, [[newcomer, 3], [third, 1]]) }));
    expect(r.winners).toEqual([kept, newcomer]);
    unwrap(await acceptElection(deps, ctx, { resolutionId: r.id, contactId: newcomer }));
    await sealable(deps, ctx, meeting.id);
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    const ended = preview.consequences.filter((c) => c.kind === 'endPredecessor').map((c) => c.params.contactId);
    expect(ended).toEqual([other]);
    expect(preview.blockers).toEqual([]);
    const sentences = composeMinutesInternal(deps.db, deps, meeting.id).items[0]!.paragraphs;
    const office = deps.db.select().from(governanceOffices).all().find((o) => o.id === officeId)!;
    expect(sentences).toContain(MINUTES_WORDS.notYetAccepted(contactNameInternal(deps.db, kept!)!, office.name));
  });

  it('an auditor election starts a term with role auditor; refuses without manage', async () => {
    const { deps, ctx, userId } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    const auditor = await person(deps, 'Prüferin');
    await elect(deps, ctx, items[0]!.id, officeOf(deps, 'auditor'), auditor);
    await sealable(deps, ctx, meeting.id);
    const preview = unwrap(await previewSeal(deps, ctxWith(['governance.read'], userId), { meetingId: meeting.id }));
    expect(preview.consequences.find((c) => c.kind === 'startTerm')!.params).toMatchObject({ contactId: auditor, since: '2026-09-05', roles: 'auditor' });
    expect(kinds(preview)).not.toContain('registerOccasion');
    expect(await previewSeal(deps, ctxWith([], userId), { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('previewSeal — other kinds', () => {
  it('statute and purpose resolve the stand with an occasion; dissolution only an occasion; a mandate becomes a follow-up of the linked user; discharge is a finance reference', async () => {
    const { deps, ctx } = setupGovernance([...RECORDING, 'users.manage']);
    const [chair] = await holders(deps, ctx, ['chair']);
    const chairUser = insertUser(deps, { name: 'Vorsitz', email: 'vorsitz@kompass.local' });
    unwrap(await linkUserToContact(deps, ctx, { userId: chairUser, contactId: chair! }));
    const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    const purpose = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    const { meeting, items } = await session(deps, ctx, { items: ['statute', 'purpose', 'dissolution', 'mandate', 'discharge'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { details: { statuteId: statute }, votedAt: '19:10' });
    await adopt(deps, ctx, items[1]!.id, { details: { statuteId: purpose }, votedAt: '19:15' });
    await adopt(deps, ctx, items[2]!.id, { details: { liquidatorContactIds: [] }, votedAt: '19:20' });
    await adopt(deps, ctx, items[3]!.id, { details: { organId: null, officeId: officeOf(deps, 'chair'), dueOn: '2026-12-01', task: 'Angebote einholen' }, votedAt: '19:25' });
    await adopt(deps, ctx, items[4]!.id, { details: { fiscalYearId: 'fy-2025', mode: 'collective', contactIds: [] }, votedAt: '19:30' });
    await sealable(deps, ctx, meeting.id);
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(kinds(preview)).toEqual(['numberResolution', 'numberResolution', 'numberResolution', 'numberResolution', 'numberResolution', 'statuteResolved', 'registerOccasion', 'statuteResolved', 'registerOccasion', 'registerOccasion', 'followUp', 'financeReference']);
    const c = preview.consequences;
    expect(c[5]!.params).toMatchObject({ statuteId: statute, on: '2026-09-05' });
    expect(c[6]!.params).toMatchObject({ kind: 'statute', statuteId: statute });
    expect(c[7]!.params).toMatchObject({ statuteId: purpose, hint: 'purposeFundsBound' });
    expect(c[9]!.params).toMatchObject({ kind: 'dissolution' });
    expect(c[10]!.params).toMatchObject({ dueAt: '2026-12-01', assigneeUserId: chairUser, title: expect.stringContaining('B-2026-004') });
    expect(c[11]!.params).toMatchObject({ kind: 'discharge' });
  });

  it('finance references say what finance does: remuneration is written, a reserve is read, the expense rule stays in Gremien', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['remuneration', 'reserve', 'expenseRule'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { details: { statuteReference: '§ 9', decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeOf(deps, 'chair')], mode: 'flat', amountCents: 84000, validFrom: '2026-10-01' }, votedAt: '19:10' });
    await adopt(deps, ctx, items[1]!.id, { details: { type: 'nr3', purpose: null, amountCents: 500000, fiscalYearId: 'fy-2026', action: 'create' }, votedAt: '19:15' });
    await adopt(deps, ctx, items[2]!.id, { details: { basis: 'boardResolution', rule: 'nach Beleg', validFrom: '2026-10-01' }, votedAt: '19:20' });
    await sealable(deps, ctx, meeting.id);
    const c = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).consequences.filter((x) => x.kind !== 'numberResolution');
    expect(c.map((x) => [x.kind, x.params.kind, x.params.effect ?? null])).toEqual([
      ['financeReference', 'remuneration', 'write'],
      ['financeReference', 'reserve', 'read'],
      ['none', 'expenseRule', null],
    ]);
  });

  it('a mandate without details or deadline creates no follow-up: the preview says so and sealing adds none', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['mandate'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { votedAt: '19:25' });
    await sealable(deps, ctx, meeting.id);
    const { consequences } = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(consequences.filter((c) => c.kind === 'followUp')).toEqual([]);
    expect(consequences.find((c) => c.kind === 'none')!.params).toMatchObject({ kind: 'mandate', hint: 'noDeadline' });
    unwrap(await sealMeeting(deps, ctx, { meetingId: meeting.id }));
    expect(followUpsOf(deps)).toEqual([]);
  });

  it('a mandate follow-up is titled in the leading language with the number only — no free text, never a name', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'i18n.locales', value: ['en', 'de'] }));
    await holders(deps, ctx, ['chair']);
    const { meeting, items } = await session(deps, ctx, { items: ['mandate'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { details: { organId: null, officeId: officeOf(deps, 'chair'), dueOn: '2026-12-01', task: 'Angebote einholen' }, votedAt: '19:25' });
    await sealable(deps, ctx, meeting.id);
    const followUp = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).consequences.find((c) => c.kind === 'followUp')!;
    const number = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).consequences.find((c) => c.kind === 'numberResolution')!.params.number as string;
    // W-12 Nachzug: Der Titel steht im Änderungsprotokoll — nur Nummer und feste Bezeichnung, kein Freitext der Aufgabe
    // (Prinzip 7, Personen nur als ID); die Aufgabe bleibt am verlinkten Beschluss lesbar.
    expect(followUp.params.title).toBe(followUpTitle('en', 'mandate', { number }));
    expect(followUp.params.title).not.toBe(followUpTitle('de', 'mandate', { number }));
    expect(followUp.params.title).toContain(number);
    expect(followUp.params.title).not.toContain('Angebote');
    // W-12: Ohne Benutzerkonto beim Amt bleibt die Wiedervorlage ohne Zuständige — die Vorschau sagt es.
    expect(followUp.params).toMatchObject({ assigneeUserId: null, hint: 'noAssignee' });
  });

  it('blocks on a resolution without finding and on missing signed minutes; a rejected one only gets a number', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['simple', 'simple'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { outcome: null });
    await adopt(deps, ctx, items[1]!.id, { outcome: 'rejected', votedAt: '19:30' });
    unwrap(await endMeeting(deps, ctx, { meetingId: meeting.id, endedAt: '21:00' }));
    const preview = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id }));
    expect(preview.blockers).toEqual(['minutesMissing', 'outcomeMissing']);
    expect(kinds(preview)).toEqual(['numberResolution']);
    expect(organOf(deps, 'assembly')).toBeTruthy();
  });
});

describe('previewSeal — substitute (G-19)', () => {
  it('electing the substitute ends the substitute term and starts a regular one', async () => {
    const { startTerm } = await import('../src/terms');
    const { deps, ctx } = setupGovernance(RECORDING);
    const officeId = officeOf(deps, 'treasurer');
    const substitute = await person(deps, 'Ersatz');
    unwrap(await startTerm(deps, ctx, { officeId, contactId: substitute, since: '2026-06-01', origin: 'substitute' }));
    const { meeting, items } = await session(deps, ctx, { items: ['election'], voters: 3 });
    await elect(deps, ctx, items[0]!.id, officeId, substitute);
    await sealable(deps, ctx, meeting.id);
    expect(kinds(unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })))).toEqual(['numberResolution', 'endPredecessor', 'startTerm']);
  });
});

describe('previewSeal — statute tax review (G-31)', () => {
  it('statuteResolved carries the answer of the stand: false as 0, true as 1, open as null', async () => {
    const { updateStatute } = await import('../src/statutes');
    const { deps, ctx } = setupGovernance(RECORDING);
    const statute = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: statute, taxReview: { affectsCharity: false, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    const { meeting, items } = await session(deps, ctx, { items: ['statute'], voters: 3 });
    await adopt(deps, ctx, items[0]!.id, { details: { statuteId: statute } });
    await sealable(deps, ctx, meeting.id);
    const resolved = unwrap(await previewSeal(deps, ctx, { meetingId: meeting.id })).consequences.find((c) => c.kind === 'statuteResolved')!;
    expect(resolved.params.affectsCharity).toBe(false);
  });
});
