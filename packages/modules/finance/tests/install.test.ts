import { schema, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documentTypeFor, documentTypes } from '@kompass/module-dms';
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

describe('installFinance — voucher types', () => {
  it('proposes four voucher types in the protection area finance, kept eight years', () => {
    const { deps } = setupFinance();
    run(deps);
    for (const [key, prefix] of [['voucher-own', 'EBL'], ['voucher-invoice', 'ERE'], ['voucher-receipt', 'QTG'], ['bank-statement', 'KTO']] as const) {
      expect(documentTypeFor(deps.db, key), key).toMatchObject({ prefix, protectionArea: 'finance', retentionClass: 'statutory8Y', ownerModule: null, defaultDirection: 'incoming' });
    }
  });

  it('leaves alone what the association already has — a taken key or prefix skips the proposal for good', () => {
    const { deps } = setupFinance();
    // wie bei Aluna: eine eigene Art `bank-statement` mit KTO, ohne Bereich
    deps.db.insert(documentTypes).values({ key: 'bank-statement', label: 'Kontoauszug', prefix: 'KTO', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 50, ownerModule: null, protectionArea: null }).run();
    run(deps);
    expect(documentTypeFor(deps.db, 'bank-statement')).toMatchObject({ retentionClass: 'statutory10Y', protectionArea: null });
    expect(documentTypeFor(deps.db, 'voucher-own')).not.toBeNull();
  });
});

describe('installFinance — cash count document type', () => {
  it('provisions the module-owned document type finance-cash-count with prefix KZP in area finance', () => {
    const { deps } = setupFinance();
    run(deps);
    expect(documentTypeFor(deps.db, 'finance-cash-count')).toMatchObject({ prefix: 'KZP', protectionArea: 'finance', retentionClass: 'statutory10Y', ownerModule: 'finance', defaultDirection: 'outgoing' });
  });
});

describe('installFinance — donation confirmation document types (F6a)', () => {
  it('creates finance-confirmation owned and protected', () => {
    const { deps } = setupFinance();
    run(deps);
    expect(documentTypeFor(deps.db, 'finance-confirmation')).toMatchObject({ prefix: 'ZWB', protectionArea: 'finance', retentionClass: 'statutory10Y', ownerModule: 'finance', defaultDirection: 'outgoing' });
    expect(documentTypeFor(deps.db, 'finance-confirmation-signed')).toMatchObject({ prefix: 'ZWU', protectionArea: 'finance', retentionClass: 'statutory10Y', ownerModule: 'finance', defaultDirection: 'incoming' });
  });

  it('refuses to install while another type holds ZWB', () => {
    const { deps } = setupFinance();
    // wie eine Vereinsart „Zuwendungsbestätigung“ aus der Zeit vor dem Finanzmodul
    deps.db.insert(documentTypes).values({ key: 'donation-receipt', label: 'Zuwendungsbestätigung', prefix: 'ZWB', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 50, ownerModule: null, protectionArea: null }).run();
    expect(() => run(deps)).toThrow(/Präfix ZWB trägt schon die Dokumentart „Zuwendungsbestätigung“/);
    expect(documentTypeFor(deps.db, 'finance-confirmation')).toBeNull();
  });
});

describe('installFinance — waiver declaration document types (F8a)', () => {
  it('creates finance-waiver-declaration (VZE, outgoing) and finance-waiver-signed (VZU, incoming), owned and protected, kept ten years', () => {
    const { deps } = setupFinance();
    run(deps);
    expect(documentTypeFor(deps.db, 'finance-waiver-declaration')).toMatchObject({ prefix: 'VZE', protectionArea: 'finance', retentionClass: 'statutory10Y', ownerModule: 'finance', defaultDirection: 'outgoing' });
    expect(documentTypeFor(deps.db, 'finance-waiver-signed')).toMatchObject({ prefix: 'VZU', protectionArea: 'finance', retentionClass: 'statutory10Y', ownerModule: 'finance', defaultDirection: 'incoming' });
  });
});
