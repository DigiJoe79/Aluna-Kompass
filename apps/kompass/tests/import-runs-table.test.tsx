// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { RunsTable, type RunRow } from '@/app/(shell)/finance/imports/runs-table';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/imports/actions', () => ({ previewDiscardRunAction: vi.fn(), discardRunAction: vi.fn(), setRunClosingBalanceAction: vi.fn() }));
afterEach(cleanup);

const run = (over: Partial<RunRow>): RunRow => ({
  id: 'R1', accountId: 'A1', accountName: 'Importkonto', format: 'camt053', formatName: null,
  periodFrom: '2026-05-01', periodTo: '2026-05-31', openingCents: 100, closingCents: 200,
  counts: { new: 1, known: 0, held: 0 }, gap: null, state: 'finished', failure: null, warnings: [],
  startedAt: '2026-06-01T10:00:00Z', createdByUserName: 'Anna Berger', rawTransactions: [], ...over,
});

function renderTable(runs: RunRow[]) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <RunsTable runs={runs} canDiscard />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

describe('RunsTable (Runde 4, 078, 214)', () => {
  it('Format ist eine Spalte ohne Rolle und steht im aufgeklappten Lauf weiter', () => {
    renderTable([run({})]);
    expect(screen.getByRole('columnheader', { name: 'Format' }).hasAttribute('data-col')).toBe(false);
    expect(screen.getByTestId('import-run-format').hasAttribute('data-col')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Kontoumsätze anzeigen' }));
    expect(screen.getByTestId('import-run-detail-format').textContent).toBe('Format: CAMT.053');
  });

  it('ein verworfener Lauf ist eine gedämpfte Zeile mit Marke am Namen, nicht in der Statusspalte', () => {
    renderTable([run({ state: 'discarded' })]);
    const row = screen.getByTestId('import-run').querySelector('tr')!;
    expect(row.hasAttribute('data-muted')).toBe(true);
    const title = row.querySelector('[data-col="title"]') as HTMLElement;
    expect(within(title).getByText('verworfen')).toBeTruthy();
    expect((row.querySelector('[data-col="status"]') as HTMLElement).textContent).toBe('');
  });

  it('ein fehlgeschlagener Lauf behält seine Marke in der Statusspalte', () => {
    renderTable([run({ state: 'failed', failure: { code: 'parse', line: null } })]);
    const row = screen.getByTestId('import-run').querySelector('tr')!;
    expect(row.hasAttribute('data-muted')).toBe(false);
    expect((row.querySelector('[data-col="status"]') as HTMLElement).textContent).toBe('fehlgeschlagen');
  });

  it('Zähler brechen nur am „·“, nie zwischen Zahl und Wort (Runde 4 Nachtrag, 214, 217)', () => {
    renderTable([run({ counts: { new: 1, known: 0, held: 1 } })]);
    const cell = screen.getByText((_, el) => el?.tagName === 'TD' && /zurückgehalten/.test(el.textContent ?? ''));
    expect(cell.textContent).toBe('1\u00a0neu · 1\u00a0zurückgehalten');
  });
});
