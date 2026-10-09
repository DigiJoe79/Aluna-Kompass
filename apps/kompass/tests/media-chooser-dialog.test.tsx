// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import type { MediaListing } from '@/lib/media-listing';
import messages from '../messages/de.json';

vi.mock('@/app/(shell)/admin/media/actions', () => ({ uploadMediaAction: vi.fn() }));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const item = (id: string, folder: string | null) => ({ id, filename: `${id}.png`, mimeType: 'image/png', bytes: 1, width: 1, height: 1, createdAt: '2026-10-01T08:00:00.000Z', folder, references: [] });

/** Was `GET /media?kind=image` liefert: Zähler nur für Bilder. „Dokumente“ hat keins, „Tiere“ nur im Unterordner. */
const LISTING: MediaListing = {
  items: [item('a', 'Bilder'), item('b', 'Tiere/Hunde'), item('c', null)],
  folders: [
    { path: 'Bilder', assetCount: 1 },
    { path: 'Dokumente', assetCount: 0 },
    { path: 'Tiere', assetCount: 0 },
    { path: 'Tiere/Hunde', assetCount: 2 },
    { path: 'Tiere/Katzen', assetCount: 0 },
  ],
  total: 4,
  unfiledCount: 1,
};

const fetchMock = vi.fn();
/** Die Suchparameter des letzten Abrufs. */
const lastParams = () => new URL(String(fetchMock.mock.calls.at(-1)?.[0]), 'http://x').searchParams;

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(LISTING), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChooser() {
  return render(<MediaChooserDialog open onOpenChange={() => {}} kind="image" multiple={false} selected={[]} onConfirm={() => {}} />, { wrapper: Intl });
}

const fixed = (key: string) => document.querySelector<HTMLElement>(`[data-fixed="${key}"]`)!;
const tree = () => screen.getByRole('tree', { name: 'Ordner' });

describe('MediaChooserDialog', () => {
  it('uploads through a button, the file input itself stays out of sight', async () => {
    renderChooser();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Hochladen' })).toBeTruthy();
    const input = within(dialog).getByLabelText('Hochladen');
    expect(input.getAttribute('type')).toBe('file');
    expect(input.className).toContain('sr-only');
    expect(input.tabIndex).toBe(-1);
  });

  it('counts only its kind and hides folders without a matching file, keeping their parents', async () => {
    renderChooser();
    await waitFor(() => expect(fixed('all')).toBeTruthy());
    await waitFor(() => expect(within(tree()).getAllByRole('treeitem').length).toBeGreaterThan(0));

    expect(fixed('all').textContent).toContain('Alle Dateien');
    expect(fixed('all').textContent).toContain('4');
    expect(fixed('unfiled').textContent).toContain('Ohne Ordner');
    expect(fixed('unfiled').textContent).toContain('1');
    expect(lastParams().get('kind')).toBe('image');

    const names = within(tree())
      .getAllByRole('treeitem')
      .map((row) => row.getAttribute('aria-label') ?? '');
    expect(names.some((n) => n.startsWith('Bilder,'))).toBe(true);
    expect(names.some((n) => n.startsWith('Tiere,'))).toBe(true);
    expect(names.some((n) => n.startsWith('Dokumente,'))).toBe(false);

    fireEvent.click(within(tree()).getByRole('treeitem', { name: /^Tiere,/ }).querySelector('[data-toggle]')!);
    await waitFor(() => expect(within(tree()).getByRole('treeitem', { name: /^Hunde,/ })).toBeTruthy());
    expect(within(tree()).queryByRole('treeitem', { name: /^Katzen,/ })).toBeNull();
  });

  it('picks a folder with a click: no link, no menu, not draggable', async () => {
    renderChooser();
    await waitFor(() => expect(within(tree()).getByRole('treeitem', { name: /^Bilder,/ })).toBeTruthy());
    expect(tree().querySelector('a')).toBeNull();
    expect(tree().querySelector('[data-row-menu]')).toBeNull();
    expect(tree().querySelector('[draggable="true"]')).toBeNull();
    expect(document.querySelector('[data-fixed] a, a[data-fixed]')).toBeNull();

    await act(async () => {
      fireEvent.click(within(tree()).getByRole('treeitem', { name: /^Bilder,/ }));
    });
    await waitFor(() => expect(lastParams().get('folder')).toBe('Bilder'));
    expect(within(tree()).getByRole('treeitem', { name: /^Bilder,/ }).getAttribute('aria-selected')).toBe('true');
    expect(fixed('all').getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(localStorage.getItem('kompass.mediaChooserFolder') ?? 'null')).toBe('Bilder');
  });

  it('tells „Alle Dateien“ and „Ohne Ordner“ apart, though neither is a folder', async () => {
    renderChooser();
    await waitFor(() => expect(fixed('unfiled')).toBeTruthy());
    expect(fixed('all').getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      fireEvent.click(fixed('unfiled'));
    });
    await waitFor(() => expect(lastParams().get('folder')).toBe(''));
    expect(fixed('unfiled').getAttribute('aria-pressed')).toBe('true');
    expect(fixed('all').getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      fireEvent.click(fixed('all'));
    });
    await waitFor(() => expect(lastParams().has('folder')).toBe(false));
    expect(fixed('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to „Alle Dateien“ when the remembered folder is gone (renamed elsewhere)', async () => {
    localStorage.setItem('kompass.mediaChooserFolder', JSON.stringify('Weg'));
    renderChooser();
    await waitFor(() => expect(fixed('all').getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(lastParams().has('folder')).toBe(false));
    expect(JSON.parse(localStorage.getItem('kompass.mediaChooserFolder') ?? '"x"')).toBeNull();
  });

  it('opens the path to the remembered folder', async () => {
    localStorage.setItem('kompass.mediaChooserFolder', JSON.stringify('Tiere/Hunde'));
    renderChooser();
    await waitFor(() => expect(within(tree()).getByRole('treeitem', { name: /^Hunde,/ }).getAttribute('aria-selected')).toBe('true'));
    expect(lastParams().get('folder')).toBe('Tiere/Hunde');
  });

  describe('with a maximum (Befund 6, 0.2.4)', () => {
    /** 14 Bilder; die bereits gewählten zählen mit. */
    const MANY: MediaListing = { items: Array.from({ length: 14 }, (_, i) => item(`p${i}`, null)), folders: [], total: 14, unfiledCount: 14 };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    const tile = (id: string) => document.querySelector<HTMLButtonElement>(`[data-asset-id="${id}"]`)!;
    const reasonOf = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

    function renderMax(selected: string[], onConfirm = vi.fn()) {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify(MANY), { status: 200, headers: { 'content-type': 'application/json' } }));
      render(<MediaChooserDialog open onOpenChange={() => {}} kind="image" multiple max={12} selected={selected} onConfirm={onConfirm} />, { wrapper: Intl });
      return onConfirm;
    }

    it('with 12 already chosen, nothing more can be picked, and it says why', async () => {
      renderMax(ids(12));
      await waitFor(() => expect(tile('p13')).toBeTruthy());
      for (const id of ['p12', 'p13']) {
        expect(tile(id).disabled).toBe(true);
        expect(reasonOf(tile(id))).toContain('Höchstens 12');
      }
      // Abwählen geht weiter.
      expect(tile('p0').disabled).toBe(false);
      expect(screen.getByText(/12 von 12 ausgewählt/)).toBeTruthy();
      // Der Grund wird angesagt: die gesperrten Kacheln sind nicht fokussierbar.
      expect(screen.getByText(/Höchstens 12 ausgewählt/).parentElement?.getAttribute('aria-live')).toBe('polite');
    });

    it('with 10 already chosen, exactly 2 more can be picked', async () => {
      const onConfirm = renderMax(ids(10));
      await waitFor(() => expect(tile('p13')).toBeTruthy());
      fireEvent.click(tile('p10'));
      fireEvent.click(tile('p11'));
      fireEvent.click(tile('p12'));
      expect(tile('p12').disabled).toBe(true);
      expect(tile('p12').getAttribute('aria-pressed')).toBe('false');
      expect(tile('p13').disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
      expect(onConfirm).toHaveBeenCalledWith(ids(12));
    });

    it('frees the tiles again once one is unpicked', async () => {
      renderMax(ids(12));
      await waitFor(() => expect(tile('p13')).toBeTruthy());
      fireEvent.click(tile('p0'));
      expect(tile('p13').disabled).toBe(false);
      expect(tile('p13').getAttribute('aria-describedby')).toBeNull();
    });
  });
});

