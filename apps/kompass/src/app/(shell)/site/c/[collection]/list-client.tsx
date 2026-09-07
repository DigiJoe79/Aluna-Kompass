'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { Button } from '@/components/ui/button';
import { deleteEntryAction, reorderEntriesAction, setEntryPublishedAction } from '../../actions';

interface Row {
  id: string;
  label: string;
  isPublished: boolean;
}

export function ListClient({ collection, rows, publishable, sortable }: { collection: string; rows: Row[]; publishable: boolean; sortable: boolean }) {
  const t = useTranslations('site.entries');
  const router = useRouter();
  const ids = rows.map((r) => r.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, start] = useTransition();

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-[14px]">
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={`h-[var(--row-h)] border-b border-line-2 hover:bg-row-hover ${index % 2 === 1 ? 'bg-zebra' : ''}`}>
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
                  onClick={() => setConfirmId(row.id)}
                >
                  {t('confirmDelete')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title={t('confirmDelete')}
        description={t('confirmDeleteBody')}
        confirmLabel={t('confirmDelete')}
        destructive
        action={async () => {
          const state = confirmId ? await deleteEntryAction(confirmId, collection) : { status: 'idle' as const };
          if (state.status === 'success') {
            toast.success(state.message ?? t('deleted'));
            start(() => router.refresh());
          } else if (state.status === 'error') {
            toast.error(state.message);
          }
          setConfirmId(null);
          return state;
        }}
      />
    </div>
  );
}
