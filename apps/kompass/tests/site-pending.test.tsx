// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { PendingPublishLine, PendingPublishNote, PendingVariablesLine } from '@/components/site/pending-publish';
import { pendingVariableNames } from '@/lib/site-job-view';
import { SiteJobIndicator } from '@/components/site/site-job-indicator';
import { SiteJobContext, type SiteJobStatus } from '@/components/site/site-job-provider';

const items = [
  { key: 'a', kind: 'changed' as const, label: 'Bruno', href: '/animals/A1', recordHref: '/animals/A1' },
  { key: 'b', kind: 'removed' as const, label: 'Kira', href: null, recordHref: '/animals/A2' },
  { key: 'c', kind: 'added' as const, label: 'Nala', href: '/animals/A3', recordHref: '/animals/A3' },
  { key: 'd', kind: 'changed' as const, label: 'Sommerfest 2026', href: '/site/c/news/E1', recordHref: '/site/c/news/E1' },
  { key: 'e', kind: 'changed' as const, label: 'Claim', href: '/site/variables', recordHref: '/site/variables' },
];
const value = (count: number): SiteJobStatus => ({
  enabled: true,
  running: null,
  last: null,
  pending: { since: '2026-09-28T08:00:00.000Z', count, items: count ? items : [], hrefs: count ? items.map((i) => i.recordHref) : [], variables: count ? ['Claim'] : [] },
  track: () => {},
  refresh: () => {},
});
const wrap =
  (status: SiteJobStatus) =>
  ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SiteJobContext.Provider value={status}>{children}</SiteJobContext.Provider>
    </NextIntlClientProvider>
  );
afterEach(cleanup);

describe('pending indicator menu (Board 8a)', () => {
  it('opens a menu with the first five names, their kind, and the way to publish', async () => {
    render(<SiteJobIndicator />, { wrapper: wrap(value(7)) });
    fireEvent.click(screen.getByTestId('site-pending-menu'));
    expect(await screen.findByRole('menuitem', { name: 'Nala (neu)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Nala (neu)' }).getAttribute('href')).toBe('/animals/A3');
    // Von der Webseite genommen: ohne eigenen Link, der Eintrag führt zum Publizieren.
    expect(screen.getByRole('menuitem', { name: 'Kira (von der Webseite genommen)' }).getAttribute('href')).toBe('/site/publish');
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    expect(screen.getByRole('menuitem', { name: 'Zum Publizieren' }).getAttribute('href')).toBe('/site/publish');
  });
});

describe('PendingPublishNote and PendingPublishLine (Board 8b/8c)', () => {
  it('says how many changes are not on the website and links to publishing', () => {
    render(<PendingPublishNote />, { wrapper: wrap(value(7)) });
    expect(screen.getByText('7 Änderungen sind noch nicht auf der Webseite.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zum Publizieren' }).getAttribute('href')).toBe('/site/publish');
  });
  it('is silent at zero and without provider', () => {
    const { container } = render(<PendingPublishNote />, { wrapper: wrap(value(0)) });
    expect(container.textContent).toBe('');
    cleanup();
    const bare = render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <PendingPublishNote />
        <PendingPublishLine href="/animals/A1" />
      </NextIntlClientProvider>,
    );
    expect(bare.container.textContent).toBe('');
  });
  it('marks a record that is in the list, and only that one — also one taken off the website', () => {
    render(
      <>
        <PendingPublishLine href="/animals/A1" />
        <PendingPublishLine href="/animals/A2" />
        <PendingPublishLine href="/animals/ZZ" />
      </>,
      { wrapper: wrap(value(7)) },
    );
    expect(screen.getAllByText('Änderung noch nicht publiziert')).toHaveLength(2);
  });
  it('links to publishing with the same words as the header and the note (Designer 2026-10-10)', () => {
    render(<PendingPublishLine href="/site/c/news/E1" />, { wrapper: wrap(value(7)) });
    const line = screen.getByTestId('site-pending-line');
    expect(line.textContent).toBe('Änderung noch nicht publiziert · Zum Publizieren');
    expect(screen.getByRole('link', { name: 'Zum Publizieren' }).getAttribute('href')).toBe('/site/publish');
  });
});

/** Designer 2026-10-10: eine Zeile für die ganze Variablen-Seite, die sagt, was geändert ist; ab vier nur die Zahl. */
describe('PendingVariablesLine', () => {
  const withVariables = (variables: string[]): SiteJobStatus => {
    const v = value(7);
    return { ...v, pending: { ...v.pending!, variables } };
  };
  it('names up to three changed variables and links to publishing', () => {
    render(<PendingVariablesLine />, { wrapper: wrap(withVariables(['Spendenkonto', 'Telefon'])) });
    expect(screen.getByTestId('site-pending-line').textContent).toBe('2 Variablen nicht publiziert: Spendenkonto, Telefon · Zum Publizieren');
    expect(screen.getByRole('link', { name: 'Zum Publizieren' }).getAttribute('href')).toBe('/site/publish');
  });
  it('says one variable in the singular', () => {
    render(<PendingVariablesLine />, { wrapper: wrap(withVariables(['Telefon'])) });
    expect(screen.getByTestId('site-pending-line').textContent).toBe('1 Variable nicht publiziert: Telefon · Zum Publizieren');
  });
  it('gives only the number from four on', () => {
    render(<PendingVariablesLine />, { wrapper: wrap(withVariables(['A', 'B', 'C', 'D'])) });
    expect(screen.getByTestId('site-pending-line').textContent).toBe('4 Variablen nicht publiziert · Zum Publizieren');
  });
  it('is silent without changed variables and without provider', () => {
    const { container } = render(<PendingVariablesLine />, { wrapper: wrap(withVariables([])) });
    expect(container.textContent).toBe('');
    cleanup();
    const bare = render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <PendingVariablesLine />
      </NextIntlClientProvider>,
    );
    expect(bare.container.textContent).toBe('');
  });
});

describe('pendingVariableNames', () => {
  it('takes the names of all pending variables, also beyond the first five items', () => {
    const list = [
      { key: 'variables.phone', kind: 'changed' as const, label: 'Telefon', href: '/site/variables', recordHref: '/site/variables' },
      { key: 'animals.A1', kind: 'changed' as const, label: 'Bruno', href: '/animals/A1', recordHref: '/animals/A1' },
      { key: 'variables.iban', kind: 'removed' as const, label: 'Spendenkonto', href: null, recordHref: '/site/variables' },
    ];
    expect(pendingVariableNames(list)).toEqual(['Telefon', 'Spendenkonto']);
  });
});
