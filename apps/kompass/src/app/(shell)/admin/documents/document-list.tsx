'use client';

import type { DocumentRecord } from '@kompass/core';
import { Download } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VoidDocumentDialog } from './void-document-dialog';

type Row = DocumentRecord & { createdByName: string | null; title: string };

export function DocumentList({ documents, selectedId, canCreate }: { documents: Row[]; selectedId: string | null; canCreate: boolean }) {
  const t = useTranslations('documents');
  const format = useFormatter();
  const [voiding, setVoiding] = useState<Row | null>(null);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <table className="w-full text-[14px]">
        <thead className="bg-table-head text-left text-[12px] font-semibold uppercase tracking-[.04em] text-muted-ink"><tr className="h-9"><th className="px-4">{t('columns.title')}</th><th className="px-4">{t('columns.reference')}</th><th className="px-4">{t('columns.createdBy')}</th><th className="px-4">{t('columns.date')}</th><th className="px-4" /></tr></thead>
        <tbody>
          {documents.map((d, i) => (
            <tr key={d.id} className={cn('h-[52px] border-b border-line-2 hover:bg-row-hover', i % 2 === 1 && 'bg-zebra', d.id === selectedId && 'bg-selected')}>
              <td className="px-4">
                <Link href={`?selected=${d.id}`} className={cn('font-semibold', d.status === 'voided' && 'text-muted-ink')}>{d.title}</Link>
                {d.status === 'voided' ? <StatusBadge tone="neutral" className="ml-2">{t('voided')}</StatusBadge> : null}
                <div className="text-[12px] text-muted-ink">{t(`templates.${d.templateKey}`)} · <span className="font-mono">{d.number}</span></div>
              </td>
              <td className="px-4 text-ink-2">{d.entityType ? `${d.entityType} · ${d.entityId ?? ''}` : '—'}</td>
              <td className="px-4 text-ink-2">{d.createdByName ?? '—'}</td>
              <td className="px-4 font-mono text-[12px]">{format.dateTime(new Date(d.createdAt), { dateStyle: 'short' })}</td>
              <td className="px-4 text-right">
                <div className="flex justify-end gap-1">
                  <a href={`/documents/${d.id}/file`} download={`${d.number}.pdf`} title={t('download')} aria-label={t('download')} className={buttonVariants({ variant: 'ghost', size: 'icon' })}><Download className="size-4" /><span className="sr-only">{t('download')}</span></a>
                  {canCreate && d.status === 'issued' ? <Button variant="outline" size="sm" className="border-error text-error" onClick={() => setVoiding(d)}>{t('void.confirm')}</Button> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {voiding ? <VoidDocumentDialog id={voiding.id} number={voiding.number} open onOpenChange={(o) => { if (!o) setVoiding(null); }} /> : null}
    </div>
  );
}
