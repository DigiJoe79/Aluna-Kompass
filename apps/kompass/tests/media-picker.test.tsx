// @vitest-environment jsdom
import { resolvePlaces, derivedAssetId } from '@kompass/core/image-places';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaPicker } from '@/components/forms/media-picker';
import messages from '../messages/de.json';

vi.mock('@/components/media/media-chooser-dialog', () => ({
  // Der Dialog wählt sofort „neu“ mit Maßen, sobald er offen ist.
  MediaChooserDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (ids: string[], sizes: Record<string, { width: number; height: number }>) => void }) =>
    open ? (
      <button type="button" onClick={() => onConfirm(['NEU'], { NEU: { width: 2000, height: 1000 } })}>
        neu wählen
      </button>
    ) : null,
}));

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

const team = resolvePlaces({ ratio: '1:1', width: 320 }, { label: 'Team' });
type Props = ComponentProps<typeof MediaPicker>;
const pick = (props: Partial<Props>) => {
  const { container } = render(<form><MediaPicker name="photo" value="A" label="Foto" {...props} /></form>, { wrapper: Intl });
  return { hidden: (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`)! };
};

/** Handover alle Bilder 3 / Board 2: dritter Knopf, Vorschau im Format der Stelle, „· Ausschnitt“. */
describe('MediaPicker mit Ausschnitt', () => {
  it('ohne Stelle (Logo) kein Knopf „Ausschnitt …“', () => {
    pick({ sizes: { A: { width: 1500, height: 1500 } } });
    expect(screen.queryByRole('button', { name: 'Foto: Ausschnitt …' })).toBeNull();
  });

  it('Knopf zwischen „Wählen“ und „Entfernen“ nur bei gewähltem Rasterbild mit Stelle', () => {
    pick({ places: team, sizes: { A: { width: 1500, height: 1500 } }, derived: true, target: 'dem Eintrag' });
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Wählen', 'Ausschnitt …', 'Bild entfernen']);
    cleanup();
    // Ohne Maße (SVG, unbekannt): kein Knopf.
    pick({ places: team, derived: true });
    expect(screen.queryByRole('button', { name: 'Foto: Ausschnitt …' })).toBeNull();
    cleanup();
    pick({ places: team, value: null, derived: true });
    expect(screen.queryByRole('button', { name: 'Foto: Ausschnitt …' })).toBeNull();
  });

  it('Template-Feld: der Wert ist die abgeleitete ID; „· Ausschnitt“ hinter dem Namen, Vorschau im Format der Stelle', () => {
    const onChange = vi.fn();
    const { hidden } = pick({ places: team, sizes: { A: { width: 1500, height: 1500 } }, derived: true, target: 'dem Eintrag', onChange });
    expect(screen.queryByText('· Ausschnitt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Foto: Ausschnitt …' }));
    expect(screen.getByText('fest für Team')).toBeTruthy();
    expect(screen.getByText('Gespeichert wird mit dem Eintrag.')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: '+' });
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    const value = onChange.mock.lastCall![0] as string;
    expect(value.startsWith('A~')).toBe(true);
    expect(hidden('photo').value).toBe(value);
    expect(screen.getByText('· Ausschnitt')).toBeTruthy();
    expect(screen.getByTestId('cropped-image').style.aspectRatio).toBe('1 / 1');
  });

  it('liest einen gespeicherten Ausschnitt aus der abgeleiteten ID; unter der Schwelle „· nur … px breit“', () => {
    pick({ places: team, value: derivedAssetId('A', { x: 0, y: 0, w: 0.25, h: 0.25 }), sizes: { A: { width: 1500, height: 1500 } }, derived: true });
    expect(screen.getByText('· nur 375 px breit')).toBeTruthy();
  });

  it('eigenes Feld (Projekt, Geschichte): Ausschnitt als JSON daneben; anderes Bild und Entfernen verwerfen ihn', () => {
    const onCropChange = vi.fn();
    const crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const { hidden } = pick({ name: 'imageAssetId', places: team, sizes: { A: { width: 1500, height: 1500 } }, crop, cropName: 'imageCrop', onCropChange });
    expect(hidden('imageAssetId').value).toBe('A');
    expect(JSON.parse(hidden('imageCrop').value)).toEqual(crop);
    fireEvent.click(screen.getByRole('button', { name: /Wählen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'neu wählen' }));
    expect(hidden('imageAssetId').value).toBe('NEU');
    expect(hidden('imageCrop').value).toBe('');
    expect(onCropChange).toHaveBeenLastCalledWith(null);
    // Das neue Bild bringt seine Maße aus dem Dialog mit: gleich zuschneidbar.
    expect(screen.getByRole('button', { name: 'Foto: Ausschnitt …' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bild entfernen' }));
    expect(hidden('imageAssetId').value).toBe('');
  });

  it('Stelle ohne Format (Projekt ohne Angabe): Vorschau zeigt den Ausschnitt wie gewählt', () => {
    pick({ places: resolvePlaces(undefined, { label: 'Projektbild' }), sizes: { A: { width: 1600, height: 1200 } }, crop: { x: 0, y: 0, w: 0.75, h: 1 }, cropName: 'imageCrop' });
    expect(screen.getByTestId('cropped-image')).toBeTruthy();
  });

  it('Template-Feld folgt einem neuen Wert von außen (Verwerfen, Liste umsortiert); der Ausschnitt gilt dann dem neuen Bild', () => {
    const onChange = vi.fn();
    const sizes = { A: { width: 1500, height: 1500 }, B: { width: 1500, height: 1500 } };
    const ui = (value: string) => <form><MediaPicker name="photo" value={value} label="Foto" places={team} sizes={sizes} derived onChange={onChange} /></form>;
    const { container, rerender } = render(ui('A~0_0_5000_5000'), { wrapper: Intl });
    rerender(ui('B'));
    expect(container.querySelector<HTMLInputElement>('input[name="photo"]')!.value).toBe('B');
    expect(screen.queryByText('· Ausschnitt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Foto: Ausschnitt …' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    expect(String(onChange.mock.lastCall![0]).startsWith('B~')).toBe(true);
  });

  it('dasselbe Bild noch einmal wählen behält den Ausschnitt', () => {
    const { hidden } = pick({ name: 'imageAssetId', value: 'NEU', places: team, sizes: { NEU: { width: 2000, height: 1000 } }, crop: { x: 0, y: 0, w: 0.5, h: 1 }, cropName: 'imageCrop' });
    fireEvent.click(screen.getByRole('button', { name: /Wählen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'neu wählen' }));
    expect(hidden('imageCrop').value).not.toBe('');
  });

  it('meldet jede Änderung als Eingabe am Formular, damit die Speicherleiste zählt', () => {
    const { hidden } = pick({ name: 'imageAssetId', places: team, sizes: { A: { width: 1500, height: 1500 } }, crop: null, cropName: 'imageCrop' });
    const seen = vi.fn();
    hidden('imageAssetId').form!.addEventListener('input', seen);
    fireEvent.click(screen.getByRole('button', { name: 'Foto: Ausschnitt …' }));
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Ausschnitt' }), { key: 'Enter' });
    expect(seen).toHaveBeenCalled();
  });
});
