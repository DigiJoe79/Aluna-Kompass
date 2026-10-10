// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhotosEditor } from '@/app/(shell)/animals/photos-editor';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const frame = { aspectRatio: '4 / 5', objectPosition: '50% 50%' };
const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ assetId: `a${i}`, isPrimary: i === 0 }));

/** Befund 6 (0.2.4): Die Grenze war erst beim Speichern zu erfahren, und dann nirgends am Feld. */
describe('PhotosEditor', () => {
  it('shows how many of the allowed photos are in use', () => {
    render(<PhotosEditor photos={photos(10)} max={12} onChange={() => {}} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    expect(screen.getByText('10 von 12 Fotos')).toBeTruthy();
  });

  it('shows the field error at the field', () => {
    render(<PhotosEditor photos={photos(13)} max={12} error="Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen." onChange={() => {}} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    const line = screen.getByText('Höchstens 12 Fotos. Entfernen Sie eines, bevor Sie ein neues hinzufügen.');
    // K10 § 4.5: Feldfehler über `FieldError`, also mit role="alert" und verbunden mit dem Knopf.
    expect(screen.getByRole('alert')).toBe(line);
    expect(screen.getByRole('button', { name: 'Fotos wählen' }).getAttribute('aria-describedby')).toBe(line.id);
    expect(screen.getByText('13 von 12 Fotos')).toBeTruthy();
  });

  it('shows no error line without an error', () => {
    render(<PhotosEditor photos={photos(1)} max={12} onChange={() => {}} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the crop of the source on a photo and says so, without it nothing (Board Vorschläge 7a)', () => {
    render(<PhotosEditor photos={[{ assetId: 'a0', isPrimary: true, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, { assetId: 'a1', isPrimary: false, crop: null }]} max={12} onChange={() => {}} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    expect(screen.getAllByTestId('crop-rect')).toHaveLength(1);
    expect(screen.getAllByText('Ausschnitt der Quelle')).toHaveLength(1);
  });

  it('marks the main photo with a badge and offers „Als Hauptfoto“ as ghost on the others (Befund 10, wie in der Prüfung)', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={photos(2)} max={12} onChange={onChange} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    expect(within(first!).getByText('Hauptfoto')).toBeTruthy();
    expect(within(first!).queryByRole('button', { name: 'Hauptfoto' })).toBeNull();
    expect(within(first!).queryByRole('button', { name: 'Als Hauptfoto' })).toBeNull();
    fireEvent.click(within(second!).getByRole('button', { name: 'Als Hauptfoto' }));
    expect(onChange).toHaveBeenCalledWith([{ assetId: 'a0', isPrimary: false }, { assetId: 'a1', isPrimary: true }]);
  });

  it('moves photos with named icon buttons instead of text arrows', () => {
    const onChange = vi.fn();
    render(<PhotosEditor photos={photos(2)} max={12} onChange={onChange} onChoose={() => {}} frame={frame} />, { wrapper: Intl });
    const [first, second] = screen.getAllByTestId('animal-photo');
    expect(within(first!).getByRole('button', { name: 'Nach vorn' }).hasAttribute('disabled')).toBe(true);
    expect(within(first!).getByRole('button', { name: 'Nach hinten' }).querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('←')).toBeNull();
    fireEvent.click(within(second!).getByRole('button', { name: 'Nach vorn' }));
    expect(onChange).toHaveBeenCalledWith([{ assetId: 'a1', isPrimary: false }, { assetId: 'a0', isPrimary: true }]);
  });
});
