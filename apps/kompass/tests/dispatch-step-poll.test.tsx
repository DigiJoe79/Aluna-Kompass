// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DispatchStep, type DispatchMailRow } from '@/components/dispatch-step';
import messages from '../messages/de.json';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ pending: false }), { status: 200 }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  refresh.mockClear();
});

const row = (state: DispatchMailRow['state']): DispatchMailRow => ({ documentId: 'd1', documentNumber: 'BRF-2026-001', name: 'Kim Beispiel', detail: null, sentAt: null, address: 'kim@example.org', state, outboxId: 'o1', errorText: null, errorCode: null });

function step(state: DispatchMailRow['state']) {
  const noop = async () => ({ status: 'idle' as const });
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DispatchStep mail={[row(state)]} post={[]} done={false} mailState={{ kind: 'redirect', redirectTo: 'umleitung@example.org' }} canSend canMark today="2026-10-18" printHref="/print" documentHref={(id) => `/dms/${id}`} onSendAll={noop} onMark={noop} onResend={noop} onMove={noop} runRef="membersFeeRun:R1" />
    </NextIntlClientProvider>,
  );
}

/** Versand-Schritt der Läufe: derselbe Takt wie die Karte am Dokument, über einen Route Handler. */
describe('DispatchStep fragt den Ausgang nur, solange etwas läuft', () => {
  it('fragt bei „wartet“ nach und erneuert die Seite, sobald nichts mehr läuft', async () => {
    step('queued');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(fetchMock).toHaveBeenCalledWith('/dms/run-mail-status?runRef=membersFeeRun%3AR1', expect.objectContaining({ cache: 'no-store' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('fragt nicht, wenn alles gesendet, nicht zugestellt oder noch nicht eingereiht ist', async () => {
    for (const state of ['sent', 'failed', 'notQueued'] as const) {
      step(state);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      cleanup();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
