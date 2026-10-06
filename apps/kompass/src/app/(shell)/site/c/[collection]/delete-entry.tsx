'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DangerSection } from '@/components/forms/danger-section';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { deleteEntryAction, entryDeletionPreviewAction, setEntryPublishedAction } from '../../actions';

/** Löschen eines Webseiten-Eintrags: letzter Abschnitt der Detailseite, mit Vorschau und Zwei-Stufen-Löschen. */
export function DeleteEntry({ collection, id, label, publishable }: { collection: string; id: string; label: string; publishable: boolean }) {
  const t = useTranslations('site.entries');
  const c = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DangerSection title={c('danger.delete')} text={t('deleteHint')} actionLabel={t('delete')} onAction={() => setOpen(true)} testId="entry-delete-trigger" />
      <DeleteRecordDialog
        open={open}
        onOpenChange={setOpen}
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
