'use client';

import type { SiteCacheStatus } from '@kompass/module-site';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Button } from '@/components/ui/button';
import { clearSiteCacheAction } from './actions';
import { Section } from '@/components/section';
import { Empty } from '@/components/empty-value';

const MB = 1_048_576;

/** Stand von Bild-Cache und Vorschau; leeren geht nur, solange kein Lauf läuft (der Dienst lehnt sonst mit `siteJobRunning` ab). */
export function CachePanel({ status }: { status: SiteCacheStatus }) {
  const t = useTranslations('site.admin.cache');
  const format = useFormatter();
  const fmt = useDateFormat();
  const router = useRouter();
  const { running } = useSiteJobStatus();
  const [open, setOpen] = useState(false);
  const date = (iso: string) => fmt.dateTime(iso);
  const size = (bytes: number) => format.number(bytes / MB, { maximumFractionDigits: 1 });
  const { images, preview } = status;
  const busy = running !== null;
  const rows: [string, React.ReactNode][] = [
    [t('terms.images'), t('images', { count: images.count, size: size(images.bytes) })],
    [t('terms.age'), images.oldest && images.newest ? t('age', { oldest: date(images.oldest), newest: date(images.newest) }) : <Empty />],
    [t('terms.preview'), preview.builtAt ? t('preview', { size: size(preview.bytes), date: date(preview.builtAt) }) : t('noPreview')],
  ];

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <Section title={t('title')} intro={t('intro')}>
        <div className="flex flex-col gap-3">
          {/* 11-2 B18: Begriff und Wert wie bei „Verbindung“ statt drei loser Zeilen. */}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-meta">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-ink">{label}</dt>
                <dd className="text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-3">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>{t('clear')}</Button>
            {busy ? <span className="text-meta text-muted-ink">{t('blocked')}</span> : null}
          </div>
          <ConfirmDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) router.refresh();
            }}
            title={t('confirmTitle')}
            description={t('confirmText')}
            confirmLabel={t('clear')}
            destructive
            action={clearSiteCacheAction}
          />
        </div>
      </Section>
    </section>
  );
}
