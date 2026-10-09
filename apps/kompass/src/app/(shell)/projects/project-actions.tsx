'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { RecordActions } from '@/components/record-actions';
import { deleteProjectAction, projectDeletionPreviewAction, setProjectPublishedAction } from './actions';

/**
 * Seltene Aktionen am Projekt im Seitenkopf (MUSTER § C): heute nur „Projekt löschen …“. Der Dialog ist gesteuert,
 * eine Instanz; nach dem Schließen kehrt der Fokus auf ⋯ zurück.
 */
export function ProjectActions({ id, name }: { id: string; name: string }) {
  const t = useTranslations('projects.delete');
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
