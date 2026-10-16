// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { TileLines } from '@/app/(shell)/dashboard/tile-lines';
import { DateFormatProvider } from '@/components/date-format-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/(shell)/due-actions', () => ({ completeDueAction: async () => ({ status: 'success' }) }));

afterEach(cleanup);

// Betrag rechts in der Kachelzeile (Designer Stufe 2 Nr. 1, Joe 2026-10-16): `trailing` rechtsbündig, Ziffern gleich breit.
describe('TileLines', () => {
  it('zeigt `trailing` rechts mit tabular-nums, ohne eigene Marke', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
          <TileLines ns="tiles.finance.myExpenses" lines={[{ titleKey: 'submitted', values: { number: 'KE-1' }, trailing: '16,00 €', href: '/x' }]} canComplete={false} />
        </DateFormatProvider>
      </NextIntlClientProvider>,
    );
    const amount = screen.getByTestId('tile-line-trailing');
    expect(amount.textContent).toBe('16,00 €');
    expect(amount.className.split(/\s+/)).toEqual(expect.arrayContaining(['tabular-nums', 'ml-auto']));
    expect(screen.getByTestId('tile-line-title').textContent).not.toContain('16,00');
  });
});

describe('Kachelnamen (Designer Stufe 2 Nr. 15)', () => {
  it('Kern „Einrichtung“, Finanzen „Finanzen einrichten“', () => {
    expect(messages.dashboard.tiles.core.setup.title).toBe('Einrichtung');
    expect(messages.dashboard.tiles.finance.setupIncomplete.title).toBe('Finanzen einrichten');
  });
});
