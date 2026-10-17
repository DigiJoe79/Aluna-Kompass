'use client';

import type { PublishSummary } from '@kompass/module-site';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { useState } from 'react';
import { ListTruncated } from '@/components/list-truncated';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LogDialog, subjectOfPublish } from './log-dialog';
import { SourceMark } from './source-mark';
import { StatusMark } from './status-mark';
import { Section } from '@/components/section';
import { countParts } from '@/lib/count-parts';

const SHOWN = 5;

/**
 * Die letzten Publishes: Zeit, Ergebnis, Änderungen in Worten, wer. Die Zeile öffnet ihr Protokoll (die Zeit ist der
 * `RowButton`, 137); das Ergebnis steht nur, wenn es vom Normalfall „Publiziert“ abweicht.
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
    <section className="rounded-lg border border-line bg-surface p-5 max-sm:p-4">
      <Section title={t('title')}>
        <div className="flex flex-col gap-4">
          {items.length === 0 ? (
            <p className="text-meta text-muted-ink">{t('empty')}</p>
          ) : (
            <Table aria-label={t('title')} className="text-meta">
              <TableHeader>
                <TableRow>
                  <TableHead col="title">{t('columns.time')}</TableHead>
                  <TableHead col="status">{t('columns.status')}</TableHead>
                  <TableHead col="meta">{t('columns.changes')}</TableHead>
                  <TableHead col="meta">{t('columns.by')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((row) => (
                  // Am Telefon Kartenzeile über die Spaltenrollen (E1).
                  <TableRow key={row.id} data-state={row.id === highlightId ? 'selected' : undefined}>
                    <TableCell col="title">
                      {row.hasLog ? (
                        <RowButton aria-haspopup="dialog" aria-label={t('logFor', { when: when(row.startedAt) })} onClick={() => setSelected(row)}>
                          {when(row.startedAt)}
                        </RowButton>
                      ) : (
                        when(row.startedAt)
                      )}
                      {row.id === highlightId ? <StatusBadge tone="brand" className="ml-2">{t('new')}</StatusBadge> : null}
                    </TableCell>
                    <TableCell col="status">
                      {row.status === 'success' ? null : <StatusMark status={row.status} />}
                    </TableCell>
                    <TableCell col="meta" className="tabular-nums">{countParts([[row.pagesChanged, t('changed', { count: row.pagesChanged })], [row.pagesAdded, t('added', { count: row.pagesAdded })], [row.pagesRemoved, t('removed', { count: row.pagesRemoved })]])}</TableCell>
                    <TableCell col="meta" className="text-ink-2"><SourceMark source={row.source} name={row.triggeredByName} /></TableCell>
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
        </div>
      </Section>
    </section>
  );
}
