// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntryForm } from '@/app/(shell)/finance/entries/entry-form';
import { DateFormatProvider } from '@/components/date-format-provider';
import { emptyForm, type EntryFormState } from '@/lib/finance/entry-form';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ saveDraftAction: vi.fn(), saveReviewedAction: vi.fn(), finalizeAction: vi.fn(), attachDocumentAction: vi.fn(), uploadVoucherAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/entries/actions', () => actions);
vi.mock('@/app/(shell)/finance/tax/actions', () => ({
  checkReverseChargeAction: vi.fn(async () => ({ status: 'success', data: null })),
  contactReverseChargeAction: vi.fn(async () => ({ status: 'success', data: null })),
  declineReverseChargeAction: vi.fn(),
  saveContactTaxDetailsAction: vi.fn(),
}));
vi.mock('@/app/(shell)/dms/document-picker', () => ({ DocumentPicker: () => null }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => router }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>
  );
}

function filled(): EntryFormState {
  const base = emptyForm('income', '2026-03-01');
  return {
    ...base,
    text: 'Spende Barbara',
    moneyRows: [{ ...base.moneyRows[0]!, accountId: 'bank', amountText: '50,00' }],
    splitRows: [{ key: 's1', categoryId: 'donations', amountText: '50,00', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false }],
  };
}

function renderForm() {
  return render(
    <EntryForm
      initial={filled()}
      accounts={[{ id: 'bank', name: 'Girokonto', kind: 'bank', balanceCents: 0 }]}
      categories={[{ id: 'donations', name: 'Spenden', direction: 'income', sphere: 'ideal' }]}
      purposes={[]}
      projects={[]}
      taxCodeOptions={[]}
      showTax={false}
      canFinalize
      voucherTypeKey="voucher"
      vouchers={[]}
      openItems={[]}
      today="2026-03-01"
    />,
    { wrapper },
  );
}

describe('Buchungsmaske — Entwurf und Geprüft (App-B3)', () => {
  it('sperrt beide Knöpfe, solange gespeichert wird: ein zweiter Klick legt keinen zweiten Entwurf an', async () => {
    let resolve!: (v: unknown) => void;
    actions.saveDraftAction.mockImplementation(() => new Promise((res) => (resolve = res)));
    renderForm();
    const draft = screen.getByRole('button', { name: 'Als Entwurf speichern' }) as HTMLButtonElement;
    const reviewed = screen.getByRole('button', { name: 'Speichern und als geprüft markieren' }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(draft);
    });
    expect(draft.disabled).toBe(true);
    expect(reviewed.disabled).toBe(true);
    expect(draft.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      fireEvent.click(draft);
      fireEvent.click(reviewed);
    });
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
    expect(actions.saveReviewedAction).not.toHaveBeenCalled();
    await act(async () => {
      resolve({ status: 'success', data: { id: 'E1' } });
    });
    expect(router.push).toHaveBeenCalledWith('/finance/entries');
  });

  it('ein Netzfehler bleibt in der Maske: Eingaben stehen, Toast mit „Erneut versuchen“, Knöpfe wieder frei', async () => {
    actions.saveDraftAction.mockRejectedValue(new Error('fetch failed'));
    renderForm();
    const draft = screen.getByRole('button', { name: 'Als Entwurf speichern' }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(draft);
    });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    const options = toastMock.error.mock.calls[0]![1] as { action?: { label: string } };
    expect(options.action?.label).toBe(messages.common.retry);
    expect((screen.getByDisplayValue('Spende Barbara') as HTMLInputElement).value).toBe('Spende Barbara');
    expect(draft.disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });
});
