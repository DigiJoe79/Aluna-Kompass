'use client';

// Browsertauglicher Unterpfad (Wächter client-imports): die reine Abbildung der abgeleiteten ID.
import { derivedAssetId, parseDerivedAssetId, type ResolvedImagePlaces } from '@kompass/module-site/client';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { CropEditor } from '@/components/media/crop-editor';
import { CroppedImage, ratioCss } from '@/components/media/cropped-image';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import { Button } from '@/components/ui/button';
import { cropPixelWidth, type Crop } from '@/lib/crop-geometry';
import { cropPlaces, thresholdOf } from '@/lib/crop-places';

type Sizes = Readonly<Record<string, { width: number; height: number }>>;

/**
 * Ein Medienfeld: Vorschau, „Wählen“, „Entfernen“. Hochladen gibt es hier
 * nicht mehr — das macht der Dialog, in den offenen Ordner der Mediathek.
 * Der Wert ist die Asset-ID im versteckten Feld; `onChange` für Formulare,
 * die ihren Zustand selbst halten (Einstellungen, Schema-Formulare).
 *
 * **Ausschnitt** (Handover alle Bilder 3, Board 2): Mit `places` — das Feld ist eine Stelle der Webseite — und einem
 * gewählten Rasterbild (Maße in `sizes` oder aus dem Dialog) steht „Ausschnitt …“ zwischen „Wählen“ und „Entfernen“.
 * Die Vorschau zeigt dann das Ergebnis im Format der Stelle, 56 px hoch. Der Ausschnitt steckt entweder in der
 * abgeleiteten ID des Werts (`derived`, Template-Felder) oder steht als JSON im Feld `cropName` (Projekt, Geschichte).
 * Ein anderes Bild und „Entfernen“ verwerfen ihn; gespeichert wird mit dem Formular („Gespeichert wird mit {target}“).
 */
export function MediaPicker({
  name,
  value,
  label,
  kind = 'image',
  onChange,
  places,
  sizes = {},
  crop: initialCrop = null,
  cropName,
  derived = false,
  onCropChange,
  target = '',
}: {
  name: string;
  value: string | null;
  label: string;
  kind?: 'image' | 'pdf';
  onChange?: (id: string | null) => void;
  /** Die Stellen der Webseite, an denen das Bild erscheint; ohne sie kein Ausschnitt (Logo, PDF). */
  places?: ResolvedImagePlaces;
  /** Pixelmaße bekannter Bilder (`mediaPixelSizes`); neu gewählte bringt der Dialog mit. */
  sizes?: Sizes;
  /** Gespeicherter Ausschnitt, wenn er nicht in der ID steckt. */
  crop?: Crop | null;
  /** Name des versteckten Felds für den Ausschnitt (JSON, leer = keiner). */
  cropName?: string;
  /** Der Wert ist die abgeleitete ID (`<assetId>~…`): Das Feld zerlegt und bildet sie. */
  derived?: boolean;
  onCropChange?: (crop: Crop | null) => void;
  /** „dem Eintrag“, „dem Projekt“ … für „Gespeichert wird mit …“. */
  target?: string;
}) {
  const t = useTranslations('content');
  const tc = useTranslations('media.crop');
  const root = useTranslations();
  const parsed = derived && value ? parseDerivedAssetId(value) : null;
  const [assetId, setAssetId] = useState<string | null>(parsed?.assetId ?? value);
  const [crop, setCrop] = useState<Crop | null>(derived ? (parsed?.crop ?? null) : initialCrop);
  const [known, setKnown] = useState<Sizes>(sizes);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);
  // Template-Felder halten ihren Wert in der Maske: „Verwerfen“ oder eine umsortierte Liste reichen einen anderen Wert
  // herein. Ändert sich der Wert von außen, folgt das Feld ihm — sonst wendete „Ausschnitt …“ den Schnitt auf das alte
  // Bild an (Review 2026-10-10). Die eigenen Änderungen kommen als derselbe Wert zurück und ändern nichts.
  const [outer, setOuter] = useState(value);
  if (derived && value !== outer) {
    setOuter(value);
    const next = value ? parseDerivedAssetId(value) : null;
    setAssetId(next?.assetId ?? value);
    setCrop(next?.crop ?? null);
  }
  const fieldValue = assetId ? (derived ? derivedAssetId(assetId, crop) : assetId) : '';
  const cropValue = crop ? JSON.stringify(crop) : '';

  // Versteckte Felder melden keine Eingabe: Die Speicherleiste zählt erst, wenn das Formular ein `input` hört.
  const seen = useRef({ fieldValue, cropValue });
  useEffect(() => {
    if (seen.current.fieldValue === fieldValue && seen.current.cropValue === cropValue) return;
    seen.current = { fieldValue, cropValue };
    hidden.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }, [fieldValue, cropValue]);

  const set = (id: string | null, more: Sizes = {}) => {
    setAssetId(id);
    setKnown((k) => ({ ...k, ...more }));
    // Ein anderes Bild (oder keins) verwirft den Ausschnitt: Er gehört zur Verwendung dieses Bilds.
    if (crop && id !== assetId) {
      setCrop(null);
      onCropChange?.(null);
    }
    onChange?.(id && id === assetId && derived ? derivedAssetId(id, crop) : id);
  };
  const applyCrop = (next: Crop | null) => {
    setCrop(next);
    onCropChange?.(next);
    if (derived && assetId) onChange?.(derivedAssetId(assetId, next));
  };

  const isImage = kind === 'image';
  const size = assetId ? known[assetId] : undefined;
  const editorPlaces = places ? cropPlaces(places, (key) => root(key as never), label) : [];
  // Vorschau im Format der ersten Stelle (Board 2a: 1:1 → 56 px breit, 16:9 → 100 px); ohne Stelle quadratisch.
  const ratio = editorPlaces.find((p) => !p.lightbox)?.ratio;
  const src = assetId ? `/media/${assetId}/preview` : '';
  const px = crop && size ? cropPixelWidth(crop, size.width) : null;
  const small = px !== null && px < thresholdOf(editorPlaces);

  return (
    <div className="flex items-center gap-3">
      <input ref={hidden} type="hidden" name={name} value={fieldValue} />
      {cropName ? <input type="hidden" name={cropName} value={cropValue} /> : null}
      {assetId && isImage && crop ? (
        // Mit Ausschnitt: das Ergebnis im Format der Stelle; ohne festes Format „wie gewählt“.
        <CroppedImage src={src} crop={crop} ratio={ratio ?? 'original'} className="h-14 w-auto shrink-0 rounded-md border border-line" />
      ) : assetId && isImage && ratio && ratio !== 'original' ? (
        <img src={src} alt="" style={{ aspectRatio: ratioCss(ratio) }} className="h-14 w-auto shrink-0 rounded-md border border-line object-cover" />
      ) : assetId && isImage ? (
        <img src={src} alt="" className="size-14 rounded-md border border-line object-cover" />
      ) : assetId ? (
        <span className="grid size-14 place-items-center rounded-md border border-line bg-surface-2 text-[11px] font-semibold uppercase text-ink-2">{kind}</span>
      ) : (
        <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />
      )}
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-meta font-semibold text-ink-2">{label}</span>
          {crop && small ? (
            <span className="flex items-center gap-1 text-hint text-warning">
              <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
              {tc('smallLine', { px })}
            </span>
          ) : crop ? (
            <span className="text-hint text-muted-ink">{tc('hasLine')}</span>
          ) : null}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" aria-label={`${label}: ${t('choose')}`} onClick={() => setOpen(true)}>
            {t('choose')}
          </Button>
          {isImage && places && assetId && size ? (
            <Button type="button" variant="ghost" size="sm" aria-label={`${label}: ${tc('edit')}`} onClick={() => setEditing(true)}>
              {tc('edit')}
            </Button>
          ) : null}
          {assetId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set(null)}>
              {t('removeImage')}
            </Button>
          ) : null}
        </div>
      </div>
      <MediaChooserDialog open={open} onOpenChange={setOpen} kind={kind} multiple={false} selected={assetId ? [assetId] : []} onConfirm={(ids, more) => set(ids[0] ?? null, more)} />
      {isImage && places && assetId && size ? (
        <CropEditor
          open={editing}
          onOpenChange={setEditing}
          src={src}
          width={size.width}
          height={size.height}
          formats={places.formats}
          places={editorPlaces}
          crop={crop}
          note={tc('note', { target })}
          onApply={applyCrop}
        />
      ) : null}
    </div>
  );
}
