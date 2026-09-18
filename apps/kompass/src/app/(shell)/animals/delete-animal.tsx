'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { Button } from '@/components/ui/button';
import { animalDeletionPreviewAction, deleteAnimalAction, setAnimalPublishedAction } from './actions';

export function DeleteAnimal({ id, name }: { id: string; name: string }) {
  const t = useTranslations('animals.delete');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-6">
      <p className="text-[13px] text-muted-ink">{t('hint')}</p>
      <Button type="button" variant="ghost" className="mt-3" onClick={() => setOpen(true)}>{t('button')}</Button>
      <DeleteRecordDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title', { name })}
        loadPreview={() => animalDeletionPreviewAction(id)}
        unpublish={() => setAnimalPublishedAction(id, false)}
        remove={async (deleteOrphanedMedia) => {
          const state = await deleteAnimalAction(id, deleteOrphanedMedia);
          if (state.status === 'success') router.push('/animals');
          return state;
        }}
      />
    </section>
  );
}
