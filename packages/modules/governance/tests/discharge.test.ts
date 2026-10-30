import { unwrap } from '@kompass/core';
import { financeFiscalYears } from '@kompass/module-finance';
import { describe, expect, it } from 'vitest';
import { dischargeCandidates, saveDischarge } from '../src/discharge';
import { quorumInternal } from '../src/quorum';
import { auditOf, holders, member, RECORDING, session, setupGovernance, withRules, type GovernanceDeps } from './helpers';

const fiscalYear = (deps: GovernanceDeps) => {
  deps.db.insert(financeFiscalYears).values({ id: 'FY25', startsOn: '2025-01-01', endsOn: '2025-12-31', designation: '2025', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }).run();
  return 'FY25';
};

/** Vorstand im Geschäftsjahr, zugleich Mitglieder; dazu `others` weitere Mitglieder, alle anwesend. */
async function assembly(functions: ('chair' | 'board' | 'treasurer')[], others: number) {
  const { deps, ctx } = setupGovernance([...RECORDING]);
  const fiscalYearId = fiscalYear(deps);
  const board = await holders(deps, ctx, functions, '2025-01-01');
  for (const contactId of board) await member(deps, { contactId });
  const s = await session(deps, ctx, { items: ['discharge'], voters: others });
  return { deps, ctx, fiscalYearId, board, ...s };
}

describe('dischargeCandidates', () => {
  it('lists the board of the fiscal year from finance', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const fiscalYearId = fiscalYear(deps);
    const board = await holders(deps, ctx, ['chair', 'treasurer'], '2025-01-01');
    expect(unwrap(await dischargeCandidates(deps, ctx, { fiscalYearId })).map((p) => p.contactId).sort()).toEqual([...board].sort());
    expect(await dischargeCandidates(deps, ctx, { fiscalYearId: 'nope' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });
});

describe('saveDischarge', () => {
  it('Abnahme 4: individually — one resolution per person, she does not vote on her own', async () => {
    const { deps, ctx, fiscalYearId, board, items } = await assembly(['chair', 'treasurer'], 5);
    const saved = unwrap(await saveDischarge(deps, ctx, { agendaItemId: items[0]!.id, fiscalYearId, mode: 'individual', votedAt: '19:30', unanimous: true }));
    expect(saved).toHaveLength(2);
    for (const [i, contactId] of board.entries()) {
      const r = saved.find((s) => (s.details as { contactIds: string[] }).contactIds[0] === contactId)!;
      expect(r, String(i)).toMatchObject({ kind: 'discharge', excluded: [{ contactId, reason: 'discharge' }], votes: { yes: 6 } });
      expect(r.evaluation).toMatchObject({ presentVoting: 7, excluded: 1 });
    }
    expect(auditOf(deps, 'governance.resolution.save')).toHaveLength(2);
    // Ein zweiter Aufruf ändert dieselben Beschlüsse.
    expect(unwrap(await saveDischarge(deps, ctx, { agendaItemId: items[0]!.id, fiscalYearId, mode: 'individual', votedAt: '19:30', votes: { yes: 5, no: 1, abstain: 0, invalid: 0 } })).map((r) => r.id).sort()).toEqual(saved.map((r) => r.id).sort());
  });

  it('Review Focus 2: collectively all three board members are excluded — four voters, quorum still seven', async () => {
    const { deps, ctx, fiscalYearId, board, items, meeting } = await assembly(['chair', 'board', 'treasurer'], 4);
    await withRules(deps, ctx, { assembly: { majorities: { discharge: { fraction: 'simple', base: 'present', abstentions: 'ignored' } } } }, '2025-06-01');
    const [r] = unwrap(await saveDischarge(deps, ctx, { agendaItemId: items[0]!.id, fiscalYearId, mode: 'collective', votedAt: '19:30', votes: { yes: 3, no: 1, abstain: 0, invalid: 0 } }));
    expect(r!.excluded.map((e) => e.contactId).sort()).toEqual([...board].sort());
    expect(r!.evaluation).toMatchObject({ presentVoting: 7, excluded: 3, result: { denominator: 4, reached: true } });
    expect(quorumInternal(deps.db, deps, meeting.id, '19:30').present).toBe(7);
    expect(await saveDischarge(deps, ctx, { agendaItemId: items[0]!.id, fiscalYearId, mode: 'collective', votedAt: '19:30', votes: { yes: 4, no: 1, abstain: 0, invalid: 0 } })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});

describe('minutes of a discharge (G-7)', () => {
  it('names the person and the fiscal year of each individual discharge', async () => {
    const { composeMinutesInternal, contactNameInternal } = await import('../src/minutes/compose');
    const { deps, ctx, fiscalYearId, board, items, meeting } = await assembly(['chair', 'treasurer'], 3);
    for (const r of unwrap(await saveDischarge(deps, ctx, { agendaItemId: items[0]!.id, fiscalYearId, mode: 'individual', votedAt: '19:30', unanimous: true }))) {
      const { decideResolution } = await import('../src/resolutions');
      unwrap(await decideResolution(deps, ctx, { id: r.id, outcome: 'adopted' }));
    }
    const paragraphs = composeMinutesInternal(deps.db, deps, meeting.id).items[0]!.paragraphs;
    for (const contactId of board) expect(paragraphs.filter((p) => p.includes(contactNameInternal(deps.db, contactId)!) && p.includes('2025'))).toHaveLength(1);
  });
});
