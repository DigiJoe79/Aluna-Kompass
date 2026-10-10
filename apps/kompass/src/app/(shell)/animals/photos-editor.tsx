'use client';

import { useId } from 'react';
import { FieldError } from '@/components/forms/field-error';
import { useTranslations } from 'next-intl';
import type { PhotoCrop } from '@kompass/module-animals';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { CropFrame, mediaPreviewUrl } from './crop-frame';

/** `crop`: Ausschnitt der Quelle, nur zur Anzeige (Board Vorschläge 7a); gespeichert wird er hier nicht (`photosFromForm`). */
export type EditorPhoto = { assetId: string; isPrimary: boolean; crop?: PhotoCrop | null };

/**
 * Die Fotos eines Tiers als Raster: Hauptfoto wählen, umsortieren, entfernen.
 * Gesteuert – den Stand hält die Maske und schickt ihn mit ihrem einen
 * Speichern ab. Alle Knöpfe sind `type="button"`, weil der Editor im Formular
 * steht.
 */
/**
 * `frame`: der Ausschnitt, in dem die Webseite das Hauptfoto zeigt (Einstellung `animals.photoFrame`). Alle
 * Kacheln stehen darin, damit man jedes Foto so sieht, wie es als Hauptfoto auf der Seite erschiene.
 *
 * `max`: die Grenze des Diensts, als Zahl neben dem Knopf sichtbar, bevor jemand an sie stößt. `error`: die
 * Meldung zum Feld `photos` aus dem letzten Speichern — ohne sie stand beim 13. Foto nur der Punkt am Reiter
 * (Befund 6, 0.2.4).
 */
export function PhotosEditor({ photos, max, error, onChange, onChoose, frame }: { photos: EditorPhoto[]; max: number; error?: string; onChange: (photos: EditorPhoto[]) => void; onChoose: () => void; frame: { aspectRatio: string; objectPosition: string } }) {
  const t = useTranslations('animals.photos');
  const errorId = useId();
  const move = (i: number, d: number) => { const n = [...photos]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" className="w-fit" onClick={onChoose} aria-describedby={error ? errorId : undefined}>
          {t('choose')}
        </Button>
        <span className={`text-meta ${photos.length > max ? 'text-error' : 'text-ink-2'}`}>{t('count', { count: photos.length, max })}</span>
      </div>
      <FieldError id={errorId} message={error} />
      <ul className="grid gap-3 sm:grid-cols-2">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            {/* Das Original in einem neuen Tab: Ob ein Mensch im Bild ist, zeigt die Vorschau nicht immer. */}
            <a href={`/media/${p.assetId}`} target="_blank" rel="noreferrer" aria-label={t('open')}>
              {p.crop ? <CropFrame src={mediaPreviewUrl(p.assetId)} crop={p.crop} label={t('crop')} /> : <img src={mediaPreviewUrl(p.assetId)} alt="" style={frame} className="w-full rounded-sm object-cover" />}
            </a>
            {p.crop ? <p className="text-hint text-ink-2">{t('crop')}</p> : null}
            <div className="flex flex-wrap items-center gap-1">
              {/* Hauptfoto als Marke am gewählten Foto, nicht als Hauptknopf in jeder Kachel — wie in der Prüfung (Befund 10). */}
              {p.isPrimary ? (
                <StatusBadge tone="neutral">{t('primary')}</StatusBadge>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(photos.map((x, j) => ({ ...x, isPrimary: j === i })))}>{t('makePrimary')}</Button>
              )}
              <Button type="button" size="icon-sm" variant="ghost" disabled={i === 0} aria-label={t('moveLeft')} onClick={() => move(i, -1)}><ArrowLeft aria-hidden /></Button>
              <Button type="button" size="icon-sm" variant="ghost" disabled={i === photos.length - 1} aria-label={t('moveRight')} onClick={() => move(i, 1)}><ArrowRight aria-hidden /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(photos.filter((_, j) => j !== i))}>{t('remove')}</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
