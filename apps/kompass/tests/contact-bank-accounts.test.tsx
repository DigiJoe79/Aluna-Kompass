// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { BankAccountsPanel, type BankAccountItem } from '@/app/(shell)/contacts/[id]/bank-accounts-panel';
import { linkContactIbanAction, unlinkContactIbanAction } from '@/app/(shell)/contacts/actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock('@/app/(shell)/contacts/actions', () => ({
  linkContactIbanAction: vi.fn(),
  unlinkContactIbanAction: vi.fn(async () => ({ status: 'success', message: 'IBAN entfernt.' })),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const IBAN = 'DE66999999991234567890';
const item = (over: Partial<BankAccountItem>): BankAccountItem => ({ id: 'b1', iban: IBAN, source: 'learned', learnedFromEntryDate: '2026-03-12', createdAt: '2026-03-12T10:00:00.000Z', createdByName: null, coHolders: [], ...over });

function panel(items: BankAccountItem[], canEdit = true) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <BankAccountsPanel contactId="c-y" contactName="Kim Klein" items={items} canEdit={canEdit} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('contact-bank-accounts');
}

/** Plan U4 Task 3 (Nachtrag MCP-Test § 3): Nebenliste „Bankverbindungen“ am Kontakt. */
describe('BankAccountsPanel', () => {
  it('zeigt IBAN in Vierergruppen, Herkunft und „Auch bei“ mit Link und Marke', () => {
    const box = panel([
      item({}),
      item({ id: 'b2', iban: 'DE23999999990000202051', source: 'manual', learnedFromEntryDate: null, createdByName: 'Joe Beispiel', coHolders: [{ contactId: 'c-x', name: 'Anna Alpha' }] }),
      item({ id: 'b3', iban: 'DE93999999990000202052', source: 'mandate', learnedFromEntryDate: null }),
      item({ id: 'b4', iban: 'DE44999999990532013000', source: null, learnedFromEntryDate: null }),
    ]);
    const rows = within(box).getAllByTestId('bank-account-row');
    expect(rows[0]!.textContent).toContain('DE66 9999 9999 1234 5678 90');
    expect(rows[0]!.textContent).toContain('aus Buchung vom 12.03.2026');
    expect(rows[1]!.textContent).toContain('von Hand, Joe Beispiel, 12.03.2026');
    expect(within(rows[1]!).getByRole('link', { name: 'Anna Alpha' }).getAttribute('href')).toBe('/contacts/c-x');
    expect(rows[1]!.textContent).toContain('Gemeinschaftskonto');
    expect(rows[2]!.textContent).toContain('aus Mandat');
    // Altbestand: eine Herkunft, kein leeres Feld.
    expect(rows[3]!.textContent).toContain('Herkunft unbekannt');
  });

  it('leer der EmptyState; ohne Recht kein „IBAN hinzufügen …“ und kein Zeilenmenü', () => {
    let box = panel([]);
    expect(box.textContent).toContain('Noch keine Bankverbindung.');
    expect(box.textContent).toContain('Kompass lernt sie aus Buchungen, oder Sie tragen sie ein.');
    cleanup();
    box = panel([item({})], false);
    expect(within(box).queryByRole('button', { name: 'IBAN hinzufügen …' })).toBeNull();
    expect(within(box).queryByRole('button', { name: /Aktionen für/ })).toBeNull();
  });

  it('fügt eine IBAN hinzu; hängt sie schon an X, fragt derselbe Dialog nach — ohne Vorwahl, der Knopf nennt die Wahl', async () => {
    vi.mocked(linkContactIbanAction)
      .mockResolvedValueOnce({ status: 'error', message: 'Diese IBAN gehört schon zu Anna Alpha.', fieldErrors: {}, code: 'contactIbanTaken', detail: 'Anna Alpha' })
      .mockResolvedValueOnce({ status: 'success', message: 'IBAN hinzugefügt.' });
    panel([]);
    fireEvent.click(screen.getByRole('button', { name: 'IBAN hinzufügen …' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/IBAN/);
    fireEvent.change(field, { target: { value: 'DE66 9999 9999 1234 5678 91' } });
    expect(dialog.textContent).toContain('Die Prüfziffer stimmt nicht.');
    fireEvent.change(field, { target: { value: 'DE66 9999 9999 1234 5678 90' } });
    expect(dialog.textContent).toContain('IBAN ist gültig.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() => expect(linkContactIbanAction).toHaveBeenCalledWith({ contactId: 'c-y', iban: 'DE66 9999 9999 1234 5678 90' }));
    const notice = await within(dialog).findByTestId('bank-account-taken');
    expect(notice.textContent).toBe('Diese IBAN gehört schon zu Anna Alpha.');
    expect((field as HTMLInputElement).disabled).toBe(true);
    const radios = within(dialog).getAllByRole('radio');
    for (const radio of radios) expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(within(dialog).getByRole('button', { name: 'Auch Kim Klein zuordnen' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Andere IBAN' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Nur noch Kim Klein zuordnen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zu Kim Klein umhängen' }));
    await waitFor(() => expect(linkContactIbanAction).toHaveBeenLastCalledWith({ contactId: 'c-y', iban: 'DE66 9999 9999 1234 5678 90', mode: 'move' }));
  });

  it('entfernt über das Zeilenmenü mit Rückfrage', async () => {
    panel([item({})]);
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen für DE66 9999 9999 1234 5678 90' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Entfernen …' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('IBAN bei Kim Klein entfernen?');
    expect(dialog.textContent).toContain('Kompass ordnet neue Buchungen mit dieser IBAN nicht mehr Kim Klein zu. Gebuchtes bleibt, wie es ist.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(unlinkContactIbanAction).toHaveBeenCalledWith({ id: 'b1', contactId: 'c-y' }));
  });
});
