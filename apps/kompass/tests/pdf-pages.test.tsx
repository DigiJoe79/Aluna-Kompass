// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfPages } from '@/components/pdf-pages';
import messages from '../messages/de.json';

afterEach(cleanup);

const Intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

const pageSrc = (page: number, scale: 1 | 2) => `/r/page/${page}?scale=${scale}`;

describe('PdfPages', () => {
  it('shows one sheet per page, each named with its number, with a double-density source', () => {
    render(
      <Intl>
        <PdfPages title="Kassenbericht 2025" pageCount={3} pageSrc={pageSrc} pdfHref="/r.pdf" orientation="portrait" />
      </Intl>,
    );
    const sheets = screen.getAllByRole('img');
    expect(sheets).toHaveLength(3);
    expect(sheets.map((s) => s.getAttribute('alt'))).toEqual([1, 2, 3].map((n) => `Seite ${n} von 3: Kassenbericht 2025`));
    expect(sheets[1]!.getAttribute('src')).toBe('/r/page/2?scale=1');
    expect(sheets[1]!.getAttribute('srcset')).toContain('/r/page/2?scale=2 2x');
  });

  it('on the phone keeps only page 1 and names all pages in the link; the PDF opens in a new tab', () => {
    render(
      <Intl>
        <PdfPages title="Übergabeliste" pageCount={2} pageSrc={pageSrc} pdfHref="/r.pdf" orientation="landscape" />
      </Intl>,
    );
    const sheets = screen.getAllByRole('img');
    expect(sheets.map((s) => s.closest('[data-phone]')?.getAttribute('data-phone') ?? 'shown')).toEqual(['shown', 'hidden']);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => [l.getAttribute('data-phone') ?? 'shown', l.getAttribute('href'), l.getAttribute('target')])).toEqual([
      ['hidden', '/r.pdf', '_blank'],
      ['only', '/r.pdf', '_blank'],
    ]);
    expect(links[1]!.textContent).toContain('2');
  });

  it('without a known page count shows only the link to the PDF', () => {
    render(
      <Intl>
        <PdfPages title="Scan" pageCount={null} pageSrc={pageSrc} pdfHref="/r.pdf" orientation="portrait" />
      </Intl>,
    );
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/r.pdf']);
  });

  it('a PDF without content shows its sentence and the link instead of sheets (Designer Runde 7, 16a D)', () => {
    render(
      <Intl>
        <PdfPages title="Personenübersicht 2025" pageCount={1} pageSrc={pageSrc} pdfHref="/r.pdf" orientation="portrait" empty="Im Kalenderjahr gibt es nichts." />
      </Intl>,
    );
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getByText('Im Kalenderjahr gibt es nichts.')).toBeTruthy();
    expect(screen.getAllByRole('link').map((l) => [l.getAttribute('href'), l.getAttribute('target')])).toEqual([['/r.pdf', '_blank']]);
  });
});
