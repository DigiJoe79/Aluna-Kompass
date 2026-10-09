// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportCard } from '@/app/(shell)/admin/backup/import-card';
import { ImportForm } from '@/app/setup/import/import-form';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/backup/actions', () => ({ importBackupAction: vi.fn(), inspectBackupAction: vi.fn() }));
vi.mock('@/app/setup/import/actions', () => ({ importForSetupAction: vi.fn() }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Beide Wege, ein Backup einzuspielen, wählen die Datei über die Ablagefläche statt über das rohe Feld („Choose Files“). */
describe.each([
  ['backup import card', () => <ImportCard environmentName="test" />],
  ['setup import form', () => <ImportForm />],
])('%s', (_, ui) => {
  it('picks the archive through the drop zone, the raw file input stays out of sight', () => {
    render(ui(), { wrapper: Intl });
    const input = screen.getByLabelText('Backup-Datei');
    expect(input.getAttribute('type')).toBe('file');
    expect(input.className).toContain('sr-only');
    expect(screen.getByText('Datei hierher ziehen')).toBeTruthy();
    expect(screen.getByText(messages.backup.import.fileHint)).toBeTruthy();
  });
});

describe('setup import form', () => {
  it('shows when the archive was made as a date, not as a raw timestamp', async () => {
    const manifest = { environment: 'production', createdAt: '2026-10-07T18:30:00.000Z', counts: { users: 2, documents: 5, mediaAssets: 9 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ handle: 'h1', manifest }), { status: 200 })));
    render(<ImportForm />, { wrapper: Intl });
    fireEvent.change(screen.getByLabelText('Backup-Datei'), { target: { files: [new File(['x'], 'kompass.tar.gz')] } });
    expect(await screen.findByText('07.10.2026, 20:30')).toBeTruthy();
    expect(screen.queryByText(manifest.createdAt)).toBeNull();
  });
});
