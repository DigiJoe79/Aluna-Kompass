import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { governanceDeadlinesInternal } from '../src/deadlines/list';
import { createRegisterFiling, getRegisterFiling, updateRegisterFiling } from '../src/register/filings';
import { saveTransparencyCheck, TRANSPARENCY_QUESTIONS } from '../src/register/transparency';
import { governanceRegisterFilings } from '../src/schema';
import { auditOf, receivedDocument, RECORDING, setupGovernance } from './helpers';
import { chairResigns, statuteMeeting } from './register-helpers';

const no = { foreignBoardMember: false, earlierOwnReport: false };
const reports = (deps: Parameters<typeof governanceDeadlinesInternal>[0], today: string) => governanceDeadlinesInternal(deps, today).filter((d) => d.kind === 'transparencyReport');

describe('transparency register check', () => {
  it('the four questions are data of the module, each with its norm', () => {
    expect(TRANSPARENCY_QUESTIONS.map((q) => [q.key, q.norm])).toEqual([['notFiledPromptly', '§ 20a Abs. 2 GwG'], ['foreignBoardMember', '§ 20a Abs. 2 GwG'], ['earlierOwnReport', '§ 20a Abs. 2 GwG'], ['controlOtherwise', '§ 3 Abs. 2 GwG']]);
  });

  it('questions 2–4 are answered by hand: all no with question 1 computed → no report; „control otherwise“ yes → report needed; one open → open', async () => {
    const { deps, ctx, userId } = setupGovernance(undefined, { now: '2026-09-05T08:00:00.000Z' });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-08-20') }] }));
    unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-08-25' }));
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).transparency).toMatchObject({ result: 'open', checkedOn: null, answers: { notFiledPromptly: false } });

    const none = unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { ...no, controlOtherwise: false }, checkedOn: '2026-09-01' }));
    expect(none.transparency).toMatchObject({ result: 'noReportNeeded', checkedOn: '2026-09-01' });
    expect(auditOf(deps, 'governance.register.transparency').at(-1)!.params).toEqual({ result: 'noReportNeeded', checkedOn: '2026-09-01' });

    const confirmation = await receivedDocument(deps, 'Bestätigung');
    const report = unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { ...no, controlOtherwise: true }, checkedOn: '2026-09-02', confirmationDocumentId: confirmation }));
    expect(report.transparency).toMatchObject({ result: 'reportNeeded', confirmationDocumentId: confirmation });

    expect(unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: no, checkedOn: '2026-09-03' })).transparency.result).toBe('open');
    expect(await saveTransparencyCheck(deps, ctxWith(['governance.read'], userId), { filingId: filing.id, answers: no, checkedOn: '2026-09-03' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { unknown: true }, checkedOn: '2026-09-03' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('question 1 is never answered by hand: the tool refuses it, a stored answer is ignored', async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-06-05T08:00:00.000Z' });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-06-01') }] }));
    expect(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { notFiledPromptly: false }, checkedOn: '2026-06-05' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    deps.db.update(governanceRegisterFilings).set({ transparency: { answers: { notFiledPromptly: true }, checkedOn: '2026-06-05', confirmationDocumentId: null, extractDocumentIds: [] } }).where(eq(governanceRegisterFilings.id, filing.id)).run();
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).transparency.answers.notFiledPromptly).toBeUndefined();
  });

  it('a statute change alone is not applicable', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const change = await statuteMeeting(deps, ctx, '2026-06-10');
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: change.occasionId }] }));
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).transparency.result).toBe('notApplicable');
    expect(reports(deps, '2026-12-01')).toEqual([]);
  });
});

/** Frage 1 berechnet (Joe 2026-10-28): Anlass am 01.06., Grenze `registerOverdueDays` (28) → überfällig ab dem 30.06. (Tag 29). */
describe('transparency question 1 and the report deadline (§ 20a Abs. 2 Nr. 1 GwG)', () => {
  const setup = async () => {
    const { deps, ctx } = setupGovernance(undefined, { now: '2026-06-05T08:00:00.000Z' });
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: await chairResigns(deps, ctx, '2026-06-01') }] }));
    return { deps, ctx, filing };
  };

  it('fresh filing: question 1 open, no report deadline', async () => {
    const { deps, ctx, filing } = await setup();
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).transparency.answers.notFiledPromptly).toBeUndefined();
    expect(reports(deps, '2026-06-05')).toEqual([]);
    expect(reports(deps, '2026-06-29')).toEqual([]);
  });

  // Joe 2026-10-29 (0.5.0 Nr. 6): Die Prüffragen zählen erst ab „eingereicht“ — davor keine Warnung, keine Frist. Den
  // verspäteten Wechsel trägt bis dahin die überfällige Registerfrist mit dem Hinweis auf § 20a Abs. 2 GwG.
  it('day 29 without submission: question 1 „not promptly“, but no report deadline before the filing is submitted', async () => {
    const { deps, ctx, filing } = await setup();
    expect(unwrap(await getRegisterFiling(deps, ctx, { id: filing.id })).transparency.due).toBe(false);
    expect(reports(deps, '2026-06-30')).toEqual([]);
    expect(governanceDeadlinesInternal(deps, '2026-06-30').filter((d) => d.kind === 'registerDue')).toEqual([expect.objectContaining({ overdue: true, params: expect.objectContaining({ hint: 'coerciveFine' }) })]);
  });

  it('a question answered „yes“ before submission makes no deadline and no warning until the filing is submitted', async () => {
    const { deps, ctx, filing } = await setup();
    const early = unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { foreignBoardMember: true }, checkedOn: '2026-06-05' }));
    expect(early.transparency).toMatchObject({ due: false, result: 'reportNeeded' });
    expect(early.warnings).toEqual([]);
    expect(reports(deps, '2026-06-20')).toEqual([]);
    const submitted = unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-06-09', submittedOn: '2026-06-10' }));
    expect(submitted.transparency.due).toBe(true);
    expect(reports(deps, '2026-06-20')).toEqual([expect.objectContaining({ key: `transparencyReport:${filing.id}` })]);
  });

  it('submitted on day 10: question 1 promptly, no deadline later either', async () => {
    const { deps, ctx, filing } = await setup();
    const view = unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-06-11' }));
    expect(view.transparency.answers.notFiledPromptly).toBe(false);
    expect(reports(deps, '2026-08-01')).toEqual([]);
  });

  it('submitted on day 40: question 1 „not promptly“, deadline until the confirmed report is kept', async () => {
    const { deps, ctx, filing } = await setup();
    const view = unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, submittedOn: '2026-07-11' }));
    expect(view.transparency).toMatchObject({ answers: { notFiledPromptly: true }, result: 'reportNeeded' });
    expect(reports(deps, '2026-07-12')).toHaveLength(1);
    unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: {}, checkedOn: '2026-07-20', confirmationDocumentId: await receivedDocument(deps, 'Bestätigung') }));
    expect(reports(deps, '2026-07-21')).toEqual([]);
  });

  it('questions 2–4 open: a warning when submitted, never a deadline', async () => {
    const { deps, ctx, filing } = await setup();
    const submitted = unwrap(await updateRegisterFiling(deps, ctx, { id: filing.id, notarizedOn: '2026-06-10', submittedOn: '2026-06-11' }));
    expect(submitted.warnings).toEqual(['transparencyChecksOpen']);
    expect(governanceDeadlinesInternal(deps, '2026-08-01').filter((d) => d.kind.startsWith('transparency'))).toEqual([]);
    const answered = unwrap(await saveTransparencyCheck(deps, ctx, { filingId: filing.id, answers: { ...no, controlOtherwise: false }, checkedOn: '2026-06-12' }));
    expect(answered.warnings).toEqual([]);
  });
});
