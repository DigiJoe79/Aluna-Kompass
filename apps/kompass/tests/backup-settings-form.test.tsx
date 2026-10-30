// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupSettingsForm } from '@/app/(shell)/admin/backup/backup-settings-form';
import messages from '../messages/de.json';

const { saveSettingsAction } = vi.hoisted(() => ({ saveSettingsAction: vi.fn() }));
vi.mock('@/app/(shell)/admin/settings/actions', () => ({ saveSettingsAction }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);
const VALUES = { enabled: false, time: '03:00', daily: 7, weekly: 4, monthly: 12, maxAgeDays: 30 };
const MB = 1024 * 1024;
const show = (canManage = true) => render(<BackupSettingsForm values={VALUES} referenceBytes={641 * MB} mailAvailable canManage={canManage} />, { wrapper: Intl });

afterEach(() => {
  cleanup();
  saveSettingsAction.mockReset();
});

describe('BackupSettingsForm', () => {
  it('speichert nur, was sich geändert hat', async () => {
    saveSettingsAction.mockResolvedValue({ status: 'success' });
    show();
    fireEvent.click(screen.getByRole('switch', { name: messages.backup.settings.schedule.enabled }));
    fireEvent.input(screen.getByLabelText(messages.backup.settings.schedule.time), { target: { value: '04:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(saveSettingsAction).toHaveBeenCalledWith({ 'backup.schedule.enabled': true, 'backup.schedule.time': '04:00' }));
  });

  it('der Ring-Hinweis folgt den Feldern', () => {
    show();
    expect(screen.getByTestId('backup-retention-hint').textContent).toMatch(/23/);
    fireEvent.input(screen.getByLabelText(messages.backup.settings.ring.dailyLabel), { target: { value: '10' } });
    expect(screen.getByTestId('backup-retention-hint').textContent).toMatch(/26/);
  });

  it('Feldfehler steht am Feld', async () => {
    saveSettingsAction.mockResolvedValue({ status: 'error', message: 'Ungültig', fieldErrors: { 'backup.ring.daily': 'Höchstens 60.' } });
    show();
    fireEvent.input(screen.getByLabelText(messages.backup.settings.ring.dailyLabel), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Höchstens 60.')).toBeTruthy();
    expect(saveSettingsAction).toHaveBeenCalledWith({ 'backup.ring.daily': 50 });
  });

  it('ohne settings.manage keine Speicherleiste, Felder gesperrt', () => {
    const { container } = show(false);
    expect(container.querySelector('[data-slot="form-action-bar"]')).toBeNull();
    expect((screen.getByLabelText(messages.backup.settings.schedule.time) as HTMLInputElement).disabled).toBe(true);
  });
});
