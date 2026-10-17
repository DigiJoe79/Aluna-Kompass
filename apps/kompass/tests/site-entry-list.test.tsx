// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SiteJobContext, type SiteJobStatus } from '@/components/site/site-job-provider';

vi.mock('@/app/(shell)/site/actions', () => ({ reorderEntriesAction: vi.fn(), setEntryPublishedAction: vi.fn() }));
const { ListClient } = await import('@/app/(shell)/site/c/[collection]/list-client');

const status = (hrefs: string[]): SiteJobStatus => ({
  enabled: true,
  running: null,
  last: null,
  pending: { since: '2026-09-28T08:00:00.000Z', count: hrefs.length, items: [], hrefs, variables: [] },
  track: () => {},
  refresh: () => {},
});
const wrap =
  (value: SiteJobStatus | null) =>
  ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <SiteJobContext.Provider value={value}>{children}</SiteJobContext.Provider>
    </NextIntlClientProvider>
  );
afterEach(cleanup);
const rows = [
  { id: 'E1', label: 'Sommerfest', isPublished: true },
  { id: 'E2', label: 'Winterhilfe', isPublished: true },
];

/** 127–133: Der Kopf meldet „n nicht publiziert“ — die Liste zeigt, welcher Eintrag gemeint ist. */
describe('Liste der Webseiten-Einträge', () => {
  it('marks the entries with changes that are not on the website yet', () => {
    render(<ListClient collection="news" rows={rows} publishable sortable={false} canManage />, { wrapper: wrap(status(['/site/c/news/E2', '/animals/A1'])) });
    const [first, second] = screen.getAllByRole('row').slice(1);
    expect(within(first!).queryByText('nicht publiziert')).toBeNull();
    expect(within(second!).getByText('nicht publiziert')).toBeTruthy();
  });
  it('stays silent without the publishing status (no right to publish, module off)', () => {
    render(<ListClient collection="news" rows={rows} publishable sortable={false} canManage />, { wrapper: wrap(null) });
    expect(screen.queryByText('nicht publiziert')).toBeNull();
  });
});
