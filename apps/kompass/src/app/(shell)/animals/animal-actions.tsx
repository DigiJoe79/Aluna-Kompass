'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { RecordActions } from '@/components/record-actions';
import { animalDeletionPreviewAction, deleteAnimalAction, setAnimalPublishedAction } from './actions';

/** Seltene Aktionen am Tier im Seitenkopf (MUSTER § C), als letztes Element nach „Als PDF“ und dem Blättern. */
export function AnimalActions({ id, name }: { id: string; name: string }) {
  const t = useTranslations('animals.delete');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RecordActions triggerRef={trigger} actions={[{ key: 'delete', label: t('button'), kind: 'delete', onSelect: () => setOpen(true), testId: 'delete-record-trigger' }]} />
      <DeleteRecordDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
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
