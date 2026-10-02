// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentMovesContext } from '@/app/(shell)/dms/document-moves';
import { DocumentList, type DocumentListItem } from '@/app/(shell)/dms/document-list';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dms',
  useSearchParams: () => new URLSearchParams('folder=behoerden'),
}));

afterEach(cleanup);

const doc = (i: number): DocumentListItem => ({
  id: `d${i}`,
  number: `BRF-2026-${i}`,
  subject: `Brief ${i}`,
  typeKey: 'letter',
  typeLabel: 'Brief',
  documentDate: '2026-03-14',
  folder: 'behoerden',
  direction: 'incoming',
  phase: 'issued',
  status: 'issued',
  sentAt: null,
  openFollowUp: null,
});

function renderList(shown: number, total: number, canMove = false) {
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <DocumentList
        documents={Array.from({ length: shown }, (_, i) => doc(i))}
        total={total}
        currentFolder="behoerden"
        types={[]}
        folders={[]}
        inboxCount={0}
        today="2026-10-01"
        canMove={canMove}
      />
    </NextIntlClientProvider>
  );
}

/*
 * Die Akte holt höchstens 200 Zeilen; ein Ordner mit Teilbaum kann mehr
 * fassen. In der E2E wären dafür 201 Dokumente anzulegen — hier reicht es,
 * der Liste weniger Zeilen als die Gesamtzahl zu geben.
 */
describe('DocumentList: abgeschnittene Liste', () => {
  it('sagt, dass nur die ersten Zeilen zu sehen sind, wenn es mehr gibt', () => {
    renderList(3, 250);
    expect(screen.getByTestId('list-truncated').textContent).toBe('Es werden die ersten 3 von 250 Dokumenten gezeigt. Grenzen Sie die Liste mit Suche oder Filtern ein.');
  });

  it('schweigt, wenn alles zu sehen ist', () => {
    renderList(3, 3);
    expect(screen.queryByTestId('list-truncated')).toBeNull();
  });
});

/*
 * Eine Live-Region sagt nur an, was in ihr geschieht, nachdem sie im DOM
 * steht: Taucht sie erst mit der ersten Auswahl samt Text auf, schweigt der
 * Screenreader. Darum steht sie immer da, und nur der Text wechselt.
 */
describe('DocumentList: Live-Region der Auswahlleiste', () => {
  it('steht schon vor der Auswahl da und bekommt die Ansage als Text', () => {
    render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <DocumentMovesContext value={{ placed: {}, remember: vi.fn(), requestMove: vi.fn() }}>
          <DocumentList documents={[doc(1), doc(2)]} total={2} currentFolder="behoerden" types={[]} folders={[]} inboxCount={0} today="2026-10-01" canMove />
        </DocumentMovesContext>
      </NextIntlClientProvider>
    );
    const region = screen.getByTestId('selection-live');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent).toBe('');
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '„Brief 1“ auswählen' }));
    expect(screen.getByTestId('selection-live')).toBe(region);
    expect(region.textContent).toBe('1 ausgewählt');
    expect(screen.getByTestId('selection-bar')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: '„Brief 1“ auswählen' }));
    expect(region.textContent).toBe('');
  });
});

// Am Telefon wird nicht gezogen (Spec Ordnerbaum § 5.6, Befund 0.2.4/11).
describe('DocumentList: Ziehen', () => {
  const pointer = (fine: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: fine, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  afterEach(() => vi.unstubAllGlobals());

  it('lässt Zeilen mit der Maus ziehen', () => {
    pointer(true);
    renderList(2, 2, true);
    expect(document.querySelector('[data-document-id="d0"]')!.getAttribute('draggable')).toBe('true');
  });

  it('lässt am Telefon nichts ziehen', () => {
    pointer(false);
    renderList(2, 2, true);
    expect(document.querySelector('[data-document-id="d0"]')!.getAttribute('draggable')).toBe('false');
  });
});
