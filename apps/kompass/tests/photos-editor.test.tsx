// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotosEditor, type EditorPhoto } from '@/app/(shell)/animals/photos-editor';
import { MediaLabelingProvider } from '@/components/media/media-labeling-provider';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const getMediaLabelingAction = vi.fn();
vi.mock('@/app/(shell)/admin/media/actions', () => ({
  getMediaLabelingAction: (...a: unknown[]) => getMediaLabelingAction(...a),
  setMediaAiKindAction: vi.fn(async () => ({ status: 'success' })),
}));

import { resolvePlaces } from '@kompass/core/image-places';

// Hauptfoto ohne Angabe im Template: Rückfall Einstellung 4:5; Galerie 4:3 aus dem Template, mit Lightbox.
const primary = resolvePlaces(undefined, { fallback: '4:5', labelKey: 'media.crop.places.animalPrimary' });
const gallery = resolvePlaces({ ratio: '4:3', width: 600 }, { labelKey: 'media.crop.places.animalGallery', lightbox: true, lightboxLabelKey: 'media.crop.places.lightbox' });
const places = { primary, gallery, focus: { focusX: 50, focusY: 50 } };
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ assetId: `a${i}`, isPrimary: i === 0 }));

/** Befund 6 (0.2.4): Die Grenze war erst beim Speichern zu erfahren, und dann nirgends am Feld. */
describe('PhotosEditor', () => {
  // 045: „1 von 12 Fotos“ las sich wie „Foto 1 von 12“; gemeint ist die Obergrenze.
  it('shows how many photos are in use and the upper limit', () => {
    render(<PhotosEditor photos={photos(10)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.getByText('10 Fotos, höchstens 12')).toBeTruthy();
    cleanup();
    render(<PhotosEditor photos={photos(1)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.getByText('1 Foto, höchstens 12')).toBeTruthy();
  });

  it('shows the field error at the field', () => {
    render(<PhotosEditor photos={photos(13)} max={12} error="Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen." onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const line = screen.getByText('Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen.');
    // K10 § 4.5: Feldfehler über `FieldError`, also mit role="alert" und verbunden mit dem Knopf.
    expect(screen.getByRole('alert')).toBe(line);
    expect(screen.getByRole('button', { name: 'Fotos wählen' }).getAttribute('aria-describedby')).toBe(line.id);
    expect(screen.getByText('13 Fotos, höchstens 12')).toBeTruthy();
  });

  it('shows no error line without an error', () => {
    render(<PhotosEditor photos={photos(1)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows each tile as the website shows it: the crop as result, no shading (Handover Ausschnitt, Raster)', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, crop: { x: 0.2, y: 0, w: 0.6, h: 1 }, width: 4000, height: 3000 }, { assetId: 'a1', isPrimary: false, crop: null, width: 4000, height: 3000 }]} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const [withCrop, without] = screen.getAllByTestId('animal-photo');
    expect(screen.queryByTestId('crop-rect')).toBeNull();
    expect(screen.queryByTestId('crop-shade')).toBeNull();
    expect(within(withCrop!).getByTestId('cropped-image')).toBeTruthy();
    expect(within(withCrop!).getByText('Ausschnitt')).toBeTruthy();
    expect(within(without!).queryByTestId('cropped-image')).toBeNull();
    // Kein Hauptfoto: im Format der Galerie (4:3).
    expect((within(without!).getByRole('link').querySelector('img') as HTMLImageElement).style.aspectRatio).toBe('4 / 3');
    expect(within(without!).getByText('ohne Ausschnitt')).toBeTruthy();
  });

  it('warns in the tile when the crop is narrower than the main image of the website', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, crop: { x: 0, y: 0, w: 0.2, h: 0.3 }, width: 4000, height: 3000 }]} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.getByText('Ausschnitt · nur 800 px breit')).toBeTruthy();
  });

  // N3 (Spec Bildkennzeichnung beim Hochladen § 5): rechts, was das Bild betrifft, in dieser Reihenfolge.
  it('offers „Ausschnitt …“ before „Bild entfernen“, only when the pixel size is known', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, crop: null, width: 4000, height: 3000 }, { assetId: 'a1', isPrimary: false, crop: null }]} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const [known, unknown] = screen.getAllByTestId('animal-photo');
    const names = within(known!).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.indexOf('Ausschnitt …')).toBe(names.indexOf('Bild entfernen') - 1);
    expect(within(unknown!).queryByRole('button', { name: 'Ausschnitt …' })).toBeNull();
  });

  it('„Ausschnitt …“ öffnet den Dialog; Übernehmen ändert nur den Stand der Maske', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, crop: null, width: 4000, height: 3000 }, { assetId: 'a1', isPrimary: false, crop: { x: 0, y: 0, w: 0.6, h: 1 }, width: 4000, height: 3000 }]} max={12} onChange={onChange} onChoose={() => {}} places={places} />, { wrapper: Intl });
    fireEvent.click(within(screen.getAllByTestId('animal-photo')[0]!).getByRole('button', { name: 'Ausschnitt …' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith([
      { assetId: 'a0', isPrimary: true, crop: { x: 0.2, y: 0, w: 0.6, h: 1 }, width: 4000, height: 3000 },
      { assetId: 'a1', isPrimary: false, crop: { x: 0, y: 0, w: 0.6, h: 1 }, width: 4000, height: 3000 },
    ]);
  });

  it('„Ausschnitt entfernen“ setzt den Ausschnitt des Fotos auf null', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={[{ assetId: 'a1', isPrimary: true, crop: { x: 0, y: 0, w: 0.6, h: 1 }, width: 4000, height: 3000 }]} max={12} onChange={onChange} onChoose={() => {}} places={places} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Ausschnitt …' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ausschnitt entfernen' }));
    expect(onChange).toHaveBeenLastCalledWith([{ assetId: 'a1', isPrimary: true, crop: null, width: 4000, height: 3000 }]);
  });

  it('Kachel im Format ihrer Stelle: Hauptfoto 4:5, übrige Fotos im Format der Galerie', () => {
    render(<PhotosEditor photos={photos(2)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    expect((within(first!).getByRole('link').querySelector('img') as HTMLImageElement).style.aspectRatio).toBe('4 / 5');
    expect((within(second!).getByRole('link').querySelector('img') as HTMLImageElement).style.aspectRatio).toBe('4 / 3');
  });

  it('Hauptfoto: Format fest „für das Titelbild“, bei Rückfall mit der Einstellung; übrige: Vorschau mit Galerie und Lightbox', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, width: 4000, height: 3000 }, { assetId: 'a1', isPrimary: false, width: 4000, height: 3000 }]} max={12} onChange={() => {}} onChoose={() => {}} places={{ ...places, gallery: resolvePlaces(undefined, { labelKey: 'media.crop.places.animalGallery', lightbox: true, lightboxLabelKey: 'media.crop.places.lightbox' }) }} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    fireEvent.click(within(first!).getByRole('button', { name: 'Ausschnitt …' }));
    expect(screen.getByText('fest für das Titelbild · Einstellung „Bildausschnitt“')).toBeTruthy();
    expect(screen.getByText('Gespeichert wird mit dem Tier.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    fireEvent.click(within(second!).getByRole('button', { name: 'Ausschnitt …' }));
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeTruthy();
    expect(screen.getByText('Galerie · wie gewählt')).toBeTruthy();
    expect(screen.getByText('Lightbox · wie gewählt')).toBeTruthy();
  });

  it('Hauptfoto aus dem Template: ohne Hinweis auf die Einstellung', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, width: 4000, height: 3000 }]} max={12} onChange={() => {}} onChoose={() => {}} places={{ ...places, primary: resolvePlaces({ ratio: '4:5', width: 600 }, { labelKey: 'media.crop.places.animalPrimary' }) }} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Ausschnitt …' }));
    expect(screen.getByText('fest für das Titelbild')).toBeTruthy();
  });

  // Joe 2026-10-22: Der Stern am Hauptfoto ist gedrückt und ohne Wirkung, aber nicht gesperrt.
  it('the star is pressed at the main photo, does nothing there and is not disabled; elsewhere it makes the main photo', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={photos(2)} max={12} onChange={onChange} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    const star = within(first!).getByRole('button', { name: 'Als Hauptfoto' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(star.hasAttribute('disabled')).toBe(false);
    fireEvent.click(star);
    expect(onChange).not.toHaveBeenCalled();
    const other = within(second!).getByRole('button', { name: 'Als Hauptfoto' });
    expect(other.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(other);
    expect(onChange).toHaveBeenCalledWith([{ assetId: 'a0', isPrimary: false }, { assetId: 'a1', isPrimary: true }]);
  });

  it('moves photos with named icon buttons instead of text arrows', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={photos(2)} max={12} onChange={onChange} onChoose={() => {}} places={places} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    expect(within(first!).getByRole('button', { name: 'Nach vorn' }).hasAttribute('disabled')).toBe(true);
    expect(within(first!).getByRole('button', { name: 'Nach hinten' }).querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('←')).toBeNull();
    fireEvent.click(within(second!).getByRole('button', { name: 'Nach vorn' }));
    expect(onChange).toHaveBeenCalledWith([{ assetId: 'a1', isPrimary: false }, { assetId: 'a0', isPrimary: true }]);
  });
});

/**
 * Titelbild wechseln (Spec Ausschnitt in der Prüfung § 2.4, Board 4): Der Ausschnitt des alten Titelbilds fällt weg,
 * die Maske merkt ihn bis Speichern oder Verwerfen; Zurückwechseln bringt ihn wieder. Ansage nur bei echtem Entfernen.
 */
describe('PhotosEditor: Titelbild wechseln', () => {
  const CROP = { x: 0.2, y: 0, w: 0.6, h: 1 };
  function Harness({ initial, spy }: { initial: EditorPhoto[]; spy?: (p: EditorPhoto[]) => void }) {
    const [list, setList] = useState(initial);
    return <PhotosEditor photos={list} max={12} onChange={(n) => { spy?.(n); setList(n); }} onChoose={() => {}} places={places} />;
  }
  const start = (): EditorPhoto[] => [
    { assetId: 'a0', isPrimary: true, crop: CROP, width: 4000, height: 3000, name: 'hb-1.jpg' },
    { assetId: 'a1', isPrimary: false, crop: null, width: 4000, height: 3000, name: 'hb-2.jpg' },
  ];
  const tiles = () => screen.getAllByTestId('animal-photo');

  it('removes the crop of the old main photo, announces it, and brings it back when switching back', () => {
    const spy = vi.fn();
    render(<Harness initial={start()} spy={spy} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[1]!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(spy).toHaveBeenLastCalledWith([expect.objectContaining({ assetId: 'a0', isPrimary: false, crop: null }), expect.objectContaining({ assetId: 'a1', isPrimary: true, crop: null })]);
    expect(within(tiles()[0]!).getByText('ohne Ausschnitt')).toBeTruthy();
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('Titelbild ist jetzt hb-2.jpg. Ausschnitt von hb-1.jpg entfernt.');
    expect(screen.getByTestId('primary-crop-announcement').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(within(tiles()[0]!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(spy).toHaveBeenLastCalledWith([expect.objectContaining({ assetId: 'a0', isPrimary: true, crop: CROP }), expect.objectContaining({ assetId: 'a1', isPrimary: false })]);
    // Zurück ohne Entfernen: keine Ansage.
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('');
  });

  it('without a crop on the old main photo there is nothing to announce', () => {
    render(<Harness initial={[{ ...start()[0]!, crop: null }, start()[1]!]} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[1]!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('');
  });

  it('„Übernehmen“ at the old main photo drops what was remembered', () => {
    const spy = vi.fn();
    render(<Harness initial={start()} spy={spy} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[1]!).getByRole('button', { name: 'Als Hauptfoto' }));
    fireEvent.click(within(tiles()[0]!).getByRole('button', { name: 'Ausschnitt …' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    fireEvent.click(within(tiles()[0]!).getByRole('button', { name: 'Ausschnitt …' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    const applied = spy.mock.lastCall![0][0].crop;
    fireEvent.click(within(tiles()[0]!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(spy.mock.lastCall![0][0].crop).toEqual(applied);
    expect(applied).not.toEqual(CROP);
  });

  it('removing the main photo keeps no crop to announce and gives the next one nothing', () => {
    const spy = vi.fn();
    render(<Harness initial={start()} spy={spy} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[0]!).getByRole('button', { name: 'Bild entfernen' }));
    expect(spy).toHaveBeenLastCalledWith([expect.objectContaining({ assetId: 'a1', crop: null })]);
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('');
  });

  it('names a photo without source reference by its place', () => {
    render(<Harness initial={start().map(({ name: _n, ...p }) => p)} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[1]!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('Titelbild ist jetzt Foto 2. Ausschnitt von Foto 1 entfernt.');
  });

  it('shows the AI badge on a tile whose photo carries a kind, and none on the others (Spec KI-Transparenz)', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, aiKind: 'generated' }, { assetId: 'a1', isPrimary: false }]} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.getAllByTestId('ai-kind-badge').map((b) => b.textContent)).toEqual(['KI erstellt']);
  });
});

/** Spec Bildkennzeichnung beim Hochladen § 4: „Kennzeichnen …“ an der Kachel, nur wer kennzeichnen darf. */
describe('PhotosEditor: Kennzeichnen', () => {
  const Labeling = ({ children }: { children: ReactNode }) => (
    <Intl>
      <MediaLabelingProvider canLabel>{children}</MediaLabelingProvider>
    </Intl>
  );

  it('without the permission or with labeling off there is no button', () => {
    render(<PhotosEditor photos={photos(1)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Kennzeichnen …' })).toBeNull();
  });

  it('opens the dialog with the usage and shows the new badge without reloading', async () => {
    getMediaLabelingAction.mockResolvedValue({ status: 'success', data: { id: 'a0', filename: 'a0.jpg', mimeType: 'image/jpeg', aiKind: 'none', references: [{ label: 'Tier „Rex“' }] } });
    render(<PhotosEditor photos={photos(1)} max={12} onChange={() => {}} onChoose={() => {}} places={places} />, { wrapper: Labeling });
    fireEvent.click(screen.getByRole('button', { name: 'Kennzeichnen …' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bildkennzeichnung' });
    expect(getMediaLabelingAction).toHaveBeenCalledWith('a0');
    expect(within(dialog).getByText('Tier „Rex“')).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole('radio')[2]!);
    await waitFor(() => expect(within(screen.getByTestId('animal-photo')).getByTestId('ai-kind-badge')).toBeTruthy());
  });
});
