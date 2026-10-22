// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaListing } from '@/lib/media-listing';
import messages from '../messages/de.json';

const uploadMediaAction = vi.fn();
const setMediaAiKindAction = vi.fn();
vi.mock('@/app/(shell)/admin/media/actions', () => ({
  uploadMediaAction: (...a: unknown[]) => uploadMediaAction(...a),
  setMediaAiKindAction: (...a: unknown[]) => setMediaAiKindAction(...a),
}));

const { MediaChooserDialog } = await import('@/components/media/media-chooser-dialog');
const { MediaLabelingProvider } = await import('@/components/media/media-labeling-provider');

const LISTING: MediaListing = { items: [], folders: [], total: 0, unfiledCount: 0 };

/** Was `uploadMediaAction` je Datei liefert, nach Dateiname. */
const STORED: Record<string, object> = {
  'neu.png': { id: 'n1', filename: 'neu-1.png', mimeType: 'image/png', aiKind: 'none', created: true, width: 4, height: 3 },
  'zwei.png': { id: 'n2', filename: 'zwei-1.png', mimeType: 'image/png', aiKind: 'none', created: true, width: 4, height: 3 },
  'brief.pdf': { id: 'p1', filename: 'brief-1.pdf', mimeType: 'application/pdf', aiKind: 'none', created: true },
  'alt.png': { id: 'd1', filename: 'alt-1.png', mimeType: 'image/png', aiKind: 'edited', created: false, width: 4, height: 3 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(LISTING), { status: 200, headers: { 'content-type': 'application/json' } })));
  uploadMediaAction.mockReset().mockImplementation(async (fd: FormData) => {
    const name = (fd.get('file') as File).name;
    return name in STORED ? { status: 'success', data: STORED[name] } : { status: 'error', message: 'Dateityp nicht erlaubt.', fieldErrors: {} };
  });
  setMediaAiKindAction.mockReset().mockResolvedValue({ status: 'success' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChooser({ multiple, canLabel = true }: { multiple: boolean; canLabel?: boolean }) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      <MediaLabelingProvider canLabel={canLabel}>
        <MediaChooserDialog open onOpenChange={onOpenChange} kind="image" multiple={multiple} selected={[]} onConfirm={onConfirm} />
      </MediaLabelingProvider>
    </NextIntlClientProvider>,
  );
  return { onConfirm, onOpenChange };
}

const upload = (...names: string[]) =>
  fireEvent.change(screen.getByLabelText('Hochladen'), { target: { files: names.map((n) => new File(['x'], n, { type: n.endsWith('.pdf') ? 'application/pdf' : 'image/png' })) } });

const labelingDialog = () => screen.findByRole('dialog', { name: 'Bildkennzeichnung' });

describe('Auswahldialog: Bildkennzeichnung nach dem Hochladen', () => {
  it('mehrere: nur Bilder als Zeilen, das schon gekennzeichnete Duplikat ohne Umschalter; „Fertig“ führt zurück', async () => {
    const { onConfirm } = renderChooser({ multiple: true });
    upload('neu.png', 'brief.pdf', 'alt.png');
    const dialog = await labelingDialog();
    expect(within(dialog).getAllByTestId('labeling-row')).toHaveLength(2);
    expect(within(dialog).getAllByRole('radiogroup')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bildkennzeichnung' })).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Bilder wählen' })).toBeTruthy();
  });

  it('alle Dateien abgelehnt: kein Schritt', async () => {
    renderChooser({ multiple: true });
    upload('kaputt.exe');
    await waitFor(() => expect(uploadMediaAction).toHaveBeenCalled());
    await screen.findByText('Dateityp nicht erlaubt.');
    expect(screen.queryByRole('dialog', { name: 'Bildkennzeichnung' })).toBeNull();
  });

  it('nur PDF oder nur schon gekennzeichnete Bilder: kein Schritt', async () => {
    renderChooser({ multiple: true });
    upload('brief.pdf', 'alt.png');
    await waitFor(() => expect(uploadMediaAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Bildkennzeichnung' })).toBeNull();
  });

  it('ein Bild: „Übernehmen“ setzt die Datei mit ihrer Art und schließt beide Dialoge', async () => {
    const { onConfirm, onOpenChange } = renderChooser({ multiple: false });
    upload('neu.png');
    const dialog = await labelingDialog();
    fireEvent.click(within(dialog).getAllByRole('radio')[1]!);
    await waitFor(() => expect(setMediaAiKindAction).toHaveBeenCalledWith('n1', 'edited'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    expect(onConfirm).toHaveBeenCalledWith(['n1'], { n1: { width: 4, height: 3, aiKind: 'edited' } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ein Bild, mit × geschlossen: zurück im Auswahldialog, das Feld bleibt unverändert', async () => {
    const { onConfirm, onOpenChange } = renderChooser({ multiple: false });
    upload('neu.png');
    const dialog = await labelingDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: messages.common.close }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bildkennzeichnung' })).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('ohne „darf kennzeichnen“ kein Schritt: ein Bild landet wie bisher sofort im Feld', async () => {
    const { onConfirm } = renderChooser({ multiple: false, canLabel: false });
    upload('neu.png');
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(['n1'], { n1: { width: 4, height: 3 } }));
    expect(screen.queryByRole('dialog', { name: 'Bildkennzeichnung' })).toBeNull();
  });
});
