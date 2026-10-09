'use client';

import { Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { useState } from 'react';
import { toast } from 'sonner';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions';

export function ExportCard({ lastExportAt }: { lastExportAt: string | null }) {
  const t = useTranslations('backup.export');
  const fmt = useDateFormat();
  const router = useRouter();
  const tCommon = useTranslations('common');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const run = async () => {
    setBusy(true);
    setRefusal({ status: 'idle' });
    try {
      const res = await fetch('/admin/backup/export', { method: 'POST' });
      if (!res.ok) { setRefusal({ status: 'error', message: t('failed'), fieldErrors: {} }); return; }
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
    } catch {
      // Der Server war nicht zu erreichen: keine Ablehnung, sondern ein Toast zum Wiederholen.
      toast.error(tCommon('network'), { duration: Infinity, closeButton: true, action: { label: tCommon('retry'), onClick: () => void run() } });
    } finally {
      setBusy(false);
    }
  };
  return (
    // Am Telefon untereinander wie die Kopfzeile (`PageHeader`): Neben der festen Knopfspalte blieben dem Text
    // rund 80 px, und der Wert lag über „Letzter Export“ (Befund 16 in 0.2.8). Bezeichnung und Wert wie in
    // `admin/site/connection-panel.tsx` (`max-content` und Rest). Bei 390 px angesehen; kein Layout-Test für
    // eine Einzelstelle (Projektregel).
    <section className="grid grid-cols-[minmax(0,1fr)_220px] gap-4 rounded-lg border border-line bg-surface p-5 max-sm:grid-cols-1">
      <div>
        <h3 className="text-[15px] font-semibold">{t('title')}</h3>
        <p className="mt-1 text-[14px] text-ink-2">{t('text')}</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-[13px]"><dt className="text-muted-ink">{t('last')}</dt><dd className="font-mono font-semibold">{lastExportAt ? fmt.dateTime(lastExportAt) : '—'}</dd></dl>
      </div>
      <div className="flex flex-col items-end gap-1 max-sm:items-start">
        <RefusalNotice action state={refusal} />
        <Button className="h-[38px]" disabled={busy} aria-busy={busy} onClick={run}><Download className="size-4" aria-hidden />{busy ? t('running') : t('button')}</Button>
        <span className="text-[12px] text-muted-ink">{t('duration')}</span>
      </div>
    </section>
  );
}
