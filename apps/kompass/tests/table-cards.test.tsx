// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { SortableHead } from '@/components/sortable-head';
import { RowLink, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * E1 „Tabelle am Telefon“ (Designer 2026-10-17, Notiz `entwuerfe/E1-tabelle-telefon.md`): Spaltenrollen an Kopf und
 * Zelle, unter `md` Kartenzeile als Liste. Das Bild selbst (Raster, Kürzung, verborgene Spalten) steht als CSS in
 * `globals.css` und ist in jsdom nicht messbar; geprüft werden Rollen, Vorleser-Semantik, Sortierknopf und die
 * Regel „höchstens drei meta“ im CSS.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/projects',
  useSearchParams: () => new URLSearchParams('sort=number&dir=asc'),
}));

let phone = false;
beforeEach(() => {
  phone = false;
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

const journal = (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead col="select" />
        <SortableHead col="meta" field="number" label="Nummer" />
        <SortableHead col="meta" field="date" label="Datum" />
        <TableHead col="title">Text</TableHead>
        <TableHead>Gegenpartei</TableHead>
        <TableHead col="amount">Betrag</TableHead>
        <TableHead col="status">Status</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell col="select"><input type="checkbox" aria-label="Auswählen" /></TableCell>
        <TableCell col="meta"><RowLink href="/finance/entries/1">B-2026-0412</RowLink></TableCell>
        <TableCell col="meta">14.10.2026</TableCell>
        <TableCell col="title">Futterkauf Fressnapf Filiale Nord</TableCell>
        <TableCell>Fressnapf</TableCell>
        <TableCell col="amount">−312,40 €</TableCell>
        <TableCell col="status">Entwurf</TableCell>
      </TableRow>
      <TableEmpty colSpan={7}>Nichts</TableEmpty>
    </TableBody>
  </Table>
);

describe('Table: Spaltenrollen (E1)', () => {
  it('Kopf und Zelle tragen ihre Rolle als data-col, Spalten ohne Rolle keine', () => {
    const { container } = show(journal);
    const heads = [...container.querySelectorAll('th')].map((th) => th.getAttribute('data-col'));
    expect(heads).toEqual(['select', 'meta', 'meta', 'title', null, 'amount', 'status']);
    const cells = [...container.querySelectorAll('tbody tr:first-child td')].map((td) => td.getAttribute('data-col'));
    expect(cells).toEqual(['select', 'meta', 'meta', 'title', null, 'amount', 'status']);
  });

  it('am Desktop bleibt es eine Tabelle', () => {
    show(journal);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('am Telefon ist die Kartenliste `list`/`listitem`, nicht `table` (Vorleser)', () => {
    phone = true;
    show(journal);
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryAllByRole('cell')).toHaveLength(0);
  });

  it('am Telefon nennt der Betrag seinen Spaltennamen für Vorleser', () => {
    phone = true;
    const { container } = show(journal);
    const amount = container.querySelector('td[data-col="amount"]')!;
    expect(amount.textContent).toBe('Betrag −312,40 €');
    expect(amount.querySelector('.sr-only')?.textContent).toBe('Betrag ');
  });

  it('am Telefon: Sortierknopf „Sortieren: …“ öffnet eine Liste der sortierbaren Spalten', () => {
    phone = true;
    show(journal);
    const trigger = screen.getByRole('combobox', { name: /Sortieren/ });
    expect(trigger.textContent).toContain('Sortieren:');
    expect(trigger.textContent).toContain('Nummer');
  });

  it('ohne sortierbare Spalte kein Sortierknopf', () => {
    phone = true;
    show(
      <Table>
        <TableHeader><TableRow><TableHead col="title">Name</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell col="title">Bello</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('eine Tabelle ohne Titelrolle bleibt auch am Telefon eine Tabelle', () => {
    phone = true;
    show(
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>Bello</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('das Bild der Kartenzeile kennt genau drei meta-Plätze (mehr ist ein Fehler, Wächter table-roles)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/:nth-child\(1 of \[data-col="meta"\]\)/);
    expect(css).toMatch(/:nth-child\(3 of \[data-col="meta"\]\)/);
    expect(css).not.toMatch(/:nth-child\(4 of \[data-col="meta"\]\)/);
  });
});
