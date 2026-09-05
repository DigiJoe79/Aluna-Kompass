'use client';

import type { PublishRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function PublishHistory({ items }: { items: PublishRecord[] }) {
  const t = useTranslations('website.publish.history');
  const [selected, setSelected] = useState<PublishRecord | null>(null);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="font-heading text-[18px]">{t('title')}</h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-ink">Bislang keine Veröffentlichungen.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label={t('title')} className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line text-muted-ink">
                <th className="py-2 pr-4">{t('columns.time')}</th>
                <th className="py-2 pr-4">{t('columns.status')}</th>
                <th className="py-2 pr-4">{t('columns.hash')}</th>
                <th className="py-2 pr-4">{t('columns.changes')}</th>
                <th className="py-2 pr-4">{t('columns.by')}</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-line hover:bg-surface-2">
                  <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.startedAt).toLocaleString('de-DE')}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] uppercase ${
                        row.status === 'success'
                          ? 'bg-success-bg text-success'
                          : row.status === 'failed'
                          ? 'bg-error-bg text-error'
                          : 'bg-muted-ink/10 text-muted-ink'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-[12px]">{row.contentHash ? row.contentHash.slice(0, 12) : '—'}</td>
                  <td className="py-2 pr-4">
                    +{row.pagesAdded} / ~{row.pagesChanged} / -{row.pagesRemoved}
                  </td>
                  <td className="py-2 pr-4 text-ink-2">{row.triggeredByUserId ?? 'System'}</td>
                  <td className="py-2 text-right">
                    {row.log && (
                      <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
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

      {selected && (
        <div
          role="dialog"
          aria-label={t('log')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-line bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-line p-4">
              <h4 className="font-heading text-[16px]">
                {t('log')} · {new Date(selected.startedAt).toLocaleString('de-DE')}
              </h4>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Schließen
              </Button>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-[12px] text-ink-2 bg-surface-2 whitespace-pre-wrap">
              {selected.log}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
