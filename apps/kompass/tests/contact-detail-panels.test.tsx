// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetentionPanel } from '@/app/(shell)/contacts/[id]/retention-panel';
import { RolesPanel } from '@/app/(shell)/contacts/[id]/roles-panel';
import { ContactVatPanel } from '@/app/(shell)/contacts/[id]/vat-panel';
import { clearReverseChargeDeclineAction, saveContactTaxDetailsAction } from '@/app/(shell)/finance/tax/actions';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/actions', () => ({
  createContactAction: vi.fn(),
  updateContactAction: vi.fn(),
  setContactChannelsAction: vi.fn(),
  addContactRoleAction: vi.fn(),
  endContactRoleAction: vi.fn(),
}));

vi.mock('@/app/(shell)/finance/tax/actions', () => ({ saveContactTaxDetailsAction: vi.fn(async () => ({ status: 'success', message: 'ok' })), clearReverseChargeDeclineAction: vi.fn(async () => ({ status: 'success' })) }));

afterEach(() => {
  cleanup();
  vi.mocked(saveContactTaxDetailsAction).mockClear();
});

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        {children}
      </DateFormatProvider>
    </NextIntlClientProvider>
  );
}

/** Durchsicht 0.2.11, Paket 04 (Kontakt-Detail). */
describe('Kontakt-Detail', () => {
  it('Aufbewahrung: Kopfzeile mit der Frist, die zählt, und dem Grund (04 B10)', () => {
    render(
      <RetentionPanel
        holds={[
          { entity: 'contactRole', id: 'R1', label: 'Rolle', until: '2030-12-31' },
          { entity: 'contact', id: 'C1', label: 'Grundfrist', until: '2028-01-31' },
        ]}
        roleKeysById={{ R1: 'donor' }}
      />,
      { wrapper: Intl },
    );
    expect(screen.getByTestId('retention-summary').textContent).toBe('Gehalten bis 31.12.2030, wegen Rolle Spender');
  });

  it('Aufbewahrung: Ein dauerhafter Halter gewinnt (04 B10)', () => {
    render(
      <RetentionPanel
        holds={[
          { entity: 'contact', id: 'C1', label: 'Grundfrist', until: '2028-01-31' },
          { entity: 'contactUserLink', id: 'L1', label: 'Verknüpfung mit einem Nutzerkonto', until: null },
        ]}
        roleKeysById={{}}
      />,
      { wrapper: Intl },
    );
    expect(screen.getByTestId('retention-summary').textContent).toBe('Dauerhaft gehalten, wegen Verknüpfung mit einem Nutzerkonto');
  });

  it('Rollen: beendete stehen unter den laufenden (Runde 3, 039)', () => {
    render(
      <RolesPanel
        contactId="C1"
        contactName="Erika Muster"
        roles={[
          { id: 'R1', role: 'interested', since: '2025-09-01', until: '2026-04-28' },
          { id: 'R2', role: 'donor', since: '2026-10-17', until: null },
        ]}
        roleDefinitions={[{ key: 'donor', retention: 'p10y' }, { key: 'interested', retention: 'p10y' }]}
        canManage
        today="2026-10-17"
      />,
      { wrapper: Intl },
    );
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.dataset.state)).toEqual(['current', 'ended']);
  });
});

/** Plan E6a Task 11c — Abschnitt „Umsatzsteuer“ am Kontakt (Board 2a A). */
describe('Kontakt-Detail: Umsatzsteuer', () => {
  const v = messages.finance.contactVat;
  const show = (props: { entrepreneur?: boolean; reverseCharge?: 'eu' | 'other' | null; canEdit?: boolean }) =>
    render(<ContactVatPanel contactId="C1" entrepreneur={props.entrepreneur ?? true} reverseCharge={props.reverseCharge ?? null} canEdit={props.canEdit ?? true} />, { wrapper: Intl });

  it('appears only when the association is an entrepreneur', () => {
    show({ entrepreneur: false });
    expect(screen.queryByTestId('contact-vat')).toBeNull();
    cleanup();
    show({});
    expect(screen.getByTestId('contact-vat')).toBeTruthy();
  });

  it('saves the third-country mark', async () => {
    show({});
    fireEvent.click(screen.getByLabelText(v.reverseCharge.replace(/\s/g, ' ')));
    fireEvent.click(screen.getByRole('radio', { name: v.other }));
    fireEvent.click(screen.getByTestId('contact-vat-save'));
    await waitFor(() => expect(saveContactTaxDetailsAction).toHaveBeenCalledWith({ contactId: 'C1', reverseCharge: 'other' }));
  });

  it('clears the mark when the box is unticked', async () => {
    show({ reverseCharge: 'eu' });
    fireEvent.click(screen.getByLabelText(v.reverseCharge.replace(/\s/g, ' ')));
    fireEvent.click(screen.getByTestId('contact-vat-save'));
    await waitFor(() => expect(saveContactTaxDetailsAction).toHaveBeenCalledWith({ contactId: 'C1', reverseCharge: null }));
  });

  it('shows a remembered no and asks again', async () => {
    render(<ContactVatPanel contactId="C1" entrepreneur reverseCharge={null} canEdit decline={{ reason: 'paymentServices', text: null, on: '2026-07-03', byName: 'Anna' }} />, { wrapper: Intl });
    expect(screen.getByTestId('contact-vat-decline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: v.askAgain }));
    await waitFor(() => expect(clearReverseChargeDeclineAction).toHaveBeenCalledWith('C1'));
    cleanup();
    show({});
    expect(screen.queryByTestId('contact-vat-decline')).toBeNull();
  });

  it('reads only without the right to book', () => {
    show({ reverseCharge: 'eu', canEdit: false });
    expect(screen.queryByTestId('contact-vat-save')).toBeNull();
    expect(screen.getByLabelText(v.reverseCharge.replace(/\s/g, ' ')).hasAttribute('disabled') || screen.getByLabelText(v.reverseCharge.replace(/\s/g, ' ')).getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
