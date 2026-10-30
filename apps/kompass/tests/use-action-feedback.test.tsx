// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import type { ActionState } from '@/lib/actions';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

function deferred() {
  let resolve!: (value: ActionState) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ActionState>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useActionFeedback — pending und In-flight-Sperre', () => {
  it('ein zweiter run während des ersten ruft fn nicht und liefert das Ergebnis des ersten — nie ein „idle“, das ein Aufrufer für Erfolg hielte', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    const first = deferred();
    const fn = vi.fn(() => first.promise);
    let firstRun!: Promise<ActionState>;
    let secondRun!: Promise<ActionState>;
    act(() => {
      firstRun = result.current.run(fn);
      secondRun = result.current.run(fn);
    });
    const refusal: ActionState = { status: 'error', message: 'Abgelehnt.', fieldErrors: { name: 'Pflichtfeld.' } };
    await act(async () => {
      first.resolve(refusal);
      await firstRun;
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await secondRun).toEqual(refusal);
  });

  it('pending ist true während des Aufrufs und danach false; danach geht ein neuer Aufruf durch', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    expect(result.current.pending).toBe(false);
    const first = deferred();
    let running!: Promise<ActionState>;
    act(() => {
      running = result.current.run(() => first.promise);
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      first.resolve({ status: 'success' });
      await running;
    });
    expect(result.current.pending).toBe(false);
    const again = vi.fn(async (): Promise<ActionState> => ({ status: 'success' }));
    await act(async () => {
      await result.current.run(again);
    });
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('nach einem Netzfehler löst sich die Sperre (Toast mit Erneut versuchen bleibt)', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    const first = deferred();
    let running!: Promise<ActionState>;
    act(() => {
      running = result.current.run(() => first.promise, { retry: () => {} });
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      first.reject(new Error('fetch failed'));
      await running;
    });
    expect(result.current.pending).toBe(false);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    const again = vi.fn(async (): Promise<ActionState> => ({ status: 'success' }));
    await act(async () => {
      await result.current.run(again);
    });
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('nach einer Ablehnung löst sich die Sperre und der Zustand hält die Ablehnung', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    const first = deferred();
    let running!: Promise<ActionState>;
    act(() => {
      running = result.current.run(() => first.promise);
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      first.resolve({ status: 'error', message: 'Abgelehnt.', fieldErrors: {} });
      await running;
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.state.status).toBe('error');
  });
});
