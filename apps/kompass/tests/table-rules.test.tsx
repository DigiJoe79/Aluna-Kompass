// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { contrastRatio, DEFAULT_THEME } from '@kompass/core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { Empty } from '@/components/empty-value';
import { StatusBadge } from '@/components/status-badge';
import { RowLink, Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Regeln des Bausteins Tabelle aus Lauf 3 (Joe 11.5, 11.8; MUSTER § G): die Titelspalte kürzt auf Wunsch, eine
 * Statusspalte ohne Marke fällt samt Kopf weg, eine Ja/Nein-Zeile wird gedämpft und trägt ihre Marke hinter dem Namen.
 * Das Bild (Breite, Ellipse, Kartenzeile) steht im CSS; geprüft werden Klassen, Attribute und Vorleser-Text.
 */
afterEach(cleanup);

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );

const LONG = 'Kontoverifizierung PayPal Europe S.a.r.l. et Cie S.C.A. EREF: 1234567890 MREF: ABCDEFG';

describe('Titelspalte kürzt (Joe 11.5)', () => {
  it('`truncate` nimmt den Restplatz, kürzt mit Ellipse und nennt den vollen Text im title', () => {
    const { container } = show(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell col="title" truncate>{LONG}</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = container.querySelector('td[data-col="title"]')!;
    expect(cell.className).toMatch(/\bw-full\b/);
    expect(cell.className).toMatch(/\bmax-w-0\b/);
    expect(cell.className).toMatch(/\btruncate\b/);
    expect(cell.getAttribute('title')).toBe(LONG);
    expect(cell.hasAttribute('data-truncate')).toBe(true);
  });

  it('ein gemischter Inhalt nennt seinen Volltext über `title` selbst', () => {
    const { container } = show(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell col="title" truncate title={LONG}>
              <span>{LONG}</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(container.querySelector('td')!.getAttribute('title')).toBe(LONG);
  });

  it('ohne `truncate` bleibt die Zelle, wie sie war', () => {
    const { container } = show(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell col="title">{LONG}</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = container.querySelector('td')!;
    expect(cell.className).not.toMatch(/\bmax-w-0\b/);
    expect(cell.hasAttribute('title')).toBe(false);
  });

  it('am Telefon bricht die gekürzte Titelzeile um, statt zu kürzen (Designer 005)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/\[data-col="title"\]\[data-truncate\][^{]*\{[^}]*max-width: none/);
  });
});

const statusTable = (rows: { name: string; status?: ReactElement | null }[]) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead col="title">Name</TableHead>
        <TableHead col="status">Zustand</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((row) => (
        <TableRow key={row.name}>
          <TableCell col="title">{row.name}</TableCell>
          <TableCell col="status">{row.status ?? null}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

describe('Statusspalte ohne Marke fällt weg (Joe 11.8)', () => {
  it('trägt keine Zeile eine Marke, sind Kopf und Zellen verborgen', () => {
    const { container } = show(statusTable([{ name: 'Girokonto' }, { name: 'Barkasse' }]));
    const statusParts = [...container.querySelectorAll('[data-col="status"]')];
    expect(statusParts).toHaveLength(3);
    expect(statusParts.every((el) => el.hasAttribute('hidden'))).toBe(true);
    expect(screen.queryByRole('columnheader', { name: 'Zustand' })).toBeNull();
  });

  it('sobald eine Zeile abweicht, steht die Spalte', () => {
    const { container } = show(
      statusTable([{ name: 'Girokonto' }, { name: 'Barkasse', status: <StatusBadge tone="warning">Entwurf</StatusBadge> }]),
    );
    expect([...container.querySelectorAll('[data-col="status"]')].some((el) => el.hasAttribute('hidden'))).toBe(false);
    expect(screen.getByRole('columnheader', { name: 'Zustand' })).toBeTruthy();
  });

  it('das CSS verbirgt sie schon vor der Hydration', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/table:not\(:has\(> tbody > tr > \[data-col="status"\]:not\(:empty\)\)\) \[data-col="status"\]/);
  });
});

describe('Ja/Nein-Zeile gedämpft mit Marke (Joe 11.8)', () => {
  it('`muted` dämpft die Zeile, die Marke steht hinter dem Namen, Link bleibt', () => {
    const { container } = show(
      <Table>
        <TableBody>
          <TableRow muted="deaktiviert">
            <TableCell col="title">
              <RowLink href="/admin/x">Spendenquittung</RowLink>
            </TableCell>
            <TableCell>Eingang</TableCell>
          </TableRow>
          <TableRow>
            <TableCell col="title">
              <RowLink href="/admin/y">Rechnung</RowLink>
            </TableCell>
            <TableCell>Eingang</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const [muted, normal] = [...container.querySelectorAll('tbody tr')];
    expect(muted!.hasAttribute('data-muted')).toBe(true);
    expect(normal!.hasAttribute('data-muted')).toBe(false);
    const title = muted!.querySelector('[data-col="title"]')!;
    expect(title.textContent).toBe('Spendenquittung deaktiviert');
    // Marke nach dem Link, für Vorleser als Text (Farbe allein ist keine Information, WCAG 1.4.1).
    expect(title.lastElementChild!.textContent).toBe('deaktiviert');
    expect(screen.getByRole('link', { name: 'Spendenquittung' })).toBeTruthy();
    expect(normal!.querySelector('[data-col="title"]')!.textContent).toBe('Rechnung');
  });

  it('das CSS dämpft die Zellen einer gedämpften Zeile', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/tr\[data-muted\] > :is\(td, th\)\s*\{[^}]*color: var\(--muted\)/);
  });

  it('die Dämpfung ist klar erkennbar: auch der Name und das Foto treten zurück (Runde 4, 192)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/tr\[data-muted\] \[data-row-link\]\s*\{[^}]*color: var\(--muted\)/);
    expect(css).toMatch(/tr\[data-muted\] img\s*\{[^}]*opacity/);
  });

  it.each(['light', 'dark'] as const)('gedämpfte Schrift bleibt lesbar: muted ≥ 4,5:1 auf Fläche und Zebra (%s)', (mode) => {
    const tokens = DEFAULT_THEME.tokens;
    expect(contrastRatio(tokens.muted[mode], tokens.surface[mode])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens.muted[mode], tokens['table-zebra'][mode])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('leere Werte in der Unterzeile der Kartenzeile (038, 043)', () => {
  it('der Leerwert ist für das CSS erkennbar', () => {
    const { container } = show(<Empty />);
    expect(container.querySelector('[data-empty]')).toBeTruthy();
  });

  it('die Unterzeile bricht um, statt zu kürzen (Designer 005; Runde 4, 018, 043, 061)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    const meta = css.match(/> tbody > tr > \[data-col="meta"\] \{[^}]*\}/)![0];
    expect(meta).toMatch(/white-space: normal/);
    expect(meta).not.toMatch(/ellipsis/);
    expect(css).not.toMatch(/fit-content\(45%\)/);
  });

  it('das CSS lässt leere meta samt Trenner weg', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../src/app/globals.css'), 'utf8');
    expect(css).toMatch(/\[data-col="meta"\]:is\(:empty, :has\(> \[data-empty\]:only-child\)\)\s*\{\s*display: none/);
    // Der Trenner steht nur vor einem Wert, dem schon ein Wert vorausgeht — in derselben Zeile (eine meta mit `wrap`
    // steht in einer eigenen, Kompromiss b).
    expect(css).toMatch(/\[data-col="meta"\]:not\(\[data-wrap\], :empty, :has\(> \[data-empty\]:only-child\)\) ~ \[data-col="meta"\]:not\(\[data-wrap\], :empty, :has\(> \[data-empty\]:only-child\)\)::before/);
  });
});

describe('Kein Überlauf: Fließtext bricht um, Kennwerte nicht (Joe 11.4, 11.5; Runde 4, 078, 086)', () => {
  const cells = () =>
    show(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead col="meta">Nr.</TableHead>
            <TableHead col="title">Text</TableHead>
            <TableHead>Spender/Empfänger</TableHead>
            <TableHead col="amount">Betrag</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell col="select" data-testid="select" />
            <TableCell col="meta" data-testid="meta">2026-0011</TableCell>
            <TableCell col="meta" wrap data-testid="meta-wrap">1 neu · 1 zurückgehalten</TableCell>
            <TableCell col="title" data-testid="title">Vereinskonto</TableCell>
            <TableCell col="title" truncate data-testid="truncate">{LONG}</TableCell>
            <TableCell data-testid="plain">geladen von Anna Berger am 17.10.2026</TableCell>
            <TableCell col="amount" data-testid="amount">−3.462,00 €</TableCell>
            <TableCell col="status" data-testid="status"><StatusBadge tone="info">Entwurf</StatusBadge></TableCell>
            <TableCell col="actions" data-testid="actions" />
          </TableRow>
          <TableRow>
            <TableCell col="span" colSpan={9} data-testid="span">Es fehlen Umsätze zwischen 31.01.2026 und 10.02.2026.</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
  const cls = (id: string) => screen.getByTestId(id).className;

  it('Nummer, Datum, Betrag, Status, Haken und Aktionen brechen nicht um', () => {
    cells();
    for (const id of ['select', 'meta', 'amount', 'status', 'actions']) {
      expect(cls(id), id).toMatch(/\bwhitespace-nowrap\b/);
      expect(cls(id), id).not.toMatch(/\bwhitespace-normal\b/);
    }
  });

  it('Fließtext — Spalten ohne Rolle, Titel ohne Kürzung, Zeilen über die ganze Breite, `wrap` — bricht an Wortgrenzen um', () => {
    cells();
    for (const id of ['plain', 'title', 'span', 'meta-wrap']) {
      expect(cls(id), id).toMatch(/\bwhitespace-normal\b/);
      expect(cls(id), id).not.toMatch(/\bwhitespace-nowrap\b/);
    }
  });

  it('eine meta-Zelle mit `wrap` trägt `data-wrap` — am Telefon steht sie in einer eigenen Zeile (Kompromiss b)', () => {
    cells();
    expect(screen.getByTestId('meta-wrap').hasAttribute('data-wrap')).toBe(true);
    expect(screen.getByTestId('meta').hasAttribute('data-wrap')).toBe(false);
    expect(screen.getByTestId('plain').hasAttribute('data-wrap')).toBe(false);
  });

  it('der Kopf einer Fließtext-Spalte bricht mit um, der Kopf eines Kennwerts nicht', () => {
    const { container } = cells();
    const heads = [...container.querySelectorAll('th')];
    expect(heads[0]!.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(heads[2]!.className).toMatch(/\bwhitespace-normal\b/);
    expect(heads[3]!.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('die kürzende Titelspalte hat eine Mindestbreite von 14rem, in einer schmalen Liste ein Viertel ihrer Breite', () => {
    cells();
    expect(cls('truncate')).toContain('min-w-[min(14rem,25cqw)]');
  });

  it('die Summenzeile bricht um (Etikett und Beträge)', () => {
    const { container } = show(
      <Table>
        <TableFooter>
          <TableRow>
            <TableCell col="meta">Summe über die gefilterten 47 Buchungen</TableCell>
            <TableCell col="amount">Ausgaben −3.462,00 € · Ergebnis 800,00 €</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    for (const cell of container.querySelectorAll('td')) expect(cell.className).toMatch(/\bwhitespace-normal\b/);
  });

});
