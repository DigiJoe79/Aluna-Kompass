// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type ReactElement, useContext } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { HelpAsideContext, HelpAsideProvider, HelpPanel, useHelpAside } from '@/components/shell/help-panel';

/** E4 „Hilfe neben der Seite“ (Designer 2026-10-17, Notiz `entwuerfe/E4-hilfe-panel.md`). */
const show = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {ui}
    </NextIntlClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = { doc: 'finanzen/journal', title: 'Journal', href: '/help/finanzen/journal', leadHtml: '<p>Das Journal zeigt alle Buchungen.</p>' };
const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);

describe('HelpPanel als Nebenspalte (ab lg)', () => {
  it('nicht modal: complementary „Hilfe“, Titel „Hilfe: …“ bekommt beim Öffnen den Fokus, Handbuch-Link im neuen Tab', async () => {
    vi.stubGlobal('fetch', respond(answer));
    show(<HelpPanel mode="aside" open onClose={() => {}} pathname="/finance/entries" />);
    const aside = screen.getByRole('complementary', { name: 'Hilfe' });
    expect(aside.getAttribute('aria-modal')).toBeNull();
    const title = await screen.findByRole('heading', { name: 'Hilfe: Journal' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.getByText('Das Journal zeigt alle Buchungen.')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Im Handbuch öffnen/ });
    expect(link.getAttribute('href')).toBe('/help/finanzen/journal');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('Esc in der Hilfe und × schließen', async () => {
    vi.stubGlobal('fetch', respond(answer));
    const onClose = vi.fn();
    show(<HelpPanel mode="aside" open onClose={onClose} pathname="/finance/entries" />);
    await screen.findByRole('heading', { name: 'Hilfe: Journal' });
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Hilfe schließen' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Seite ohne Hilfe: leerer Zustand, der Handbuch-Link bleibt', async () => {
    vi.stubGlobal('fetch', respond({ doc: null, indexHtml: '<ul><li>Akte</li></ul>' }));
    show(<HelpPanel mode="aside" open onClose={() => {}} pathname="/x" />);
    expect(await screen.findByText('Zu dieser Seite gibt es noch keine Hilfe.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Im Handbuch öffnen/ }).getAttribute('href')).toBe('/help');
  });

  it('Ladefehler: Notice mit „Erneut versuchen“, das neu lädt', async () => {
    const fetchMock = respond({}, false);
    vi.stubGlobal('fetch', fetchMock);
    show(<HelpPanel mode="aside" open onClose={() => {}} pathname="/x" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Die Hilfe konnte nicht geladen werden.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('HelpAsideProvider', () => {
  /**
   * Der Context-Wert über der Seite bleibt derselbe, auch wenn die Hilfe auf- und zugeht. Ein wechselnder Wert erreicht
   * noch nicht hydrierte Suspense-Grenzen; im Image blieb dann der gestreamte Teil (`<div hidden id="S:0">`) als zweites
   * Seitenpanel „Bestände“ im DOM — nach dem Neuladen mit offener Hilfe (help.spec.ts:50, 29.10.).
   */
  it('hält den Context-Wert stabil, der Verbraucher sieht trotzdem den Wechsel', () => {
    const values: unknown[] = [];
    function Probe() {
      values.push(useContext(HelpAsideContext));
      return null;
    }
    function Consumer() {
      return <p data-testid="aside">{useHelpAside() ? 'daneben' : 'zu'}</p>;
    }
    const tree = (aside: boolean) => (
      <HelpAsideProvider aside={aside}>
        <Probe />
        <Consumer />
      </HelpAsideProvider>
    );
    const { rerender } = render(tree(false));
    expect(screen.getByTestId('aside').textContent).toBe('zu');
    act(() => rerender(tree(true)));
    expect(screen.getByTestId('aside').textContent).toBe('daneben');
    act(() => rerender(tree(false)));
    expect(screen.getByTestId('aside').textContent).toBe('zu');
    expect(values.length).toBeGreaterThan(1);
    expect(new Set(values).size).toBe(1);
  });
});
