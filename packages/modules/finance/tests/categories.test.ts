import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { createCategory, deleteCategory, listCategories, updateCategory } from '../src/ledger/categories';
import { financeAllocationLines, financeEntries } from '../src/schema';
import { setupFinance } from './helpers';

const income = { key: 'raffle', name: 'Tombola', direction: 'income' as const, sphere: 'business' as const, incomeKind: 'sales' as const };
const expense = { key: 'rent', name: 'Miete', direction: 'expense' as const, sphere: 'ideal' as const, costFunction: 'administration' as const };
const issues = (r: { ok: boolean; error?: { type: string; issues?: { path: string; message: string }[] } }) => (r.ok ? [] : (r.error!.issues ?? []).map((i) => i.message));
const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

describe('categories', () => {
  it('creates with sensible defaults', async () => {
    const { deps, ctx } = setupFinance();
    expect(unwrap(await createCategory(deps, ctx, income))).toMatchObject({ key: 'raffle', allowanceKind: 'none', statementSuffices: false, defaultTaxCode: 'none', inputTaxDeductible: 'no', countsTowardTurnover: false, isAssetSale: false, isActive: true });
  });

  it.each([
    ['transitHasNoSphere', { key: 'x', name: 'x', direction: 'transit', sphere: 'ideal' }],
    ['sphereRequired', { key: 'x', name: 'x', direction: 'income', incomeKind: 'other' }],
    ['incomeKindRequired', { key: 'x', name: 'x', direction: 'income', sphere: 'ideal' }],
    ['costFunctionRequired', { key: 'x', name: 'x', direction: 'expense', sphere: 'ideal' }],
    ['incomeKindOnlyForIncome', { ...expense, key: 'x', incomeKind: 'other' }],
    ['costFunctionOnlyForExpense', { ...income, key: 'x', costFunction: 'program' }],
    ['certifiableOnlyIdeal', { ...income, key: 'x', incomeKind: 'donation' }],
    ['allowanceOnlyForExpense', { ...income, key: 'x', allowanceKind: 'volunteer' }],
    ['inputTaxNotInIdeal', { ...expense, key: 'x', inputTaxDeductible: 'yes' }],
  ])('refuses: %s', async (message, input) => {
    const { deps, ctx } = setupFinance();
    expect(issues(await createCategory(deps, ctx, input))).toContain(message);
  });

  it('keeps the key for good, and checks the rules against the merged result on update', async () => {
    const { deps, ctx } = setupFinance();
    const row = unwrap(await createCategory(deps, ctx, expense));
    expect(issues(await updateCategory(deps, ctx, { id: row.id, inputTaxDeductible: 'yes' }))).toContain('inputTaxNotInIdeal');
    expect(unwrap(await updateCategory(deps, ctx, { id: row.id, sphere: 'business', inputTaxDeductible: 'yes' })).inputTaxDeductible).toBe('yes');
    expect((await updateCategory(deps, ctx, { id: row.id, key: 'other' } as never)).ok).toBe(false);
  });

  it('refuses a second category with the same key and deletes an unused one', async () => {
    const { deps, ctx } = setupFinance();
    const row = unwrap(await createCategory(deps, ctx, income));
    const again = await createCategory(deps, ctx, income);
    expect(again.ok ? null : again.error).toMatchObject({ type: 'conflict', code: 'categoryKeyTaken' });
    expect((await deleteCategory(deps, ctx, { id: row.id })).ok).toBe(true);
    expect(unwrap(await listCategories(deps, ctx, {}))).toEqual([]);
  });

  it('cannot be deleted once a line points at it — even a draft’s', async () => {
    const { deps, ctx } = setupFinance();
    const row = unwrap(await createCategory(deps, ctx, income));
    const now = '2026-03-01T10:00:00.000Z';
    deps.db.insert(financeEntries).values({ id: 'E1', number: null, entryDate: '2026-03-01', text: 'Test', status: 'draft', createdByUserId: 'U1', createdChannel: 'ui', createdAt: now, updatedAt: now }).run();
    deps.db.insert(financeAllocationLines).values({ id: 'L1', entryId: 'E1', position: 0, categoryId: row.id, amountCents: 1, taxCode: 'none', rateKind: 'standard', abroad: false, addsToAssets: false }).run();
    expect(err(await deleteCategory(deps, ctx, { id: row.id }))).toMatchObject({ type: 'conflict', code: 'categoryInUse' });
  });
});
