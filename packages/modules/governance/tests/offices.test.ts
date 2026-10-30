import { describe, expect, it } from 'vitest';
import { saveOffice, setOfficeActive } from '../src/offices';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { startTerm } from '../src/terms';
import { auditOf, person, setupGovernance } from './helpers';

const base = { seats: 1, representative: false, termMonths: null, untilSuccessor: false, function: null, incompatibleWith: [] as string[] };

describe('offices', () => {
  it('creates and updates an office, audited without values', async () => {
    const { deps, ctx } = setupGovernance();
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    const created = await saveOffice(deps, ctx, { organId: board.id, name: 'Schriftführung', ...base });
    expect(created).toMatchObject({ ok: true, value: { organId: board.id, name: 'Schriftführung', seats: 1, active: true } });
    const id = created.ok ? created.value.id : '';
    const updated = await saveOffice(deps, ctx, { id, organId: board.id, name: 'Beisitz', ...base, seats: 2, function: 'board' });
    expect(updated).toMatchObject({ ok: true, value: { name: 'Beisitz', seats: 2, function: 'board' } });
    expect(auditOf(deps, 'governance.office.create')).toHaveLength(1);
    expect(auditOf(deps, 'governance.office.update')).toHaveLength(1);
  });

  it('refuses invalid input, an unknown organ and a missing permission', async () => {
    const { deps, ctx } = setupGovernance();
    const board = deps.db.select().from(governanceOrgans).all().find((o) => o.kind === 'board')!;
    expect(await saveOffice(deps, ctx, { organId: board.id, name: 'X', ...base, seats: 0 })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await saveOffice(deps, ctx, { organId: 'nope', name: 'X', ...base })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await saveOffice(reader.deps, reader.ctx, { organId: board.id, name: 'X', ...base })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('deactivates an office only without a running term', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    const term = await startTerm(deps, ctx, { officeId: chair.id, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' });
    expect(term.ok).toBe(true);
    expect(await setOfficeActive(deps, ctx, { id: chair.id, active: false })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'officeOccupied' } });
    const deputy = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'board')!;
    expect(await setOfficeActive(deps, ctx, { id: deputy.id, active: false })).toMatchObject({ ok: true, value: { active: false } });
    expect(auditOf(deps, 'governance.office.deactivate')).toHaveLength(1);
  });
});
