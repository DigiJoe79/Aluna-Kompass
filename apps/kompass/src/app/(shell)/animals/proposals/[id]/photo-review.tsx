'use client';

import type { AnimalRecord, PhotoChoice, PhotoRow } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { ChoiceCompare } from '@/components/forms/choice-compare';
import { StatusBadge } from '@/components/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CropFrame, mediaPreviewUrl, proposalImageUrl } from '../../crop-frame';

export type ReviewPhotoRow = PhotoRow & { conflict: boolean };
type AnimalPhoto = AnimalRecord['photos'][number];
export interface PhotoState {
  selected: Record<string, boolean>;
  /** Titelbild: der vorgeschlagene (`proposal`) oder der heutige (`current`). */
  primary: 'proposal' | 'current';
}

export const srcOf = (r: Pick<PhotoRow, 'imageId' | 'mediaId'>) => (r.imageId ? proposalImageUrl(r.imageId) : mediaPreviewUrl(r.mediaId!));

export function initialPhotoState(rows: readonly ReviewPhotoRow[]): PhotoState {
  return { selected: Object.fromEntries(rows.map((r) => [r.key, r.defaultSelected])), primary: 'proposal' };
}

/** Die Fotoliste danach (Reihenfolge der Kacheln), wie `defaultPhotoChoice`, aber nach der Wahl. */
export function photoChoices(rows: readonly ReviewPhotoRow[], state: PhotoState): PhotoChoice[] {
  const chosen = rows.filter((r) => state.selected[r.key]);
  const proposed = chosen.find((r) => r.proposedPrimary)?.key ?? null;
  const current = chosen.find((r) => r.currentPrimary)?.key ?? null;
  const primaryKey = (state.primary === 'proposal' ? (proposed ?? current) : (current ?? proposed)) ?? chosen[0]?.key ?? null;
  return chosen.map((r) => {
    const isPrimary = r.key === primaryKey;
    if (!r.inProposal) return { mediaId: r.mediaId!, isPrimary };
    return r.imageId ? { imageId: r.imageId, isPrimary, crop: r.crop } : { mediaId: r.mediaId!, isPrimary, crop: r.crop };
  });
}

const keyOf = (c: PhotoChoice): string => (c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`);

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
 * Fotos einer Änderung (Board Vorschläge 2a): in der Reihenfolge danach, Marken neu · bleibt · fällt weg, Herkunft;
 * neue mit „übernehmen“, wegfallende mit „entfernen“, Fotos aus Kompass nur durch „abwählen“ weg (A12). Der
 * Titelbildwechsel ist eine eigene Wahl unter den Kacheln. `readOnly`: entschiedener Vorschlag.
 */
export function PhotoReview({ rows, state, onChange, sourceName, max, readOnly }: { rows: readonly ReviewPhotoRow[]; state: PhotoState; onChange: (next: PhotoState) => void; sourceName: string; max: number; readOnly?: boolean }) {
  const t = useTranslations('animals.proposals.photoReview');
  const r = useTranslations('animals.proposals.review');
  const choices = photoChoices(rows, state);
  const primaryKeyAfter = rows.find((row) => choices.some((c) => c.isPrimary && (c.imageId ? `image:${c.imageId}` : `media:${c.mediaId}`) === row.key))?.key;
  const proposedPrimary = rows.find((row) => row.proposedPrimary && state.selected[row.key]);
  const currentPrimary = rows.find((row) => row.currentPrimary && state.selected[row.key]);
  const set = (key: string, on: boolean) => onChange({ ...state, selected: { ...state.selected, [key]: on } });
  const name = (row: ReviewPhotoRow) => row.sourceRef ?? (row.mediaId ? t('kompassPhoto') : t('sourcePhoto'));
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 sm:grid-cols-4">
        {rows.map((row) => {
          const on = !!state.selected[row.key];
          const toggle =
            row.change === 'new' || (row.inProposal && row.change === 'kept')
              ? { label: row.change === 'new' ? t('take') : t('keep'), checked: on, set: (v: boolean) => set(row.key, v) }
              : row.change === 'dropped'
                ? { label: t('remove'), checked: !on, set: (v: boolean) => set(row.key, !v) }
                : { label: t('deselect'), checked: !on, set: (v: boolean) => set(row.key, !v) };
          return (
            <li key={row.key} data-testid="proposal-photo" className={`flex flex-col gap-1.5 rounded-md border p-2 ${on ? 'border-line' : 'border-line opacity-60'}`}>
              <CropFrame src={srcOf(row)} crop={row.crop} label={row.crop ? t('withCrop', { name: name(row) }) : name(row)} />
              <span className="flex flex-wrap items-center gap-1">
                {row.change === 'new' ? <StatusBadge tone="agent">{t('new')}</StatusBadge> : row.change === 'dropped' ? <StatusBadge tone="warning">{t('dropped')}</StatusBadge> : <StatusBadge tone="neutral">{t('kept')}</StatusBadge>}
                {row.key === primaryKeyAfter ? <StatusBadge tone="neutral">{t('primary')}</StatusBadge> : null}
                {row.conflict ? <StatusBadge tone="warning">{r('changedSince')}</StatusBadge> : null}
              </span>
              <span className="text-hint text-ink-2">{row.origin === 'source' ? t('fromSource', { source: sourceName }) : t('fromKompass')}</span>
              {readOnly ? null : (
                <label className="flex items-center gap-2 text-meta text-ink">
                  <Checkbox checked={toggle.checked} onCheckedChange={(v) => toggle.set(v === true)} aria-label={`${toggle.label}: ${name(row)}`} />
                  {toggle.label}
                </label>
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
            onValueChange={(primary) => onChange({ ...state, primary })}
            labels={{ current: t('keepPrimary'), proposal: t('switchPrimary') }}
            current={name(currentPrimary)}
            proposed={name(proposedPrimary)}
            disabled={readOnly}
            testId="proposal-primary-choice"
          />
        </div>
      ) : null}
      <p className="text-hint text-ink-2">{t('max', { count: choices.length, max })}</p>
    </div>
  );
}
