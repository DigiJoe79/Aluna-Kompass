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
        />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
}

describe('Journal: Kontozeile', () => {
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

});
