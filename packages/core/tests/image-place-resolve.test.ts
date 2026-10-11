import { describe, expect, it } from 'vitest';
import { IMAGE_WIDTHS, MAIN_IMAGE_MAX_WIDTH, resolvePlaces, thresholdFor } from '../src/media/image-place-resolve';

// Spec Ausschnitt für alle Bilder § 2, Handover Entscheidungen 2 und 6.
describe('resolvePlaces', () => {
  it('gibt bei einem Format ein festes Format', () => {
    expect(resolvePlaces({ ratio: '1:1', width: 320 }, { label: 'Team' })).toEqual({
      formats: ['1:1'],
      places: [{ ratio: '1:1', minWidthPx: 480, label: 'Team' }],
      source: 'template',
    });
  });

  it('gibt bei mehreren Formaten die Auswahl und je Format eine Stelle mit ihrem Namen', () => {
    const r = resolvePlaces({ ratio: ['16:10', '16:9'], width: 600 }, { labelKey: 'p.image', labelKeys: ['p.tile', 'p.cover'] });
    expect(r.formats).toEqual(['16:10', '16:9']);
    expect(r.places).toEqual([{ ratio: '16:10', minWidthPx: 960, labelKey: 'p.tile' }, { ratio: '16:9', minWidthPx: 960, labelKey: 'p.cover' }]);
    expect(resolvePlaces({ ratio: '16:9' }, { labelKey: 'p.image', labelKeys: ['p.tile', 'p.cover'] }).places[0]!.labelKey).toBe('p.image');
  });

  it('gibt ohne Angabe die volle Reihe und eine Stelle „wie gewählt“', () => {
    expect(resolvePlaces(undefined)).toEqual({ formats: [], places: [{ ratio: 'original', minWidthPx: 960 }], source: 'none' });
  });

  it('nimmt als Schwelle die nächste Bildbreite ab der Anzeigebreite', () => {
    const at = (width?: number) => resolvePlaces({ ratio: '4:3', ...(width === undefined ? {} : { width }) }).places[0]!.minWidthPx;
    expect([at(320), at(480), at(600), at(1200), at(2400), at()]).toEqual([480, 480, 960, 1600, 1600, 960]);
    expect(thresholdFor(undefined)).toBe(MAIN_IMAGE_MAX_WIDTH);
    expect(IMAGE_WIDTHS).toContain(MAIN_IMAGE_MAX_WIDTH);
  });

  it('fällt ohne Angabe auf den Rückfall zurück, das Template gewinnt', () => {
    expect(resolvePlaces(undefined, { fallback: '4:5' })).toEqual({ formats: ['4:5'], places: [{ ratio: '4:5', minWidthPx: 960 }], source: 'fallback' });
    expect(resolvePlaces({ ratio: '1:1' }, { fallback: '4:5' })).toMatchObject({ formats: ['1:1'], source: 'template' });
  });

  it('bietet unlesbare Formate nicht an', () => {
    expect(resolvePlaces({ ratio: ['4:3', 'banana' as never] }).formats).toEqual(['4:3']);
    expect(resolvePlaces({ ratio: 'banana' as never }).formats).toEqual([]);
  });

  it('hängt die Lightbox ohne eigene Schwelle an', () => {
    expect(resolvePlaces({ ratio: '4:3', width: 400 }, { labelKey: 'g', lightbox: true, lightboxLabelKey: 'lb' }).places).toEqual([
      { ratio: '4:3', minWidthPx: 480, labelKey: 'g' },
      { ratio: 'original', minWidthPx: 0, labelKey: 'lb', lightbox: true },
    ]);
  });
});
