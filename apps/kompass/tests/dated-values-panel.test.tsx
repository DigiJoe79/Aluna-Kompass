// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/finance/actions', () => ({ removeDatedValueAction: vi.fn(), setDatedValueAction: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ refresh: vi.fn() }) }));
const { DatedValuesPanel } = await import('@/app/(shell)/admin/finance/dated-values-panel');

afterEach(cleanup);

/** 11-1 B30, 11-1 B31: Sätze und Grenzen als eine Tabelle, je Wert die Herkunft. */
describe('DatedValuesPanel', () => {
  const entries = [
    { key: 'vatStandard', unit: 'percent' as const, entries: [{ validFrom: '2024-01-01', value: 19, source: 'shipped' as const }] },
    { key: 'taxation', unit: 'taxation' as const, entries: [{ validFrom: '2024-01-01', value: 'smallBusiness', source: 'shipped' as const }, { validFrom: '2027-01-01', value: 'regular', source: 'override' as const }] },
  ];
  it('is one table and names the source of each value', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DatedValuesPanel entries={entries} />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByText('Vorgabe').length).toBeGreaterThan(0);
    expect(screen.getByText('Vom Verein überschrieben')).toBeTruthy();
  });
});
