// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CropEditor } from '@/components/media/crop-editor';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

type Props = ComponentProps<typeof CropEditor>;
function open(overrides: Partial<Props> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CropEditor
      open
      onOpenChange={onOpenChange}
      src="/media/a/preview"
      width={4000}
      height={3000}
      formats={['4:5']}
      fixedReason="das Titelbild"
      places={[{ label: 'Titelbild', ratio: '4:5', minWidthPx: 960 }]}
      note="Gespeichert wird mit dem Tier."
      crop={null}
      onApply={onApply}
      {...overrides}
    />,
    { wrapper: Intl },
  );
  const rect = screen.getByRole('slider', { name: 'Ausschnitt' });
  const key = (k: string, init: { shiftKey?: boolean } = {}) => fireEvent.keyDown(rect, { key: k, ...init });
  return { onApply, onOpenChange, rect, key };
}

/** Verhalten mit Tastatur und Knöpfen; die Gesten mit Maus und Fingern prüft der E2E (Plan B Task 5). */
describe('CropEditor', () => {
  it('startet ohne Ausschnitt größtmöglich am Blickpunkt; Enter übernimmt genau das', () => {
    const { onApply, rect, key } = open();
    expect(rect.getAttribute('aria-valuetext')).toBe('2400 × 3000 px, Mitte');
    expect(screen.getByText('2400 × 3000 px')).toBeTruthy();
    key('Enter');
    expect(onApply).toHaveBeenCalledWith({ x: 0.2, y: 0, w: 0.6, h: 1 });
  });

  it('Pfeile verschieben 1 %, mit Umschalt 10 %, und halten am Rand', () => {
    const { onApply, key } = open();
    key('ArrowRight');
    key('ArrowRight', { shiftKey: true });
    key('Enter');
    expect(onApply).toHaveBeenLastCalledWith({ x: 0.31, y: 0, w: 0.6, h: 1 });
    for (let i = 0; i < 5; i++) key('ArrowLeft', { shiftKey: true });
    key('ArrowDown');
    key('Enter');
    expect(onApply).toHaveBeenLastCalledWith({ x: 0, y: 0, w: 0.6, h: 1 });
  });

  it('+ und − zoomen um 0,05× um die Mitte, Grenze 1,9×; 0 setzt das ganze Format', () => {
    const { onApply, rect, key } = open();
    key('+');
    key('Enter');
    const z = onApply.mock.lastCall![0];
    expect(z.w).toBeCloseTo(0.6 / 1.05, 4);
    expect(z.x + z.w / 2).toBeCloseTo(0.5, 4);
    for (let i = 0; i < 30; i++) key('+');
    expect((screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement).value).toBe('1.9');
    expect(screen.getByRole('button', { name: 'Hineinzoomen' }).hasAttribute('disabled')).toBe(true);
    expect(rect.getAttribute('aria-valuetext')).toBe('1263 × 1579 px, Mitte');
    key('0');
    key('Enter');
    expect(onApply).toHaveBeenLastCalledWith({ x: 0.2, y: 0, w: 0.6, h: 1 });
    key('-');
    expect((screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement).value).toBe('1');
  });

  it('der Schieber setzt den Zoom', () => {
    const { onApply, key } = open();
    fireEvent.change(screen.getByRole('slider', { name: 'Zoom' }), { target: { value: '1.5' } });
    key('Enter');
    expect(onApply.mock.lastCall![0].w).toBeCloseTo(0.4, 4);
  });

  it('„Übernehmen“ in der Leiste liefert den gerundeten Ausschnitt', () => {
    const { onApply, key } = open({ crop: { x: 0.1, y: 0, w: 0.6, h: 1 } });
    key('+');
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const c = onApply.mock.lastCall![0];
    for (const v of Object.values(c) as number[]) expect(Math.round(v * 10_000) / 10_000).toBe(v);
    expect(screen.getByText('Gespeichert wird mit dem Tier.')).toBeTruthy();
  });

  it('„Ausschnitt entfernen“ nur bei vorhandenem Ausschnitt, „Ganzes Format“ sobald gezoomt ist; Entfernen liefert null', () => {
    const first = open();
    expect(screen.queryByRole('button', { name: 'Ausschnitt entfernen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ganzes Format' })).toBeNull();
    // Designer 2026-10-10 (e): auch ohne gespeicherten Ausschnitt, sobald das Rechteck kleiner als das ganze Format ist.
    first.key('+');
    expect(screen.getByRole('button', { name: 'Ganzes Format' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ausschnitt entfernen' })).toBeNull();
    cleanup();
    const { onApply } = open({ crop: { x: 0.3, y: 0.2, w: 0.3, h: 0.5 } });
    fireEvent.click(screen.getByRole('button', { name: 'Ganzes Format' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    expect(onApply).toHaveBeenLastCalledWith({ x: 0.15, y: 0, w: 0.6, h: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Ausschnitt entfernen' }));
    expect(onApply).toHaveBeenLastCalledWith(null);
  });

  it('Formatwechsel: legt das größte Rechteck im neuen Format mittig hinein und sagt es', () => {
    const { onApply, key } = open({ formats: ['4:3'], crop: { x: 0.2, y: 0, w: 0.6, h: 1 } });
    expect(screen.getByText('Der Ausschnitt hatte das Format 4:5 und wird beim Übernehmen auf 4:3 angepasst.')).toBeTruthy();
    key('Enter');
    expect(onApply).toHaveBeenLastCalledWith({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });
  });

  it('im Format kein Satz zum Format', () => {
    open({ crop: { x: 0.2, y: 0, w: 0.6, h: 1 } });
    expect(screen.queryByText(/hatte das Format/)).toBeNull();
  });

  it('warnt unter der Hauptbild-Breite, sperrt aber nicht; schmales Original: nur „größeres Original“', () => {
    const { onApply, key } = open({ width: 800, height: 600 });
    const warn = screen.getByRole('status');
    expect(warn.textContent).toContain('Der Ausschnitt ist nur 480 px breit.');
    expect(warn.textContent).toContain('Die Webseite nimmt für Titelbild bis 960 px; für diesen Ausschnitt zeigt sie ein kleineres.');
    expect(warn.textContent).toContain('ein größeres Original wählen');
    expect(warn.textContent).not.toContain('größer ziehen');
    key('Enter');
    expect(onApply).toHaveBeenCalled();
  });

  it('Warnung erst unter der Schwelle, mit beiden Auswegen', () => {
    const { key } = open({ width: 2000, height: 1500 });
    expect(screen.queryByText(/ist nur/)).toBeNull();
    for (let i = 0; i < 10; i++) key('+');
    expect(screen.getByText(/Der Ausschnitt ist nur 8\d\d px breit/)).toBeTruthy();
    expect(screen.getByText(/Ausschnitt größer ziehen · ein größeres Original wählen/)).toBeTruthy();
  });

  it('ein vorhandener Ausschnitt über 1,9× startet an der Grenze, um seine Mitte', () => {
    const { onApply, rect, key } = open({ crop: { x: 0.4, y: 0.4, w: 0.1, h: 1 / 6 } });
    expect((screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement).value).toBe('1.9');
    expect(Number(rect.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(1.9);
    key('Enter');
    const c = onApply.mock.lastCall![0];
    expect(c.w).toBeCloseTo(0.6 / 1.9, 4);
    expect(c.x + c.w / 2).toBeCloseTo(0.45, 3);
  });

  it('festes Format: Zeile „fest für …“ statt der Reihe', () => {
    open();
    expect(screen.getByText('fest für das Titelbild')).toBeTruthy();
    expect(screen.getByText('4:5')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Format' })).toBeNull();
  });

  it('ohne Grund nennt die Zeile die Stelle', () => {
    open({ formats: ['1:1'], fixedReason: undefined, places: [{ label: 'Team', ratio: '1:1', minWidthPx: 480 }] });
    expect(screen.getByText('fest für Team')).toBeTruthy();
  });

  it('volle Reihe: vorgewählt Original, Quer/Hoch erst bei einem gedrehten Format', () => {
    const { onApply, key } = open({ formats: [], fixedReason: undefined, places: [{ label: 'Galerie', ratio: 'original', minWidthPx: 960 }] });
    const row = screen.getByRole('radiogroup', { name: 'Format' });
    expect(Array.from(row.querySelectorAll('[role="radio"]')).map((r) => r.textContent)).toEqual(['Original', '1:1', '4:3', '3:2', '16:9']);
    expect(screen.getByRole('radio', { name: 'Original' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radiogroup', { name: 'Ausrichtung' })).toBeNull();
    key('Enter');
    expect(onApply).toHaveBeenLastCalledWith({ x: 0, y: 0, w: 1, h: 1 });
    fireEvent.click(screen.getByRole('radio', { name: '3:2' }));
    expect(screen.getByRole('radiogroup', { name: 'Ausrichtung' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Hoch' }));
    expect(screen.getByRole('radio', { name: '2:3' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    // 2:3 auf 4000 × 3000: 2000 × 3000, mittig.
    expect(onApply).toHaveBeenLastCalledWith({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('Hoch bleibt Hoch, auch wenn man kurz Original oder 1:1 wählt', () => {
    open({ formats: [], fixedReason: undefined, places: [{ label: 'Galerie', ratio: 'original', minWidthPx: 960 }] });
    fireEvent.click(screen.getByRole('radio', { name: '4:3' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hoch' }));
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }));
    const row = screen.getByRole('radiogroup', { name: 'Format' });
    expect(Array.from(row.querySelectorAll('[role="radio"]')).map((r) => r.textContent)).toEqual(['Original', '1:1', '3:4', '2:3', '9:16']);
  });

  it('Feld mit zwei Formaten derselben Stelle: Hinweis auf die Breite nur einmal', () => {
    open({ width: 400, height: 400, formats: ['4:3', '16:9'], fixedReason: undefined, places: [{ label: 'Bild', ratio: '4:3', minWidthPx: 960 }, { label: 'Bild', ratio: '16:9', minWidthPx: 960 }] });
    expect(screen.getAllByText(/Die Webseite nimmt für Bild/)).toHaveLength(1);
  });

  it('mehrere Formate: nur diese, vorgewählt das erste, ohne Umschalter', () => {
    open({ formats: ['16:10', '16:9'], fixedReason: undefined, places: [{ label: 'Kachel', ratio: '16:10', minWidthPx: 960 }, { label: 'Titelbild', ratio: '16:9', minWidthPx: 1600 }] });
    const row = screen.getByRole('radiogroup', { name: 'Format' });
    expect(Array.from(row.querySelectorAll('[role="radio"]')).map((r) => r.textContent)).toEqual(['16:10', '16:9']);
    expect(screen.getByRole('radio', { name: '16:10' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radiogroup', { name: 'Ausrichtung' })).toBeNull();
  });

  it('ein gespeicherter Ausschnitt wählt sein Format; Formatwechsel legt das größte Rechteck um den alten Mittelpunkt', () => {
    const { onApply, key } = open({ formats: [], fixedReason: undefined, places: [{ label: 'Galerie', ratio: 'original', minWidthPx: 960 }], crop: { x: 0.5, y: 0, w: 0.375, h: 0.5 } });
    // 1500 × 1500 → 1:1.
    expect(screen.getByRole('radio', { name: '1:1' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/hatte das Format/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '16:9' }));
    key('Enter');
    const c = onApply.mock.lastCall![0];
    // 16:9 größtmöglich: volle Breite, Höhe 4000·9/16/3000 = 0,75, um die alte Mitte (y 0,25) ins Bild gerückt.
    expect(c).toEqual({ x: 0, y: 0, w: 1, h: 0.75 });
  });

  it('Vorschau: eine Kachel je Stelle mit Name, Format und wo sie nachschneidet; höchstens drei', () => {
    open({
      formats: ['16:9'],
      fixedReason: undefined,
      places: [
        { label: 'Galerie', ratio: '4:3', minWidthPx: 960 },
        { label: 'Lightbox', ratio: 'original', minWidthPx: 0, lightbox: true },
        { label: 'Kachel', ratio: '1:1', minWidthPx: 480 },
        { label: 'Vierte', ratio: '3:2', minWidthPx: 480 },
      ],
    });
    expect(screen.getByText('Galerie · 4:3 · schneidet seitlich nach')).toBeTruthy();
    expect(screen.getByText('Lightbox · wie gewählt')).toBeTruthy();
    expect(screen.getByText('Kachel · 1:1 · schneidet seitlich nach')).toBeTruthy();
    expect(screen.queryByText(/Vierte/)).toBeNull();
    expect(screen.getAllByTestId('cropped-image')).toHaveLength(3);
  });

  it('Schwelle je Stelle: der Hinweis nennt die Stelle, die mehr braucht', () => {
    open({ width: 400, height: 400, formats: ['1:1'], fixedReason: undefined, places: [{ label: 'Team', ratio: '1:1', minWidthPx: 480 }] });
    const warn = screen.getByRole('status');
    expect(warn.textContent).toContain('Der Ausschnitt ist nur 400 px breit.');
    expect(warn.textContent).toContain('Die Webseite nimmt für Team bis 480 px');
  });

  it('Escape bricht ab, ohne zu übernehmen', async () => {
    const { onApply, onOpenChange, rect } = open();
    // Base UI hängt den Horcher für Escape erst nach dem Öffnen an.
    await waitFor(() => {
      fireEvent.keyDown(rect, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Abbrechen schließt ohne Rückfrage und ohne zu übernehmen', () => {
    const { onApply, onOpenChange } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
