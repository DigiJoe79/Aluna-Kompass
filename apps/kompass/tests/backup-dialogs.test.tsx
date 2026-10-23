// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupPageProvider } from '@/app/(shell)/admin/backup/backup-page-provider';
import { PinDialog } from '@/app/(shell)/admin/backup/pin-dialog';
import { RestoreDialog } from '@/app/(shell)/admin/backup/restore-dialog';
import { UploadDialog } from '@/app/(shell)/admin/backup/upload-dialog';
import type { BackupRow } from '@/lib/backup-view';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ restorePreviewAction: vi.fn(), startRestoreAction: vi.fn(), pinBackupAction: vi.fn() }));
vi.mock('@/app/(shell)/admin/backup/actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const MB = 1024 * 1024;
const T = '2026-10-23T01:00:00.000Z';
const ok: BackupRow = {
  name: 'kompass-backup-test-20261023-010000-automatic',
  kind: 'automatic',
  createdAt: T,
  sizeBytes: 641 * MB,
  appVersion: '0.3.2',
  migrationCount: 11,
  counts: { users: 4, auditEntries: 900, mediaAssets: 3, records: { 'dms.documents': 12 } },
  verification: { status: 'passed', at: T },
  pinned: false,
  pinnedLabel: null,
  restorable: true,
  retention: { kind: 'untilNextManual' },
  dropsWhenUnpinned: false,
};
const preview = { name: ok.name, createdAt: T, sizeBytes: ok.sizeBytes, pinnedLabel: null, counts: ok.counts, changesSince: 37, personsSince: 3, estimatedSeconds: 300, restorable: true };

const Wrap = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    <BackupPageProvider initial={{ running: null, last: { create: null, verify: null, restore: null } }}>{children}</BackupPageProvider>
  </NextIntlClientProvider>
);

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('RestoreDialog', () => {
  const show = (row: BackupRow = ok) => render(<RestoreDialog row={row} environmentName="test" appVersion="0.3.2" appMigrationCount={11} onClose={() => {}} />, { wrapper: Wrap });

  it('Fokus im Feld, gesperrt bis zum Umgebungsnamen, Ablehnung bleibt im Dialog', async () => {
    actions.restorePreviewAction.mockResolvedValue({ status: 'success', data: { ...preview, changesSince: 0 } });
    actions.startRestoreAction.mockResolvedValueOnce({ status: 'error', message: 'Gerade läuft …', fieldErrors: {} });
    show();
    const field = await screen.findByLabelText(messages.backup.restore.confirmLabel);
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    const button = screen.getByRole('button', { name: messages.backup.restore.confirm });
    expect((button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.change(field, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: messages.backup.restore.confirm }));
    expect(await screen.findByText('Gerade läuft …')).toBeTruthy();
    expect(actions.startRestoreAction).toHaveBeenCalledWith({ name: ok.name, confirmation: 'test' });
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('gestartet → /maintenance', async () => {
    actions.restorePreviewAction.mockResolvedValue({ status: 'success', data: preview });
    actions.startRestoreAction.mockResolvedValueOnce({ status: 'success', data: { runId: 'restore-1' } });
    show();
    fireEvent.change(await screen.findByLabelText(messages.backup.restore.confirmLabel), { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: messages.backup.restore.confirm }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/maintenance'));
  });

  it('ohne Änderungen seit dem Backup keine Verlust-Zeile; älteres Backup mit Hinweis', async () => {
    actions.restorePreviewAction.mockResolvedValue({ status: 'success', data: preview });
    show();
    await screen.findByLabelText(messages.backup.restore.confirmLabel);
    const withChanges = screen.getAllByRole('listitem').length;
    expect(screen.queryByText(/Aus Kompass 0\.3\.1/)).toBeNull();
    cleanup();
    actions.restorePreviewAction.mockResolvedValue({ status: 'success', data: { ...preview, changesSince: 0 } });
    show({ ...ok, appVersion: '0.3.1', migrationCount: 10 });
    await screen.findByLabelText(messages.backup.restore.confirmLabel);
    expect(screen.getAllByRole('listitem').length).toBe(withChanges - 1);
    expect(screen.getByText(/Aus Kompass 0\.3\.1/)).toBeTruthy();
  });

  it('Vorschau abgelehnt: der Grund steht im Dialog', async () => {
    actions.restorePreviewAction.mockResolvedValue({ status: 'error', message: 'Keine Rechte', fieldErrors: {} });
    show();
    expect(await screen.findByText('Keine Rechte')).toBeTruthy();
  });
});

class FakeXHR {
  static last: FakeXHR | null = null;
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  abort = vi.fn(() => this.onabort?.());
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  constructor() {
    FakeXHR.last = this;
  }
}

describe('UploadDialog', () => {
  const show = () => render(<UploadDialog onClose={onClose} onRestore={onRestore} xhr={() => new FakeXHR() as unknown as XMLHttpRequest} />, { wrapper: Wrap });
  const onClose = vi.fn();
  const onRestore = vi.fn();
  const pick = () => fireEvent.change(screen.getByLabelText(messages.backup.upload.file), { target: { files: [new File(['x'.repeat(10)], 'b.tar')] } });

  it('leer: der Einleitungssatz steht einmal, die Fläche nennt nur das Format', () => {
    show();
    expect(screen.getAllByText(messages.backup.upload.text)).toHaveLength(1);
    expect(screen.getByText(messages.backup.upload.fileHint)).toBeTruthy();
  });

  it('Abbrechen bricht die Übertragung ab, ohne refresh', () => {
    show();
    pick();
    const xhr = FakeXHR.last!;
    expect(xhr.open).toHaveBeenCalledWith('POST', '/admin/backup/upload');
    xhr.upload.onprogress?.({ loaded: 5, total: 10, lengthComputable: true });
    fireEvent.click(screen.getByRole('button', { name: messages.common.cancel }));
    expect(xhr.abort).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('422 zeigt die Ablehnung im Dialog, kein Toast', async () => {
    show();
    pick();
    const xhr = FakeXHR.last!;
    xhr.status = 422;
    xhr.responseText = JSON.stringify({ error: 'backupFormatUnsupported' });
    xhr.onload?.();
    expect(await screen.findByText(/kein Kompass-Backup oder ein altes Format/)).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('200: geprüft, Liste erneuert, „Einspielen …“ öffnet den Dialog für die Datei', async () => {
    show();
    pick();
    const xhr = FakeXHR.last!;
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ name: 'up1', manifest: { createdAt: T, environment: 'production', appVersion: '0.3.2' } });
    xhr.onload?.();
    const done = await screen.findByText(/Hochgeladen und geprüft/);
    expect(router.refresh).toHaveBeenCalled();
    // Designer 3b: Haken vor dem Satz, Einleitung weg; nichts mehr abzubrechen — „Schließen“, „Einspielen …“ outline.
    expect(done.closest('p')?.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText(messages.backup.upload.text)).toBeNull();
    expect(screen.queryByRole('button', { name: messages.common.cancel })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: messages.common.close }).find((b) => b.textContent === messages.common.close)!);
    expect(onClose).toHaveBeenCalled();
    const restore = screen.getByRole('button', { name: messages.backup.upload.restore });
    expect(restore.className).not.toContain('bg-brand');
    expect(restore.className).toContain('bg-surface');
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledWith('up1');
  });
});

describe('PinDialog', () => {
  it('Zähler erst ab 50 Zeichen, Speichern ruft pinBackupAction mit Name', async () => {
    actions.pinBackupAction.mockResolvedValue({ status: 'success', data: {} });
    const onClose = vi.fn();
    render(<PinDialog row={ok} mode="pin" pinnedCount={1} pinnedMax={3} onClose={onClose} />, { wrapper: Wrap });
    const field = screen.getByLabelText(messages.backup.pin.label);
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: 'x'.repeat(49) } });
    expect(screen.queryByText('49 von 60')).toBeNull();
    fireEvent.change(field, { target: { value: 'Jahresabschluss 2025'.padEnd(50, '.') } });
    expect(screen.getByText('50 von 60')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'Jahresabschluss 2025' } });
    fireEvent.click(screen.getByRole('button', { name: messages.backup.pin.save }));
    await vi.waitFor(() => expect(actions.pinBackupAction).toHaveBeenCalledWith({ name: ok.name, label: 'Jahresabschluss 2025' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
