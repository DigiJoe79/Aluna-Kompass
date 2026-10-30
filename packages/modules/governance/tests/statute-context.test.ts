import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createRegisterFiling } from '../src/register/filings';
import { getStatuteContext } from '../src/statute-context';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { RECORDING, setupGovernance } from './helpers';
import { statuteMeeting } from './register-helpers';

describe('getStatuteContext', () => {
  it('a stand resolved in a meeting names number and agenda item; its filing; figures without an ended meeting have no example', async () => {
    const { deps, ctx } = setupGovernance([...RECORDING, 'dms.view']);
    const { statuteId, meetingId, occasionId } = await statuteMeeting(deps, ctx, '2026-03-20');
    const filing = unwrap(await createRegisterFiling(deps, ctx, { occasions: [{ id: occasionId }] }));
    const context = unwrap(await getStatuteContext(deps, ctx, { statuteId }));
    expect(context.statute.id).toBe(statuteId);
    expect(context.resolutions).toEqual([{ on: '2026-03-20', resolutionId: expect.any(String), number: 'B-2026-001', meetingId, meetingKind: 'extraordinary', itemPosition: 1 }]);
    expect(context.filing).toEqual({ id: filing.id, state: 'due', submittedOn: null });
    const board = context.organs.find((o) => o.kind === 'board')!;
    expect(board.offices.map((o) => o.name)).toEqual(['Vorsitz', 'Stellvertretender Vorsitz', 'Kasse']);
    expect(board.figures).toMatchObject({ organMembers: 0, lastPresentVoting: null });
    const assembly = context.organs.find((o) => o.kind === 'assembly')!;
    // Die nachgetragene Versammlung hatte sieben Stimmberechtigte.
    expect(assembly.figures.lastPresentVoting).toBe(7);
    expect(context.law.majorities.purpose!.norm).toBe('§ 33 Abs. 1 S. 2 BGB');
  });

  it('a backfilled resolution has neither id nor number; notFound and forbidden', async () => {
    const { deps, ctx, userId } = setupGovernance();
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2020-05-01', resolutionId: null }] }));
    const context = unwrap(await getStatuteContext(deps, ctx, { statuteId: id }));
    expect(context.resolutions).toEqual([{ on: '2020-05-01', resolutionId: null, number: null, meetingId: null, meetingKind: null, itemPosition: null }]);
    expect(context.filing).toBeNull();
    expect(context.document).toBeNull();
    expect(await getStatuteContext(deps, ctx, { statuteId: 'fehlt' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await getStatuteContext(deps, ctxWith([], userId), { statuteId: id })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
