'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { RecordActions } from '@/components/record-actions';
import { deleteEntryAction, entryDeletionPreviewAction, setEntryPublishedAction } from '../../actions';

/** Seltene Aktionen am Webseiten-Eintrag im Seitenkopf (MUSTER § C): Löschen mit Vorschau und in zwei Stufen. */
export function EntryActions({ collection, id, label, publishable }: { collection: string; id: string; label: string; publishable: boolean }) {
  const t = useTranslations('site.entries');
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <RecordActions triggerRef={trigger} actions={[{ key: 'delete', label: t('delete'), kind: 'delete', onSelect: () => setOpen(true), testId: 'entry-delete-trigger' }]} />
      <DeleteRecordDialog
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
        title={t('deleteTitle', { label })}
        loadPreview={() => entryDeletionPreviewAction(id)}
        unpublish={publishable ? () => setEntryPublishedAction(id, false, collection) : undefined}
        remove={async (deleteOrphanedMedia) => {
          const state = await deleteEntryAction(id, collection, deleteOrphanedMedia);
          if (state.status === 'success') router.push(`/site/c/${collection}`);
          return state;
        }}
      />
    </>
  );
}
