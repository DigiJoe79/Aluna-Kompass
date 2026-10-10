import type { PhotoCrop } from '@kompass/module-animals';
import { cn } from '@/lib/utils';

/** Bild eines Vorschlags vor der Entscheidung (Route mit `animals.manage`); Vorgabe die WebP-Vorschau. */
export function proposalImageUrl(imageId: string, variant: 'preview' | 'original' = 'preview'): string {
  return `/animals/proposal-images/${imageId}${variant === 'original' ? '?variant=original' : ''}`;
}

export const mediaPreviewUrl = (assetId: string): string => `/media/${assetId}/preview`;

const pct = (n: number) => `${Math.round(n * 10_000) / 100}%`;

/**
 * Der Ausschnitt der Quelle am ganzen Foto (Board Vorschläge 2a, 4a, 7a): außerhalb des Rechtecks abgedunkelt (45 %),
 * das Rechteck hell gerahmt. Nur Anzeige — bearbeitet wird der Ausschnitt mit Backlog 24. Ohne Ausschnitt das Foto
 * ohne Abdunklung. `img` statt `next/image`: Die Vorschauen sind privat.
 */
export function CropFrame({ src, crop, label, className }: { src: string; crop: PhotoCrop | null; alt?: string; label: string; className?: string }) {
  const shades = crop
    ? [
        { left: '0%', top: '0%', width: '100%', height: pct(crop.y) },
        { left: '0%', top: pct(crop.y + crop.h), width: '100%', height: pct(Math.max(0, 1 - crop.y - crop.h)) },
        { left: '0%', top: pct(crop.y), width: pct(crop.x), height: pct(crop.h) },
        { left: pct(crop.x + crop.w), top: pct(crop.y), width: pct(Math.max(0, 1 - crop.x - crop.w)), height: pct(crop.h) },
      ]
    : [];
  return (
    <figure role="img" aria-label={label} className={cn('relative m-0 overflow-hidden rounded-sm', className)}>
      <img src={src} alt="" className="block h-auto w-full" />
      {shades.map((style, i) => (
        <span key={i} data-testid="crop-shade" aria-hidden className="absolute bg-overlay/45" style={style} />
      ))}
      {crop ? (
        <span
          data-testid="crop-rect"
          aria-hidden
          className="absolute border-2 border-on-brand"
          style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
        />
      ) : null}
    </figure>
  );
}
