import { unwrap } from '@kompass/core';
import { ctxWith, insertUser } from '@kompass/core/testing';
import { sealPreviewInternal } from '../src/seal/preview';
import { describe, expect, it } from 'vitest';
import { decideResolution, getResolution, listResolutions, saveResolution } from '../src/resolutions';
import { governanceAgendaItems, governanceResolutions } from '../src/schema';
import { listTerms } from '../src/terms';
import { auditOf, holders, officeOf, RECORDING, session, setupGovernance, withRules } from './helpers';

describe('saveResolution', () => {
  it('unanimous with six voters, one of them excluded, gives five yes; kind defaults to the item', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items, contactIds } = await session(deps, ctx, { items: ['simple'], voters: 6 });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Der Verein kauft einen Anhänger.', votedAt: '19:30', unanimous: true, excluded: [{ contactId: contactIds[0]!, reason: 'legalTransaction' }] }));
    expect(saved).toMatchObject({ kind: 'simple', votes: { yes: 5, no: 0, abstain: 0, invalid: 0 }, unanimous: true, yesComputed: false, decidedOn: '2026-09-05', number: null, outcome: null });
    expect(saved.evaluation).toMatchObject({ presentVoting: 6, result: { reached: true }, required: { source: 'law' } });
    expect(auditOf(deps, 'governance.resolution.save')[0]!.params).toEqual({ kind: 'simple', agendaItemId: items[0]!.id });
    expect(JSON.stringify(auditOf(deps, 'governance.resolution.save'))).not.toContain('Anhänger');
  });

  it('G-3: a dismissal without the term it ends warns detailsMissing; with the term it does not', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [treasurer] = await holders(deps, ctx, ['treasurer']);
    const { items } = await session(deps, ctx, { items: ['dismissal'], voters: 3 });
    const bare = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Abberufung der Kasse.', votedAt: '19:30', unanimous: true }));
    expect(bare.warnings).toContain('detailsMissing');
    const termId = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'treasurer') })).find((t) => t.contactId === treasurer)!.id;
    const linked = unwrap(await saveResolution(deps, ctx, { id: bare.id, agendaItemId: items[0]!.id, text: 'Abberufung der Kasse.', votedAt: '19:30', unanimous: true, details: { termId } }));
    expect(linked.warnings).not.toContain('detailsMissing');
  });

  it('V-5: approving the accounts or a discharge without the fiscal year warns detailsMissing', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['accounts', 'discharge'], voters: 3 });
    for (const item of items) {
      const bare = unwrap(await saveResolution(deps, ctx, { agendaItemId: item.id, text: 'Die Versammlung nimmt den Kassenbericht an.', votedAt: '19:30', unanimous: true }));
      expect(bare.warnings).toContain('detailsMissing');
    }
  });

  it('computes yes by subtraction and keeps that it was computed', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['simple'], voters: 7 });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', yesComputed: true, votes: { no: 1, abstain: 2, invalid: 0 } }));
    expect(saved).toMatchObject({ votes: { yes: 4, no: 1, abstain: 2, invalid: 0 }, yesComputed: true });
    expect(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', votes: { no: 1, abstain: 0, invalid: 0 } })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('refuses more votes than voters', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['simple'], voters: 3 });
    expect(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', votes: { yes: 3, no: 1, abstain: 0, invalid: 0 } })).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ message: 'votesExceedVoters' }] } });
  });

  it('Abnahme 3: statute change with 3/4 of those present just missed', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { majorities: { statute: { fraction: { num: 3, den: 4 }, base: 'present', abstentions: 'ignored' } } } });
    const { items } = await session(deps, ctx, { items: ['statute'], voters: 7 });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Neufassung § 5', votedAt: '19:30', votes: { yes: 5, no: 1, abstain: 1, invalid: 0 } }));
    expect(saved.evaluation).toMatchObject({ required: { source: 'statute' }, result: { denominator: 7, needed: 6, reached: false } });
  });

  it('warns about a statute change on an item added in the meeting', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['statute', 'simple'], voters: 2 });
    deps.db.update(governanceAgendaItems).set({ addedDuring: 'meeting' }).run();
    const statute = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true }));
    expect(statute.warnings).toContain('notAnnounced');
  });

  it('needs governance.record, the writer and valid input', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['simple'], voters: 1 });
    const input = { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true };
    expect(await saveResolution(deps, ctxWith(['governance.read', 'governance.manage'], ctx.userId!), input)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await saveResolution(deps, ctxWith(RECORDING, insertUser(deps, { name: 'B', email: 'b@kompass.local' })), input)).toMatchObject({ ok: false, error: { code: 'notWriter' } });
    expect(await saveResolution(deps, ctx, { ...input, votedAt: 'halb acht' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('decideResolution', () => {
  it('Review Focus 4: against the count without a reason is kept with reasonMissing (blocks sealing), with a reason only warned', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { meeting, items } = await session(deps, ctx, { items: ['simple'], voters: 5 });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', votes: { yes: 2, no: 3, abstain: 0, invalid: 0 } }));
    expect(unwrap(await decideResolution(deps, ctx, { id: saved.id, outcome: 'adopted' }))).toMatchObject({ outcome: 'adopted', warnings: ['outcomeAgainstCount', 'reasonMissing'] });
    // Eine neue Zählung lässt die Feststellung stehen; die Begründung fehlt weiter.
    expect(unwrap(await saveResolution(deps, ctx, { id: saved.id, agendaItemId: items[0]!.id, text: 'x', votedAt: '19:31', votes: { yes: 1, no: 4, abstain: 0, invalid: 0 } }))).toMatchObject({ outcome: 'adopted', warnings: ['outcomeAgainstCount', 'reasonMissing'] });
    expect(sealPreviewInternal(deps.db, deps, { meetingId: meeting.id })!.blockers).toContain('reasonMissing');
    const decided = unwrap(await decideResolution(deps, ctx, { id: saved.id, outcome: 'adopted', outcomeReason: 'Zwei Stimmen falsch gezählt.' }));
    expect(decided).toMatchObject({ outcome: 'adopted', warnings: ['outcomeAgainstCount'] });
    expect(auditOf(deps, 'governance.resolution.decide')[0]!.params).toEqual({ kind: 'simple', outcome: 'adopted', againstCount: true });
    expect(JSON.stringify(auditOf(deps, 'governance.resolution.decide'))).not.toContain('falsch');
    expect(unwrap(await decideResolution(deps, ctx, { id: saved.id, outcome: 'rejected' })).warnings).toEqual([]);
  });

  it('Review Focus 4: a tie the chair decides is free either way', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { tie: 'chairDecides' } });
    const { items } = await session(deps, ctx, { kind: 'board', items: ['simple'], boardFunctions: ['chair', 'board'] });
    const saved = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', votes: { yes: 1, no: 1, abstain: 0, invalid: 0 } }));
    expect(saved.evaluation!.result).toMatchObject({ tie: true, reached: null });
    expect(unwrap(await decideResolution(deps, ctx, { id: saved.id, outcome: 'adopted' })).warnings).toEqual([]);
  });
});

describe('getResolution and listResolutions', () => {
  it('lists the tax relevant ones: a reserve, not a discharge', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items, organId } = await session(deps, ctx, { items: ['reserve', 'discharge'], voters: 2 });
    const reserve = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, details: { type: 'nr1', purpose: 'Neues Tierheim', amountCents: 500000, fiscalYearId: 'fy', action: 'create' } }));
    unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'x', votedAt: '19:40', unanimous: true, excluded: [], details: { fiscalYearId: 'fy', mode: 'collective', contactIds: [] } }));
    expect(unwrap(await listResolutions(deps, ctx, { taxRelevant: true })).map((r) => r.id)).toEqual([reserve.id]);
    expect(unwrap(await listResolutions(deps, ctx, { organId, year: 2026 }))).toHaveLength(2);
    expect(unwrap(await listResolutions(deps, ctx, { kinds: ['discharge'] }))).toHaveLength(1);
    expect(unwrap(await getResolution(deps, ctxWith(['governance.read'], ctx.userId!), { id: reserve.id }))).toMatchObject({ id: reserve.id, kind: 'reserve' });
    expect(await listResolutions(deps, ctxWith([], ctx.userId!), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(deps.db.select().from(governanceResolutions).all()).toHaveLength(2);
  });
});

describe('audit of resolution details (G-27)', () => {
  it('a changed term of a dismissal shows in before and after', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const [treasurer] = await holders(deps, ctx, ['treasurer']);
    const { items } = await session(deps, ctx, { items: ['dismissal'], voters: 3 });
    const r = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'Abberufung.', votedAt: '19:30', unanimous: true }));
    const termId = unwrap(await listTerms(deps, ctx, { officeId: officeOf(deps, 'treasurer') })).find((t) => t.contactId === treasurer)!.id;
    unwrap(await saveResolution(deps, ctx, { id: r.id, agendaItemId: items[0]!.id, text: 'Abberufung.', votedAt: '19:30', unanimous: true, details: { termId } }));
    const last = auditOf(deps, 'governance.resolution.save').at(-1)!;
    expect(JSON.parse(last.after!)).toMatchObject({ details: { termId } });
    expect(JSON.parse(last.before!)).toMatchObject({ details: null });
  });
});
