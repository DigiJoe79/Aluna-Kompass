// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SortableHead } from '@/components/sortable-head';
import { Table, TableHeader, TableRow } from '@/components/ui/table';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/contacts',
  useSearchParams: () => new URLSearchParams(''),
}));
afterEach(cleanup);

/** 04 B8: Ohne `?sort` sortiert die Seite nach ihrer Vorgabe — der Kopf zeigt sie an. */
describe('SortableHead mit Vorgabe', () => {
  it('zeigt die Vorgabe als aktive Sortierung, solange die Adresse keine nennt', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead col="title" field="name" label="Name" byDefault="asc" />
              <SortableHead col="meta" field="city" label="Ort" />
            </TableRow>
          </TableHeader>
        </Table>
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.getAttribute('aria-sort'))).toEqual(['ascending', 'none']);
  });
});
