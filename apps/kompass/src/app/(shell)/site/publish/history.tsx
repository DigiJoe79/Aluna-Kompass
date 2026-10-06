'use client';

import type { PublishSummary } from '@kompass/module-site';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { LogDialog, subjectOfPublish } from './log-dialog';
import { SourceMark } from './source-mark';
import { StatusMark } from './status-mark';

const SHOWN = 5;

/**
 * Die letzten Publishes: Zeit, Ergebnis, Änderungen in Worten, wer, und das
 * Protokoll hinter einem Knopf. Am Telefon ist die ganze Zeile der Knopf.
 * `highlightId` ist der Publish, der gerade zu Ende ging — er trägt „neu“.
 */
export function PublishHistory({ items, highlightId = null }: { items: PublishSummary[]; highlightId?: string | null }) {
  const t = useTranslations('site.publish.history');
  const format = useFormatter();
  const [selected, setSelected] = useState<PublishSummary | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 max-sm:p-4">
      <h3 className="font-heading text-[18px]">{t('title')}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-ink">{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t('title')} className="w-full text-left text-[13px]">
            <thead className="max-sm:hidden">
              <tr className="border-b border-line text-muted-ink">
                <th className="py-2 pr-4">{t('columns.time')}</th>
                <th className="py-2 pr-4">{t('columns.status')}</th>
                <th className="py-2 pr-4">{t('columns.changes')}</th>
                <th className="py-2 pr-4">{t('columns.by')}</th>
                <th className="py-2 pr-4">{t('columns.log')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b border-line hover:bg-surface-2 max-sm:grid max-sm:min-h-14 max-sm:grid-cols-2 max-sm:items-center max-sm:gap-x-3 max-sm:py-2 ${row.id === highlightId ? 'bg-brand-soft' : ''}`}
                >
                  <td className="py-2 pr-4 whitespace-nowrap max-sm:py-0">
                    {when(row.startedAt)}
                    {row.id === highlightId ? <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-on-brand">{t('new')}</span> : null}
                  </td>
                  <td className="py-2 pr-4 max-sm:py-0">
                    <StatusMark status={row.status} />
                  </td>
                  <td className="py-2 pr-4 tabular-nums max-sm:py-0">{t('changes', { changed: row.pagesChanged, added: row.pagesAdded, removed: row.pagesRemoved })}</td>
                  <td className="py-2 pr-4 text-ink-2 max-sm:py-0"><SourceMark source={row.source} name={row.triggeredByName} /></td>
                  <td className="py-1 pr-4 text-right max-sm:col-span-2 max-sm:py-0 sm:text-left">
                    {row.hasLog && (
                      <Button variant="ghost" size="sm" className="max-sm:h-11" onClick={() => setSelected(row)}>
                        {t('log')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!all && items.length > SHOWN ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAll(true)}>
            {t('older')}
          </Button>
        </div>
      ) : null}
      <LogDialog item={selected ? subjectOfPublish(selected) : null} onClose={() => setSelected(null)} />
    </section>
  );
}
