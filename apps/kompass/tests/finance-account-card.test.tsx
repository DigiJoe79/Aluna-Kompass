// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { DateFormatProvider } from '@/components/date-format-provider';
import { AccountCard, type AccountCardData } from '@/components/finance/account-card';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
afterEach(cleanup);

const card = (daysAgo: number): AccountCardData => ({
  accountId: 'A1', name: 'Girokonto', kind: 'bank', iban: null, balanceCents: 0, withReviewedCents: 0, lastCount: null,
  statement: { importedThrough: '2026-09-01', lastStatementDaysAgo: daysAgo, lastStatementInFuture: false, warnDays: 35, reconciliation: null },
});

function renderCard(daysAgo: number) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
        <AccountCard account={card(daysAgo)} />
      </DateFormatProvider>
    </NextIntlClientProvider>,
  );
  return screen.getByText(/zuletzt vor/);
}

/** Runde 3, 096: „zuletzt vor … Tagen“ wird erst ab `finance.lastStatementWarnDays` ocker, darunter gedämpft. */
describe('AccountCard: Alter des letzten Auszugs', () => {
  it('ist unter der Grenze gedämpft', () => {
    expect(renderCard(34).className).toContain('text-muted-ink');
  });
  it('ist ab der Grenze ocker', () => {
    expect(renderCard(35).className).toContain('text-warning');
  });
});

/** Joe 2026-10-17: Eine Kasse steht in „Konten“ und in „Kassen“; ihre Karte führt deshalb auf die Kassenseite. */
describe('AccountCard: Ziel der Karte', () => {
  function renderKind(kind: AccountCardData['kind']) {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
          <AccountCard account={{ accountId: 'K1', name: 'Konto', kind, iban: null, balanceCents: 0, withReviewedCents: 0, lastCount: null, statement: null }} />
        </DateFormatProvider>
      </NextIntlClientProvider>,
    );
    screen.getByRole('link').click();
    return push.mock.calls.at(-1)?.[0];
  }

  it('eine Kasse öffnet die Kassenseite mit dieser Kasse', () => {
    expect(renderKind('cash')).toBe('/finance/cash?account=K1');
  });

  it('ein Bankkonto öffnet das Journal, gefiltert auf das Konto', () => {
    expect(renderKind('bank')).toBe('/finance/entries?account=K1');
  });
});
