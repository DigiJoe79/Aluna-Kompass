// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaxAgeSettings } from '@/app/(shell)/admin/backup/max-age-settings';
import { RetentionSettings } from '@/app/(shell)/admin/retention/retention-settings';
import messages from '../messages/de.json';

const saveSettingsAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(shell)/admin/settings/actions', () => ({ saveSettingsAction }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  saveSettingsAction.mockReset();
});

/** K10 Charge 2, T3.3: Aufbewahrung und Backup-Alter speichern über die FormActionBar, nicht über eine eigene Zeile. */
describe.each([
  ['Aufbewahrung', () => <RetentionSettings statutory10Y={120} statutory8Y={96} statutory6Y={72} consent={24} canManage />, messages.retention.settings.consent],
  ['Backup-Alter', () => <MaxAgeSettings maxAgeDays={7} canManage />, messages.backup.settings.maxAgeDays],
])('%s', (_, ui, label) => {
  it('zählt eine Änderung in der Leiste', () => {
    render(ui(), { wrapper: Intl });
    expect(screen.queryByText(/1 Änderung/)).toBeNull();
    fireEvent.input(screen.getByLabelText(label), { target: { value: '30' } });
    expect(screen.getByText(/1 Änderung/)).toBeTruthy();
  });

  it('zeigt eine Ablehnung des Dienstes in der Leiste', async () => {
    saveSettingsAction.mockResolvedValue({ status: 'error', message: 'Dafür fehlt das Recht.', fieldErrors: {} });
    const { container } = render(ui(), { wrapper: Intl });
    fireEvent.input(screen.getByLabelText(label), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const bar = container.querySelector('[data-slot="form-action-bar"]')!;
    await waitFor(() => expect(bar.querySelector('[role="alert"]')?.textContent).toContain('Dafür fehlt das Recht.'));
    expect(screen.getAllByText('Dafür fehlt das Recht.')).toHaveLength(1);
  });

  it('ohne Recht keine Leiste', () => {
    const view = ui();
    render({ ...view, props: { ...view.props, canManage: false } }, { wrapper: Intl });
    expect(container().querySelector('[data-slot="form-action-bar"]')).toBeNull();
  });
});

const container = () => document.body;
