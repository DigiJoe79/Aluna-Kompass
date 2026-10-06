'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DangerSection } from '@/components/forms/danger-section';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { animalDeletionPreviewAction, deleteAnimalAction, setAnimalPublishedAction } from './actions';

export function DeleteAnimal({ id, name }: { id: string; name: string }) {
  const t = useTranslations('animals.delete');
  const c = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DangerSection title={c('danger.delete')} text={t('hint')} actionLabel={t('button')} onAction={() => setOpen(true)} testId="delete-record-trigger" />
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
    </>
  );
}
