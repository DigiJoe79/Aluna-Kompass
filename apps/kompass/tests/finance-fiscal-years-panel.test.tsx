// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ createFirstFiscalYearAction: vi.fn(), updateFiscalYearAction: vi.fn() }));
const { FiscalYearsPanel } = await import('@/app/(shell)/admin/finance/fiscal-years-panel');
afterEach(cleanup);

const year = (designation: string, status: 'open' | 'closed') => ({
  id: designation,
  expectedVersion: '1',
  designation,
  startsOn: `${designation}-01-01`,
  endsOn: `${designation}-12-31`,
  status,
  taxReturnFiledOn: null,
  isShortYear: false,
});

/** Runde 3, 170: Ein offenes Geschäftsjahr ist der Normalfall ohne Marke, ein abgeschlossenes eine gedämpfte Zeile. */
describe('FiscalYearsPanel', () => {
  it('kein grünes „Offen“, „abgeschlossen“ als gedämpfte Zeile mit Marke', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <FiscalYearsPanel years={[year('2025', 'closed'), year('2026', 'open')]} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText('Offen')).toBeNull();
    const closed = screen.getByRole('row', { name: /2025/ });
    expect(closed.textContent).toContain('abgeschlossen');
    expect(closed.getAttribute('data-muted')).not.toBeNull();
    expect(screen.getByRole('row', { name: /2026/ }).getAttribute('data-muted')).toBeNull();
  });
});
