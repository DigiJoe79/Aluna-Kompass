'use client';

import { useTranslations } from 'next-intl';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { RowLink, Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { reorderEntriesAction, setEntryPublishedAction } from '../../actions';

interface Row {
  id: string;
  label: string;
  isPublished: boolean;
}

export function ListClient({ collection, rows, publishable, sortable, canManage }: { collection: string; rows: Row[]; publishable: boolean; sortable: boolean; canManage: boolean }) {
  const c = useTranslations('content');
  const ids = rows.map((r) => r.id);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table className="w-full text-[14px]">
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell className="font-semibold">
                {canManage ? <RowLink href={`/site/c/${collection}/${row.id}`}>{row.label}</RowLink> : row.label}
              </TableCell>
              {publishable ? (
                <TableCell>
                  {canManage ? (
                    <PublishSwitch id={row.id} isPublished={row.isPublished} action={(id, next) => setEntryPublishedAction(id, next, collection)} />
                  ) : (
                    <span>{row.isPublished ? c('published') : c('unpublished')}</span>
                  )}
                </TableCell>
              ) : null}
              {sortable && canManage ? (
                <TableCell className="text-right">
                  <ReorderButtons ids={ids} index={index} action={(next) => reorderEntriesAction(collection, next)} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
