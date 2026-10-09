// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

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

/*
 * Die zwei Leerzustände des Journals (Spec Filterleisten § 3, Befund 2). Der Seed hat immer Buchungen, deshalb steht
 * das wirklich leere Journal mit dem Weg zur Einrichtung hier und nicht im E2E.
 */
function show(filtered: boolean, showSetupLink: boolean) {
  return render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <Journal
        rows={[]}
        total={0}
        totals={{ incomeCents: 0, expenseCents: 0, resultCents: 0 }}
        page={1}
        pageSize={50}
        standing={{ finalizedThrough: null, draftCount: 0, reviewedDraftCount: 0 }}
        accounts={[]}
        categories={[]}
        years={[]}
        unfiltered={0}
        canWrite
        canFinalize={false}
        showSetupLink={showSetupLink}
        filtered={filtered}
        accountFilter={null}
      />
    </NextIntlClientProvider>,
  );
}

describe('Journal leer', () => {
  it('ganz leer: „Noch keine Buchung.“ mit „Neue Buchung“ und dem Weg zur Einrichtung', () => {
    show(false, true);
    expect(screen.getByRole('heading', { name: 'Noch keine Buchung.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bankkonten und Kassen einrichten' })).toBeTruthy();
  });

  it('gefiltert leer: Zurücksetzen statt Anlegen und Einrichtung', () => {
    show(true, true);
    expect(screen.getByRole('heading', { name: 'Keine Buchung passt zu diesen Filtern.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Filter zurücksetzen' }).getAttribute('href')).toBe('/finance/entries');
    expect(screen.queryByText('Noch keine Buchung.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Bankkonten und Kassen einrichten' })).toBeNull();
    // „Neue Buchung“ steht nur noch im Seitenkopf, nicht im Leerzustand.
    expect(screen.getAllByRole('link', { name: 'Neue Buchung' })).toHaveLength(1);
  });
});
