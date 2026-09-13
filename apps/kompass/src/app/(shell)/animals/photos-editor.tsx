'use client';

import type { AnimalPhoto } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MediaChooserDialog } from '@/components/media/media-chooser-dialog';
import { Button } from '@/components/ui/button';
import { mergePhotos } from './photos-merge';
import { setAnimalPhotosAction } from './actions';

export function PhotosEditor({ animalId, initial }: { animalId: string; initial: AnimalPhoto[] }) {
  const t = useTranslations('animals.photos');
  const [photos, setPhotos] = useState(initial.map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary })));
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const move = (i: number, d: number) => setPhotos((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="secondary" className="w-fit" onClick={() => setOpen(true)}>
        {t('choose')}
      </Button>
      <MediaChooserDialog open={open} onOpenChange={setOpen} kind="image" multiple selected={photos.map((p) => p.assetId)} onConfirm={(ids) => setPhotos((p) => mergePhotos(p, ids))} />
      <ul className="grid gap-3 md:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            <img src={`/media/${p.assetId}/preview`} alt="" className="aspect-[4/3] w-full rounded-sm object-cover" />
            <div className="flex flex-wrap gap-1 text-[12px]">
              <Button type="button" size="sm" variant={p.isPrimary ? 'default' : 'ghost'} onClick={() => setPhotos(photos.map((x, j) => ({ ...x, isPrimary: j === i })))}>{t('primary')}</Button>
              <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)}>←</Button>
              <Button type="button" size="sm" variant="ghost" disabled={i === photos.length - 1} onClick={() => move(i, 1)}>→</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>{t('remove')}</Button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" className="w-fit" disabled={pending} onClick={() => start(async () => { const s = await setAnimalPhotosAction(animalId, photos); if (s.status === 'error') toast.error(s.message); else toast.success(s.status === 'success' ? s.message ?? '' : ''); })}>{t('save')}</Button>
    </div>
  );
}
