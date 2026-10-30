// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), usePathname: () => '/finance/reserves' }));
vi.mock('@/app/(shell)/finance/reserves/actions', () => ({}));
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { ReserveTable } = await import('@/app/(shell)/finance/reserves/reserve-table');
afterEach(cleanup);

const row = (over: Record<string, unknown>) => ({
  id: 'R-1', name: 'Freie Rücklage', kind: 'free' as const, balanceCents: 0, purposeId: null, purposeText: null, purposeLabel: null, resolution: null,
  carryForwardCents: null, carryForwardDate: null, carryForwardDocument: null, isActive: true, isDissolved: false, kindLocked: false, updatedAt: 'v1', resolutionRef: null, ...over,
});
const show = (rows: ReturnType<typeof row>[]) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <ReserveTable rows={rows} purposes={[]} fiscalYears={[]} defaultFiscalYearId={null} today="2026-09-05" canWrite={false} canSetup={false} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );

/** G7: Eine Rücklage verweist auf einen Beschluss der Gremien — die Spalte „Beschluss“ verlinkt ihn. */
describe('ReserveTable: Beschluss aus Gremien', () => {
  it('zeigt Beschriftung und Link des Beschlusses, auch ohne Dokument', () => {
    show([row({ resolutionRef: { label: 'Beschluss B-2026-001', href: '/governance/resolutions/R1' } })]);
    const cell = screen.getByTestId('reserve-resolution-ref');
    expect(within(cell).getByRole('link', { name: 'Beschluss B-2026-001' }).getAttribute('href')).toBe('/governance/resolutions/R1');
  });

  it('ohne Link (kein Leserecht) nur die Beschriftung', () => {
    show([row({ resolutionRef: { label: 'Nicht sichtbar', href: null } })]);
    expect(screen.getByTestId('reserve-resolution-ref').textContent).toContain('Nicht sichtbar');
    expect(within(screen.getByTestId('reserve-resolution-ref')).queryByRole('link')).toBeNull();
  });
});
