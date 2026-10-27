// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const saveCategoryAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/admin/finance', useSearchParams: () => new URLSearchParams('panel=categories') }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ saveCategoryAction, setCategoryActiveAction: vi.fn(), confirmCategoriesAction: vi.fn() }));
const { CategoriesPanel } = await import('@/app/(shell)/admin/finance/categories-panel');
afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  saveCategoryAction.mockReset();
});

/** Kategorie-Merkmal „Für die Freigrenze“ (Plan C2 Task 9, C1 Entscheidung 16). */
const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const ROW = { id: 'k1', key: 'grant', name: 'Betriebszuschuss', explanation: '', direction: 'income' as const, sphere: 'business' as const, incomeKind: 'other', costFunction: null, allowanceKind: 'none', statementSuffices: false, defaultTaxCode: 'none', inputTaxDeductible: 'no', countsTowardTurnover: false, isAssetSale: false, thresholdExclusion: 'none' as const, externalAccountNumber: null, isActive: true, expectedVersion: 'v1' };
const open = () => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <CategoriesPanel categories={[ROW]} confirmedAt={null} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Betriebszuschuss' }));
  return screen.getByRole('dialog');
};

describe('Kategorie: Für die Freigrenze', () => {
  it('speichert das Merkmal mit der Kategorie', async () => {
    saveCategoryAction.mockResolvedValue({ status: 'success' });
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText(m('finance.admin.categories.thresholdExclusion')), { target: { value: 'notPerformance' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(saveCategoryAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'k1', thresholdExclusion: 'notPerformance' })));
  });

  it('Feldfehler am Feld', async () => {
    saveCategoryAction.mockResolvedValue({ status: 'error', message: 'x', fieldErrors: { thresholdExclusion: 'Ungültige Auswahl.' } });
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: m('common.save') }));
    expect(await within(dialog).findByText('Ungültige Auswahl.')).toBeTruthy();
  });
});
