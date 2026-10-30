import { unwrap, writeSettingInternal } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { governanceDeadlinesInternal } from '../src/deadlines/list';
import { createMeeting } from '../src/meetings';
import { saveDissolutionNotices } from '../src/register/dissolution';
import { createRegisterFiling, updateRegisterFiling } from '../src/register/filings';
import { recordInterimOrder } from '../src/register/interim-orders';
import { saveTransparencyCheck } from '../src/register/transparency';
import { createStatuteDraft, getStatute, registerStatute, updateStatute } from '../src/statutes';
import { organOf, RECORDING, setupGovernance, withRules } from './helpers';
import { chairResigns, statuteMeeting } from './register-helpers';

const of = (deps: Parameters<typeof governanceDeadlinesInternal>[0], today: string, kind: string) => governanceDeadlinesInternal(deps, today).filter((d) => d.kind === kind);

describe('register deadlines', () => {
  it('an occasion is due after registerOverdueDays and overdue the day after, with the coercive fine hint; not after the notary', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2027-02-20T08:00:00.000Z' });
    const occasionId = await chairResigns(deps, ctx, '2027-01-10');
    expect(of(deps, '2027-02-07', 'registerDue')).toEqual([expect.objectContaining({ dueOn: '2027-02-07', overdue: false, params: expect.objectContaining({ occurredOn: '2027-01-10', occasion: 'boardChange', hint: 'none' }) })]);
    expect(of(deps, '2027-02-08', 'registerDue')).toEqual([expect.objectContaining({ dueOn: '2027-02-07', overdue: true, params: expect.objectContaining({ hint: 'coerciveFine' }) })]);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: occasionId }] }));
    expect(of(deps, '2027-02-08', 'registerDue')).toEqual([expect.objectContaining({ key: `registerDue:${filing.id}`, overdue: true })]);
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2027-02-09' }));
    expect(of(deps, '2027-02-10', 'registerDue')).toEqual([]);
  });

  it('an interim order with a deadline; filed in time, the transparency checks make no deadline', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-06-01') }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-10' }));
    unwrap(await recordInterimOrder(deps, ctx, { filingId: filing.id, on: '2026-08-17', deadline: '2026-09-14' }));
    expect(of(deps, '2026-09-15', 'interimOrder')).toEqual([expect.objectContaining({ dueOn: '2026-09-14', overdue: true, params: { on: '2026-08-17' } })]);
    expect(of(deps, '2026-09-05', 'transparencyReport')).toEqual([]);
  });

  it('filed in time, but a board member lives abroad: the report is due until the confirmation is kept (§ 20a Abs. 2 Nr. 3 GwG)', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-06-01') }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-10' }));
    unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { foreignBoardMember: true, earlierOwnReport: false, controlOtherwise: false }, checkedOn: '2026-06-12' }));
    expect(of(deps, '2026-06-20', 'transparencyReport')).toEqual([expect.objectContaining({ key: `transparencyReport:${filing.id}` })]);
  });

  it('dissolution: notice due within a month (month end), gone with both notices', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2027-02-15T08:00:00.000Z' });
    const meeting = await statuteMeeting(deps, ctx, '2027-01-31', { kind: 'dissolution' });
    expect(of(deps, '2027-02-15', 'dissolutionNotice')).toEqual([expect.objectContaining({ dueOn: '2027-02-28', overdue: false, params: { decidedOn: '2027-01-31' } })]);
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: meeting.occasionId }] }));
    expect(of(deps, '2027-03-01', 'dissolutionNotice')).toEqual([expect.objectContaining({ dueOn: '2027-02-28', overdue: true })]);
    unwrap(await saveDissolutionNotices(deps, ctx, { filingId: filing.id, taxOfficeNotifiedOn: '2027-02-10' }));
    expect(of(deps, '2027-03-01', 'dissolutionNotice')).toHaveLength(1);
    unwrap(await saveDissolutionNotices(deps, ctx, { filingId: filing.id, municipalityNotifiedOn: '2027-02-11' }));
    expect(of(deps, '2027-03-01', 'dissolutionNotice')).toEqual([]);
  });

  it('tax office: pre-submission before the invitation is never overdue; after registration ask for a new notice', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { noticeDays: 14 } });
    const draft = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id: draft, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'extraordinary', heldOn: '2026-10-20', startsAt: '19:00', form: 'inPerson' }));
    unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'statute', title: 'Satzung', statuteId: draft }));
    const pre = of(deps, '2026-10-19', 'taxPreSubmission');
    expect(pre).toEqual([expect.objectContaining({ overdue: false, params: { heldOn: '2026-10-20' } })]);
    expect(pre[0]!.dueOn! < '2026-10-19').toBe(true);

    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    unwrap(await updateStatute(deps, ctx, { id: change.statuteId, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    expect(of(deps, '2026-09-05', 'taxNoticeRequest')).toEqual([]);
    unwrap(await registerStatute(deps, ctx, { id: change.statuteId, registeredOn: '2026-07-01' }));
    expect(of(deps, '2026-09-05', 'taxNoticeRequest')).toEqual([expect.objectContaining({ dueOn: '2026-07-29', overdue: true })]);
    unwrap(await updateStatute(deps, ctx, { id: change.statuteId, taxReview: { affectsCharity: true, submittedOn: '2026-07-02', submissionDocumentId: null, answer: 'newNotice', answerDocumentId: null } }));
    expect(of(deps, '2026-09-05', 'taxNoticeRequest')).toEqual([]);
  });

  it('the new notice is due taxNoticeRequestDays after registration (default 28): open before, overdue after', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    unwrap(await updateStatute(deps, ctx, { id: change.statuteId, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    unwrap(await registerStatute(deps, ctx, { id: change.statuteId, registeredOn: '2026-07-01' }));
    expect(of(deps, '2026-07-02', 'taxNoticeRequest')).toEqual([expect.objectContaining({ dueOn: '2026-07-29', overdue: false, params: { registeredOn: '2026-07-01' } })]);
    expect(of(deps, '2026-07-28', 'taxNoticeRequest')).toEqual([expect.objectContaining({ overdue: false })]);
    expect(of(deps, '2026-07-29', 'taxNoticeRequest')).toEqual([expect.objectContaining({ overdue: false })]);
    expect(of(deps, '2026-07-30', 'taxNoticeRequest')).toEqual([expect.objectContaining({ overdue: true })]);
    unwrap(deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'governance.taxNoticeRequestDays', 10)));
    expect(of(deps, '2026-07-11', 'taxNoticeRequest')).toEqual([expect.objectContaining({ dueOn: '2026-07-11', overdue: false })]);
    expect(of(deps, '2026-07-12', 'taxNoticeRequest')).toEqual([expect.objectContaining({ overdue: true })]);
  });

  // Joe 2026-10-29 (0.5.0 Nr. 6): Die Warnung am Satzungsstand folgt der Frist — nicht ab dem Tag nach der Eintragung,
  // sondern erst, wenn die Frist überschritten ist. Eingetragen am 01.07.: Tag 27 (28.07.) und Tag 28 (29.07.) ruhig, Tag 29 (30.07.) warnt.
  it.each([
    ['2026-07-28', false],
    ['2026-07-29', false],
    ['2026-07-30', true],
  ])('the statute warns newNoticeMissing only once the request is overdue (today %s → %s)', async (today, warns) => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: `${today}T08:00:00.000Z` });
    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    unwrap(await updateStatute(deps, ctx, { id: change.statuteId, taxReview: { affectsCharity: true, submittedOn: null, submissionDocumentId: null, answer: null, answerDocumentId: null } }));
    unwrap(await registerStatute(deps, ctx, { id: change.statuteId, registeredOn: '2026-07-01' }));
    expect(unwrap(await getStatute(deps, ctx, { id: change.statuteId })).warnings.includes('newNoticeMissing')).toBe(warns);
    expect(of(deps, today, 'taxNoticeRequest')).toEqual([expect.objectContaining({ dueOn: '2026-07-29', overdue: warns })]);
  });
});

describe('K-9: computed register occasions have their own deadline key', () => {
  it('two resolved, unregistered stands: one key each, named after the stand', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: '2026-10-29T08:00:00.000Z' });
    const stand = async (on: string, basedOnId?: string, registeredOn?: string) => {
      const id = unwrap(await createStatuteDraft(deps, ctx, basedOnId ? { basedOnId } : {})).id;
      unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on, resolutionId: null }] }));
      if (registeredOn) unwrap(await registerStatute(deps, ctx, { id, registeredOn }));
      return id;
    };
    const founding = await stand('2025-02-01', undefined, '2025-03-01');
    const a = await stand('2026-06-15', founding);
    const b = await stand('2026-09-01', founding);
    const keys = of(deps, '2026-10-29', 'registerDue').map((d) => d.key).sort();
    expect(keys).toEqual([`registerDue:statute:${a}`, `registerDue:statute:${b}`].sort());
  });
});
