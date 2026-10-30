import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contactRoles, startRoleRowInternal } from '@kompass/module-contacts';
import { representativesInternal } from '@kompass/module-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveOffice } from '../src/offices';
import { adoptRoleRows, endTerm, startTerm } from '../src/terms';
import { organOf, person, setupGovernance, type GovernanceDeps } from './helpers';

const base = { seats: 1, termMonths: null, untilSuccessor: false, incompatibleWith: [] as string[] };
type OfficeInput = { name: string; representative: boolean; function: 'chair' | 'board' | 'treasurer' };

async function office(deps: GovernanceDeps, ctx: Parameters<typeof saveOffice>[1], input: OfficeInput) {
  return unwrap(await saveOffice(deps, ctx, { organId: organOf(deps, 'board'), ...base, ...input })).id;
}
const rowsOf = (deps: GovernanceDeps, contactId: string) => deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, contactId)).all();

describe('representing offices set "represents the association" on the board role (G7)', () => {
  it('a representing office puts its holder among the representatives', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = await office(deps, ctx, { name: 'Vorsitz', representative: true, function: 'chair' });
    const erika = await person(deps, 'Beispiel', 'Erika');
    unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: erika, since: '2026-11-01', origin: 'backfilled' }));
    expect(representativesInternal(deps.db, '2026-11-02')).toEqual([expect.objectContaining({ contactId: erika, office: 'Vorsitz' })]);
  });

  it('a non-representing board office does not', async () => {
    const { deps, ctx } = setupGovernance();
    const seat = await office(deps, ctx, { name: 'Beisitz', representative: false, function: 'board' });
    unwrap(await startTerm(deps, ctx, { officeId: seat, contactId: await person(deps), since: '2026-11-01', origin: 'backfilled' }));
    expect(representativesInternal(deps.db, '2026-11-02')).toEqual([]);
  });

  it('a representing treasurer gets the mark only on the board-member row', async () => {
    const { deps, ctx } = setupGovernance();
    const treasurer = await office(deps, ctx, { name: 'Kasse', representative: true, function: 'treasurer' });
    const tanja = await person(deps, 'Kasse', 'Tanja');
    unwrap(await startTerm(deps, ctx, { officeId: treasurer, contactId: tanja, since: '2026-11-01', origin: 'backfilled' }));
    const rows = rowsOf(deps, tanja);
    expect(rows.map((r) => [r.role, r.representsAssociation]).sort()).toEqual([['board-member', true], ['treasurer', false]]);
  });

  it('switching the office off follows on running rows only; ended terms keep their mark', async () => {
    const { deps, ctx } = setupGovernance(); // heute 2026-09-05
    const chair = await office(deps, ctx, { name: 'Vorsitz', representative: true, function: 'chair' });
    const earlier = await person(deps, 'Früher', 'Frieda');
    const term = unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: earlier, since: '2025-01-01', origin: 'backfilled' }));
    unwrap(await endTerm(deps, ctx, { id: term.id, until: '2025-12-31', reason: 'expired' }));
    const erika = await person(deps, 'Beispiel', 'Erika');
    unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: erika, since: '2026-01-01', origin: 'backfilled' }));
    expect(representativesInternal(deps.db, '2026-09-05').map((r) => r.contactId)).toEqual([erika]);

    unwrap(await saveOffice(deps, ctx, { id: chair, organId: organOf(deps, 'board'), ...base, name: 'Vorsitz', representative: false, function: 'chair' }));
    expect(representativesInternal(deps.db, '2026-09-05')).toEqual([]);
    expect(representativesInternal(deps.db, '2025-06-01').map((r) => r.contactId)).toEqual([earlier]);
  });

  it('adopting a hand row at a representing office sets the mark', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = await office(deps, ctx, { name: 'Vorsitz', representative: true, function: 'chair' });
    const erika = await person(deps, 'Beispiel', 'Erika');
    const rowId = deps.db.transaction((tx) => startRoleRowInternal(tx, deps, systemContext(), { contactId: erika, role: 'board-member', since: '2026-01-01', note: 'Vorsitz' }));
    unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId: chair }] }));
    expect(rowsOf(deps, erika).find((r) => r.id === rowId)?.representsAssociation).toBe(true);
  });
});
