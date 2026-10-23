// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupLastResult, BackupRunCard } from '@/app/(shell)/admin/backup/backup-run-card';
import { BackupPageProvider } from '@/app/(shell)/admin/backup/backup-page-provider';
import type { BackupJobView, BackupRecordView, BackupRunView } from '@/lib/backup-job-view';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ startBackupAction: vi.fn(), verifyBackupAction: vi.fn(), cancelBackupJobAction: vi.fn() }));
vi.mock('@/app/(shell)/admin/backup/actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MB = 1024 * 1024;
const EMPTY_LAST: BackupJobView['last'] = { create: null, verify: null, restore: null };
const run = (over: Partial<BackupRunView> = {}): BackupRunView => ({
  runId: 'R1',
  kind: 'create',
  source: 'ui',
  startedAt: '2026-10-23T08:00:00.000Z',
  elapsedMs: 65_000,
  userName: 'Erika Beispiel',
  cancellable: true,
  steps: [],
  meta: {},
  ...over,
});
const record = (over: Partial<BackupRecordView> = {}): BackupRecordView => ({
  runId: 'R0',
  kind: 'create',
  status: 'failed',
  startedAt: '2026-10-23T07:00:00.000Z',
  finishedAt: '2026-10-23T07:05:00.000Z',
  userId: 'U1',
  lastStep: 'files',
  meta: {},
  name: null,
  error: { code: 'x', message: 'Platte voll' },
  ...over,
});
const wrap = (initial: BackupJobView, ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <BackupPageProvider initial={initial}>{ui}</BackupPageProvider>
    </NextIntlClientProvider>,
  );

describe('BackupRunCard', () => {
  it('zeigt die Schritte des Laufs mit Bytes als Zähler und den Abbrechen-Knopf', () => {
    const steps = [
      { key: 'database', state: 'done' as const },
      { key: 'files', state: 'running' as const, done: 312 * MB, total: 641 * MB },
      { key: 'verify', state: 'pending' as const },
      { key: 'prune', state: 'pending' as const },
    ];
    wrap({ running: run({ steps }), last: EMPTY_LAST }, <BackupRunCard lastDurationMs={580_000} />);
    expect(screen.getAllByRole('listitem').map((li) => li.dataset.state)).toEqual(['done', 'running', 'pending', 'pending']);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('49');
    expect(screen.getByText(messages.backup.run.counter.replace('{done}', '312 MB').replace('{total}', '641 MB'))).toBeTruthy();
    expect(screen.getByRole('button', { name: messages.backup.run.cancel })).toBeTruthy();
  });

  it('gesperrt: kein Dialog, der Grund steht daneben', () => {
    wrap({ running: run({ cancellable: false, steps: [{ key: 'prune', state: 'running' }] }), last: EMPTY_LAST }, <BackupRunCard lastDurationMs={null} />);
    const button = screen.getByRole('button', { name: messages.backup.run.cancel });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText(messages.backup.run.cancelLocked)).toBeTruthy();
  });

  it('ohne Lauf nichts', () => {
    const { container } = wrap({ running: null, last: EMPTY_LAST }, <BackupRunCard lastDurationMs={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('BackupLastResult', () => {
  const show = (last: Partial<BackupJobView['last']>, newest: string | null) =>
    wrap({ running: null, last: { ...EMPTY_LAST, ...last } }, <BackupLastResult newestCreatedAt={newest} />).container;

  it('zeigt einen gescheiterten Lauf einer Person mit Grund, Schritt und „Erneut starten“', async () => {
    actions.startBackupAction.mockResolvedValue({ status: 'success', data: { runId: 'R2' } });
    const c = show({ create: record() }, '2026-10-22T01:00:00.000Z');
    expect(c.textContent).toContain(messages.backup.run.status.failed);
    expect(c.textContent).toContain('Platte voll');
    expect(c.textContent).toContain(messages.backup.steps.create.files);
    fireEvent.click(screen.getByRole('button', { name: messages.backup.run.restart }));
    await vi.waitFor(() => expect(actions.startBackupAction).toHaveBeenCalled());
  });

  it('nichts bei nächtlichen Läufen, Erfolg oder wenn ein neueres Backup da ist', () => {
    expect(show({ create: record({ userId: null }) }, null).textContent).toBe('');
    cleanup();
    expect(show({ create: record({ status: 'success' }) }, null).textContent).toBe('');
    cleanup();
    expect(show({ create: record() }, '2026-10-23T07:10:00.000Z').textContent).toBe('');
  });

  it('erneut prüfen nimmt den Namen des Backups', async () => {
    actions.verifyBackupAction.mockResolvedValue({ status: 'success', data: { runId: 'R3' } });
    show({ verify: record({ kind: 'verify', name: 'b1', lastStep: 'verify' }) }, null);
    fireEvent.click(screen.getByRole('button', { name: messages.backup.run.restart }));
    await vi.waitFor(() => expect(actions.verifyBackupAction).toHaveBeenCalledWith('b1'));
  });
});
