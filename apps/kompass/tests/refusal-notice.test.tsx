// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RefusalNotice', () => {
  it('zeigt Titel, Grund und Auswege als role=alert', () => {
    render(<RefusalNotice state={{ status: 'error', message: 'Konto ist gesperrt.', fieldErrors: {}, remedies: [{ label: 'Zum Konto', href: '/x' }] }} />, { wrapper });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Nicht gespeichert')).toBeTruthy();
    expect(within(alert).getByText('Konto ist gesperrt.')).toBeTruthy();
    expect(within(alert).getByRole('link', { name: /Zum Konto/ }).getAttribute('href')).toBe('/x');
  });
  it('zeigt nichts bei Feldfehlern (die stehen am Feld) und nichts bei idle', () => {
    const { container } = render(<><RefusalNotice state={{ status: 'idle' }} /><RefusalNotice state={{ status: 'error', message: 'x', fieldErrors: { a: 'b' } }} /></>, { wrapper });
    expect(container.innerHTML).toBe('');
  });
  it('nimmt „Nicht möglich“ für Aktionen, die nichts speichern', () => {
    render(<RefusalNotice action state={{ status: 'error', message: 'Zeitraum ist geschlossen.', fieldErrors: {} }} />, { wrapper });
    expect(screen.getByText('Nicht möglich')).toBeTruthy();
  });
});

describe('useActionFeedback', () => {
  it('hält eine Ablehnung im Zustand und räumt sie beim nächsten Absenden zuerst ab', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    await act(async () => { await result.current.run(async () => ({ status: 'error', message: 'Nein.', fieldErrors: {} })); });
    expect(result.current.state.status).toBe('error');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.run(async () => { await gate; return { status: 'success' as const }; }); });
    expect(result.current.state.status).toBe('idle');
    await act(async () => { release(); await pending; });
    expect(toastMock.error).not.toHaveBeenCalled();
  });
  it('leitet Netzprobleme in einen Toast ohne Zeitlimit und lässt den Zustand leer', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    const retry = vi.fn();
    await act(async () => { await result.current.run(async () => { throw new Error('weg'); }, { retry }); });
    expect(result.current.state.status).toBe('idle');
    const [message, options] = toastMock.error.mock.calls[0]!;
    expect(message).toContain('Verbindung');
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe('Erneut versuchen');
  });
  it('zeigt Erfolgstexte als Toast', async () => {
    const { result } = renderHook(() => useActionFeedback(), { wrapper });
    await act(async () => { await result.current.run(async () => ({ status: 'success', message: 'Gespeichert.' })); });
    expect(toastMock.success).toHaveBeenCalledWith('Gespeichert.');
  });
});
