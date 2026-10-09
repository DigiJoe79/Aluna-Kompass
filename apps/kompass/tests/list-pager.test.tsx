// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { ListPager } from '@/components/list-pager';
import { ListTruncated } from '@/components/list-truncated';

const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
const hrefFor = (offset: number) => `/finance/entries?page=${offset / 50 + 1}`;

afterEach(cleanup);

describe('ListPager', () => {
  it('nennt den Bereich und blättert in beide Richtungen', () => {
    show(<ListPager total={312} offset={50} hrefFor={hrefFor} />);
    expect(screen.getByText('51–100 von 312')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zurück' }).getAttribute('href')).toBe('/finance/entries?page=1');
    expect(screen.getByRole('link', { name: 'Weiter' }).getAttribute('href')).toBe('/finance/entries?page=3');
  });

  it('auf der ersten Seite kein Zurück, auf der letzten kein Weiter', () => {
    show(<ListPager total={60} offset={0} hrefFor={hrefFor} />);
    expect(screen.getByText('1–50 von 60')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Zurück' })).toBeNull();
    cleanup();
    show(<ListPager total={60} offset={50} hrefFor={hrefFor} />);
    expect(screen.getByText('51–60 von 60')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Weiter' })).toBeNull();
  });

  it('passt alles auf eine Seite, steht nichts da', () => {
    const { container } = show(<ListPager total={50} offset={0} hrefFor={hrefFor} />);
    expect(container.innerHTML).toBe('');
  });

  it('eigene Seitengröße', () => {
    show(<ListPager total={45} offset={20} pageSize={20} hrefFor={(o) => `?offset=${o}`} />);
    expect(screen.getByText('21–40 von 45')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Weiter' }).getAttribute('href')).toBe('?offset=40');
  });
});

describe('ListPager und ListTruncated als Fuß der Tabellenkarte (Designer 2026-10-08, Board § L Ziel 4)', () => {
  it('ListPager footer: Linie oben, Polster wie die Karte; Knöpfe outline sm', () => {
    show(<ListPager total={312} offset={0} hrefFor={hrefFor} footer testId="p" />);
    const nav = screen.getByTestId('p');
    expect(nav.className).toContain('border-t');
    expect(nav.className).toContain('border-line');
    expect(nav.className).toContain('px-4');
    expect(screen.getByRole('link', { name: 'Weiter' }).className).toContain('border');
  });

  it('ohne footer keine Linie (Tabelle ohne Karte: direkt darunter)', () => {
    show(<ListPager total={312} offset={0} hrefFor={hrefFor} testId="p" />);
    expect(screen.getByTestId('p').className).not.toContain('border-t');
  });

  it('ListTruncated footer: Linie oben, Polster wie die Karte', () => {
    show(<ListTruncated shown={200} total={312} text="gekürzt" footer testId="t" />);
    expect(screen.getByTestId('t').className).toContain('border-t');
    expect(screen.getByTestId('t').className).toContain('px-4');
  });
});

describe('ListTruncated', () => {
  it('zeigt den fertigen Satz des Aufrufers, wenn gekürzt', () => {
    show(<ListTruncated shown={200} total={312} text="Es werden die ersten 200 von 312 Umsätzen gezeigt." testId="t" />);
    expect(screen.getByTestId('t').textContent).toBe('Es werden die ersten 200 von 312 Umsätzen gezeigt.');
  });

  it('schweigt, wenn alles gezeigt wird', () => {
    const { container } = show(<ListTruncated shown={12} total={12} text="x" />);
    expect(container.innerHTML).toBe('');
  });
});
