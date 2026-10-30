import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { financeFiscalYears, financePeriodEvents, financeReports, saveAssemblyResult } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { removeAgendaItem, reorderAgenda, saveAgendaItem } from '../src/agenda';
import { proposeAgenda } from '../src/agenda-proposal';
import { getMeeting } from '../src/meeting-detail';
import { createMeeting, deleteMeeting } from '../src/meetings';
import { governanceAgendaItems, governanceMeetings, governanceOffices, governanceOrgans } from '../src/schema';
import { startTerm } from '../src/terms';
import { auditOf, person, setupGovernance, type GovernanceDeps } from './helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;
const office = (deps: GovernanceDeps, fn: string) => deps.db.select().from(governanceOffices).all().find((o) => o.function === fn)!.id;
const head = { heldOn: '2026-11-20', startsAt: '19:00', form: 'inPerson' as const };
const mvMeeting = async (deps: GovernanceDeps, ctx: Ctx, kind: 'ordinary' | 'extraordinary' = 'ordinary') => unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'assembly'), kind, ...head }));

/** Beide Plätze der Prüfung und alle Vorstandsämter besetzt, seit 2026-01-01 — nichts fällig. */
async function fullOffices(deps: GovernanceDeps, ctx: Ctx, since = '2026-01-01') {
  for (const fn of ['chair', 'board', 'treasurer', 'auditor', 'auditor']) unwrap(await startTerm(deps, ctx, { officeId: office(deps, fn), contactId: await person(deps, `P${Math.random()}`), since, origin: 'backfilled' }));
}

function closedYear(deps: GovernanceDeps, opts: { cashReport: boolean }) {
  deps.db.insert(financeFiscalYears).values({ id: 'FY25', startsOn: '2025-01-01', endsOn: '2025-12-31', designation: '2025', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
  deps.db.insert(financePeriodEvents).values({ id: 'EV1', fiscalYearId: 'FY25', kind: 'closed', at: '2026-03-01T00:00:00.000Z', byUserId: 'u' }).run();
  if (opts.cashReport)
    deps.db.insert(financeReports).values({ id: 'R1', reportKey: 'cashReport', params: '{}', fiscalYearId: 'FY25', dataHash: 'h', documentId: 'DOC-CASH', documentNumber: 'BER-2026-001', releaseBasis: null, finalizedAt: '2026-03-02T00:00:00.000Z', finalizedByUserId: 'u', voidedAt: null, voidReason: null, replacedByReportId: null }).run();
}

describe('proposeAgenda', () => {
  it('proposes the ten points of an ordinary assembly, without elections when nothing is due', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    const meeting = await mvMeeting(deps, ctx);
    const items = unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
    expect(items.map((i) => i.kind)).toEqual(['other', 'agenda', 'minutesApproval', 'report', 'accounts', 'report', 'discharge', 'other', 'other']);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(items.every((i) => i.addedDuring === 'preparation')).toBe(true);
    expect(auditOf(deps, 'governance.agenda.propose')[0]!.params).toEqual({ count: 9 });
  });

  it('adds elections with the offices whose term ends', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx, '2025-01-01');
    const meeting = await mvMeeting(deps, ctx);
    const items = unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id }));
    expect(items).toHaveLength(10);
    const election = items.find((i) => i.kind === 'election')!;
    expect(election.position).toBe(8);
    expect(election.officeIds.sort()).toEqual([office(deps, 'chair'), office(deps, 'board'), office(deps, 'treasurer'), office(deps, 'auditor')].sort());
  });

  it('attaches the cash report of the last closed year and warns about the missing audit report', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    closedYear(deps, { cashReport: true });
    const items = unwrap(await proposeAgenda(deps, ctx, { meetingId: (await mvMeeting(deps, ctx)).id }));
    const accounts = items.find((i) => i.kind === 'accounts')!;
    expect(accounts).toMatchObject({ fiscalYearId: 'FY25', attachmentDocumentIds: ['DOC-CASH'], warnings: [] });
    expect(items.find((i) => i.kind === 'discharge')).toMatchObject({ fiscalYearId: 'FY25', warnings: ['auditReportMissing'] });
  });

  it('W-2: no accounts or discharge for a closed year that is already approved and fully discharged', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    closedYear(deps, { cashReport: true });
    const managerCtx = ctxWith(['finance.read', 'finance.periodClose'], ctx.userId!);
    unwrap(await saveAssemblyResult(deps, managerCtx, { fiscalYearId: 'FY25', assemblyOn: '2026-03-14', accountsApproved: 'yes', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    const items = unwrap(await proposeAgenda(deps, ctx, { meetingId: (await mvMeeting(deps, ctx)).id }));
    expect(items.map((i) => i.kind)).toEqual(['other', 'agenda', 'minutesApproval', 'report', 'other', 'other']);
  });

  it('warns about a missing cash report', async () => {
    const { deps, ctx } = setupGovernance();
    await fullOffices(deps, ctx);
    closedYear(deps, { cashReport: false });
    const items = unwrap(await proposeAgenda(deps, ctx, { meetingId: (await mvMeeting(deps, ctx)).id }));
    expect(items.find((i) => i.kind === 'accounts')!.warnings).toEqual(['cashReportMissing']);
  });

  it('proposes only on an empty agenda, and needs governance.manage', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx, 'extraordinary');
    expect(unwrap(await proposeAgenda(deps, ctx, { meetingId: meeting.id })).map((i) => i.kind)).toEqual(['other', 'agenda', 'other']);
    expect(await proposeAgenda(deps, ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'agendaNotEmpty' } });
    const reader = setupGovernance(['governance.read']);
    expect(await proposeAgenda(reader.deps, reader.ctx, { meetingId: meeting.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('agenda items', () => {
  it('saves, reorders and removes items, audited; the meeting shows its agenda', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...head }));
    const a = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'report', title: 'Bericht' }));
    const b = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Anschaffung', proposal: 'Der Vorstand beschließt …' }));
    expect([a.position, b.position]).toEqual([1, 2]);
    unwrap(await saveAgendaItem(deps, ctx, { id: a.id, meetingId: meeting.id, kind: 'report', title: 'Bericht des Vorsitzes' }));
    expect(await reorderAgenda(deps, ctx, { meetingId: meeting.id, itemIds: [b.id] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    unwrap(await reorderAgenda(deps, ctx, { meetingId: meeting.id, itemIds: [b.id, a.id] }));
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).agenda.map((i) => [i.title, i.position])).toEqual([['Anschaffung', 1], ['Bericht des Vorsitzes', 2]]);
    unwrap(await removeAgendaItem(deps, ctx, { id: b.id }));
    expect(unwrap(await getMeeting(deps, ctx, { id: meeting.id })).agenda.map((i) => i.position)).toEqual([1]);
    expect(auditOf(deps, 'governance.agenda.save').map((e) => e.params)).toEqual([{ kind: 'report', position: 1 }, { kind: 'simple', position: 2 }, { kind: 'report', position: 1 }]);
    expect(auditOf(deps, 'governance.agenda.reorder')[0]!.params).toEqual({ count: 2 });
    expect(auditOf(deps, 'governance.agenda.remove')[0]!.params).toEqual({ kind: 'simple' });
  });

  it('marks an item added after the invitation as supplement with a warning', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx, 'extraordinary');
    deps.db.update(governanceMeetings).set({ invitedOn: '2026-10-20' }).run();
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Nachtrag' }));
    expect(item).toMatchObject({ addedDuring: 'supplement', warnings: ['changedAfterInvitation'] });
  });

  it('refuses invalid input and a missing permission', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx);
    expect(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'nope', title: 'x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'x', officeIds: ['o'] })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await saveAgendaItem(reader.deps, reader.ctx, { meetingId: meeting.id, kind: 'simple', title: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('Review Focus 5 (part): a planned meeting with two items is deletable, its items go with it', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organ(deps, 'board'), kind: 'board', ...head }));
    for (const title of ['Eins', 'Zwei']) unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'discussion', title }));
    expect(await deleteMeeting(deps, ctx, { id: meeting.id })).toMatchObject({ ok: true });
    expect(deps.db.select().from(governanceAgendaItems).all()).toEqual([]);
  });
});

describe('changed paragraphs at a statute item (U2)', () => {
  it('stores and reads wordingChanges at statute and purpose; refuses them at other kinds', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx);
    const wordingChanges = [{ label: '§ 5 Abs. 2', before: 'Alt', after: 'Neu' }, { label: '§ 7', before: '', after: 'Neuer Absatz' }];
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzungsänderung', wordingChanges }));
    expect(item.wordingChanges).toEqual(wordingChanges);
    expect(deps.db.select().from(governanceAgendaItems).all().find((i) => i.id === item.id)!.wordingChanges).toEqual(wordingChanges);
    expect(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Anderes', wordingChanges })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'wordingChanges', message: 'wordingOnlyForStatute' }] } });
    expect(unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Ohne' })).wordingChanges).toEqual([]);
  });
});

describe('saveAgendaItem with a motion (G-21)', () => {
  it('the motion knows its item; moving the link clears the old motion', async () => {
    const { saveMotion } = await import('../src/motions');
    const { governanceMotions } = await import('../src/schema');
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx);
    const a = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-10-01', text: 'Antrag A' }));
    const b = unwrap(await saveMotion(deps, ctx, { meetingId: meeting.id, receivedOn: '2026-10-02', text: 'Antrag B' }));
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Antrag', motionId: a.id }));
    const motion = (id: string) => deps.db.select().from(governanceMotions).all().find((m) => m.id === id)!;
    expect(motion(a.id).agendaItemId).toBe(item.id);
    unwrap(await saveAgendaItem(deps, ctx, { id: item.id, meetingId: meeting.id, kind: 'simple', title: 'Antrag', motionId: b.id }));
    expect([motion(a.id).agendaItemId, motion(b.id).agendaItemId]).toEqual([null, item.id]);
  });
});

describe('audit of agenda items (G-27)', () => {
  it('keeps title, invitation text and proposal out of the change log', async () => {
    const { deps, ctx } = setupGovernance();
    const meeting = await mvMeeting(deps, ctx);
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'simple', title: 'Antrag Jonas Kranich', proposal: 'Kranich beantragt ein Zelt.', invitationText: 'Kranich' }));
    unwrap(await saveAgendaItem(deps, ctx, { id: item.id, meetingId: meeting.id, kind: 'simple', title: 'Antrag Jonas Kranich II' }));
    expect(JSON.stringify(auditOf(deps, 'governance.agenda.save'))).not.toContain('Kranich');
  });
});
