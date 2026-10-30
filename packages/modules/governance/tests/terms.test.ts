import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contactRoles, startRoleRowInternal } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { governanceOffices, governanceTerms } from '../src/schema';
import { adoptRoleRows, endTerm, listTerms, startTerm } from '../src/terms';
import { auditOf, person, receivedDocument, setupGovernance, type GovernanceDeps } from './helpers';

const office = (deps: GovernanceDeps, fn: string) => deps.db.select().from(governanceOffices).all().find((o) => o.function === fn)!;
const rolesOf = (deps: GovernanceDeps, contactId: string) => deps.db.select().from(contactRoles).where(eq(contactRoles.contactId, contactId)).all();
/** Eine Rollenzeile, wie sie vor Gremien von Hand entstand. */
const handRow = (deps: GovernanceDeps, contactId: string, role: string, since: string, until: string | null = null) =>
  deps.db.transaction((tx) => {
    const id = startRoleRowInternal(tx, deps, systemContext(), { contactId, role, since, note: 'Kasse' });
    if (until) tx.update(contactRoles).set({ until }).where(eq(contactRoles.id, id)).run();
    return id;
  });

describe('startTerm', () => {
  it('starts the treasurer with two role rows and remembers them', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const res = unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'treasurer').id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    expect(res).toMatchObject({ contactId, since: '2026-07-20', until: null, origin: 'backfilled', running: true, warnings: [] });
    const roles = rolesOf(deps, contactId);
    expect(roles.map((r) => [r.role, r.note, r.since]).sort()).toEqual([
      ['board-member', 'Kasse', '2026-07-20'],
      ['treasurer', null, '2026-07-20'],
    ]);
    const row = deps.db.select().from(governanceTerms).get()!;
    expect([...row.roleRowIds].sort()).toEqual(roles.map((r) => r.id).sort());
    expect(auditOf(deps, 'governance.term.start').map((e) => e.params)).toEqual([{ origin: 'backfilled', since: '2026-07-20', contactId }]);
  });

  it('ends only the row of the older office when one person holds two board offices in turn (Review Focus 2)', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const first = unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'board').id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'chair').id, contactId, since: '2027-03-01', origin: 'appointed' }));
    unwrap(await endTerm(deps, ctx, { id: first.id, until: '2027-02-28', reason: 'other' }));
    const rows = rolesOf(deps, contactId).sort((a, b) => a.since.localeCompare(b.since));
    expect(rows.map((r) => [r.note, r.until])).toEqual([
      ['Stellvertretender Vorsitz', '2027-02-28'],
      ['Vorsitz', null],
    ]);
  });

  it('refuses a third auditor at the same time, but not a successor starting the day after (Review Focus 5)', async () => {
    const { deps, ctx } = setupGovernance();
    const auditor = office(deps, 'auditor').id;
    const a = unwrap(await startTerm(deps, ctx, { officeId: auditor, contactId: await person(deps, 'Eins'), since: '2026-07-20', origin: 'backfilled' }));
    unwrap(await startTerm(deps, ctx, { officeId: auditor, contactId: await person(deps, 'Zwei'), since: '2026-07-20', origin: 'backfilled' }));
    const third = await startTerm(deps, ctx, { officeId: auditor, contactId: await person(deps, 'Drei'), since: '2027-03-01', origin: 'backfilled' });
    expect(third).toMatchObject({ ok: false, error: { type: 'conflict', code: 'officeFull', params: { seats: 2 } } });
    expect(deps.db.select().from(governanceTerms).all()).toHaveLength(2);
    unwrap(await endTerm(deps, ctx, { id: a.id, until: '2027-02-28', reason: 'expired' }));
    expect(await startTerm(deps, ctx, { officeId: auditor, contactId: await person(deps, 'Drei'), since: '2027-03-01', origin: 'backfilled' })).toMatchObject({ ok: true });
  });

  it('warns about an incompatible office and still saves', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'auditor').id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    const res = unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'chair').id, contactId, since: '2026-09-01', origin: 'backfilled' }));
    expect(res.warnings).toContain('incompatible');
    expect(deps.db.select().from(governanceTerms).all()).toHaveLength(2);
  });

  it('refuses elected as origin, a missing permission and writes no names into the audit log', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps, 'Unverwechselbar');
    expect(await startTerm(deps, ctx, { officeId: office(deps, 'chair').id, contactId, since: '2026-07-20', origin: 'elected' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const reader = setupGovernance(['governance.read']);
    expect(await startTerm(reader.deps, reader.ctx, { officeId: office(reader.deps, 'chair').id, contactId, since: '2026-07-20', origin: 'backfilled' })).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'chair').id, contactId, since: '2026-07-20', origin: 'backfilled' }));
    const entries = deps.db.select().from((await import('@kompass/core')).schema.auditLog).all().filter((e) => e.action.startsWith('governance.'));
    expect(JSON.stringify(entries)).not.toContain('Unverwechselbar');
  });
});

describe('endTerm', () => {
  it('needs the day a resignation was received', async () => {
    const { deps, ctx } = setupGovernance();
    const term = unwrap(await startTerm(deps, ctx, { officeId: office(deps, 'chair').id, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' }));
    expect(await endTerm(deps, ctx, { id: term.id, until: '2026-12-31', reason: 'resigned' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    expect(await endTerm(deps, ctx, { id: term.id, until: '2026-07-01', reason: 'other' })).toMatchObject({ ok: false, error: { type: 'validation' } });
    const ended = unwrap(await endTerm(deps, ctx, { id: term.id, until: '2026-12-31', reason: 'resigned', receivedOn: '2026-12-01' }));
    expect(ended).toMatchObject({ until: '2026-12-31', endReason: 'resigned', endReceivedOn: '2026-12-01' });
    expect(auditOf(deps, 'governance.term.end').map((e) => e.params)).toEqual([{ until: '2026-12-31', reason: 'resigned', contactId: term.contactId }]);
  });

  it('G-25: a resignation without a document warns; with one, or for another reason, it does not', async () => {
    const { deps, ctx } = setupGovernance();
    const start = async (fn: 'chair' | 'treasurer' | 'board') => unwrap(await startTerm(deps, ctx, { officeId: office(deps, fn).id, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' }));
    expect(unwrap(await endTerm(deps, ctx, { id: (await start('chair')).id, until: '2026-12-31', reason: 'resigned', receivedOn: '2026-12-01' })).warnings).toEqual(['resignationDocumentMissing']);
    expect(unwrap(await endTerm(deps, ctx, { id: (await start('treasurer')).id, until: '2026-12-31', reason: 'resigned', receivedOn: '2026-12-01', documentId: await receivedDocument(deps) })).warnings).toEqual([]);
    expect(unwrap(await endTerm(deps, ctx, { id: (await start('board')).id, until: '2026-12-31', reason: 'expired' })).warnings).toEqual([]);
  });
});

describe('listTerms', () => {
  it('computes running at a given day', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = office(deps, 'chair').id;
    const term = unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: await person(deps), since: '2026-07-20', origin: 'backfilled' }));
    unwrap(await endTerm(deps, ctx, { id: term.id, until: '2026-08-31', reason: 'other' }));
    expect(unwrap(await listTerms(deps, ctx, { officeId: chair, on: '2026-08-01' })).map((t) => t.running)).toEqual([true]);
    expect(unwrap(await listTerms(deps, ctx, { officeId: chair, on: '2026-09-01' })).map((t) => t.running)).toEqual([false]);
  });
});

describe('adoptRoleRows', () => {
  it('folds the two rows of the treasurer into one term and ends both with it', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const rows = [handRow(deps, contactId, 'board-member', '2026-07-20'), handRow(deps, contactId, 'treasurer', '2026-08-01')];
    const treasurer = office(deps, 'treasurer').id;
    const terms = unwrap(await adoptRoleRows(deps, ctx, { items: rows.map((rowId) => ({ rowId, officeId: treasurer })) }));
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ contactId, since: '2026-07-20', until: null, origin: 'backfilled' });
    expect(rolesOf(deps, contactId)).toHaveLength(2); // keine neue Zeile
    expect(auditOf(deps, 'governance.term.adopt').map((e) => e.params)).toEqual([{ count: 2 }]);
    unwrap(await endTerm(deps, ctx, { id: terms[0]!.id, until: '2027-06-30', reason: 'other' }));
    expect(rolesOf(deps, contactId).map((r) => r.until)).toEqual(['2027-06-30', '2027-06-30']);
  });

  it('adds the treasurer row when only board-member exists', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const rowId = handRow(deps, contactId, 'board-member', '2026-07-20');
    const [term] = unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId: office(deps, 'treasurer').id }] }));
    expect(rolesOf(deps, contactId).map((r) => r.role).sort()).toEqual(['board-member', 'treasurer']);
    expect(deps.db.select().from(governanceTerms).get()!.roleRowIds).toHaveLength(2);
    expect(term!.since).toBe('2026-07-20');
  });

  it('refuses a row adopted twice and a row of another role (Review Focus 4)', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const rowId = handRow(deps, contactId, 'board-member', '2026-07-20');
    unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId: office(deps, 'chair').id }] }));
    expect(await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId: office(deps, 'board').id }] })).toMatchObject({ ok: false, error: { type: 'conflict', code: 'roleRowAdopted' } });
    const treasurerRow = handRow(deps, await person(deps, 'Andere'), 'treasurer', '2026-07-20');
    expect(await adoptRoleRows(deps, ctx, { items: [{ rowId: treasurerRow, officeId: office(deps, 'chair').id }] })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('refuses rows that end on different days', async () => {
    const { deps, ctx } = setupGovernance();
    const contactId = await person(deps);
    const rows = [handRow(deps, contactId, 'board-member', '2026-07-20', '2026-12-31'), handRow(deps, contactId, 'treasurer', '2026-07-20', '2027-01-31')];
    const treasurer = office(deps, 'treasurer').id;
    expect(await adoptRoleRows(deps, ctx, { items: rows.map((rowId) => ({ rowId, officeId: treasurer })) })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });

  it('returns officeFull from the internal start as a result and saves nothing', async () => {
    const { deps, ctx } = setupGovernance();
    const chair = office(deps, 'chair').id;
    unwrap(await startTerm(deps, ctx, { officeId: chair, contactId: await person(deps, 'Eins'), since: '2026-07-20', origin: 'backfilled' }));
    const before = deps.db.select().from(contactRoles).all().length;
    const other = await person(deps, 'Zwei');
    const rowId = handRow(deps, other, 'board-member', '2026-07-20');
    const res = await adoptRoleRows(deps, ctx, { items: [{ rowId, officeId: chair }] });
    expect(res).toMatchObject({ ok: false, error: { type: 'conflict', code: 'officeFull' } });
    expect(deps.db.select().from(governanceTerms).all()).toHaveLength(1);
    expect(deps.db.select().from(contactRoles).all()).toHaveLength(before + 1);
  });
});
