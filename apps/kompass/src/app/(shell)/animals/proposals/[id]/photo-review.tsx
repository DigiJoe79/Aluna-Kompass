'use client';

import type { AnimalRecord, PhotoChoice, PhotoCrop, PhotoRow } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ChoiceCompare } from '@/components/forms/choice-compare';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { applyCrop, switchPrimaryCrop } from '@/lib/primary-crop';
import { mediaPreviewUrl, proposalImageUrl } from '../../crop-frame';
import { CropLine, PhotoActions, PhotoCropDialog, PhotoTileImage, usePhotoPlaces, type AnimalPhotoPlaces } from '../../photo-tile';

export type ReviewPhotoRow = PhotoRow & { conflict: boolean };
type AnimalPhoto = AnimalRecord['photos'][number];
export interface PhotoState {
  selected: Record<string, boolean>;
  /** Titelbild: der vorgeschlagene (`proposal`) oder der heutige (`current`). */
  primary: 'proposal' | 'current';
  /** Geltender Ausschnitt je Foto (Spec Ausschnitt in der Prüfung § 3); fehlt ein Schlüssel, gilt der der Zeile. */
  crops: Record<string, PhotoCrop | null>;
  /** Beim Titelbildwechsel entfernte Ausschnitte, gemerkt bis zum Annehmen (`lib/primary-crop.ts`). */
  removed: Record<string, PhotoCrop>;
}

/** Pixelmaße der Fotos aus Kompass je Medium — die Zeilen bringen sie nicht mit (`restRow`). */
export type PhotoSizes = Record<string, { width: number; height: number }>;

export const srcOf = (r: Pick<PhotoRow, 'imageId' | 'mediaId'>) => (r.imageId ? proposalImageUrl(r.imageId) : mediaPreviewUrl(r.mediaId!));

export function initialPhotoState(rows: readonly ReviewPhotoRow[]): PhotoState {
  return { selected: Object.fromEntries(rows.map((r) => [r.key, r.defaultSelected])), primary: 'proposal', crops: Object.fromEntries(rows.map((r) => [r.key, r.crop])), removed: {} };
}

const cropOf = (row: Pick<PhotoRow, 'key' | 'crop'>, state: Pick<PhotoState, 'crops'>): PhotoCrop | null => (row.key in state.crops ? (state.crops[row.key] ?? null) : row.crop);

/**
 * Die Fotoliste danach (Reihenfolge der Kacheln), wie `defaultPhotoChoice`, aber nach der Wahl. Jedes Foto trägt
 * seinen Ausschnitt, auch eines aus Kompass (Spec Ausschnitt in der Prüfung § 3); `choicesDiffer` zählt den dort nicht (A12).
 */
export function photoChoices(rows: readonly ReviewPhotoRow[], state: PhotoState): PhotoChoice[] {
  const chosen = rows.filter((r) => state.selected[r.key]);
  const proposed = chosen.find((r) => r.proposedPrimary)?.key ?? null;
  const current = chosen.find((r) => r.currentPrimary)?.key ?? null;
  const primaryKey = (state.primary === 'proposal' ? (proposed ?? current) : (current ?? proposed)) ?? chosen[0]?.key ?? null;
  return chosen.map((r) => {
    const isPrimary = r.key === primaryKey;
    const crop = cropOf(r, state);
    return r.imageId ? { imageId: r.imageId, isPrimary, crop } : { mediaId: r.mediaId!, isPrimary, crop };
  });
}

const keyOf = (c: PhotoChoice): string => (c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`);

/** Der Schlüssel des Titelbilds nach der Wahl, `null` ohne Fotos. */
const primaryKeyOf = (rows: readonly ReviewPhotoRow[], state: PhotoState): string | null => {
  const c = photoChoices(rows, state).find((x) => x.isPrimary);
  return c ? keyOf(c) : null;
};

/**
 * Weicht die Wahl vom Vorschlag ab? Dieselbe Regel wie `photoChoiceDiffers` des Moduls (hier nachgebaut, weil die
 * Datei im Browser läuft; `tests/proposal-photo-choice.test.ts` hält beide gleich): Fotos aus Kompass zählen nicht
 * (A12), die Reihenfolge auch nicht.
 */
export function choicesDiffer(rows: readonly PhotoRow[], chosen: readonly PhotoChoice[]): boolean {
  const byKey = new Map(chosen.map((c) => [keyOf(c), c]));
  for (const row of rows) {
    const choice = byKey.get(row.key);
    if (row.inProposal && !choice) return true;
    if (row.change === 'dropped' && choice) return true;
    if (row.inProposal && row.proposedPrimary && !choice?.isPrimary) return true;
    if (row.inProposal && choice && choice.crop !== undefined && JSON.stringify(choice.crop ?? null) !== JSON.stringify(row.crop ?? null)) return true;
  }
  return false;
}

export const photoChoicesDiffer = (rows: readonly ReviewPhotoRow[], state: PhotoState): boolean => choicesDiffer(rows, photoChoices(rows, state));

/**
 * Bleibt die Fotoliste des Tiers nach dieser Wahl, wie sie heute ist? Maßstab ist der Hund heute, nicht der Vorschlag
 * — nachgebaut aus `samePhotos` des Dienstes (Reihenfolge, Titelbild, Ausschnitt, neue Bilder). Vorsichtig: Was der
 * Dienst sonst noch umschreiben könnte (ein Foto aus Kompass wird Foto der Quelle), zählt als Änderung.
 */
export function photosUnchanged(rows: readonly ReviewPhotoRow[], state: PhotoState, today: readonly Pick<AnimalPhoto, 'assetId' | 'isPrimary' | 'crop' | 'sourceUserId' | 'sourceRef'>[]): boolean {
  const chosen = photoChoices(rows, state);
  if (chosen.length !== today.length) return false;
  const anyPrimary = chosen.some((c) => c.isPrimary);
  return chosen.every((c, i) => {
    const photo = today[i]!;
    if (c.imageId || c.mediaId !== photo.assetId) return false;
    if ((c.isPrimary || (i === 0 && !anyPrimary)) !== photo.isPrimary) return false;
    if (c.crop !== undefined && JSON.stringify(c.crop ?? null) !== JSON.stringify(photo.crop ?? null)) return false;
    const row = rows.find((r) => r.key === `media:${photo.assetId}`);
    return !(row?.inProposal && row.sourceRef && photo.sourceUserId === null);
  });
}

/** Zahlen für Kopf und Zusammenfassung: dazu, weg, Titelbild wechselt, danach. */
export function photoCounts(rows: readonly ReviewPhotoRow[], state: PhotoState) {
  const choices = photoChoices(rows, state);
  const added = rows.filter((r) => r.change === 'new' && state.selected[r.key]).length;
  const removed = rows.filter((r) => r.change !== 'new' && !state.selected[r.key]).length;
  const before = rows.find((r) => r.currentPrimary)?.key ?? null;
  const after = rows.find((r) => choices.some((c) => c.isPrimary && (c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`) === r.key))?.key ?? null;
  return { added, removed, primaryChanges: before !== after, after: choices.length };
}

/**
 * Fotos einer Änderung (Board Vorschläge 2a, Board Ausschnitt in der Prüfung 2): in der Reihenfolge danach, Kachel wie
 * im Tierformular (Bild, Zeile „Ausschnitt“), Marken neu · bleibt · fällt weg, Herkunft; neue mit „übernehmen“,
 * wegfallende mit „entfernen“, Fotos aus Kompass nur durch „abwählen“ weg (A12). „Ausschnitt …“ rechts neben der
 * Checkbox, nur bei Fotos, die danach im Tier sind. Der Titelbildwechsel ist eine eigene Wahl unter den Kacheln; er und
 * das Abwählen laufen durch die Titelbild-Regel (`lib/primary-crop.ts`). `readOnly`: entschiedener Vorschlag.
 */
export function PhotoReview({ rows, state, onChange, sourceName, max, readOnly, places, sizes }: { rows: readonly ReviewPhotoRow[]; state: PhotoState; onChange: (next: PhotoState) => void; sourceName: string; max: number; readOnly?: boolean; places: AnimalPhotoPlaces; sizes: PhotoSizes }) {
  const t = useTranslations('animals.proposals.photoReview');
  const r = useTranslations('animals.proposals.review');
  const tc = useTranslations('media.crop');
  const at = usePhotoPlaces(places);
  const [editing, setEditing] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const choices = photoChoices(rows, state);
  const primaryKeyAfter = primaryKeyOf(rows, state);
  const proposedPrimary = rows.find((row) => row.proposedPrimary && state.selected[row.key]);
  const currentPrimary = rows.find((row) => row.currentPrimary && state.selected[row.key]);
  const name = (row: ReviewPhotoRow) => row.sourceRef ?? (row.mediaId ? t('kompassPhoto') : t('sourcePhoto'));
  const sizeOf = (row: ReviewPhotoRow) => (row.width && row.height ? { width: row.width, height: row.height } : row.mediaId ? (sizes[row.mediaId] ?? null) : null);
  // Jede Wahl läuft durch die Titelbild-Regel: ChoiceCompare und Abwählen des Titelbilds (Board 4).
  const update = (next: PhotoState) => {
    const before = primaryKeyAfter;
    const after = primaryKeyOf(rows, next);
    const crops = Object.fromEntries(rows.map((row) => [row.key, cropOf(row, next)]));
    const res = switchPrimaryCrop({ crops, removed: next.removed }, before ? { key: before, stays: !!next.selected[before] } : null, after);
    if (before && after && before !== after) {
      const byKey = (k: string) => rows.find((row) => row.key === k)!;
      setAnnouncement(res.removedFrom ? tc('primaryMoved', { new: name(byKey(after)), old: name(byKey(before)) }) : '');
    }
    onChange({ ...next, crops: res.crops as Record<string, PhotoCrop | null>, removed: res.removed as Record<string, PhotoCrop> });
  };
  const set = (key: string, on: boolean) => update({ ...state, selected: { ...state.selected, [key]: on } });
  const edited = editing === null ? undefined : rows.find((row) => row.key === editing);
  const editedSize = edited ? sizeOf(edited) : null;
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((row) => {
          const on = !!state.selected[row.key];
          const crop = cropOf(row, state);
          const isPrimary = row.key === primaryKeyAfter;
          const toggle =
            row.change === 'new' || (row.inProposal && row.change === 'kept')
              ? { label: row.change === 'new' ? t('take') : t('keep'), checked: on, set: (v: boolean) => set(row.key, v) }
              : row.change === 'dropped'
                ? { label: t('remove'), checked: !on, set: (v: boolean) => set(row.key, !v) }
                : { label: t('deselect'), checked: !on, set: (v: boolean) => set(row.key, !v) };
          return (
            <li key={row.key} data-testid="proposal-photo" className={`flex min-w-0 flex-col gap-1.5 rounded-md border p-2 ${on ? 'border-line' : 'border-line opacity-60'}`}>
              <PhotoTileImage src={srcOf(row)} crop={crop} isPrimary={isPrimary} places={at} label={crop ? t('withCrop', { name: name(row) }) : name(row)} />
              <CropLine crop={crop} width={sizeOf(row)?.width ?? null} isPrimary={isPrimary} places={at} />
              {/* Marken und Herkunft in einer Zeile, die Aktionen unten bündig: Die Karten standen mit vier Textzeilen und
                  verschiedenen Bildhöhen unruhig nebeneinander (05 B23). Kein Layout-Test (AGENTS.md). */}
              <span className="flex flex-wrap items-center gap-1">
                {row.change === 'new' ? <StatusBadge tone="agent">{t('new')}</StatusBadge> : row.change === 'dropped' ? <StatusBadge tone="warning">{t('dropped')}</StatusBadge> : <StatusBadge tone="neutral">{t('kept')}</StatusBadge>}
                {isPrimary ? <StatusBadge tone="neutral">{t('primary')}</StatusBadge> : null}
                {row.conflict ? <StatusBadge tone="warning">{r('changedSince')}</StatusBadge> : null}
                <span className="text-hint text-ink-2">{row.origin === 'source' ? t('fromSource', { source: sourceName }) : t('fromKompass')}</span>
              </span>
              {readOnly ? null : (
                // Checkbox und Knopf stehen beide für „was passiert mit diesem Foto“ (Board 2a); bricht die Zeile um, steht der Knopf darunter.
                <PhotoActions className="mt-auto justify-between gap-x-2 gap-y-1">
                  <label className="flex items-center gap-2 text-meta text-ink">
                    <Checkbox checked={toggle.checked} onCheckedChange={(v) => toggle.set(v === true)} aria-label={`${toggle.label}: ${name(row)}`} />
                    {toggle.label}
                  </label>
                  {on && sizeOf(row) ? <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(row.key)}>{tc('edit')}</Button> : null}
                </PhotoActions>
              )}
            </li>
          );
        })}
      </ul>
      {proposedPrimary && currentPrimary && proposedPrimary.key !== currentPrimary.key ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-meta font-semibold text-ink-2">{t('primaryChoice')}</span>
          <ChoiceCompare
            label={t('primaryChoice')}
            value={state.primary}
            onValueChange={(primary) => update({ ...state, primary })}
            labels={{ current: t('keepPrimary'), proposal: t('switchPrimary') }}
            current={name(currentPrimary)}
            proposed={name(proposedPrimary)}
            disabled={readOnly}
            testId="proposal-primary-choice"
          />
        </div>
      ) : null}
      <p className="text-hint text-ink-2">{t('max', { count: choices.length, max })}</p>
      {/* Ein Dialog für alle Kacheln; „Übernehmen“ setzt den Ausschnitt im Stand der Seite, gespeichert wird mit dem Annehmen. */}
      <PhotoCropDialog
        photo={edited ? { src: srcOf(edited), width: editedSize?.width ?? null, height: editedSize?.height ?? null, crop: cropOf(edited, state), isPrimary: edited.key === primaryKeyAfter } : undefined}
        onClose={() => setEditing(null)}
        places={at}
        note={tc('noteAccept')}
        onApply={(crop) => {
          const next = applyCrop(state, edited!.key, crop);
          onChange({ ...state, crops: next.crops as Record<string, PhotoCrop | null>, removed: next.removed as Record<string, PhotoCrop> });
        }}
      />
      <p data-testid="primary-crop-announcement" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
