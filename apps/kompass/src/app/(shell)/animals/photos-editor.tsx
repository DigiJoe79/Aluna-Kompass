'use client';

import type { AnimalPhoto } from '@kompass/module-animals';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setAnimalPhotosAction, uploadAnimalPhotoAction } from './actions';

export function PhotosEditor({ animalId, initial }: { animalId: string; initial: AnimalPhoto[] }) {
  const t = useTranslations('animals.photos');
  const [photos, setPhotos] = useState(initial.map((p) => ({ assetId: p.assetId, isPrimary: p.isPrimary })));
  const [pending, start] = useTransition();
  const upload = (file: File) => start(async () => {
    const fd = new FormData();
    fd.set('file', file);
    const s = await uploadAnimalPhotoAction(fd);
    if (s.status === 'success') setPhotos((p) => [...p, { assetId: (s.data as { id: string }).id, isPrimary: p.length === 0 }]);
    else if (s.status === 'error') toast.error(s.message);
  });
  const move = (i: number, d: number) => setPhotos((p) => { const n = [...p]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); return n; });
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">{t('upload')}<input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${t('upload')} Datei`} disabled={pending} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} className="text-[12px] font-normal" /></label>
      <ul className="grid gap-3 md:grid-cols-4">
        {photos.map((p, i) => (
          <li key={p.assetId} data-testid="animal-photo" className={`flex flex-col gap-1 rounded-md border p-2 ${p.isPrimary ? 'border-brand' : 'border-line'}`}>
            <img src={`/media/${p.assetId}`} alt="" className="aspect-[4/3] w-full rounded-sm object-cover" />
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
