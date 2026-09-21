import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { bookEntry } from '../src/ledger/finalize';
import { financeModule } from '../src/manifest';
import { ledgerFixture, setupFinance } from './helpers';

describe('finance module', () => {
  it('has the key finance, stores files, and depends on contacts, the file module and projects', () => {
    expect(financeModule).toMatchObject({ key: 'finance', files: true });
    expect([...(financeModule.dependsOn ?? [])].sort()).toEqual(['contacts', 'dms', 'projects']);
  });

  it('declares all ten permissions from the start — role proposals are never topped up later', () => {
    expect(financeModule.permissions).toEqual([
      'finance.read', 'finance.overview', 'finance.entriesWrite', 'finance.entriesFinalize', 'finance.periodClose',
      'finance.setup', 'finance.expensesSubmit', 'finance.approve', 'finance.donationsIssue', 'finance.reportsFinalize',
    ]);
  });

  it('puts the journal, accounts, open items and the cash box into the rail with the euro icon, readable with finance.read, in the same section', () => {
    expect(financeModule.navigation).toEqual([
      { key: 'finance.entries', href: '/finance/entries', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
      { key: 'finance.accounts', href: '/finance/accounts', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
      { key: 'finance.openItems', href: '/finance/open-items', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
      { key: 'finance.cash', href: '/finance/cash', icon: 'euro', group: 'finance', section: 'finance.entries', permission: 'finance.read' },
    ]);
    expect(financeModule.moduleIcon).toBe('euro');
  });

  it('registers the protection area finance, opened by finance.read', () => {
    expect(financeModule.documentAreas).toEqual([{ key: 'finance', permission: 'finance.read' }]);
  });

  it('registers entries and open items with the file module: read with finance.read, file with finance.entriesWrite', () => {
    expect(financeModule.linkedDocumentAccess).toEqual([
      { entityType: 'financeEntry', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
      { entityType: 'financeOpenItem', readPermission: 'finance.read', receivePermission: 'finance.entriesWrite' },
      { entityType: 'financeCashCount', readPermission: 'finance.read', receivePermission: 'finance.entriesFinalize' },
    ]);
  });

  it('registers the cash count template under finance.entriesFinalize', () => {
    const template = (financeModule.documentTemplates ?? []).find((t) => t.key === 'finance-cash-count');
    expect(template).toMatchObject({ key: 'finance-cash-count', type: 'finance-cash-count', permission: 'finance.entriesFinalize' });
  });

  it('brings five contact roles, none of which holds a contact by itself', () => {
    expect(financeModule.contactRoles).toEqual(['donor', 'grant-recipient', 'claimant', 'board-member', 'related-party'].map((key) => ({ key, retention: 'none' })));
  });

  it('labels a fiscal year for follow-ups and links from the file module', async () => {
    const { deps, ctx } = setupFinance();
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    expect(financeModule.recordLabels!(deps, ctx, 'financeFiscalYear', year.id)).toMatchObject({ label: 'Geschäftsjahr 2026', state: 'ok' });
    expect(financeModule.recordLabels!(deps, ctxWith([]), 'financeFiscalYear', year.id)).toMatchObject({ state: 'forbidden', label: 'Geschäftsjahr 2026' });
    expect(financeModule.recordLabels!(deps, ctx, 'financeFiscalYear', 'nope')).toMatchObject({ state: 'missing' });
    expect(financeModule.recordLabels!(deps, ctx, 'contact', 'x')).toBeNull();
  });

  it('offers a follow-up target for a fiscal year, without a page yet', async () => {
    const { deps, ctx } = setupFinance();
    const year = unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    expect(financeModule.followUpTargets!(deps, 'financeFiscalYear', year.id)).toEqual({ label: 'Geschäftsjahr 2026', href: null });
    expect(financeModule.followUpTargets!(deps, 'financeFiscalYear', 'nope')).toBeNull();
    expect(financeModule.followUpTargets!(deps, 'contact', 'x')).toBeNull();
  });

  it('states for every entity whether it can be deleted, and never lets the history go', () => {
    const rules = Object.fromEntries((financeModule.deletionRules ?? []).map((r) => [r.entity, r.deletable]));
    expect(rules).toEqual({
      financeAccount: true, financeCategory: true, financePurpose: true, financeDatedValue: true, financeFiscalYear: false, financePeriodEvent: false,
      financeEntryDraft: true, financeEntry: false, financeOpenItem: false, financeAllocationCorrection: false, financeEntryDocument: false, financeEntryJustification: false,
      financeProjectSettings: true, financeYearPersonalData: true, financeCashCount: false,
    });
  });

  it('never lets finalized records go: entries, open items, corrections, voucher links, justifications', () => {
    const rules = Object.fromEntries((financeModule.deletionRules ?? []).map((r) => [r.entity, r.deletable]));
    for (const entity of ['financeEntry', 'financeOpenItem', 'financeAllocationCorrection', 'financeEntryDocument', 'financeEntryJustification']) {
      expect(rules[entity], entity).toBe(false);
    }
  });

  it('rules the personal data of a year as one logical entity, ten years, with its own audit action', () => {
    const rule = (financeModule.deletionRules ?? []).find((r) => r.entity === 'financeYearPersonalData')!;
    expect(rule).toMatchObject({ deletable: true, retentionClass: 'statutory10Y', auditAction: 'finance.personalData.redact' });
  });

  it('the reason for “not deletable” tells what happens instead', () => {
    for (const entity of ['financeEntry', 'financeOpenItem', 'financeAllocationCorrection', 'financeEntryDocument', 'financeEntryJustification']) {
      const rule = (financeModule.deletionRules ?? []).find((r) => r.entity === entity)!;
      expect(rule.reason, entity).toMatch(/Anonymisierung|entfernt/);
    }
  });

  it('can be switched off as long as nothing is finalized', () => {
    const { deps } = setupFinance();
    expect(financeModule.canDisable!(deps)).toBeNull();
  });

  it('can no longer be switched off once an entry is finalized', async () => {
    const f = await ledgerFixture();
    expect(financeModule.canDisable!(f.deps)).toBeNull();
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
    expect(financeModule.canDisable!(f.deps)).toBe('hasFinalRecords');
  });
});
