// @vitest-environment jsdom
import type { NameConsentEntry } from '@kompass/module-finance';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const recordNameConsentAction = vi.fn();
const saveContactTaxDetailsAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/contacts/c1' }));
vi.mock('@/app/(shell)/finance/tax/actions', () => ({ recordNameConsentAction, saveContactTaxDetailsAction, clearReverseChargeDeclineAction: vi.fn() }));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { AnnualAccountsPanel } = await import('@/app/(shell)/contacts/[id]/annual-accounts-panel');
afterEach(cleanup);
beforeEach(() => {
  recordNameConsentAction.mockReset();
  saveContactTaxDetailsAction.mockReset();
});

const m = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], messages) as string;
const C = 'finance.contactAnnualAccounts';
const entry = (over: Partial<NameConsentEntry>): NameConsentEntry => ({ id: 'n1', kind: 'granted', on: '2026-01-12', fromYear: 2025, documentId: null, documentNumber: null, createdAt: '2026-01-12T10:00:00.000Z', createdByUserId: 'u1', ...over });
const granted = entry({ id: 'n2', documentId: 'd3', documentNumber: 'EIN-2026-003' });
const revokedOld = entry({ id: 'n1', kind: 'revoked', on: '2025-03-03', fromYear: null });
type Props = React.ComponentProps<typeof AnnualAccountsPanel>;
const show = (over: Partial<Props> = {}) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <AnnualAccountsPanel contactId="c1" contactKind="person" legalEntity={null} consents={[]} effect={null} canEdit today="2026-10-28" lastClosedYear={2025} {...over} />
    </NextIntlClientProvider>,
  );
const history = () => screen.queryByRole('region', { name: m(`${C}.history`) });
const GRANT = () => screen.queryByRole('button', { name: m(`${C}.grant`) });

describe('Karte „Jahresrechnung“ am Kontakt (Designer 2a)', () => {
  it('legal entity only for organizations (Abnahme 11)', () => {
    show();
    expect(screen.queryByRole('radiogroup', { name: m(`${C}.legalEntity`) })).toBeNull();
    cleanup();
    show({ contactKind: 'organization' });
    expect(within(screen.getByRole('radiogroup', { name: m(`${C}.legalEntity`) })).getAllByRole('radio')).toHaveLength(3);
  });

  it('unknown works like no; yes hides the consent and its history, switching back shows it (Abnahme 10, Review Focus 5)', () => {
    show({ contactKind: 'organization', legalEntity: null });
    expect(GRANT()).toBeTruthy();
    cleanup();
    show({ contactKind: 'organization', legalEntity: 'no' });
    expect(GRANT()).toBeTruthy();
    cleanup();
    show({ contactKind: 'organization', legalEntity: 'yes', consents: [granted, revokedOld] });
    expect(screen.queryByRole('button', { name: m(`${C}.revoke`) })).toBeNull();
    expect(history()).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: m(`${C}.no`) }));
    expect(screen.getByRole('button', { name: m(`${C}.revoke`) })).toBeTruthy();
    expect(history()).not.toBeNull();
  });

  it('the consent dialog speaks of the organization at an organization (Bildabnahme 0.4.5 T-3)', async () => {
    show({ contactKind: 'organization', legalEntity: 'no' });
    fireEvent.click(GRANT()!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Die Organisation willigt ein');
    expect(dialog.textContent).not.toContain('Die Person');
    cleanup();
    show();
    fireEvent.click(GRANT()!);
    expect((await screen.findByRole('dialog')).textContent).toContain('Die Person willigt ein');
  });

  it('latest state and history', () => {
    show({ consents: [granted, revokedOld] });
    expect(screen.getByRole('button', { name: m(`${C}.revoke`) })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'EIN-2026-003' }).getAttribute('href')).toBe('/dms/d3');
    expect(history()!.textContent).toContain('1');
    cleanup();
    show({ consents: [granted] });
    expect(history()).toBeNull();
    cleanup();
    show({ consents: [] });
    expect(GRANT()).toBeTruthy();
  });

  it('effect line only with an effect; named chooses the sentence', () => {
    show({ consents: [granted] });
    expect(screen.queryByTestId('annual-accounts-effect')).toBeNull();
    cleanup();
    show({ consents: [granted], effect: { designation: '2025', amountCents: 120000, sharePermille: 150, named: true } });
    const named = screen.getByTestId('annual-accounts-effect');
    expect(named.dataset.named).toBe('true');
    cleanup();
    show({ effect: { designation: '2025', amountCents: 120000, sharePermille: 150, named: false } });
    expect(screen.getByTestId('annual-accounts-effect').dataset.named).toBe('false');
  });

  it('records a consent with the year as number; a day in the future stands at the field', async () => {
    recordNameConsentAction.mockResolvedValueOnce({ status: 'error', message: 'Nicht gespeichert', fieldErrors: { on: 'Liegt in der Zukunft.' } });
    show();
    fireEvent.click(GRANT()!);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(new RegExp(m(`${C}.dialog.grantedOn`))), { target: { value: '2026-11-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: m('common.save') }));
    await waitFor(() => expect(recordNameConsentAction).toHaveBeenCalledWith({ contactId: 'c1', kind: 'granted', on: '2026-11-01', fromYear: 2025, documentId: null }));
    await waitFor(() => expect(within(dialog).getByLabelText(new RegExp(m(`${C}.dialog.grantedOn`))).getAttribute('aria-invalid')).toBe('true'));
  });
});
