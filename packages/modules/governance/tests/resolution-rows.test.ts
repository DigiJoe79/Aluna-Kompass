import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { saveAgendaItem } from '../src/agenda';
import { backfillMeeting } from '../src/backfill';
import { acceptElection, saveElectionRound } from '../src/elections';
import { createCircular, decideCircular, saveCircularResponse } from '../src/circulars';
import { getCircularContext } from '../src/circular-context';
import { getResolutionContext, listResolutionRows } from '../src/resolution-rows';
import { listResolutions } from '../src/resolutions';
import { sealCircular } from '../src/seal/seal';
import { elect, holders, officeOf, organOf, person, RECORDING, setupGovernance } from './helpers';
import { statuteMeeting } from './register-helpers';

async function world() {
  const env = setupGovernance([...RECORDING, 'dms.view']);
  const { deps, ctx } = env;
  await statuteMeeting(deps, ctx, '2026-03-20');
  const [chair] = await holders(deps, ctx, ['chair', 'board', 'treasurer']);
  const board = organOf(deps, 'board');
  const circular = unwrap(await createCircular(deps, ctx, { organId: board, kind: 'simple', text: 'Anschaffung Testgerät\nZweite Zeile', requestedOn: '2026-08-01', deadline: '2026-08-10', channel: 'email' }));
  for (const r of circular.responses) unwrap(await saveCircularResponse(deps, ctx, { id: r.id, answer: 'yes', answeredOn: '2026-08-02' }));
  unwrap(await decideCircular(deps, ctx, { id: circular.id, outcome: 'adopted', decidedOn: '2026-08-03', decidedByContactId: chair! }));
  unwrap(await sealCircular(deps, ctx, { circularId: circular.id }));
  // Ein offener Umlauf ohne Feststellung erscheint nicht.
  unwrap(await createCircular(deps, ctx, { organId: board, kind: 'reserve', text: 'Offen', requestedOn: '2026-08-05', deadline: '2026-08-20', channel: 'email' }));
  return { ...env, circular, chair: chair! };
}

describe('listResolutionRows', () => {
  it('newest first, with source, subject and tax relevance; only decided ones; filters as listResolutions', async () => {
    const { deps, ctx, circular } = await world();
    const rows = unwrap(await listResolutionRows(deps, ctx, {}));
    expect(rows.map((r) => [r.number, r.decidedOn, r.kind, r.taxRelevant])).toEqual([
      ['B-2026-002', '2026-08-03', 'simple', false],
      ['B-2026-001', '2026-03-20', 'statute', true],
    ]);
    expect(rows[0]!).toMatchObject({ subject: 'Anschaffung Testgerät', organName: 'Vorstand', source: { kind: 'circular', circularId: circular.id }, outcome: 'adopted', againstCount: false, election: null });
    expect(rows[1]!.source).toMatchObject({ kind: 'meeting', itemPosition: 1 });
    for (const filter of [{ taxRelevant: true }, { taxRelevant: false }, { kinds: ['statute' as const] }]) {
      const ids = unwrap(await listResolutions(deps, ctx, filter)).filter((r) => r.outcome !== null).map((r) => r.id).sort();
      expect(unwrap(await listResolutionRows(deps, ctx, filter)).map((r) => r.id).sort()).toEqual(ids);
    }
  });

  it('lists an election, which has no outcome of its own, with its office and the elected person', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-07-20', startsAt: '18:00', endedAt: '20:00', form: 'inPerson', place: 'Vereinsheim', present: 7, voting: 7 }));
    const office = officeOf(deps, 'chair');
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'election', title: 'Wahl', officeIds: [office] }));
    await elect(deps, ctx, item.id, office, await person(deps, 'Falkner', 'Greta'));
    const rows = unwrap(await listResolutionRows(deps, ctx, {}));
    expect(rows).toEqual([expect.objectContaining({ kind: 'election', outcome: null, election: expect.objectContaining({ elected: ['Greta Falkner'] }) })]);
  });

  it('the context of an election carries each round with votes and needed votes, the elected and their acceptance', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const meeting = unwrap(await backfillMeeting(deps, ctx, { organId: organOf(deps, 'assembly'), kind: 'ordinary', heldOn: '2026-07-20', startsAt: '18:00', endedAt: '20:00', form: 'inPerson', place: 'Vereinsheim', present: 7, voting: 7 }));
    const office = officeOf(deps, 'chair');
    const item = unwrap(await saveAgendaItem(deps, ctx, { meetingId: meeting.id, kind: 'election', title: 'Wahl', officeIds: [office] }));
    const greta = await person(deps, 'Falkner', 'Greta');
    const round = unwrap(await saveElectionRound(deps, ctx, { agendaItemId: item.id, officeId: office, votedAt: '18:30', round: { number: 1, runoff: false, candidates: [{ contactId: greta, votes: 6 }], no: 1, abstain: 0, invalid: 0, unanimousContactId: null } }));
    unwrap(await acceptElection(deps, ctx, { resolutionId: round.id, contactId: greta, acceptedOn: '2026-07-20' }));
    expect(unwrap(await getResolutionContext(deps, ctx, { id: round.id })).election).toEqual({
      rounds: [{ number: 1, runoff: false, candidates: [{ name: 'Greta Falkner', votes: 6 }], no: 1, abstain: 0, invalid: 0, unanimous: null, needed: 4 }],
      elected: [{ name: 'Greta Falkner', acceptedOn: '2026-07-20', declinedOn: null }],
    });
  });

  it('the context names decider, documents and names; the circular context answers per office', async () => {
    const { deps, ctx, circular, chair, userId } = await world();
    const [row] = unwrap(await listResolutionRows(deps, ctx, {}));
    const context = unwrap(await getResolutionContext(deps, ctx, { id: row!.id }));
    expect(context.row.id).toBe(row!.id);
    expect(context.decidedBy).toBe('Erika Amt chair 0');
    const circ = unwrap(await getCircularContext(deps, ctx, { id: circular.id }));
    expect(circ.resolution).toEqual({ id: row!.id, number: 'B-2026-002' });
    expect(circ.offices[chair]).toBe('Vorsitz');
    expect(circ.names[chair]).toBe('Erika Amt chair 0');
    expect(circ.rule.source).toBe('law');
    expect(await getResolutionContext(deps, ctxWith([], userId), { id: row!.id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getCircularContext(deps, ctx, { id: 'fehlt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await getResolutionContext(deps, ctx, {})).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
