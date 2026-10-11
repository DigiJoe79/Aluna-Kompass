import { describe, expect, it } from 'vitest';
import { cropOutOfBounds, cropRectSchema, derivedAssetId, parseDerivedAssetId, roundCropRect, type CropRect } from '../src/media/derived-id';
import { newId } from '../src/ids';

describe('derivedAssetId', () => {
  it('lässt eine ID ohne Ausschnitt unverändert', () => {
    expect(derivedAssetId('A', null)).toBe('A');
    expect(derivedAssetId('A', undefined)).toBe('A');
  });

  it('hängt das Rechteck in Zehntausendsteln an', () => {
    expect(derivedAssetId('A', { x: 0.12, y: 0, w: 0.76, h: 0.95 })).toBe('A~1200_0_7600_9500');
  });

  it('rundet wie roundCrop, gleiche Ausschnitte ergeben gleiche IDs', () => {
    expect(derivedAssetId('A', { x: 0.12004, y: 0.00001, w: 0.75996, h: 0.95 })).toBe('A~1200_0_7600_9500');
    expect(derivedAssetId('A', { x: 0.123456, y: 0.1, w: 0.5, h: 0.5 })).toBe('A~1235_1000_5000_5000');
  });

  it('klemmt einen Ausschnitt, den der Dienst mit Toleranz durchließ, ins Bild', () => {
    // cropIssues lässt 1,0001 zu; die ID muss trotzdem wieder lesbar sein.
    const id = derivedAssetId('A', { x: 0.5, y: 0, w: 0.5001, h: 1 });
    expect(id).toBe('A~5000_0_5000_10000');
    expect(parseDerivedAssetId(id)).not.toBeNull();
  });

  it('newId erzeugt kein Trennzeichen', () => {
    for (let i = 0; i < 100; i++) expect(newId()).not.toContain('~');
  });
});

describe('parseDerivedAssetId', () => {
  it('liest die abgeleitete Form', () => {
    expect(parseDerivedAssetId('A~1200_0_7600_9500')).toEqual({ assetId: 'A', crop: { x: 0.12, y: 0, w: 0.76, h: 0.95 } });
  });

  it('liefert null für eine gewöhnliche ID', () => {
    expect(parseDerivedAssetId('01JABCDEFGHJKMNPQRSTVWXYZ0')).toBeNull();
  });

  it.each([
    'A~x',
    'A~1_2_3',
    'A~1_2_3_4_5',
    '~0_0_100_100',
    'A~-1_0_100_100',
    'A~0_0_0_100',
    'A~0_0_100_0',
    'A~0_0_10001_100',
    'A~5000_0_5001_100',
    'A~0_5000_100_5001',
    'A~1.5_0_100_100',
    'A~0_0_100_100~0_0_1_1',
    'A~ 0_0_100_100',
  ])('liefert null für Unsinn: %s', (id) => {
    expect(parseDerivedAssetId(id)).toBeNull();
  });

  it('Rundreise für zufällige gültige Ausschnitte', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const x = Math.floor(rnd() * 9999) / 10000;
      const y = Math.floor(rnd() * 9999) / 10000;
      const w = Math.max(1, Math.floor(rnd() * (10000 - x * 10000))) / 10000;
      const h = Math.max(1, Math.floor(rnd() * (10000 - y * 10000))) / 10000;
      const crop: CropRect = { x, y, w, h };
      const id = derivedAssetId('B', crop);
      const parsed = parseDerivedAssetId(id);
      expect(parsed?.assetId).toBe('B');
      expect(derivedAssetId('B', parsed!.crop)).toBe(id);
      expect(parsed!.crop.x).toBeCloseTo(x, 4);
      expect(parsed!.crop.w).toBeCloseTo(w, 4);
    }
  });
});

// Ausschnitt für alle Bilder (Spec 2026-10-10 § 3): ein Ausschnitt-Schema für jede Verwendung, nicht nur Tierfotos.
describe('cropRectSchema, roundCropRect, cropOutOfBounds', () => {
  it('nimmt ein Rechteck aus Anteilen, nichts sonst', () => {
    expect(cropRectSchema.safeParse({ x: 0.1, y: 0, w: 0.5, h: 1 }).success).toBe(true);
    expect(cropRectSchema.safeParse({ x: 0.1, y: 0, w: 0, h: 1 }).success).toBe(false);
    expect(cropRectSchema.safeParse({ x: -0.1, y: 0, w: 0.5, h: 1 }).success).toBe(false);
    expect(cropRectSchema.safeParse({ x: 0, y: 0, w: 0.5, h: 1, extra: 1 }).success).toBe(false);
  });

  it('rundet auf vier Nachkommastellen und erkennt ein Rechteck über den Rand', () => {
    expect(roundCropRect({ x: 0.123456, y: 0.5, w: 0.33333, h: 0.25 })).toEqual({ x: 0.1235, y: 0.5, w: 0.3333, h: 0.25 });
    expect(cropOutOfBounds({ x: 0.6, y: 0, w: 0.5, h: 1 })).toBe(true);
    expect(cropOutOfBounds({ x: 0.5, y: 0, w: 0.50005, h: 1 })).toBe(false);
    expect(cropOutOfBounds(null)).toBe(false);
  });
});
