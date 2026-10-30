import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createCircular, decideCircular, getCircular, saveCircularResponse } from '../src/circulars';
import { listResolutions, saveResolution } from '../src/resolutions';
import { previewSeal } from '../src/seal/preview';
import { sealCircular } from '../src/seal/seal';
import { createStatuteDraft, registerStatute } from '../src/statutes';
import { holders, organOf, RECORDING, session, setupGovernance, type GovernanceDeps } from './helpers';
import { statuteMeeting } from './register-helpers';

type Ctx = ReturnType<typeof setupGovernance>['ctx'];
const NOW = '2026-10-29T08:00:00.000Z';

/** Gründungssatzung beschlossen (festgeschrieben) und eingetragen. */
async function registeredStand(deps: GovernanceDeps, ctx: Ctx) {
  const founding = await statuteMeeting(deps, ctx, '2025-02-01', { founding: true });
  unwrap(await registerStatute(deps, ctx, { id: founding.statuteId, registeredOn: '2025-03-01' }));
  return founding.statuteId;
}

describe('L-3: statute and purpose resolutions from circulars and meetings check stand and organ (G-4)', () => {
  it('a board circular on a registered stand warns statuteRegistered and statuteNotAssembly; the preview blocks, sealing is refused', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const statuteId = await registeredStand(deps, ctx);
    const board = await holders(deps, ctx, ['chair', 'board', 'treasurer']);
    const c = unwrap(await createCircular(deps, ctx, { organId: organOf(deps, 'board'), kind: 'statute', text: 'Satzung geändert', details: { statuteId }, requestedOn: '2026-10-20', deadline: '2026-10-27', channel: 'email' }));
    expect(c.warnings).toEqual(expect.arrayContaining(['statuteRegistered', 'statuteNotAssembly']));
    for (const r of c.responses) unwrap(await saveCircularResponse(deps, ctx, { id: r.id, answer: 'yes', answeredOn: '2026-10-21' }));
    const decided = unwrap(await decideCircular(deps, ctx, { id: c.id, outcome: 'adopted', decidedOn: '2026-10-22', decidedByContactId: board[0]! }));
    expect(decided.warnings).toContain('statuteRegistered');
    expect(unwrap(await previewSeal(deps, ctx, { circularId: c.id })).blockers).toContain('statuteResolutionInvalid');
    expect(await sealCircular(deps, ctx, { circularId: c.id })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'statuteResolutionInvalid' } });
    expect(unwrap(await getCircular(deps, ctx, { id: c.id })).sealedAt).toBeNull();
  });

  it('an assembly naming a registered stand warns statuteRegistered only; on a draft nothing; the sealed founding resolution stays clean after registration', async () => {
    const { deps, ctx } = setupGovernance(RECORDING, { now: NOW });
    const statuteId = await registeredStand(deps, ctx);
    const draft = unwrap(await createStatuteDraft(deps, ctx, { basedOnId: statuteId })).id;
    const { items } = await session(deps, ctx, { items: ['statute', 'statute'], voters: 2, heldOn: '2026-10-28' });
    const onRegistered = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:10', unanimous: true, details: { statuteId } }));
    expect(onRegistered.warnings).toContain('statuteRegistered');
    expect(onRegistered.warnings).not.toContain('statuteNotAssembly');
    const onDraft = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'y', votedAt: '19:20', unanimous: true, details: { statuteId: draft } }));
    expect(onDraft.warnings).not.toContain('statuteRegistered');
    const founding = unwrap(await listResolutions(deps, ctx, { kinds: ['statute'] })).find((r) => r.number !== null)!;
    expect(founding.warnings).not.toContain('statuteRegistered');
  });
});
