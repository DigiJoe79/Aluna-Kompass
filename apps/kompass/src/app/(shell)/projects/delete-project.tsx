'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DangerSection } from '@/components/forms/danger-section';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { deleteProjectAction, projectDeletionPreviewAction, setProjectPublishedAction } from './actions';

export function DeleteProject({ id, name }: { id: string; name: string }) {
  const t = useTranslations('projects.delete');
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
        loadPreview={() => projectDeletionPreviewAction(id)}
        unpublish={() => setProjectPublishedAction(id, false)}
        remove={async (deleteOrphanedMedia) => {
          const state = await deleteProjectAction(id, deleteOrphanedMedia);
          if (state.status === 'success') router.push('/projects');
          return state;
        }}
      />
    </>
  );
}
