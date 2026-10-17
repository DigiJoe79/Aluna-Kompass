'use client';

import { useTranslations } from 'next-intl';
import { PublishSwitch } from '@/components/forms/publish-switch';
import { ReorderButtons } from '@/components/forms/reorder-buttons';
import { RowLink, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { reorderEntriesAction, setEntryPublishedAction } from '../../actions';

interface Row {
  id: string;
  label: string;
  isPublished: boolean;
}

export function ListClient({ collection, rows, publishable, sortable, canManage }: { collection: string; rows: Row[]; publishable: boolean; sortable: boolean; canManage: boolean }) {
  const c = useTranslations('content');
  const t = useTranslations('site.entries');
  const ids = rows.map((r) => r.id);

  // 10 B7, 10 B9: Spaltenkopf wie in den Projekten (Reihenfolge nur für Vorleser) und ein Zähler über der Liste.
  return (
    <>
    <p className="mb-3 text-meta text-muted-ink" aria-live="polite">{t('total', { n: rows.length })}</p>
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <Table className="w-full text-body">
        <TableHeader>
          <TableRow>
            <TableHead col="title">{t('columns.entry')}</TableHead>
            {publishable ? <TableHead col="status">{t('columns.website')}</TableHead> : null}
            {sortable && canManage ? <TableHead col="actions"><span className="sr-only">{t('columns.order')}</span></TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell col="title">
                {canManage ? <RowLink href={`/site/c/${collection}/${row.id}`}>{row.label}</RowLink> : row.label}
              </TableCell>
              {publishable ? (
                <TableCell col="status">
                  {canManage ? (
                    <PublishSwitch id={row.id} isPublished={row.isPublished} action={(id, next) => setEntryPublishedAction(id, next, collection)} />
                  ) : (
                    <span>{row.isPublished ? c('published') : c('unpublished')}</span>
                  )}
                </TableCell>
              ) : null}
              {sortable && canManage ? (
                <TableCell col="actions" className="text-right">
                  <ReorderButtons ids={ids} index={index} action={(next) => reorderEntriesAction(collection, next)} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </>
  );
}
