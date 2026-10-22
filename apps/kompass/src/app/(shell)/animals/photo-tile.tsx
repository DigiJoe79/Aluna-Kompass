'use client';

import { useTranslations } from 'next-intl';
import type { PhotoCrop } from '@kompass/module-animals';
import type { ResolvedImagePlaces } from '@kompass/core/image-places';
import { AlertTriangle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CropEditor } from '@/components/media/crop-editor';
import { CroppedImage, ratioCss } from '@/components/media/cropped-image';
import { cropPixelWidth } from '@/lib/crop-geometry';
import { cropPlaces, thresholdOf, type CropPlace } from '@/lib/crop-places';
import { cn } from '@/lib/utils';

/*
 * Die Fotokachel eines Tiers — geteilt von Tierformular (`photos-editor.tsx`) und Prüfung eines Vorschlags
 * (`proposals/[id]/create-review.tsx`, `photo-review.tsx`): Die Prüfung ist für Fotos dieselbe Arbeit wie das Formular,
 * also gleiche Kachel, gleicher Knopf, gleicher Dialog (Board Ausschnitt in der Prüfung, Designer 2026-10-11). Kein
 * Baustein unter `components/`: Sie kennt die Stellen der Tierfotos.
 */

/**
 * Die Stellen der Webseite für die Fotos eines Tiers (Spec Ausschnitt für alle Bilder § 4): `primary` für das
 * Hauptfoto (`animals.primary`; ohne Angabe im Template die Einstellung „Bildausschnitt“, `source: 'fallback'`),
 * `gallery` für die übrigen (`animals.gallery`, mit Lightbox). Jede Kachel steht im Format ihrer Stelle. `focus`: der
 * Blickpunkt aus der Einstellung — dort zeigt die Webseite ein Foto ohne Ausschnitt, dort beginnt der Dialog.
 */
export interface AnimalPhotoPlaces {
  primary: ResolvedImagePlaces;
  gallery: ResolvedImagePlaces;
  focus: { focusX: number; focusY: number };
}

export type PhotoPlaces = ReturnType<typeof usePhotoPlaces>;

/** Formate und Stellen je Rolle (Titelbild oder übrige), das Format der Kachel und der Grund für das feste Format. */
export function usePhotoPlaces(places: AnimalPhotoPlaces) {
  const tc = useTranslations('media.crop');
  const root = useTranslations();
  const label = (key: string) => root(key as never);
  const primary = { formats: places.primary.formats, places: cropPlaces(places.primary, label) };
  const gallery = { formats: places.gallery.formats, places: cropPlaces(places.gallery, label) };
  const placesOf = (isPrimary: boolean) => (isPrimary ? primary : gallery);
  return {
    placesOf,
    // Das Format der Kachel: die erste Stelle, die nicht die Lightbox ist.
    tileRatio: (isPrimary: boolean) => placesOf(isPrimary).places.find((x) => !x.lightbox)?.ratio ?? 'original',
    // „fest für das Titelbild“, beim Rückfall mit der Einstellung, aus der das Format kommt (Board 1b).
    primaryReason: places.primary.source === 'fallback' ? `${tc('fixedPrimary')} · ${tc('fixedSetting')}` : tc('fixedPrimary'),
    focus: places.focus,
  };
}

/**
 * Das Bild der Kachel, wie die Webseite es zeigt: mit Ausschnitt `CroppedImage` im Format der Stelle, ohne `object-cover`
 * am Blickpunkt im Format der Stelle. Die Abdunklung gibt es nur im Dialog. `label`: Name für Vorleser, wo das Bild
 * nicht in einem benannten Link steht (Prüfung).
 */
export function PhotoTileImage({ src, crop, isPrimary, places, label }: { src: string; crop: PhotoCrop | null; isPrimary: boolean; places: PhotoPlaces; label?: string }) {
  const ratio = places.tileRatio(isPrimary);
  const image = crop ? (
    <CroppedImage src={src} crop={crop} ratio={ratio} />
  ) : (
    <img src={src} alt="" style={{ aspectRatio: ratioCss(ratio), objectPosition: `${places.focus.focusX}% ${places.focus.focusY}%` }} className="w-full rounded-sm object-cover" />
  );
  return label ? <div role="img" aria-label={label}>{image}</div> : image;
}

/** Zeile unter dem Bild: „Ausschnitt“, „ohne Ausschnitt“ oder — unter der Schwelle — Warnfarbe mit Symbol und Wort (MUSTER F). */
export function CropLine({ crop, width, isPrimary, places }: { crop: PhotoCrop | null; width: number | null; isPrimary: boolean; places: PhotoPlaces }) {
  const minWidthPx = thresholdOf(places.placesOf(isPrimary).places as readonly CropPlace[]);
  const tc = useTranslations('media.crop');
  if (!crop) return <p className="text-hint text-muted-ink">{tc('none')}</p>;
  const px = width ? cropPixelWidth(crop, width) : null;
  if (px !== null && px < minWidthPx)
    return (
      <p className="flex items-center gap-1 text-hint text-warning">
        <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
        {tc('small', { px })}
      </p>
    );
  return <p className="text-hint text-ink-2">{tc('has')}</p>;
}

/**
 * N3 (Freigabe Joe 2026-10-22, Spec Bildkennzeichnung beim Hochladen § 5): die Aktionszeile der Kachel (Tierformular
 * und Prüfung). Links, was die Reihenfolge betrifft (`start`: Hauptfoto, Pfeile), rechts, was das Bild betrifft (`end`:
 * Ausschnitt, Kennzeichnen, Entfernen). Jede Gruppe ist ein eigener Block: Wird die Kachel zu schmal, rutscht die rechte
 * Gruppe geschlossen unter die linke, einzelne Knöpfe brechen nie allein um. Bei Touch (`pointer: coarse`, wie
 * `--field-h`) sind die Knöpfe 44 px groß, eine Checkbox-Zeile 44 px hoch. Kein dauerhafter Test: Maße misst jsdom
 * nicht (Feedback Layout-Tests).
 */
export function PhotoActions({ start, end, className }: { start: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pointer-coarse:[&_button]:h-11 pointer-coarse:[&_button]:min-w-11 pointer-coarse:[&_label]:min-h-11', className)}>
      <span className="flex items-center gap-1">{start}</span>
      {end ? <span className="flex items-center gap-1">{end}</span> : null}
    </div>
  );
}

/** Ein Symbolknopf der Aktionszeile: `icon-sm ghost`, Name für Vorleser und als Tooltip beim Überfahren. */
export function PhotoActionButton({ label, children, ...props }: Omit<ComponentProps<typeof Button>, 'aria-label' | 'size' | 'variant' | 'type'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={label} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Ein Dialog „Ausschnitt“ für alle Kacheln einer Liste; `photo` ist das bearbeitete Foto (ohne Pixelmaße kein Dialog).
 * „Übernehmen“ ändert nur den Stand der Seite — gespeichert wird mit dem, was `note` nennt (MUSTER B).
 */
export function PhotoCropDialog({ photo, onClose, places, note, onApply }: { photo: { src: string; width: number | null; height: number | null; crop: PhotoCrop | null; isPrimary: boolean } | undefined; onClose: () => void; places: PhotoPlaces; note: string; onApply: (crop: PhotoCrop | null) => void }) {
  if (!photo?.width || !photo.height) return null;
  const at = places.placesOf(photo.isPrimary);
  return (
    <CropEditor
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      src={photo.src}
      width={photo.width}
      height={photo.height}
      formats={at.formats}
      {...(photo.isPrimary ? { fixedReason: places.primaryReason } : {})}
      places={at.places}
      focus={places.focus}
      note={note}
      crop={photo.crop}
      onApply={onApply}
    />
  );
}
