import { unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { endContactRole, startRoleRowInternal } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { governanceTerms } from '../src/schema';
import { listAdoptableRoleRows } from '../src/role-rows';
import { adoptRoleRows, startTerm } from '../src/terms';
import { divergingRoleRowsInternal } from '../src/role-rows';
import { officeOf, person, setupGovernance, type GovernanceDeps } from './helpers';

const row = (deps: GovernanceDeps, contactId: string, role: string, since: string) => deps.db.transaction((tx) => startRoleRowInternal(tx, deps, systemContext(), { contactId, role, since, note: null }));

describe('listAdoptableRoleRows', () => {
  it('lists role rows without a term; an adopted row is gone; treasurer only names offices with that function', async () => {
    const { deps, ctx } = setupGovernance();
    const anna = await person(deps, 'Kasse');
    const bert = await person(deps, 'Prüfer');
    const treasurerRow = row(deps, anna, 'treasurer', '2025-03-01');
    const auditorRow = row(deps, bert, 'auditor', '2025-04-01');
    row(deps, bert, 'press', '2025-04-01');
    const rows = unwrap(await listAdoptableRoleRows(deps, ctx, {}));
    expect(rows.map((r) => [r.rowId, r.role, r.name])).toEqual([
      [treasurerRow, 'treasurer', 'Erika Kasse'],
      [auditorRow, 'auditor', 'Erika Prüfer'],
    ]);
    expect(rows[0]!.offices).toEqual([officeOf(deps, 'treasurer')]);
    unwrap(await adoptRoleRows(deps, ctx, { items: [{ rowId: auditorRow, officeId: officeOf(deps, 'auditor') }] }));
    expect(unwrap(await listAdoptableRoleRows(deps, ctx, {})).map((r) => r.rowId)).toEqual([treasurerRow]);
  });

  it('needs governance.manage', async () => {
    const { deps, userId } = setupGovernance();
    expect(await listAdoptableRoleRows(deps, ctxWith(['governance.read'], userId), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});

describe('V-1: rows from before Gremien stay in the hand of contacts', () => {
  const contactsCtx = ctxWith(['contacts.view', 'contacts.manage']);

  it('a legacy board row can be ended by hand while Gremien is on; a row of a term cannot; the overview still counts the legacy row until then', async () => {
    const { deps, ctx } = setupGovernance();
    const old = await person(deps, 'Altvorstand');
    const legacy = row(deps, old, 'board-member', '2023-01-01');
    expect(divergingRoleRowsInternal(deps.db, '2026-06-01')).toBe(1);
    unwrap(await endContactRole(deps, contactsCtx, { roleId: legacy, until: '2026-06-30' }));
    expect(divergingRoleRowsInternal(deps.db, '2026-07-01')).toBe(0);

    const chair = await person(deps, 'Vorsitz');
    const term = unwrap(await startTerm(deps, ctx, { officeId: officeOf(deps, 'chair'), contactId: chair, since: '2026-07-01', origin: 'backfilled' }));
    const termRow = deps.db.select().from(governanceTerms).where(eq(governanceTerms.id, term.id)).get()!.roleRowIds[0]!;
    const res = await endContactRole(deps, contactsCtx, { roleId: termRow, until: '2026-08-01' });
    expect(res.ok ? null : res.error).toMatchObject({ code: 'roleManagedByModule' });
  });
});

describe('V-10: the finance setup step „Vorstand am Kontakt“ points at Gremien while Gremien manages the role', () => {
  it('names governance.manage and Gremien; without Gremien contacts.manage as before', async () => {
    const { getSetupStatus } = await import('@kompass/module-finance');
    const { writeSettingInternal } = await import('@kompass/core');
    const { deps } = setupGovernance();
    const ctx = ctxWith(['finance.read']);
    const step = async () => unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'boardMembers')!;
    expect(await step()).toMatchObject({ permission: 'governance.manage', detail: { managedBy: 'governance' } });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance', 'members']));
    expect(await step()).toMatchObject({ permission: 'contacts.manage', detail: {} });
  });
});
