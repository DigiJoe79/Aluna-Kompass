// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/site/actions', () => ({ reorderEntriesAction: vi.fn(), setEntryPublishedAction: vi.fn() }));
const { ListClient } = await import('@/app/(shell)/site/c/[collection]/list-client');

afterEach(cleanup);

/** 10 B7, 10 B9: Die Sammlungsliste hat einen Spaltenkopf und einen Zähler. */
describe('ListClient', () => {
  const rows = [
    { id: 'E1', label: 'Jonas Feld', isPublished: true },
    { id: 'E2', label: 'Mira Klein', isPublished: false },
  ];
  it('has column heads and counts the entries', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <ListClient collection="team" rows={rows} publishable sortable canManage />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Eintrag', 'Webseite', 'Reihenfolge']);
    expect(screen.getByText('2 Einträge')).toBeTruthy();
  });
});
