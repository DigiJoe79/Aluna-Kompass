import { roleIdByOrigin, schema, unwrap, readSetting } from '@kompass/core';
import { auditEntry, ctxWith, insertRole, insertUser, systemContext } from '@kompass/core/testing';
import { createContact, linkUserToContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../src/ledger/accounts';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { applyTaxDefaults, confirmSetupStep, getPermissionMatrix, getSetupStatus } from '../src/ledger/setup';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { setupFinance } from './helpers';

const FINANCE_ROLE_ORIGIN_KEYS = ['finance:treasurer', 'finance:approver', 'finance:clerk', 'finance:auditor', 'finance:agent'];

describe('finance setup status', () => {
  it('reports every step open on a fresh installation, account blocked behind fiscal year', async () => {
    const { deps, ctx } = setupFinance();
    const status = unwrap(await getSetupStatus(deps, ctx));
    expect(status.complete).toBe(false);
    expect(status.steps.map((s) => s.key)).toEqual(['fiscalYear', 'account', 'roles', 'categories', 'tax']);
    for (const step of status.steps) expect(step.done, step.key).toBe(false);
    const account = status.steps.find((s) => s.key === 'account')!;
    expect(account.dependsOn).toBe('fiscalYear');
    expect(account.blocked).toBe(true);
    const fiscalYear = status.steps.find((s) => s.key === 'fiscalYear')!;
    expect(fiscalYear.blocked).toBe(false);
  });

  it('counts an account only with an opening balance', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
    const withoutOpening = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'account')!;
    expect(withoutOpening.done).toBe(false);
    expect(withoutOpening.detail).toEqual({ accounts: 1, withoutOpening: 1 });

    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true, openingBalanceCents: 10000, openingDate: '2026-01-01' }));
    const withOpening = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'account')!;
    expect(withOpening.done).toBe(true);
    expect(withOpening.detail).toEqual({ accounts: 2, withoutOpening: 1 });
  });

  it('reports roles done only when each finance role has an active user and every finance user is linked to a contact', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));

    const before = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'roles')!;
    expect(before.done).toBe(false);
    expect(before.detail.rolesWithoutUser).toContain('Schatzmeister');
    expect(before.permission).toBe('users.manage');

    const holderId = insertUser(deps, { name: 'Rollen-Halterin' });
    for (const originKey of FINANCE_ROLE_ORIGIN_KEYS) {
      const roleId = roleIdByOrigin(deps.db, originKey)!;
      deps.db.insert(schema.userRoles).values({ userId: holderId, roleId }).run();
    }
    const afterAssign = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'roles')!;
    expect(afterAssign.done).toBe(false);
    expect(afterAssign.detail.usersWithoutContact).toBe(1);
    expect(afterAssign.detail.rolesWithoutUser).toBeUndefined();

    const adminCtx = ctxWith(['users.manage', 'contacts.manage'], 'ADMIN-USER');
    const contact = unwrap(await createContact(deps, adminCtx, { kind: 'person', lastName: 'Musterhalterin' }));
    unwrap(await linkUserToContact(deps, adminCtx, { userId: holderId, contactId: contact.id }));

    const afterLink = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'roles')!;
    expect(afterLink.done).toBe(true);
    expect(afterLink.detail).toEqual({});
  });

  it('names who can do a step, without e-mail addresses', async () => {
    const { deps, ctx } = setupFinance();
    const roleId = insertRole(deps, { name: 'Kann Einrichten' });
    deps.db.insert(schema.rolePermissions).values({ roleId, permissionKey: 'finance.setup' }).run();
    insertUser(deps, { name: 'Helfer Person', email: 'helfer@example.org', id: 'HELPER' });
    deps.db.insert(schema.userRoles).values({ userId: 'HELPER', roleId }).run();

    const fiscalYear = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'fiscalYear')!;
    expect(fiscalYear.canDo).toContain('Helfer Person');
    expect(fiscalYear.canDo.join(' ')).not.toContain('@');
  });

  it('confirms categories and tax, and applyTaxDefaults confirms tax in one go', async () => {
    const { deps, ctx } = setupFinance();
    const before = unwrap(await getSetupStatus(deps, ctx));
    expect(before.steps.find((s) => s.key === 'categories')!.done).toBe(false);
    expect(before.steps.find((s) => s.key === 'tax')!.done).toBe(false);

    unwrap(await confirmSetupStep(deps, ctx, { step: 'categories' }));
    const afterCategories = unwrap(await getSetupStatus(deps, ctx));
    expect(afterCategories.steps.find((s) => s.key === 'categories')!.done).toBe(true);
    expect(afterCategories.steps.find((s) => s.key === 'tax')!.done).toBe(false);

    const applied = unwrap(await applyTaxDefaults(deps, ctx));
    expect(applied.applied).toEqual(['finance.isEntrepreneurOrHasVatId', 'finance.membershipFeesCertifiable', 'finance.expenseWaiversEnabled']);
    expect(readSetting(deps, 'finance.isEntrepreneurOrHasVatId')).toBe(false);
    expect(readSetting(deps, 'finance.membershipFeesCertifiable')).toBe(true);
    expect(readSetting(deps, 'finance.expenseWaiversEnabled')).toBe(true);
    const afterTax = unwrap(await getSetupStatus(deps, ctx));
    expect(afterTax.steps.find((s) => s.key === 'tax')!.done).toBe(true);
  });

  it('is complete when all five are done', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true, openingBalanceCents: 10000, openingDate: '2026-01-01' }));

    const holderId = insertUser(deps, { name: 'Rollen-Halterin' });
    for (const originKey of FINANCE_ROLE_ORIGIN_KEYS) {
      const roleId = roleIdByOrigin(deps.db, originKey)!;
      deps.db.insert(schema.userRoles).values({ userId: holderId, roleId }).run();
    }
    const adminCtx = ctxWith(['users.manage', 'contacts.manage'], 'ADMIN-USER');
    const contact = unwrap(await createContact(deps, adminCtx, { kind: 'person', lastName: 'Musterhalterin' }));
    unwrap(await linkUserToContact(deps, adminCtx, { userId: holderId, contactId: contact.id }));

    unwrap(await confirmSetupStep(deps, ctx, { step: 'categories' }));
    unwrap(await applyTaxDefaults(deps, ctx));

    const status = unwrap(await getSetupStatus(deps, ctx));
    expect(status.complete).toBe(true);
    expect(status.steps.every((s) => s.done)).toBe(true);
  });

  it('lets finance.read see the status but not confirm', async () => {
    const { deps } = setupFinance();
    const readerCtx = ctxWith(['finance.read'], 'READER');
    const status = await getSetupStatus(deps, readerCtx);
    expect(status.ok).toBe(true);
    expect(await confirmSetupStep(deps, readerCtx, { step: 'categories' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
    expect(await applyTaxDefaults(deps, readerCtx)).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
  });

  it('maps ten activities to the ten permissions and lists holders per role; a role nobody holds has an empty list', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const matrix = unwrap(await getPermissionMatrix(deps, ctx));
    expect(matrix.activities).toHaveLength(10);
    expect(matrix.activities.map((a) => a.permission)).toEqual([...FINANCE_PERMISSIONS]);
    expect(matrix.activities[0]).toEqual({ key: 'read', permission: 'finance.read' });

    const treasurer = matrix.roles.find((r) => r.name === 'Schatzmeister')!;
    expect(treasurer.holders).toEqual([]);
    expect(treasurer.permissions).toContain('finance.setup');
    expect(treasurer.navigation).toContain('finance.admin');

    const holderId = insertUser(deps, { name: 'Schatzmeister Person' });
    const treasurerRoleId = roleIdByOrigin(deps.db, 'finance:treasurer')!;
    deps.db.insert(schema.userRoles).values({ userId: holderId, roleId: treasurerRoleId }).run();
    const matrixAfter = unwrap(await getPermissionMatrix(deps, ctx));
    expect(matrixAfter.roles.find((r) => r.name === 'Schatzmeister')!.holders).toEqual(['Schatzmeister Person']);
  });

  it('never writes user names into the audit log', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await confirmSetupStep(deps, ctx, { step: 'categories' }));
    unwrap(await applyTaxDefaults(deps, ctx));
    const entry = auditEntry(deps, 'finance.setup.applyTaxDefaults');
    expect(Object.keys(JSON.parse(entry.after as string)).sort()).toEqual(['applied', 'confirmedAt', 'step']);
    expect(entry.summary).not.toMatch(/Test/);
  });
});
