// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { HelpPanel } from '@/components/shell/help-panel';

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
