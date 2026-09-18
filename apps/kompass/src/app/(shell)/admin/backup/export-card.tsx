'use client';

import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ExportCard({ lastExportAt }: { lastExportAt: string | null }) {
  const t = useTranslations('backup.export');
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch('/admin/backup/export', { method: 'POST' });
      if (!res.ok) { toast.error(t('failed')); return; }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'kompass-backup.tar.gz';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      // Der Anker muss im Dokument hängen: ein Klick auf ein losgelöstes
      // Element löst in Safari und Firefox keinen Download aus.
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Der Download startet asynchron. Die Blob-URL erst später freigeben und
      // die Seite weich aktualisieren — ein harter Reload bräche ihn ab.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 rounded-lg border border-line bg-surface p-5">
      <div>
        <h3 className="font-heading text-[18px]">{t('title')}</h3>
        <p className="mt-1 text-[14px] text-ink-2">{t('text')}</p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]"><dt className="text-muted-ink">{t('last')}</dt><dd className="col-span-2 font-mono font-semibold">{lastExportAt ? format.dateTime(new Date(lastExportAt), { dateStyle: 'short', timeStyle: 'short' }) : '—'}</dd></dl>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Button className="h-[38px]" disabled={busy} aria-busy={busy} onClick={run}><Download className="size-4" aria-hidden />{busy ? t('running') : t('button')}</Button>
        <span className="text-[12px] text-muted-ink">{t('duration')}</span>
      </div>
    </section>
  );
}
