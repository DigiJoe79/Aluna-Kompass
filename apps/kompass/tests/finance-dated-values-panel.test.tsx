// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/admin/finance/actions', () => ({ removeDatedValueAction: vi.fn(), setDatedValueAction: vi.fn() }));
const { DatedValuesPanel } = await import('@/app/(shell)/admin/finance/dated-values-panel');
afterEach(cleanup);

/** Runde 3, 171: „Warnmarke 80 %“ sagt in einer Unterzeile, wovon 80 %. */
describe('DatedValuesPanel', () => {
  it('erklärt die Warnmarke unter dem Namen', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DatedValuesPanel entries={[{ key: 'warnAtPercent', unit: 'percent', entries: [{ validFrom: '2020-01-01', value: 80, source: 'shipped' }] }]} />
      </NextIntlClientProvider>,
    );
    const row = screen.getByTestId('dated-value-row');
    expect(row.textContent).toContain('Warnmarke');
    expect(row.textContent).toContain('Anteil einer Grenze');
  });
});
