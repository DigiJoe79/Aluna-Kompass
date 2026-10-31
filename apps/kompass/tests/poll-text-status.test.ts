import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollTextStatus } from '@/lib/poll-text-status';

const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('pollTextStatus', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('erneuert genau einmal, wenn der Stand pending/running verlässt', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { textStatus: 'pending' }))
      .mockResolvedValueOnce(json(200, { textStatus: 'running' }))
      .mockResolvedValue(json(200, { textStatus: 'done' }));
    const onDone = vi.fn();
    const onGiveUp = vi.fn();
    pollTextStatus({ url: '/x', onDone, onGiveUp });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('hört bei 404 und 403 auf, ohne zu erneuern, und meldet das Aufgeben', async () => {
    for (const status of [404, 403]) {
      fetchMock.mockReset().mockResolvedValue(json(status));
      const onDone = vi.fn();
      const onUnauthorized = vi.fn();
      const onGiveUp = vi.fn();
      pollTextStatus({ url: '/x', onDone, onUnauthorized, onGiveUp });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onDone).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(onGiveUp).toHaveBeenCalledTimes(1);
    }
  });

  it('hört bei 401 auf und meldet es einmal', async () => {
    fetchMock.mockResolvedValue(json(401));
    const onUnauthorized = vi.fn();
    const onGiveUp = vi.fn();
    pollTextStatus({ url: '/x', onDone: vi.fn(), onUnauthorized, onGiveUp });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('hört nach fünf Fehlern in Folge auf (Netz und 5xx) und meldet das Aufgeben einmal', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(json(500)).mockRejectedValue(new Error('net'));
    const onDone = vi.fn();
    const onGiveUp = vi.fn();
    pollTextStatus({ url: '/x', onDone, onGiveUp });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onDone).not.toHaveBeenCalled();
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('bricht eine hängende Abfrage nach der Frist ab und zählt sie als Fehler', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('abort')))),
    );
    pollTextStatus({ url: '/x', onDone: vi.fn(), onGiveUp: vi.fn(), maxFailures: 2, timeoutMs: 10_000 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ruft nach dem Beenden nichts mehr auf und ruft nie zwei Abfragen zugleich', async () => {
    fetchMock.mockResolvedValue(json(200, { textStatus: 'pending' }));
    const stop = pollTextStatus({ url: '/x', onDone: vi.fn(), onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reicht jeden gelesenen Stand an onTick, auch den letzten, vor onDone (App-B4)', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { state: 'running', n: 1 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(json(200, { state: 'success', n: 2 }));
    const seen: unknown[] = [];
    const onDone = vi.fn(() => seen.push('done'));
    pollTextStatus({ url: '/x', onDone, onGiveUp: vi.fn(), isPending: (b) => b.state === 'running', onTick: (b) => seen.push(b.n) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen).toEqual([1, 2, 'done']);
  });
});
