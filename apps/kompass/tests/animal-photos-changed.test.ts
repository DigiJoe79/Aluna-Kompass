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

  it('erkennt einen neuen, geänderten und entfernten Ausschnitt; gerundet gleich ist unverändert', () => {
    const crop = { x: 0.1, y: 0, w: 0.5, h: 0.5 };
    const saved = [{ ...a, crop }, { ...b, crop: null }];
    expect(photosChanged(saved, [{ ...a, crop: { ...crop } }, { ...b, crop: null }])).toBe(false);
    expect(photosChanged(saved, [{ ...a, crop: { ...crop, x: 0.10001 } }, { ...b, crop: null }])).toBe(false);
    expect(photosChanged(saved, [{ ...a, crop: { ...crop, x: 0.2 } }, { ...b, crop: null }])).toBe(true);
    expect(photosChanged(saved, [{ ...a, crop: null }, { ...b, crop: null }])).toBe(true);
    expect(photosChanged(saved, [{ ...a, crop }, { ...b, crop }])).toBe(true);
    // Ohne Angabe (MCP-Weg, alte Maske): behalten, keine Änderung.
    expect(photosChanged(saved, [a, b])).toBe(false);
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

  it('liest den Ausschnitt je Foto mit: Rechteck, null = entfernen, fehlt = behalten', () => {
    const crop = { x: 0.1, y: 0, w: 0.5, h: 0.5 };
    expect(photosFromForm(JSON.stringify([{ ...a, crop }, { ...b, crop: null }, c]))).toEqual([{ ...a, crop }, { ...b, crop: null }, c]);
    expect(photosFromForm(JSON.stringify([{ ...a, crop: { x: 'a', y: 0, w: 1, h: 1 } }]))).toBeNull();
    expect(photosFromForm(JSON.stringify([{ ...a, crop: 5 }]))).toBeNull();
  });

  it('liest die Auswahl und schneidet fremde Schlüssel ab', () => {
    expect(photosFromForm('[{"assetId":"a","isPrimary":true,"sortOrder":7},{"assetId":"b","isPrimary":false}]')).toEqual([a, b]);
  });
});
