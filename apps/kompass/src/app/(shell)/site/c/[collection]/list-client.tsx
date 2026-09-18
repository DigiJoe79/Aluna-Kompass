'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DeleteRecordDialog } from '@/components/forms/delete-record-dialog';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Button } from '@/components/ui/button';
import { deleteEntryAction, entryDeletionPreviewAction, reorderEntriesAction, setEntryPublishedAction } from '../../actions';

interface Row {
  id: string;
  label: string;
  isPublished: boolean;
}

export function ListClient({ collection, rows, publishable, sortable }: { collection: string; rows: Row[]; publishable: boolean; sortable: boolean }) {
  const t = useTranslations('site.entries');
  const router = useRouter();
  const ids = rows.map((r) => r.id);
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [, start] = useTransition();

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-[14px]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={`h-row border-b border-line-2 hover:bg-row-hover ${index % 2 === 1 ? 'bg-zebra' : ''}`}>
              <td className="px-4 font-semibold">
                <Link href={`/site/c/${collection}/${row.id}`} className="text-link underline">{row.label}</Link>
              </td>
              {publishable ? (
                <td className="px-4">
                  <PublishSwitch id={row.id} isPublished={row.isPublished} action={(id, next) => setEntryPublishedAction(id, next, collection)} />
                </td>
              ) : null}
              {sortable ? (
                <td className="px-4 text-right">
                  <ReorderButtons ids={ids} index={index} action={(next) => reorderEntriesAction(collection, next)} />
                </td>
              ) : null}
              <td className="px-4 text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirm(row)}
                >
                  {t('delete')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <DeleteRecordDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t('deleteTitle', { label: confirm?.label ?? '' })}
        loadPreview={() => (confirm ? entryDeletionPreviewAction(confirm.id) : Promise.resolve(null))}
        unpublish={publishable && confirm ? async () => { const state = await setEntryPublishedAction(confirm.id, false, collection); start(() => router.refresh()); return state; } : undefined}
        remove={async (deleteOrphanedMedia) => {
          const state = confirm ? await deleteEntryAction(confirm.id, collection, deleteOrphanedMedia) : { status: 'idle' as const };
          if (state.status === 'success') start(() => router.refresh());
          return state;
        }}
      />
    </div>
  );
}
