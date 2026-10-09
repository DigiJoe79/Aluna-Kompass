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

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h3 className="text-[15px] font-semibold">{t('title')}</h3>
      <p className="max-w-prose text-[13px] text-ink-2">{t('intro')}</p>
      <ul className="flex flex-col gap-1 text-[13px] text-ink">
        <li>{t('images', { count: images.count, size: size(images.bytes) })}</li>
        <li>{images.oldest && images.newest ? t('age', { oldest: date(images.oldest), newest: date(images.newest) }) : t('noAge')}</li>
        <li>{preview.builtAt ? t('preview', { size: size(preview.bytes), date: date(preview.builtAt) }) : t('noPreview')}</li>
      </ul>
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={busy} onClick={() => setOpen(true)}>{t('clear')}</Button>
        {busy ? <span className="text-[13px] text-muted-ink">{t('blocked')}</span> : null}
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
    </section>
  );
}
