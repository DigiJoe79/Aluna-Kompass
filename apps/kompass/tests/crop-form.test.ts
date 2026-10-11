import { describe, expect, it } from 'vitest';
import { cropFromForm } from '@/lib/crop-form';

const fd = (value?: string) => {
  const f = new FormData();
  if (value !== undefined) f.set('imageCrop', value);
  return f;
};

/** Der Ausschnitt eines Bildfelds reist als JSON im versteckten Feld (MediaPicker `cropName`). */
describe('cropFromForm', () => {
  it('leer = kein Ausschnitt (null entfernt), JSON = Rechteck, fehlt das Feld = weglassen (behalten)', () => {
    expect(cropFromForm(fd(''), 'imageCrop')).toBeNull();
    expect(cropFromForm(fd('{"x":0,"y":0.1,"w":1,"h":0.8}'), 'imageCrop')).toEqual({ x: 0, y: 0.1, w: 1, h: 0.8 });
    expect(cropFromForm(fd(), 'imageCrop')).toBeUndefined();
  });

  it('Unlesbares schickt der Dienst nicht zurück: weglassen', () => {
    expect(cropFromForm(fd('{kaputt'), 'imageCrop')).toBeUndefined();
    expect(cropFromForm(fd('[1,2]'), 'imageCrop')).toBeUndefined();
  });
});
