'use client';

import type { PublishSummary } from '@kompass/module-site';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { useState } from 'react';
import { ListTruncated } from '@/components/list-truncated';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LogDialog, subjectOfPublish } from './log-dialog';
import { SourceMark } from './source-mark';
import { StatusMark } from './status-mark';

const SHOWN = 5;

/**
 * Die letzten Publishes: Zeit, Ergebnis, Änderungen in Worten, wer, und das
 * Protokoll hinter einem Knopf. Am Telefon ist die ganze Zeile der Knopf.
 * `highlightId` ist der Publish, der gerade zu Ende ging — er trägt „neu“.
 */
export function PublishHistory({ items, total = items.length, highlightId = null }: { items: PublishSummary[]; /** Alle Publishes; mehr als `items` nennt `ListTruncated`. */ total?: number; highlightId?: string | null }) {
  const t = useTranslations('site.publish.history');
  const fmt = useDateFormat();
  const [selected, setSelected] = useState<PublishSummary | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  const when = (iso: string) => fmt.dateTime(iso);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 max-sm:p-4">
      <h3 className="font-heading text-[18px]">{t('title')}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('empty')}</p>
      ) : (
        <Table aria-label={t('title')} className="text-[13px]">
          <TableHeader className="max-sm:hidden">
            <TableRow>
              <TableHead>{t('columns.time')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.changes')}</TableHead>
              <TableHead>{t('columns.by')}</TableHead>
              <TableHead>{t('columns.log')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => (
              // Am Telefon wird die Zeile ein Raster aus zwei Spalten; die feste Zeilenhöhe gibt sie dort frei.
              <TableRow
                key={row.id}
                data-state={row.id === highlightId ? 'selected' : undefined}
                className="max-sm:grid max-sm:h-auto max-sm:min-h-14 max-sm:grid-cols-2 max-sm:items-center max-sm:gap-x-3 max-sm:py-2"
              >
                <TableCell className="max-sm:py-0">
                  {when(row.startedAt)}
                  {row.id === highlightId ? <StatusBadge tone="brand" className="ml-2">{t('new')}</StatusBadge> : null}
                </TableCell>
                <TableCell className="max-sm:py-0">
                  <StatusMark status={row.status} />
                </TableCell>
                <TableCell className="tabular-nums max-sm:py-0">{t('changes', { changed: row.pagesChanged, added: row.pagesAdded, removed: row.pagesRemoved })}</TableCell>
                <TableCell className="text-ink-2 max-sm:py-0"><SourceMark source={row.source} name={row.triggeredByName} /></TableCell>
                <TableCell className="text-right max-sm:col-span-2 max-sm:py-0 sm:text-left">
                  {row.hasLog && (
                    <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => setSelected(row)}>
                      {t('log')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!all && items.length > SHOWN ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAll(true)}>
            {t('older')}
          </Button>
        </div>
      ) : null}
      {all || items.length <= SHOWN ? <ListTruncated shown={items.length} total={total} text={t('truncated', { shown: items.length, total })} testId="publish-history-truncated" /> : null}
      <LogDialog item={selected ? subjectOfPublish(selected) : null} onClose={() => setSelected(null)} />
    </section>
  );
}
