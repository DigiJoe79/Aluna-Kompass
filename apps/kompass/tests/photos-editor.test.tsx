// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
