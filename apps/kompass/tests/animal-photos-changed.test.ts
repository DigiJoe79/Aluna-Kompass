import { describe, expect, it } from 'vitest';
import { photosChanged, photosFromForm } from '../src/app/(shell)/animals/photos-changed';

const a = { assetId: 'a', isPrimary: true };
const b = { assetId: 'b', isPrimary: false };
const c = { assetId: 'c', isPrimary: false };

describe('photosChanged', () => {
  it('sieht keinen Unterschied, wo keiner ist', () => {
    expect(photosChanged([a, b], [{ ...a }, { ...b }])).toBe(false);
    expect(photosChanged([], [])).toBe(false);
  });

  it('erkennt ein anderes Hauptfoto', () => {
    expect(photosChanged([a, b], [{ assetId: 'a', isPrimary: false }, { assetId: 'b', isPrimary: true }])).toBe(true);
  });

  it('erkennt eine andere Reihenfolge', () => {
    expect(photosChanged([a, b], [b, a])).toBe(true);
  });

  it('sieht in einem Ausschnitt der Quelle keine Änderung (er wird nicht gespeichert, Plan A)', () => {
    const cropped = { ...a, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } };
    expect(photosChanged([a, b], [cropped, b])).toBe(false);
    expect(photosFromForm(JSON.stringify([cropped]))).toEqual([a]);
  });

  it('erkennt ein Foto weniger und eines mehr', () => {
    expect(photosChanged([a, b], [a])).toBe(true);
    expect(photosChanged([a, b], [a, b, c])).toBe(true);
  });
});

describe('photosFromForm', () => {
  it('liefert null, wenn das Feld fehlt oder kein gültiges Array trägt', () => {
    for (const value of [null, '', 'kaputt', '{}', '[1]', '[{"assetId":"a"}]', '[{"assetId":"","isPrimary":true}]']) expect(photosFromForm(value)).toBeNull();
  });

  it('liest eine leere Auswahl als leere Liste', () => {
    expect(photosFromForm('[]')).toEqual([]);
  });

  it('liest die Auswahl und schneidet fremde Schlüssel ab', () => {
    expect(photosFromForm('[{"assetId":"a","isPrimary":true,"sortOrder":7},{"assetId":"b","isPrimary":false}]')).toEqual([a, b]);
  });
});
