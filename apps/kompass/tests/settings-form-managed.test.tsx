// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/settings/actions', () => ({ saveSettingsAction: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/settings', useSearchParams: () => new URLSearchParams() }));
const { SettingsForm } = await import('@/app/(shell)/admin/settings/settings-form');

afterEach(cleanup);

const show = (panel: 'bank' | 'organization', managed: string[]) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SettingsForm initial={{ 'organization.name': 'Verein', 'organization.country': 'DE', 'organization.timeZone': 'Europe/Berlin' }} themes={[]} lastSaved={null} managed={managed} panel={panel} />
    </NextIntlClientProvider>,
  );

/** 11-1 B18: Ein Reiter nur mit geführten Feldern hat keine Speicherleiste. */
describe('SettingsForm', () => {
  it('zeigt keine Leiste, wenn alle Felder des Reiters geführt sind', () => {
    show('bank', ['organization.iban', 'organization.bic', 'organization.bankName']);
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });
  it('zeigt die Leiste auf einem Reiter mit eigenen Feldern', () => {
    show('organization', ['organization.iban']);
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
    // 11-1 B19: Land als Auswahl mit Klarnamen.
    expect((screen.getByLabelText('Land') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Deutschland');
  });
});

describe('SettingsForm mit Änderungen aus einem anderen Reiter', () => {
  it('behält die Leiste auf einem geführten Reiter, solange etwas offen ist', () => {
    const { rerender } = show('organization', ['organization.iban', 'organization.bic', 'organization.bankName']);
    const input = screen.getByLabelText('Vereinsname') as HTMLInputElement;
    // Änderung im Reiter Verein, dann Wechsel auf Bank (alle Felder geführt).
    fireEvent.change(input, { target: { value: 'Neu' } });
    rerender(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SettingsForm initial={{ 'organization.name': 'Verein', 'organization.country': 'DE', 'organization.timeZone': 'Europe/Berlin' }} themes={[]} lastSaved={null} managed={['organization.iban', 'organization.bic', 'organization.bankName']} panel="bank" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeTruthy();
  });
});
