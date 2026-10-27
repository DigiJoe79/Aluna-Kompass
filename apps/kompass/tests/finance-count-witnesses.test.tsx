// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/cash/actions', () => ({ countCashAction: vi.fn(), emptyDonationBoxAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/closing/handover/actions', () => ({ countCashForHandoverAction: vi.fn(async () => ({ status: 'success' })) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => ({ items: [], more: false })) }));
const { CountDialog } = await import('@/app/(shell)/finance/cash/count-dialog');
const { countCashForHandoverAction } = await import('@/app/(shell)/finance/closing/handover/actions');
afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const open = (witnesses: React.ComponentProps<typeof CountDialog>['witnesses']) => {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <CountDialog account={{ id: 'k', name: 'Barkasse', bookCents: 21430 }} today="2026-02-18" canCreateContact={false} witnesses={witnesses} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: m('finance.cash.count.trigger') }));
};

describe('Zähldialog „Im Beisein von“ (Board 12f)', () => {
  it('offers a box per auditor of the running audit', () => {
    open({ designation: '2025', auditors: [{ id: 'a1', name: 'Klara Prüf' }, { id: 'a2', name: 'Paula Papier' }] });
    const field = screen.getByTestId('count-witnesses');
    expect(field.textContent).toContain(m('finance.cash.count.witnesses'));
    expect(screen.getByRole('checkbox', { name: 'Klara Prüf' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Paula Papier' })).toBeTruthy();
  });

  it('without a running audit the field is not there', () => {
    open(null);
    expect(screen.queryByTestId('count-witnesses')).toBeNull();
  });
});

describe('Zähldialog aus der Amtsübergabe (Befund 4)', () => {
  it('belegt die neue Person als zweite Zählende vor — kein „Im Beisein von“, Speichern ohne weitere Wahl', async () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <CountDialog account={{ id: 'k', name: 'Barkasse', bookCents: 21430 }} today="2026-07-01" canCreateContact={false} handover={{ id: 'h1', handoverOn: '2026-06-30', from: { id: 'c-alt', name: 'Anna Alt' }, to: { id: 'c-neu', name: 'Lena Neu' }, triggerLabel: 'Kasse zählen' }} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByTestId('handover-count'));
    expect(screen.queryByTestId('count-handover-witness')).toBeNull();
    fireEvent.change(screen.getByLabelText(new RegExp(m('finance.cash.count.countedAmount'))), { target: { value: '214,30' } });
    fireEvent.click(screen.getByRole('button', { name: m('finance.cash.count.submit') }));
    await waitFor(() => expect(countCashForHandoverAction).toHaveBeenCalled());
    expect(vi.mocked(countCashForHandoverAction).mock.calls[0]![0]).toMatchObject({ id: 'h1', counterOneContactId: 'c-alt', counterTwoContactId: 'c-neu', countedCents: 21430 });
  });
});
