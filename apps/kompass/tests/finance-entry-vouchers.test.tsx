// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/entries/actions', () => ({
  revokeVoucherAction: vi.fn(async () => ({ status: 'success' })),
  uploadVoucherAction: vi.fn(),
  uploadCorrectionProofAction: vi.fn(async () => ({ status: 'success', data: { documentId: 'd-up' } })),
}));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => [{ id: 'd9', number: 'BEL-2025-009', subject: 'Richtige Rechnung', phase: 'issued' }]) }));
const { EntryVouchers } = await import('@/app/(shell)/finance/entries/[id]/vouchers');
const actions = await import('@/app/(shell)/finance/entries/actions');
afterEach(cleanup);
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
  vi.clearAllMocks();
});

/** Belege an der Buchung (Designer Runde 5, 267): Prüfer sehen nur „Öffnen“, die Kasse widerruft und reicht nach — Rechte wie die Dienste. */
const VOUCHERS = [{ linkId: 'l1', documentNumber: 'BEL-2025-001', title: 'Rechnung', typeLabel: 'Beleg', date: '2025-03-01', viewHref: '/finance/entries/e1/voucher/d1', revoked: false }];
const view = (rights: { canRevoke: boolean; canUpload: boolean }, closedYear = false) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <EntryVouchers today="2026-02-20" entryId="e1" vouchers={VOUCHERS} closedYear={closedYear} yearDesignation="2025" {...rights} />
    </NextIntlClientProvider>,
  );
const menu = () => screen.getByRole('button', { name: 'Aktionen für BEL-2025-001' });
const openReplace = async () => {
  fireEvent.click(menu());
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Beleg ersetzen …' }));
  return screen.findByRole('dialog');
};

describe('Belege an der Buchung', () => {
  it('Prüfer (ohne Schreibrechte): kein Menü, kein Nachreichen; die Kasse sieht beides', () => {
    view({ canRevoke: false, canUpload: false });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /BEL-2025-001|Rechnung|Öffnen/ })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    cleanup();
    view({ canRevoke: false, canUpload: false }, true);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    cleanup();
    view({ canRevoke: true, canUpload: true });
    expect(menu()).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('Runde 6, Antwort 3: im Zeilenmenü offen „Entfernen“, abgeschlossen nur „Beleg ersetzen …“; Nachreichen bleibt', async () => {
    view({ canRevoke: true, canUpload: true });
    fireEvent.click(menu());
    expect(await screen.findByRole('menuitem', { name: 'Entfernen …' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Beleg ersetzen …' })).toBeNull();
    cleanup();
    view({ canRevoke: true, canUpload: true }, true);
    fireEvent.click(menu());
    expect(await screen.findByRole('menuitem', { name: 'Beleg ersetzen …' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Entfernen …' })).toBeNull();
    expect(document.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('Ersetzen aus der Akte: gesperrt ohne Wahl, aktiv mit Wahl und Grund; ruft den Widerruf mit dem Ersatz', async () => {
    view({ canRevoke: true, canUpload: true }, true);
    const dialog = await openReplace();
    expect(dialog.textContent).toContain('BEL-2025-001');
    expect(dialog.textContent).toContain('2025');
    const confirm = within(dialog).getByRole('button', { name: 'Ersetzen' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Warum/ }), { target: { value: 'Falsche Rechnung' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.focus(within(dialog).getByRole('combobox'));
    fireEvent.click(await within(dialog).findByTestId('document-option'));
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.revokeVoucherAction).toHaveBeenCalledWith('l1', 'Falsche Rechnung', 'd9'));
    expect(actions.uploadCorrectionProofAction).not.toHaveBeenCalled();
  });

  it('Ablehnung des Dienstes steht im Dialog, der Dialog bleibt offen', async () => {
    vi.mocked(actions.revokeVoucherAction).mockResolvedValueOnce({ status: 'error', message: 'Der Beleg hängt schon an dieser Buchung.', fieldErrors: {} });
    view({ canRevoke: true, canUpload: true }, true);
    const dialog = await openReplace();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Warum/ }), { target: { value: 'Falsch' } });
    fireEvent.focus(within(dialog).getByRole('combobox'));
    fireEvent.click(await within(dialog).findByTestId('document-option'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    expect(await within(dialog).findByText('Der Beleg hängt schon an dieser Buchung.')).toBeTruthy();
  });

  it('Hochladen: erst in die Akte ohne Verknüpfung als Beleg, dann der Widerruf mit dem neuen Dokument', async () => {
    view({ canRevoke: true, canUpload: true }, true);
    const dialog = await openReplace();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hochladen' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Warum/ }), { target: { value: 'Falsch' } });
    const confirm = within(dialog).getByRole('button', { name: 'Ersetzen' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(['%PDF-1.4 x'], 'neu.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.revokeVoucherAction).toHaveBeenCalledWith('l1', 'Falsch', 'd-up'));
    const form = vi.mocked(actions.uploadCorrectionProofAction).mock.calls[0]![0] as FormData;
    expect(form.get('entryId')).toBe('e1');
    expect(actions.uploadVoucherAction).not.toHaveBeenCalled();
  });
});
