// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateFormatProvider } from '@/components/date-format-provider';
import { collectiveLineIds } from '@/lib/finance/donations';
import messages from '../messages/de.json';

const actions = vi.hoisted(() => ({ loadIssueCheckAction: vi.fn(async () => ({ status: 'idle' })), issueConfirmationAction: vi.fn(), saveInKindDetailsAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/finance/donations/actions', () => actions);
vi.mock('@/app/(shell)/dms/search-action', () => ({ searchDocumentsAction: vi.fn(async () => []) }));
const { UncertifiedList } = await import('@/app/(shell)/finance/donations/uncertified-list');
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const line = (lineId: string, entryDate: string, extra: object = {}) => ({ lineId, entryId: `e-${lineId}`, entryNumber: `B-${lineId}`, entryDate, netCents: 1000, incomeKind: 'donation', ...extra });
const group = (lines: ReturnType<typeof line>[]) => ({ contactId: 'c1', contactName: 'Kim Beispiel', contactComplete: true, sumCents: 1000 * lines.length, lines });

describe('collectiveLineIds', () => {
  it('nimmt alle fähigen Geldzeilen, ohne Sachspende, Zukunft und Rückläufer-Warnung', () => {
    expect(
      collectiveLineIds([
        line('a', '2026-03-01'),
        line('b', '2026-04-01'),
        line('sache', '2026-05-01', { incomeKind: 'inKindDonation' }),
        line('morgen', '2026-12-01', { inFuture: true }),
        line('rueck', '2026-06-01', { warnings: ['possibleReturnWithoutOrigin'] }),
        line('entwurf', '2026-07-01', { warnings: ['returnDraftPending'] }),
      ]),
    ).toEqual(['a', 'b']);
  });

  it('bleibt in einem Kalenderjahr, weil der Dienst sonst ablehnt: das älteste mit mindestens zwei Zeilen', () => {
    expect(collectiveLineIds([line('neu1', '2026-03-01'), line('neu2', '2026-04-01'), line('alt1', '2025-03-01'), line('alt2', '2025-04-01')])).toEqual(['alt1', 'alt2']);
    expect(collectiveLineIds([line('neu1', '2026-03-01'), line('neu2', '2026-04-01'), line('alt1', '2025-03-01')])).toEqual(['neu1', 'neu2']);
  });

  it('ist leer unter zwei fähigen Zeilen', () => {
    expect(collectiveLineIds([line('a', '2026-03-01'), line('b', '2026-04-01', { incomeKind: 'inKindDonation' })])).toEqual([]);
    expect(collectiveLineIds([line('a', '2026-03-01'), line('b', '2025-04-01')])).toEqual([]);
  });
});

describe('Noch nicht bestätigt: Sammelbestätigung', () => {
  const show = (groups: ReturnType<typeof group>[], canIssue = true) =>
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DateFormatProvider mode="locale" timeZone="Europe/Berlin">
          <UncertifiedList groups={groups} minCents={null} count={{ shown: groups.length, total: groups.length }} canIssue={canIssue} canDescribe today="2026-10-31" />
        </DateFormatProvider>
      </NextIntlClientProvider>,
    );
  const name = messages.finance.donations.uncertified.issueCollective;

  it('öffnet den Dialog mit allen fähigen Zeilen der Gruppe', async () => {
    show([group([line('a', '2026-03-01'), line('b', '2026-04-01'), line('sache', '2026-05-01', { incomeKind: 'inKindDonation' })])]);
    fireEvent.click(within(screen.getByTestId('uncertified-group')).getByRole('button', { name }));
    await waitFor(() => expect(actions.loadIssueCheckAction).toHaveBeenCalledWith(['a', 'b'], '2026-10-31'));
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: messages.finance.donations.issue.titleCollective })).toBeTruthy();
  });

  it('fehlt bei einer Zeile, ohne Recht und ohne Anschrift', () => {
    show([group([line('a', '2026-03-01')])]);
    expect(screen.queryByRole('button', { name })).toBeNull();
    cleanup();
    show([group([line('a', '2026-03-01'), line('b', '2026-04-01')])], false);
    expect(screen.queryByRole('button', { name })).toBeNull();
    cleanup();
    show([{ ...group([line('a', '2026-03-01'), line('b', '2026-04-01')]), contactComplete: false }]);
    expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
