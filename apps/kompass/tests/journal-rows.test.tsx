// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import type { JournalRow } from '@/app/(shell)/finance/entries/journal';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/finance/entries',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/app/(shell)/finance/entries/actions', () => ({
  deleteDraftsAction: vi.fn(),
  finalizeAllReviewedAction: vi.fn(),
  finalizeReviewedAction: vi.fn(),
  setReviewedManyAction: vi.fn(),
}));

const { Journal } = await import('@/app/(shell)/finance/entries/journal');

afterEach(cleanup);

const row = (over: Partial<JournalRow>): JournalRow => ({
  id: 'E1', number: '2026-0008', entryDate: '2026-03-01', text: 'Fehlbuchung Futter mit sehr langem Text', accountLabel: 'Vereinskonto',
  allocationLabel: 'Futter', contactLabel: null, amountCents: -1000, transfer: false, runningBalanceCents: null,
  documentationState: 'voucher', status: 'final', reviewedAt: null, reversedByEntryId: 'E2', reversedByNumber: '2026-0009',
  reversesEntryId: null, reversesNumber: null, correctionOfEntryId: null, correctionOfNumber: null, createdChannel: 'ui', ...over,
});

function show(rows: JournalRow[], accountFilter: { name: string; openingBalanceCents: number | null } | null = null) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <Journal
          rows={rows}
          total={rows.length}
          totals={{ incomeCents: 426200, expenseCents: 10000, resultCents: 416200 }}
          page={1}
          pageSize={50}
          standing={{ finalizedThrough: null, draftCount: 0, reviewedDraftCount: 0 }}
          accounts={[]}
          categories={[]}
          years={[]}
          unfiltered={rows.length}
          canWrite
          canFinalize={false}
          showSetupLink={false}
          filtered={false}
          accountFilter={accountFilter}
          aside={<aside data-testid="aside">Bestände</aside>}
        />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

describe('Journal: Zeilen (Runde 4, 086, 212, 213)', () => {
  it('der Verweis steht in einer eigenen Unterzeile, nicht in der kürzenden Zeile des Texts', () => {
    show([row({})]);
    const refs = screen.getByTestId('journal-row-refs');
    expect(refs.textContent).toBe('zurückgenommen durch 2026-0009\u00a0· Vereinskonto');
    const text = screen.getByText('Fehlbuchung Futter mit sehr langem Text');
    expect(text.className).toMatch(/\btruncate\b/);
    expect(text.contains(refs)).toBe(false);
    expect(refs.className).not.toMatch(/\btruncate\b/);
  });

  it('die Nummer im Verweis bricht nie um (Runde 4 Nachtrag, 213)', () => {
    show([row({ reversesEntryId: 'E0', reversesNumber: '2026-0007' })]);
    for (const number of ['2026-0009', '2026-0007']) {
      const el = screen.getByText(number);
      expect(el.className).toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it('Verweis und Konto teilen sich eine Unterzeile (Runde 4 Nachtrag, 213)', () => {
    show([row({ reversedByEntryId: null, reversedByNumber: null, reversesEntryId: 'E0', reversesNumber: '2026-0008' })]);
    const refs = screen.getByTestId('journal-row-refs');
    const account = screen.getByTestId('journal-row-account');
    expect(account.parentElement).toBe(refs);
    expect(refs.textContent).toBe('nimmt zurück: 2026-0008\u00a0· Vereinskonto');
  });

  it('das Konto steht als Unterzeile unter dem Text, nicht mit Kontofilter', () => {
    show([row({ reversedByEntryId: null, reversedByNumber: null })]);
    expect(screen.getByTestId('journal-row-account').textContent).toBe('Vereinskonto');
    cleanup();
    show([row({})], { name: 'Vereinskonto', openingBalanceCents: 0 });
    expect(screen.queryByTestId('journal-row-account')).toBeNull();
    cleanup();
    show([row({ accountLabel: '—' })]);
    expect(screen.queryByTestId('journal-row-account')).toBeNull();
  });

  it('die Summenzeile setzt Einnahmen · Ausgaben · Ergebnis als eine Gruppe', () => {
    show([row({})]);
    expect(screen.getByTestId('journal-totals').textContent).toMatch(/^Einnahmen .+ · Ausgaben .+ · Ergebnis .+$/);
  });

  it('das Seitenpanel steht unter dem Seitentitel', () => {
    show([row({})]);
    const heading = screen.getByRole('heading', { level: 1 });
    const aside = screen.getByTestId('aside');
    expect(heading.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
