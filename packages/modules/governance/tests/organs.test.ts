import { describe, expect, it } from 'vitest';
import { listOrgans, saveOrgan, setOrganActive } from '../src/organs';
import { auditOf, setupGovernance } from './helpers';

describe('organs', () => {
  it('lists assembly and board with their offices', async () => {
    const { deps, ctx } = setupGovernance();
    const res = await listOrgans(deps, ctx, {});
    expect(res.ok && res.value.map((o) => [o.kind, o.offices.length])).toEqual([
      ['assembly', 1],
      ['board', 3],
    ]);
  });

  it('creates another organ and audits it with its kind', async () => {
    const { deps, ctx } = setupGovernance();
    const res = await saveOrgan(deps, ctx, { kind: 'other', name: 'Beirat' });
    expect(res).toMatchObject({ ok: true, value: { kind: 'other', name: 'Beirat', active: true, offices: [] } });
    expect(auditOf(deps, 'governance.organ.create').map((e) => e.params)).toEqual([{ kind: 'other' }]);
  });

  it('renames an organ but keeps its kind', async () => {
    const { deps, ctx } = setupGovernance();
    const listed = await listOrgans(deps, ctx, {});
    const board = listed.ok ? listed.value.find((o) => o.kind === 'board') : undefined;
    const res = await saveOrgan(deps, ctx, { id: board!.id, kind: 'other', name: 'Präsidium' });
    expect(res).toMatchObject({ ok: true, value: { kind: 'board', name: 'Präsidium' } });
    expect(auditOf(deps, 'governance.organ.update').map((e) => e.params)).toEqual([{ kind: 'board' }]);
  });

  it('refuses a second assembly as validation', async () => {
    const { deps, ctx } = setupGovernance();
    expect(await saveOrgan(deps, ctx, { kind: 'assembly', name: 'Zweite MV' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await saveOrgan(deps, ctx, { kind: 'other', name: '' })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('needs governance.manage', async () => {
    const { deps, ctx } = setupGovernance(['governance.read']);
    expect(await saveOrgan(deps, ctx, { kind: 'other', name: 'Beirat' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await listOrgans(deps, ctx, {})).toMatchObject({ ok: true });
    const { deps: d2, ctx: c2 } = setupGovernance([]);
    expect(await listOrgans(d2, c2, {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('keeps assembly and board active; deactivates other organs', async () => {
    const { deps, ctx } = setupGovernance();
    const organs = await listOrgans(deps, ctx, {});
    const assembly = organs.ok ? organs.value.find((o) => o.kind === 'assembly')! : null;
    expect(await setOrganActive(deps, ctx, { id: assembly!.id, active: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'organRequired' } });
    const other = await saveOrgan(deps, ctx, { kind: 'other', name: 'Beirat' });
    const id = other.ok ? other.value.id : '';
    expect(await setOrganActive(deps, ctx, { id, active: false })).toMatchObject({ ok: true, value: { active: false } });
    expect(auditOf(deps, 'governance.organ.deactivate').map((e) => e.params)).toEqual([{ kind: 'other' }]);
    const listed = await listOrgans(deps, ctx, {});
    expect(listed.ok && listed.value.some((o) => o.id === id)).toBe(false);
    const all = await listOrgans(deps, ctx, { includeInactive: true });
    expect(all.ok && all.value.some((o) => o.id === id)).toBe(true);
  });
});
