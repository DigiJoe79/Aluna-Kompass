// @vitest-environment jsdom
import type { BackupOverview } from '@kompass/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupList } from '@/app/(shell)/admin/backup/backup-list';
import { BackupPageProvider } from '@/app/(shell)/admin/backup/backup-page-provider';
import { toBackupRow, type BackupRow } from '@/lib/backup-view';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ pinBackupAction: vi.fn(), unpinBackupAction: vi.fn(), verifyBackupAction: vi.fn() }));
vi.mock('@/app/(shell)/admin/backup/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const MB = 1024 * 1024;
const T = '2026-10-22T01:00:00.000Z';
const base: BackupOverview['items'][number] = {
  version: 1,
  name: 'x',
  kind: 'automatic',
  createdAt: T,
  sizeBytes: 641 * MB,
  sha256: null,
  manifest: { format: 3, appVersion: '0.3.2', createdAt: T, environment: 'test', migrationCount: 11, counts: { users: 1, auditEntries: 1, mediaAssets: 0, records: {} }, files: [] },
  verification: { status: 'passed', at: T },
  pinned: false,
  pinnedLabel: null,
  hasSidecar: true,
  restorable: true,
  retention: { kind: 'untilNextManual' },
};
const row = (name: string, patch: Partial<BackupOverview['items'][number]> = {}): BackupRow => toBackupRow({ ...base, name: `kompass-backup-test-${name}`, ...patch });
const ok = row('ok');
const kaputt = row('kaputt', { verification: { status: 'failed', at: T, reason: 'backupCorrupt' }, restorable: false });
const fest = row('fest', { pinned: true, pinnedLabel: 'Jahresabschluss 2025', retention: { kind: 'pinned' } });
const ROWS = [ok, kaputt, fest];

const show = (opts: { rows?: BackupRow[]; shown?: BackupRow[]; total?: number; canImport?: boolean } = {}) => {
  const rows = opts.rows ?? ROWS;
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <BackupPageProvider initial={{ running: null, last: { create: null, verify: null, restore: null } }}>
        <BackupList
          rows={rows}
          shown={opts.shown ?? rows}
          hidden={{ weekly: 2, monthly: 1, other: 0 }}
          total={opts.total ?? rows.length}
          storage={{ usedBytes: 2000 * MB, freeBytes: 900 * MB, totalBytes: 10_000 * MB, referenceBytes: 641 * MB, low: true }}
          pinnedMax={3}
          canImport={opts.canImport ?? true}
          canAudit
          appMigrationCount={11}
        />
      </BackupPageProvider>
    </NextIntlClientProvider>,
  );
};
const rowOf = (name: string) => document.querySelector(`tr[data-backup="kompass-backup-test-${name}"]`) as HTMLElement;
const openMenu = (name: string) => {
  const trigger = within(rowOf(name)).getByRole('button');
  fireEvent.click(trigger);
  return screen.getAllByRole('menuitem');
};

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

describe('BackupList', () => {
  it('geprüft ohne Marke, gescheitert mit Marke und Grund, festgehalten in Bleibt, Name als zweite Zeile', () => {
    show();
    expect(within(rowOf('ok')).queryByText(messages.backup.list.checkFailed)).toBeNull();
    expect(within(rowOf('kaputt')).getByText(messages.backup.list.checkFailed)).toBeTruthy();
    expect(within(rowOf('kaputt')).getByText(messages.backup.reasons.backupCorrupt)).toBeTruthy();
    expect(within(rowOf('fest')).getByText('Jahresabschluss 2025')).toBeTruthy();
    expect(within(rowOf('fest')).getByText(messages.backup.list.keep.pinned)).toBeTruthy();
  });

  it('Kartenzeile (Designer 2a): Version als meta mit „Kompass“, Bleibt als eigene Zeile mit „bleibt“', () => {
    show();
    const cells = [...rowOf('ok').querySelectorAll('td')];
    const meta = cells.filter((c) => c.dataset.col === 'meta');
    expect(meta.map((c) => c.textContent)).toEqual(['automatisch', '641 MB', 'Kompass\u00a00.3.2', 'bleibt\u00a0bis zum nächsten von Hand']);
    // Die Wörter „Kompass“ und „bleibt“ stehen nur in der Kartenzeile, am Desktop sagt es der Spaltenkopf.
    expect(meta[2]!.querySelector('.md\\:hidden')?.textContent).toBe('Kompass\u00a0');
    expect(meta[3]!.dataset.wrap).toBe('');
    expect(meta[3]!.querySelector('.md\\:hidden')?.textContent).toBe('bleibt\u00a0');
    // Festgehalten ist eine Marke, ohne „bleibt“ davor.
    expect(within(rowOf('fest')).queryByText('bleibt', { exact: false })).toBeNull();
  });

  it('Menü: Einspielen zuerst, Löschen zuletzt, gesperrte Einträge nennen den Grund', async () => {
    show();
    const items = openMenu('kaputt');
    expect(items[0]!.textContent).toContain(messages.backup.menu.restore);
    expect(items.at(-1)!.textContent).toContain(messages.backup.menu.delete);
    expect(items[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(messages.backup.menu.reasons.failed)).toBeTruthy();
  });

  it('ohne backup.import keine Einträge Einspielen und Löschen', () => {
    show({ canImport: false });
    const labels = openMenu('ok').map((i) => i.textContent ?? '');
    expect(labels.some((l) => l.includes(messages.backup.menu.restore))).toBe(false);
    expect(labels.some((l) => l.includes(messages.backup.menu.delete))).toBe(false);
  });

  it('Fuß: „Alle n anzeigen“ führt auf ?all=1 und fehlt, wenn alles sichtbar ist', () => {
    show({ shown: [ok], total: 3 });
    const link = screen.getByRole('link', { name: messages.backup.list.showAll.replace('{total}', '3') });
    expect(link.getAttribute('href')).toBe('/admin/backup?all=1');
    cleanup();
    show();
    expect(screen.queryByTestId('backup-list-truncated')).toBeNull();
    expect(screen.getByTestId('backup-list-footer')).toBeTruthy(); // Speicherzeile bleibt
  });

  it('Herunterladen ruft die Datei-Route und zeigt einen Toast', () => {
    show();
    const download = openMenu('ok').find((i) => i.textContent?.startsWith(messages.backup.menu.download.split(' ·')[0]!))!;
    fireEvent.click(download);
    expect(assign).toHaveBeenCalledWith('/admin/backup/files/kompass-backup-test-ok');
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('Freigeben ohne Folgen: sofort, mit Rückgängig', async () => {
    actions.unpinBackupAction.mockResolvedValue({ status: 'success', data: {} });
    show();
    const unpin = openMenu('fest').find((i) => i.textContent === messages.backup.menu.unpin)!;
    fireEvent.click(unpin);
    await vi.waitFor(() => expect(actions.unpinBackupAction).toHaveBeenCalledWith('kompass-backup-test-fest'));
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalled());
  });
});
