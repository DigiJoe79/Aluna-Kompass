// @vitest-environment jsdom
import type { DashboardLine } from '@kompass/core';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { TileLines } from '@/app/(shell)/dashboard/tile-lines';
import { DateFormatProvider } from '@/components/date-format-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/(shell)/due-actions', () => ({ completeDueAction: async () => ({ status: 'success' }) }));

afterEach(cleanup);

function show(variant: 'list' | 'due' | 'work', lines: DashboardLine[], ns = 'tiles.finance.myExpenses', canComplete = false) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <TileLines ns={ns} lines={lines} canComplete={canComplete} variant={variant} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

describe('TileLines', () => {
  it('zeigt `trailing` getrennt vom Titel', () => {
    show('list', [{ titleKey: 'submitted', values: { number: 'KE-1' }, trailing: '16,00 €', href: '/x' }]);
    const amount = screen.getByTestId('tile-line-trailing');
    expect(amount.textContent).toBe('16,00 €');
    expect(screen.getByTestId('tile-line-title').textContent).not.toContain('16,00');
  });

  it('Liste: jede Zeile mit Ziel ist ein Link; ohne Ziel kein Link (Briefing § 4)', () => {
    show('list', [{ title: 'Rechnung Büromaterial', href: '/dms/1' }, { title: 'Ohne Ziel' }], 'tiles.dms.inbox');
    const link = screen.getByRole('link', { name: 'Rechnung Büromaterial' });
    expect(link.getAttribute('href')).toBe('/dms/1');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('Fällig: die Zeile ist kein Link, der Bezug schon; überfällig im Ton warning', () => {
    show('due', [{ date: '2026-10-16', title: 'Antwort abwarten', overdue: true, link: { label: 'BRF-2026-002', href: '/dms/2' }, action: { kind: 'completeFollowUp', followUpId: 'F1' } }], 'tiles.core.followUps', true);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['BRF-2026-002']);
    expect(screen.getByTestId('tile-line-date').className).toMatch(/\btext-warning\b/);
    expect(screen.getByRole('checkbox', { name: 'Antwort abwarten erledigen' })).toBeTruthy();
  });
});
