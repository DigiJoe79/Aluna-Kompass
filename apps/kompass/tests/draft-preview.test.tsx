// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftPreview } from '@/app/(shell)/dms/new/draft-preview';
import { DateFormatProvider } from '@/components/date-format-provider';
import messages from '../messages/de.json';

afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">{children}</DateFormatProvider>
    </NextIntlClientProvider>
  );
}

/** K10 Charge 2 (Designer 2026-10-08): Die Leiste zeigt nur den Zustand; Wiederholen steht im Inhalt der Vorschau. */
describe('DraftPreview', () => {
  it('fehlgeschlagen: Marke in der Leiste, Wiederholen im Inhalt', () => {
    const onRetry = vi.fn();
    render(<DraftPreview status="error" onRetry={onRetry} />, { wrapper: Wrapper });
    const bar = screen.getByTestId('preview-bar');
    expect(bar.textContent).toContain('Vorschau konnte nicht erzeugt werden');
    const retry = screen.getByRole('button', { name: 'Erneut versuchen' });
    expect(bar.contains(retry)).toBe(false);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('veraltet: kein Wiederholen', () => {
    render(<DraftPreview status="stale" savedAt={new Date('2026-08-01T10:00:00Z')} onRetry={vi.fn()} />, { wrapper: Wrapper });
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });
});
