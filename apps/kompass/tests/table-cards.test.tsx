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

  const css = () => readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');

  it('das Bild der Kartenzeile kennt genau drei meta-Plätze (mehr ist ein Fehler, Wächter table-roles)', () => {
    expect(css()).toMatch(/:nth-child\(1 of \[data-col="meta"\]:not\(\[data-wrap\]\)\)/);
    expect(css()).toMatch(/:nth-child\(3 of \[data-col="meta"\]:not\(\[data-wrap\]\)\)/);
    expect(css()).not.toMatch(/:nth-child\(4 of \[data-col="meta"\]/);
  });

  it('eine umbrechende meta (`wrap`) steht am Telefon in einer eigenen Zeile über die volle Breite, ohne „·“ davor (Kompromiss b)', () => {
    // Eigene Zeilen 3 bis 5 unter Titel und Kennwerten, von der Titelkante bis zum Rand: kein Hängeeinzug mehr.
    expect(css()).toMatch(/:nth-child\(1 of \[data-col="meta"\]\[data-wrap\]:not\(:empty, :has\(> \[data-empty\]:only-child\)\)\) \{ grid-row: 3; \}/);
    // Ist die 2. Zeile sonst leer, rückt sie hoch (sonst hielte das Zeilenmenü eine leere Zeile offen, 217).
    // Die Bedingung prüft ohne verschachteltes `:has()` — das machte die Regel im Browser ungültig.
    expect(css()).toMatch(/tr:not\(:has\(> \[data-col="meta"\]:not\(\[data-wrap\], :empty\)\)\):not\(:has\(> \[data-col="amount"\]\):has\(> \[data-col="status"\]\)\) > :nth-child\(1 of /);
    expect(css()).toMatch(/:nth-child\(1 of \[data-col="meta"\]\[data-wrap\]:not\(:empty, :has\(> \[data-empty\]:only-child\)\)\) \{ grid-row: 2; grid-column: m1 \/ menu; \}/);
    expect(css()).toMatch(/\[data-col="meta"\]\[data-wrap\] \{ grid-column: m1 \/ -1;/);
    // Der Trenner steht nur zwischen Kennwerten derselben Zeile.
    expect(css()).toMatch(/\[data-col="meta"\]:not\(\[data-wrap\], :empty, :has\(> \[data-empty\]:only-child\)\) ~ \[data-col="meta"\]:not\(\[data-wrap\], :empty, :has\(> \[data-empty\]:only-child\)\)::before/);
  });

  /** Der Block der Kartenzeile (unter `md`) und darin die Regeln, deren Selektor genau `selector` ist. */
  const phoneRules = (selector: string) => {
    const text = css();
    const start = text.indexOf('@media (max-width: 767.98px)');
    const block = text.slice(start, text.indexOf('\n}\n', start));
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...block.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]!);
  };
  const TITLE = 'table:has([data-col="title"]) > tbody > tr > [data-col="title"]';

  it('Kartenzeile (Joe 2026-10-24): Titel und erste Unterzeile brechen um, ohne line-clamp', () => {
    const rules = phoneRules(TITLE);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r).not.toMatch(/line-clamp/);
      expect(r).not.toMatch(/overflow:\s*hidden/);
      expect(r).toMatch(/white-space:\s*normal/);
    }
  });

  // Nur kurze Zeilen (`span`) kürzen; ein Satz (`p`, Hinweis zur Unabhängigkeit) bricht um (Schlussdurchsicht D1e, I3).
  it('Kartenzeile: erst ab der dritten Zeile der Titelzelle (zweite Unterzeile) einzeilig mit „…“; kürzende Titel (`truncate`) und Sätze (`p`) ausgenommen', () => {
    const [rule] = phoneRules(`${TITLE}:not([data-truncate]) > span:nth-child(n+2 of :not(:first-child, [data-slot="status-badge"], .sr-only)):not(:has(a, button))`);
    expect(rule).toBeDefined();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('Kartenzeile: die Marke hat eigene Breite und kürzt nie', () => {
    const rules = phoneRules('table:has([data-col="title"]) > tbody > tr > :is([data-col="status"], [data-col="amount"], [data-col="select"], [data-col="actions"])');
    expect(rules.join(' ')).toMatch(/min-width:\s*max-content/);
    for (const r of phoneRules('table:has([data-col="title"]) > tbody > tr > [data-col="status"]')) expect(r).not.toMatch(/overflow|text-overflow|line-clamp/);
  });
});

