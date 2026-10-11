'use client';

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { aspectOf, type Crop } from '@/lib/crop-geometry';

/** `'4:5'` → `'4 / 5'` für `aspect-ratio`; `'original'` hat kein festes Format. */
export function ratioCss(ratio: string): string | undefined {
  if (ratio === 'original') return undefined;
  const [w, h] = ratio.split(':');
  return `${w} / ${h}`;
}

const pct = (n: number) => `${n * 100}%`;

/**
 * Das Ergebnis eines Ausschnitts im Format einer Stelle der Webseite (Handover Ausschnitt, verallgemeinert in Handover
 * alle Bilder § 5, Freigabe Designer 2026-10-10): das Bild absolut gesetzt und so skaliert, dass genau das Rechteck den
 * Rahmen füllt; der Rahmen schneidet ab (`overflow-hidden` nur hier am Bildrahmen, wie bei `CropFrame`, nie an der
 * Formularkarte).
 *
 * `ratio` ist das Format der Stelle (`'W:H'`) oder `'original'` — „wie gewählt“: Der Rahmen hat dann das Format des
 * Ausschnitts selbst (Lightbox). Hat der Ausschnitt ein anderes Format als die Stelle, schneidet der Rahmen mittig nach
 * wie `object-fit: cover` — so zeigt es auch die Webseite. Dafür braucht es das Seitenverhältnis des Originals; es kommt
 * aus dem geladenen Bild, bis dahin gilt der Ausschnitt als im Format.
 *
 * Ohne Ausschnitt nicht benutzen: Dann zeigt der Aufrufer das Bild mit `object-fit: cover`.
 */
export function CroppedImage({ src, crop, ratio, className }: { src: string; crop: Crop; ratio: string; className?: string }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const read = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setNatural({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);
  const original = ratio === 'original';
  // Seitenverhältnis des Ausschnitts in Pixeln; vor dem Laden das der Anteile.
  const own = natural ? (crop.w * natural.w) / (crop.h * natural.h) : crop.w / crop.h;
  const aspect = original ? own : aspectOf(ratio);
  const frameCss = original ? (natural ? `${Math.round(crop.w * natural.w)} / ${Math.round(crop.h * natural.h)}` : `${crop.w} / ${crop.h}`) : ratioCss(ratio);
  // Die Fläche des Ausschnitts im Rahmen (Anteile am Rahmen): 1 × 1, wenn das Format passt, sonst „cover“ mittig.
  const fit = natural ? own : aspect;
  const region = fit >= aspect ? { w: fit / aspect, h: 1, x: (1 - fit / aspect) / 2, y: 0 } : { w: 1, h: aspect / fit, x: 0, y: (1 - aspect / fit) / 2 };
  const width = region.w / crop.w;
  const height = region.h / crop.h;
  return (
    <div data-testid="cropped-image" className={cn('relative w-full overflow-hidden rounded-sm', className)} style={{ aspectRatio: frameCss }}>
      <img
        ref={read}
        src={src}
        alt=""
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        className="absolute block max-w-none"
        style={{ width: pct(width), height: pct(height), left: pct(region.x - crop.x * width), top: pct(region.y - crop.y * height) }}
      />
    </div>
  );
}
