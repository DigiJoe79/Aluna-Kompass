// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePlaces } from '@kompass/core/image-places';
import { initialPhotoState, photoChoices, PhotoReview, type PhotoState, type ReviewPhotoRow } from '@/app/(shell)/animals/proposals/[id]/photo-review';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const places = {
  primary: resolvePlaces(undefined, { fallback: '4:5', labelKey: 'media.crop.places.animalPrimary' }),
  gallery: resolvePlaces({ ratio: '4:3', width: 600 }, { labelKey: 'media.crop.places.animalGallery', lightbox: true, lightboxLabelKey: 'media.crop.places.lightbox' }),
  focus: { focusX: 50, focusY: 50 },
};
const CROP = { x: 0.1, y: 0, w: 0.6, h: 1 };
const base = { origin: 'source', defaultSelected: true, inProposal: true, proposedPrimary: false, currentPrimary: false, crop: null, sourceRef: null, width: null, height: null, conflict: false } as const;
/** Neu und vorgeschlagenes Titelbild (ohne Ausschnitt) · heutiges Titelbild aus Kompass mit Ausschnitt · Foto aus Kompass. */
const rows: ReviewPhotoRow[] = [
  { ...base, key: 'image:i1', imageId: 'i1', mediaId: null, change: 'new', proposedPrimary: true, sourceRef: 'hb-1.jpg', width: 4000, height: 3000 },
  { ...base, key: 'media:k1', imageId: null, mediaId: 'k1', origin: 'kompass', change: 'kept', inProposal: false, currentPrimary: true, crop: CROP },
  { ...base, key: 'media:k2', imageId: null, mediaId: 'k2', origin: 'kompass', change: 'kept', inProposal: false },
];
const sizes = { k1: { width: 3000, height: 4000 }, k2: { width: 3000, height: 2000 } };

function Harness({ readOnly, onState }: { readOnly?: boolean; onState?: (s: PhotoState) => void }) {
  const [state, setState] = useState(() => initialPhotoState(rows));
  return <PhotoReview rows={rows} state={state} onChange={(s) => { onState?.(s); setState(s); }} sourceName="Quelle" max={12} readOnly={readOnly} places={places} sizes={sizes} />;
}
const tiles = () => screen.getAllByTestId('proposal-photo');

/** Spec Ausschnitt in der Prüfung (2026-10-11), Board 2 und 4: Kachel wie im Tierformular, Knopf neben der Checkbox. */
describe('Fotoprüfung einer Änderung', () => {
  it('shows the result like the animal form: cropped image, line below, no shading and no hint sentence', () => {
    render(<Harness />, { wrapper: Intl });
    expect(screen.queryByTestId('crop-rect')).toBeNull();
    expect(within(tiles()[1]!).getByTestId('cropped-image')).toBeTruthy();
    expect(within(tiles()[1]!).getByRole('img', { name: 'Foto 2 aus Kompass, mit Ausschnitt' })).toBeTruthy();
    expect(within(tiles()[1]!).getByText('Ausschnitt')).toBeTruthy();
    expect(within(tiles()[0]!).getByText('ohne Ausschnitt')).toBeTruthy();
    expect(screen.queryByText(/Rahmen = Ausschnitt/)).toBeNull();
  });

  it('offers „Ausschnitt …“ only for photos that end up in the animal, also from Kompass', () => {
    render(<Harness />, { wrapper: Intl });
    expect(within(tiles()[0]!).getByRole('button', { name: 'Ausschnitt …' })).toBeTruthy();
    expect(within(tiles()[2]!).getByRole('button', { name: 'Ausschnitt …' })).toBeTruthy();
    fireEvent.click(within(tiles()[2]!).getByRole('checkbox', { name: 'danach dabei: Foto 3 aus Kompass' }));
    expect(within(tiles()[2]!).queryByRole('button', { name: 'Ausschnitt …' })).toBeNull();
  });

  it('read only: no checkbox, no button, the tile shows the result', () => {
    render(<Harness readOnly />, { wrapper: Intl });
    expect(screen.queryByRole('button', { name: 'Ausschnitt …' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(within(tiles()[1]!).getByTestId('cropped-image')).toBeTruthy();
  });

  it('the dialog sets the crop of a Kompass photo in the state of the page, saved with accepting', () => {
    let last: PhotoState | undefined;
    render(<Harness onState={(s) => (last = s)} />, { wrapper: Intl });
    fireEvent.click(within(tiles()[2]!).getByRole('button', { name: 'Ausschnitt …' }));
    expect(screen.getByText('Gespeichert wird mit dem Annehmen.')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    expect(last!.crops['media:k2']).toBeTruthy();
    expect(within(tiles()[2]!).getByTestId('cropped-image')).toBeTruthy();
  });

  it('switching the primary in ChoiceCompare removes the crop of the old one and announces it; back brings it again', () => {
    render(<Harness />, { wrapper: Intl });
    const choice = screen.getByTestId('proposal-primary-choice');
    fireEvent.click(within(choice).getByRole('radio', { name: /Heute behalten/ }));
    // Vom vorgeschlagenen (ohne Ausschnitt) zum heutigen: nichts entfernt, keine Ansage.
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('');
    fireEvent.click(within(choice).getByRole('radio', { name: /Wechseln/ }));
    expect(within(tiles()[1]!).getByText('ohne Ausschnitt')).toBeTruthy();
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('Titelbild ist jetzt Foto 1 von Quelle. Ausschnitt von Foto 2 aus Kompass entfernt.');
    fireEvent.click(within(choice).getByRole('radio', { name: /Heute behalten/ }));
    expect(within(tiles()[1]!).getByTestId('cropped-image')).toBeTruthy();
  });

  /** Backlog 79: Die Kennung der Quelle (`sourceRef`) dient dem Abgleich, nicht dem Menschen; die Wahl zeigt beide Bilder. */
  it('79: the primary choice shows both photos with source and position, never the source reference', () => {
    render(<Harness />, { wrapper: Intl });
    const choice = screen.getByTestId('proposal-primary-choice');
    expect(within(choice).getAllByRole('img')).toHaveLength(2);
    // Die Kennung der Quelle bleibt dem Abgleich vorbehalten — nirgends in Anzeige oder Namen für Vorleser.
    expect(document.body.innerHTML).not.toContain('hb-1.jpg');
  });

  it('deselecting the primary runs through the same rule: the old one keeps its crop, nothing is announced', () => {
    render(<Harness />, { wrapper: Intl });
    fireEvent.click(within(screen.getByTestId('proposal-primary-choice')).getByRole('radio', { name: /Heute behalten/ }));
    fireEvent.click(within(tiles()[1]!).getByRole('checkbox', { name: 'danach dabei: Foto 2 aus Kompass' }));
    expect(screen.getByTestId('primary-crop-announcement').textContent).toBe('');
    fireEvent.click(within(tiles()[1]!).getByRole('checkbox', { name: 'danach dabei: Foto 2 aus Kompass' }));
    expect(within(tiles()[1]!).getByTestId('cropped-image')).toBeTruthy();
  });

  /**
   * 051 (Review Focus 5): Jedes Kästchen fragt „danach dabei“ — angehakt, wenn das Foto nach dem Annehmen da ist. Die
   * Richtung des Hakens dreht sich bei „entfernen“ und „abwählen“, gespeichert wird beim Annehmen dasselbe wie vorher.
   */
  it('051: every checkbox asks „danach dabei“, checked means the photo stays; accepting stores the same as before', () => {
    const mixed: ReviewPhotoRow[] = [
      { ...base, key: 'image:i1', imageId: 'i1', mediaId: null, change: 'new', proposedPrimary: true, sourceRef: 'hb-1.jpg' },
      { ...base, key: 'media:d1', imageId: null, mediaId: 'd1', change: 'dropped', inProposal: false, defaultSelected: false, sourceRef: 'hb-alt.jpg' },
      { ...base, key: 'media:k2', imageId: null, mediaId: 'k2', origin: 'kompass', change: 'kept', inProposal: false },
    ];
    let last: PhotoState = initialPhotoState(mixed);
    function Mixed() {
      const [state, setState] = useState(() => initialPhotoState(mixed));
      return <PhotoReview rows={mixed} state={state} onChange={(s) => { last = s; setState(s); }} sourceName="Quelle" max={12} places={places} sizes={sizes} />;
    }
    render(<Mixed />, { wrapper: Intl });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(['danach dabei: Foto 1 von Quelle', 'danach dabei: Foto 2 von Quelle', 'danach dabei: Foto 3 aus Kompass']);
    // Angehakt heißt: nach dem Annehmen dabei. Das wegfallende Foto ist leer, das neue und das aus Kompass angehakt.
    expect(boxes.map((b) => b.getAttribute('aria-checked') ?? String((b as HTMLInputElement).checked))).toEqual(['true', 'false', 'true']);
    // Vorher hieß dieselbe Wahl „entfernen“ ab- und „abwählen“ angehakt: Das wegfallende Foto bleibt doch, das aus Kompass geht.
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[2]!);
    expect(last.selected).toEqual({ 'image:i1': true, 'media:d1': true, 'media:k2': false });
    expect(photoChoices(mixed, last)).toEqual([
      { imageId: 'i1', isPrimary: true, crop: null },
      { mediaId: 'd1', isPrimary: false, crop: null },
    ]);
  });
});
