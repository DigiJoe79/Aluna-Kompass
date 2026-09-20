import { schema, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { deleteCategory, listCategories } from '../src/ledger/categories';
import { setupFinance } from './helpers';

const rolePermissions = (deps: ReturnType<typeof setupFinance>['deps'], originKey: string) => {
  const role = deps.db.select().from(schema.roles).where(eq(schema.roles.originKey, originKey)).get()!;
  return deps.db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id)).all().map((r) => r.permissionKey).sort();
};
const run = (deps: ReturnType<typeof setupFinance>['deps']) => deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));

describe('installFinance — roles', () => {
  it('proposes five roles with exactly the permissions of the spec', () => {
    const { deps } = setupFinance();
    run(deps);
    expect(rolePermissions(deps, 'finance:treasurer')).toEqual([
      'contacts.manage', 'contacts.view', 'dms.create', 'dms.view', 'documents.export',
      'finance.approve', 'finance.donationsIssue', 'finance.entriesFinalize', 'finance.entriesWrite', 'finance.expensesSubmit', 'finance.overview', 'finance.periodClose', 'finance.read', 'finance.reportsFinalize', 'finance.setup',
      'followUps.manage', 'followUps.view', 'projects.view',
    ]);
    expect(rolePermissions(deps, 'finance:approver')).toEqual(['contacts.view', 'finance.approve', 'finance.expensesSubmit', 'finance.overview', 'finance.read', 'projects.view']);
    expect(rolePermissions(deps, 'finance:clerk')).toEqual(['finance.expensesSubmit']);
    expect(rolePermissions(deps, 'finance:auditor')).toEqual(['documents.export', 'finance.overview', 'finance.read']);
    expect(rolePermissions(deps, 'finance:agent')).toEqual(['contacts.view', 'finance.entriesWrite', 'finance.overview', 'finance.read', 'projects.view']);
  });

  it('the treasurer gets no dms.file — vouchers are filed in the name of the entry', () => {
    const { deps } = setupFinance();
    run(deps);
    expect(rolePermissions(deps, 'finance:treasurer')).not.toContain('dms.file');
  });

  it('runs again without doubling, and never brings back what the association removed', () => {
    const { deps } = setupFinance();
    run(deps);
    const role = deps.db.select().from(schema.roles).where(eq(schema.roles.originKey, 'finance:clerk')).get()!;
    deps.db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, role.id)).run();
    run(deps);
    expect(deps.db.select().from(schema.roles).all().filter((r) => r.originKey?.startsWith('finance:'))).toHaveLength(5);
    expect(rolePermissions(deps, 'finance:clerk')).toEqual([]);
  });
});

describe('installFinance — start plan', () => {
  it('delivers the start plan once — a category the association deleted never comes back', async () => {
    const { deps, ctx } = setupFinance();
    run(deps);
    expect(unwrap(await listCategories(deps, ctx, { includeInactive: true }))).toHaveLength(37);
    const fees = unwrap(await listCategories(deps, ctx, {})).find((c) => c.key === 'bank-fees')!;
    unwrap(await deleteCategory(deps, ctx, { id: fees.id }));
    run(deps);
    expect(unwrap(await listCategories(deps, ctx, { includeInactive: true })).map((c) => c.key)).not.toContain('bank-fees');
  });
});
