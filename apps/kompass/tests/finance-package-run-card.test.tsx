// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PackageRunCard } from '@/app/(shell)/finance/audit/package-run-card';
import { DateFormatProvider } from '@/components/date-format-provider';
import type { AuditPackageView } from '@/lib/finance/audit-package-view';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ startPackageRunAction: vi.fn(), cancelPackageRunAction: vi.fn() }));
vi.mock('@/app/(shell)/finance/audit/actions', () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const RUNNING: AuditPackageView = { state: 'running', runId: 'R1', cancellable: true, steps: [{ key: 'report', state: 'running' }], finishedAt: null, files: [], skipped: {}, canStart: true };
const DONE: AuditPackageView = { ...RUNNING, state: 'success', cancellable: false, steps: [{ key: 'report', state: 'done' }], finishedAt: '2026-10-28T09:00:00.000Z' };

const show = (initial: AuditPackageView) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <PackageRunCard yearId="Y25" initial={initial} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );

describe('Prüfpaket: Stand abfragen (App-B4)', () => {
  it('ein fehlgeschlagener Abruf beendet das Abfragen nicht: danach ist der Lauf fertig', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify(DONE), { status: 200 }));
    show(RUNNING);
    expect(screen.getByRole('button', { name: messages.finance.audit.package.run.cancel })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('button', { name: messages.finance.audit.package.run.cancel })).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
  });

  it('nach dem Verlassen der Seite plant ein laufender Abruf keinen neuen', async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((res) => (answer = res)));
    const { unmount } = show(RUNNING);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    answer(new Response(JSON.stringify(RUNNING), { status: 200 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
