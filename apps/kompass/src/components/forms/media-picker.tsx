'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import { Button } from '@/components/ui/button';

/**
 * Ein Medienfeld: Vorschau, „Wählen“, „Entfernen“. Hochladen gibt es hier
 * nicht mehr — das macht der Dialog, in den offenen Ordner der Mediathek.
 * Der Wert ist die Asset-ID im versteckten Feld; `onChange` für Formulare,
 * die ihren Zustand selbst halten (Einstellungen, Schema-Formulare).
 */
export function MediaPicker({
  name,
  value,
  label,
  kind = 'image',
  onChange,
}: {
  name: string;
  value: string | null;
  label: string;
  kind?: 'image' | 'pdf';
  onChange?: (id: string | null) => void;
}) {
  const t = useTranslations('content');
  const [assetId, setAssetId] = useState<string | null>(value);
  const [open, setOpen] = useState(false);
  const set = (id: string | null) => {
    setAssetId(id);
    onChange?.(id);
  };
  const isImage = kind === 'image';
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={assetId ?? ''} />
      {assetId && isImage ? (
        <img src={`/media/${assetId}/preview`} alt="" className="size-14 rounded-md border border-line object-cover" />
      ) : assetId ? (
        <span className="grid size-14 place-items-center rounded-md border border-line bg-surface-2 text-[11px] font-semibold uppercase text-ink-2">{kind}</span>
      ) : (
        <div className="size-14 rounded-md border border-dashed border-line-strong bg-surface-2" aria-hidden />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-2">{label}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" aria-label={`${label}: ${t('choose')}`} onClick={() => setOpen(true)}>
            {t('choose')}
          </Button>
          {assetId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => set(null)}>
              {t('removeImage')}
            </Button>
          ) : null}
        </div>
      </div>
      <MediaChooserDialog open={open} onOpenChange={setOpen} kind={kind} multiple={false} selected={assetId ? [assetId] : []} onConfirm={(ids) => set(ids[0] ?? null)} />
    </div>
  );
}
