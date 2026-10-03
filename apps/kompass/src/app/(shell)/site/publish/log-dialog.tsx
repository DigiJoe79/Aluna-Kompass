'use client';

import type { PublishSource, PublishSummary } from '@kompass/module-site';
import { Copy } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { copyToClipboard } from '@/lib/clipboard';
import type { DetailView } from '@/lib/site-job-view';
import { SourceMark } from './source-mark';
import { StatusMark } from './status-mark';

/** Was der Dialog zeigt und woher er sein Protokoll holt: ein Eintrag der Historie oder das letzte Ergebnis einer Art. */
export interface LogSubject {
  key: string;
  /** Adresse des vollen Protokolls und wie man den Text darin findet. */
  from: { kind: 'publish'; id: string } | { kind: 'job'; job: SiteJobKindName };
  startedAt: string;
  status: PublishSummary['status'];
  byName: string | null;
  source: PublishSource;
  hash: string;
  summary: string;
  /** Steht im Protokoll nichts, hilft die Fehlermeldung des Laufs. */
  fallback: string;
}
type SiteJobKindName = DetailView['kind'];

export const subjectOfPublish = (p: PublishSummary): LogSubject => ({
  key: p.id,
  from: { kind: 'publish', id: p.id },
  startedAt: p.startedAt,
  status: p.status,
  byName: p.triggeredByName,
  source: p.source,
  hash: p.contentHash,
  summary: p.summary,
  fallback: '',
});

/** Ein beendeter Lauf: Das Protokoll liegt im Ergebnis seiner Art (`/site/job/<art>`), ohne Publish-Eintrag gilt die Fehlermeldung. */
export const subjectOfJob = (job: DetailView): LogSubject => ({
  key: job.runId,
  from: { kind: 'job', job: job.kind },
  startedAt: job.startedAt,
  status: job.status === 'success' ? 'success' : job.status === 'failed' ? 'failed' : 'aborted',
  byName: job.userName,
  source: { channel: 'ui', tokenName: null },
  hash: job.contentHash ?? '',
  summary: '',
  fallback: job.error?.message ?? '',
});

/**
 * Das Protokoll eines Laufs. Es lädt erst, wenn der Dialog aufgeht
 * (`/site/publishes/[id]`), der Fokus liegt auf dem Protokoll selbst, damit es
 * sich mit der Tastatur scrollen lässt, und „Kopieren“ übergibt es der
 * Zwischenablage.
 */
export function LogDialog({ item, onClose }: { item: LogSubject | null; onClose(): void }) {
  const t = useTranslations('site.publish.log');
  const tHistory = useTranslations('site.publish.history');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const [log, setLog] = useState<string | null>(null);
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setLog(null);
    if (!item) return;
    let active = true;
    const url = item.from.kind === 'publish' ? `/site/publishes/${item.from.id}?log=full` : `/site/job/${item.from.job}?log=full`;
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ log?: { text: string }; last?: { runId: string; log: { text: string } } | null }>) : null))
      .then((body) => {
        // Zwischen Klick und Antwort kann ein neuer Lauf das „letzte Ergebnis“ ersetzt haben; dann gilt die Meldung.
        const text = item.from.kind === 'publish' ? body?.log?.text : body?.last?.runId === item.key ? body.last.log.text : '';
        if (active) setLog(text || item.fallback);
      })
      .catch(() => active && setLog(item.fallback));
    return () => {
      active = false;
    };
  }, [item]);

  const copy = async () => {
    if (log !== null && (await copyToClipboard(log))) toast.success(t('copied'));
  };

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent layout="fixed-footer" initialFocus={pre} className="bg-surface sm:max-w-[760px] max-sm:h-full max-sm:max-h-full max-sm:max-w-full max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="font-heading text-[16px]">{item ? t('title', { when: format.dateTime(new Date(item.startedAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : ''}</DialogTitle>
          {item ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
              <StatusMark status={item.status} />
              <span>
                <SourceMark source={item.source} name={item.byName} />
              </span>
              {item.hash ? <span className="font-mono text-[12px]">{item.hash.slice(0, 12)}</span> : null}
            </div>
          ) : null}
          {item?.summary ? (
            <p className="text-[13px] text-ink-2">
              <span className="font-semibold">{t('short')}</span> {item.summary}
            </p>
          ) : null}
        </DialogHeader>
        <DialogBody>
          {log === null ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
              <span className="sr-only">{tHistory('loading')}</span>
            </div>
          ) : (
            <pre ref={pre} tabIndex={0} className="rounded-md bg-code p-4 font-mono text-[12px] whitespace-pre-wrap text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {log}
            </pre>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={log === null} onClick={() => void copy()}>
            <Copy aria-hidden />
            {t('copy')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
