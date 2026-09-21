import { roleIdByOrigin, schema, unwrap, readSetting } from '@kompass/core';
import { auditEntry, ctxWith, insertRole, insertUser, systemContext } from '@kompass/core/testing';
import { createContact, linkUserToContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { applyTaxDefaults, confirmSetupStep, getPermissionMatrix, getSetupStatus, setFinanceLimit, setFinanceSwitch } from '../src/ledger/setup';
import { installFinance } from '../src/install';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { setupFinance } from './helpers';

const FINANCE_ROLE_ORIGIN_KEYS = ['finance:treasurer', 'finance:approver', 'finance:clerk', 'finance:auditor', 'finance:agent'];

describe('finance setup status', () => {
  it('reports every step open on a fresh installation, account blocked behind fiscal year', async () => {
    const { deps, ctx } = setupFinance();
    const status = unwrap(await getSetupStatus(deps, ctx));
    expect(status.complete).toBe(false);
    expect(status.steps.map((s) => s.key)).toEqual(['fiscalYear', 'account', 'roles', 'categories', 'tax', 'importFormat']);
    // importFormat ist ohne Bankkonto vakuos erfüllt (nichts, was ein Format bräuchte) — die übrigen fünf sind offen.
    for (const step of status.steps.filter((s) => s.key !== 'importFormat')) expect(step.done, step.key).toBe(false);
    const account = status.steps.find((s) => s.key === 'account')!;
    expect(account.dependsOn).toBe('fiscalYear');
    expect(account.blocked).toBe(true);
    const fiscalYear = status.steps.find((s) => s.key === 'fiscalYear')!;
    expect(fiscalYear.blocked).toBe(false);

    // F4 Task 6: importFormat ist der einzige optionale Schritt — hängt an account, nicht an fiscalYear.
    const importFormat = status.steps.find((s) => s.key === 'importFormat')!;
    expect(importFormat.required).toBe(false);
    expect(importFormat.dependsOn).toBe('account');
    expect(importFormat.blocked).toBe(true);
    for (const step of status.steps.filter((s) => s.key !== 'importFormat')) expect(step.required, step.key).toBe(true);
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

  it('adds the optional import format step, done when every active bank account has a format, without touching completeness', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
    const importFormatWithOnlyCash = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'importFormat')!;
    expect(importFormatWithOnlyCash.required).toBe(false);
    expect(importFormatWithOnlyCash.done).toBe(true); // eine Barkasse braucht kein Auszugsformat

    const main = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true, importFormat: 'camt053' }));
    const formatlos = unwrap(await createAccount(deps, ctx, { name: 'Zweitkonto', kind: 'bank', iban: 'DE12999999990000112233' }));
    void main;
    const withUnsetFormat = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'importFormat')!;
    expect(withUnsetFormat.done).toBe(false); // ein Bankkonto hat noch kein Format

    unwrap(await setAccountActive(deps, ctx, { id: formatlos.id, isActive: false, expectedVersion: formatlos.updatedAt }));
    const afterDeactivating = unwrap(await getSetupStatus(deps, ctx)).steps.find((s) => s.key === 'importFormat')!;
    expect(afterDeactivating.done).toBe(true); // nur aktive Bankkonten zaehlen
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

  it('is complete when all five required steps are done, even while the optional importFormat step is still open', async () => {
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
    expect(status.steps.filter((s) => s.required).every((s) => s.done)).toBe(true);
    // Das angelegte Bankkonto hat noch kein Auszugsformat — der optionale Schritt bleibt offen, ohne complete zu kippen.
    expect(status.steps.find((s) => s.key === 'importFormat')!.done).toBe(false);
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

  it('sets a finance switch (H7) with finance.setup, refuses an unknown key, and keeps the mcp-only switch bound to the ui channel', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setFinanceSwitch(deps, ctx, { key: 'finance.isEntrepreneurOrHasVatId', value: true }));
    expect(readSetting(deps, 'finance.isEntrepreneurOrHasVatId')).toBe(true);

    const invalid = await setFinanceSwitch(deps, ctx, { key: 'finance.uploadLimitMb', value: true });
    expect(invalid.ok).toBe(false);

    const agentCtx = { ...ctx, channel: 'mcp' as const };
    const refused = await setFinanceSwitch(deps, agentCtx, { key: 'finance.mcpHumanOnlyAllowed', value: true });
    expect(refused).toMatchObject({ ok: false, error: { type: 'conflict', code: 'switchUiOnly' } });

    const readerCtx = ctxWith(['finance.read'], 'READER');
    expect(await setFinanceSwitch(deps, readerCtx, { key: 'finance.isEntrepreneurOrHasVatId', value: false })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
  });

  it('sets one of the three finance limits with finance.setup, refuses other keys and negative amounts', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setFinanceLimit(deps, ctx, { key: 'finance.statementSufficesBelowCents', cents: 5000 }));
    expect(readSetting(deps, 'finance.statementSufficesBelowCents')).toBe(5000);

    const unknownKey = await setFinanceLimit(deps, ctx, { key: 'finance.uploadLimitMb', cents: 5 });
    expect(unknownKey.ok).toBe(false);

    const negative = await setFinanceLimit(deps, ctx, { key: 'finance.cashDonationAlertCents', cents: -100 });
    expect(negative.ok).toBe(false);

    const readerCtx = ctxWith(['finance.read'], 'READER');
    expect(await setFinanceLimit(deps, readerCtx, { key: 'finance.roundAmountFromCents', cents: 10000 })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.setup' } });
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
