'use client';

import { useId, useState } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { useTranslations } from 'next-intl';
import type { PhotoCrop } from '@kompass/module-animals';
import { ArrowLeft, ArrowRight, Crop, Star, Tag, Trash2 } from 'lucide-react';
import { AiKindBadge } from '@/components/media/ai-kind-badge';
import { useLabelLater } from '@/components/media/image-labeling-dialog';
import { useCanLabelMedia } from '@/components/media/media-labeling-provider';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { applyCrop, switchPrimaryCrop } from '@/lib/primary-crop';
import { mediaPreviewUrl } from './crop-frame';
import { CropLine, PhotoActionButton, PhotoActions, PhotoCropDialog, PhotoTileImage, usePhotoPlaces, type AnimalPhotoPlaces } from './photo-tile';

export type { AnimalPhotoPlaces } from './photo-tile';

/**
 * `crop`: der Ausschnitt des Fotos (von Hand, von der Quelle oder über MCP gesetzt). `width`/`height`: das Original in
 * Pixeln aus `media_assets` (nach EXIF-Drehung); fehlen sie (Altbestand, SVG, eben erst gewählt und noch nicht
 * gespeichert), gibt es weder „Ausschnitt …“ noch den Hinweis auf die Breite. `name`: die Referenz der Quelle, für die
 * Ansage beim Titelbildwechsel; ohne sie heißt das Foto nach seinem Platz.
 */
export type EditorPhoto = { assetId: string; isPrimary: boolean; crop?: PhotoCrop | null; width?: number | null; height?: number | null; name?: string; aiKind?: 'edited' | 'generated' };

/**
 * Die Fotos eines Tiers als Raster: Hauptfoto wählen, umsortieren, entfernen.
 * Gesteuert – den Stand hält die Maske und schickt ihn mit ihrem einen
 * Speichern ab. Alle Knöpfe sind `type="button"`, weil der Editor im Formular
 * steht. Die beim Titelbildwechsel entfernten Ausschnitte merkt der Editor selbst; die Maske setzt ihn nach dem
 * Speichern neu auf (`key`), Verwerfen lädt die Seite neu.
 */
/**
 * `max`: die Grenze des Diensts, als Zahl neben dem Knopf sichtbar, bevor jemand an sie stößt. `error`: die
 * Meldung zum Feld `photos` aus dem letzten Speichern — ohne sie stand beim 13. Foto nur der Punkt am Reiter
 * (Befund 6, 0.2.4).
 */
export function PhotosEditor({ photos, max, error, onChange, onChoose, places }: { photos: EditorPhoto[]; max: number; error?: string; onChange: (photos: EditorPhoto[]) => void; onChoose: () => void; places: AnimalPhotoPlaces }) {
  const t = useTranslations('animals.photos');
  const tc = useTranslations('media.crop');
  const m = useTranslations('content');
  const tl = useTranslations('media.labeling');
  const at = usePhotoPlaces(places);
  const errorId = useId();
  // Welches Foto der Dialog „Ausschnitt“ bearbeitet; `null` = zu.
  const [editing, setEditing] = useState<number | null>(null);
  const edited = editing === null ? undefined : photos[editing];
  // Beim Titelbildwechsel entfernte Ausschnitte je Foto (Spec Ausschnitt in der Prüfung § 2.4) und die letzte Ansage.
  const [removed, setRemoved] = useState<Record<string, PhotoCrop>>({});
  const [announcement, setAnnouncement] = useState('');
  // „Kennzeichnen …“ speichert sofort (Spec Bildkennzeichnung beim Hochladen § 4); die Kachel zeigt die neue Marke ohne Neuladen.
  const canLabel = useCanLabelMedia();
  const [labeled, setLabeled] = useState<Record<string, 'none' | 'edited' | 'generated'>>({});
  const labelLater = useLabelLater({ target: tc('targets.animal'), onLabeled: (id, kind) => setLabeled((l) => ({ ...l, [id]: kind })) });
  const aiKindOf = (p: EditorPhoto) => labeled[p.assetId] ?? p.aiKind;
  const nameOf = (p: EditorPhoto, list: readonly EditorPhoto[]) => p.name ?? t('nth', { n: list.indexOf(p) + 1 });
  const primaryOf = (list: readonly EditorPhoto[]) => list.find((p) => p.isPrimary) ?? list[0];
  // Jede Änderung der Liste läuft durch die Titelbild-Regel: wählen, entfernen, umsortieren.
  const change = (next: EditorPhoto[]) => {
    const before = primaryOf(photos);
    const after = primaryOf(next);
    const r = switchPrimaryCrop(
      { crops: Object.fromEntries(next.map((p) => [p.assetId, p.crop ?? null])), removed },
      before ? { key: before.assetId, stays: next.some((p) => p.assetId === before.assetId) } : null,
      after?.assetId ?? null,
    );
    setRemoved(r.removed);
    if (before && after && before.assetId !== after.assetId) setAnnouncement(r.removedFrom ? tc('primaryMoved', { new: nameOf(after, next), old: nameOf(before, photos) }) : '');
    onChange(next.map((p) => ((r.crops[p.assetId] ?? null) === (p.crop ?? null) ? p : { ...p, crop: r.crops[p.assetId] ?? null })));
  };
  const move = (i: number, d: number) => { const n = [...photos]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); change(n); };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" className="w-fit" onClick={onChoose} aria-describedby={error ? errorId : undefined}>
          {t('choose')}
        </Button>
        <span className={`text-meta ${photos.length > max ? 'text-error' : 'text-ink-2'}`}>{t('count', { count: photos.length, max })}</span>
      </div>
      <FieldError id={errorId} message={error} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            {/* Das Original in einem neuen Tab: Ob ein Mensch im Bild ist, zeigt die Vorschau nicht immer. Die Marke
                „Hauptfoto“ steht auf dem Bild oben links (Board 2a), die Bildkennzeichnung oben rechts wie an der Kachel der
                Mediathek — so sind Kacheln mit und ohne Kennzeichnung gleich hoch (Joe 2026-10-22). */}
            <span className="relative">
              <a href={`/media/${p.assetId}`} target="_blank" rel="noreferrer" aria-label={t('open')}>
                {/* Jede Kachel im Format der Webseite und mit dem, was sie zeigt; die Abdunklung gibt es nur im Dialog. */}
                <PhotoTileImage src={mediaPreviewUrl(p.assetId)} crop={p.crop ?? null} isPrimary={p.isPrimary} places={at} />
              </a>
              {p.isPrimary ? (
                <StatusBadge tone="neutral" className="absolute top-1.5 left-1.5">
                  {t('primary')}
                </StatusBadge>
              ) : null}
              <AiKindBadge kind={aiKindOf(p)} className="absolute top-1.5 right-1.5" />
            </span>
            <CropLine crop={p.crop ?? null} width={p.width ?? null} isPrimary={p.isPrimary} places={at} />
            <PhotoActions
              className="mt-auto"
              start={
                <>
                  {/* Am Hauptfoto gedrückt und ohne Wirkung, aber nicht gesperrt: grau hieße „geht nicht“ (Joe 2026-10-22). */}
                  <PhotoActionButton label={t('makePrimary')} aria-pressed={p.isPrimary} onClick={() => !p.isPrimary && change(photos.map((x, j) => ({ ...x, isPrimary: j === i })))}>
                    <Star aria-hidden className={p.isPrimary ? 'fill-current text-brand' : undefined} />
                  </PhotoActionButton>
                  <PhotoActionButton label={t('moveLeft')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowLeft aria-hidden />
                  </PhotoActionButton>
                  <PhotoActionButton label={t('moveRight')} disabled={i === photos.length - 1} onClick={() => move(i, 1)}>
                    <ArrowRight aria-hidden />
                  </PhotoActionButton>
                </>
              }
              end={
                <>
                  {p.width && p.height ? (
                    <PhotoActionButton label={tc('edit')} onClick={() => setEditing(i)}>
                      <Crop aria-hidden />
                    </PhotoActionButton>
                  ) : null}
                  {canLabel ? (
                    <PhotoActionButton label={tl('label')} aria-haspopup="dialog" onClick={() => labelLater.open(p.assetId)}>
                      <Tag aria-hidden />
                    </PhotoActionButton>
                  ) : null}
                  <PhotoActionButton label={m('removeImage')} onClick={() => change(photos.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </PhotoActionButton>
                </>
              }
            />
          </li>
        ))}
      </ul>
      {/* Ein Dialog für alle Kacheln. „Übernehmen“ ändert nur den Stand der Maske; gespeichert wird mit dem Tier (MUSTER B). */}
      <PhotoCropDialog
        photo={edited ? { src: mediaPreviewUrl(edited.assetId), width: edited.width ?? null, height: edited.height ?? null, crop: edited.crop ?? null, isPrimary: edited.isPrimary } : undefined}
        onClose={() => setEditing(null)}
        places={at}
        note={tc('note', { target: tc('targets.animal') })}
        onApply={(crop) => {
          // Übernehmen verwirft, was die Seite für dieses Foto gemerkt hatte.
          setRemoved(applyCrop({ crops: {}, removed }, edited!.assetId, crop).removed);
          onChange(photos.map((x, j) => (j === editing ? { ...x, crop } : x)));
        }}
      />
      {labelLater.dialog}
      <p data-testid="primary-crop-announcement" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
