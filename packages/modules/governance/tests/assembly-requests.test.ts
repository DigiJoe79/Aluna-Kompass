import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { listAssemblyRequests, saveAssemblyRequest } from '../src/assembly-requests';
import { createMeeting } from '../src/meetings';
import { governanceOrgans } from '../src/schema';
import { createStatuteDraft, updateStatute } from '../src/statutes';
import { auditOf, member, setupGovernance, type GovernanceDeps } from './helpers';

const organ = (deps: GovernanceDeps, kind: 'assembly' | 'board') => deps.db.select().from(governanceOrgans).all().find((o) => o.kind === kind)!.id;

async function members(deps: GovernanceDeps, n: number) {
  for (let i = 0; i < n; i += 1) await member(deps);
}

describe('saveAssemblyRequest', () => {
  it('needs a tenth of the members on the day of receipt (§ 37 BGB)', async () => {
    const { deps, ctx } = setupGovernance();
    await members(deps, 40);
    const mv = organ(deps, 'assembly');
    const short = unwrap(await saveAssemblyRequest(deps, ctx, { organId: mv, receivedOn: '2026-06-01', supporters: 3, purpose: 'Satzungsfrage' }));
    expect(short).toMatchObject({ required: 4, memberCount: 40, reached: false, meetingId: null });
    const reached = unwrap(await saveAssemblyRequest(deps, ctx, { id: short.id, organId: mv, receivedOn: '2026-06-01', supporters: 4, purpose: 'Satzungsfrage' }));
    expect(reached.reached).toBe(true);
    expect(auditOf(deps, 'governance.assemblyRequest.save').map((e) => e.params)).toEqual([
      { receivedOn: '2026-06-01', supporters: 3, reached: false },
      { receivedOn: '2026-06-01', supporters: 4, reached: true },
    ]);
    const meeting = unwrap(await createMeeting(deps, ctx, { organId: mv, kind: 'extraordinary', heldOn: '2026-07-10', startsAt: '19:00', form: 'inPerson', assemblyRequestId: short.id }));
    expect(unwrap(await listAssemblyRequests(deps, ctx, {}))).toMatchObject([{ id: short.id, meetingId: meeting.id }]);
  });

  it('takes the fraction from the statute', async () => {
    const { deps, ctx } = setupGovernance();
    await members(deps, 40);
    const mv = organ(deps, 'assembly');
    const id = unwrap(await createStatuteDraft(deps, ctx, {})).id;
    unwrap(await updateStatute(deps, ctx, { id, resolutions: [{ on: '2026-01-10', resolutionId: null }], rules: { organs: { [mv]: { minorityRequest: { num: 1, den: 5 } } } } }));
    expect(unwrap(await saveAssemblyRequest(deps, ctx, { organId: mv, receivedOn: '2026-06-01', supporters: 4, purpose: 'x' }))).toMatchObject({ required: 8, reached: false });
  });

  it('refuses the board as organ and a missing permission', async () => {
    const { deps, ctx } = setupGovernance();
    expect(await saveAssemblyRequest(deps, ctx, { organId: organ(deps, 'board'), receivedOn: '2026-06-01', supporters: 4, purpose: 'x' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await saveAssemblyRequest(reader.deps, reader.ctx, { organId: organ(deps, 'assembly'), receivedOn: '2026-06-01', supporters: 4, purpose: 'x' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
