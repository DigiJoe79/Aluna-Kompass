import { resolvePlaces } from '@kompass/core/image-places';
import { describe, expect, it } from 'vitest';
import { cropPlaces, thresholdOf } from '@/lib/crop-places';

describe('cropPlaces', () => {
  it('übersetzt Schlüssel, nimmt fertige Namen, hängt die Lightbox ohne Schwelle an', () => {
    const t = (k: string) => `T(${k})`;
    const gallery = resolvePlaces({ ratio: '4:3', width: 600 }, { labelKey: 'media.crop.places.animalGallery', lightbox: true, lightboxLabelKey: 'media.crop.places.lightbox' });
    expect(cropPlaces(gallery, t)).toEqual([
      { label: 'T(media.crop.places.animalGallery)', ratio: '4:3', minWidthPx: 960 },
      { label: 'T(media.crop.places.lightbox)', ratio: 'original', minWidthPx: 0, lightbox: true },
    ]);
    expect(cropPlaces(resolvePlaces({ ratio: '1:1', width: 320 }, { label: 'Team' }), t)).toEqual([{ label: 'Team', ratio: '1:1', minWidthPx: 480 }]);
    expect(cropPlaces(resolvePlaces(undefined), t, 'Foto')).toEqual([{ label: 'Foto', ratio: 'original', minWidthPx: 960 }]);
  });

  it('Schwelle: die anspruchsvollste Stelle', () => {
    expect(thresholdOf([{ minWidthPx: 960 }, { minWidthPx: 1600 }, { minWidthPx: 0 }])).toBe(1600);
    expect(thresholdOf([])).toBe(0);
  });
});
