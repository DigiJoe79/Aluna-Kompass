'use client';

import { AlertTriangle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { startDeployCheckAction } from './actions';
import { useSiteJob } from './use-site-job';

interface DeployCheck {
  target: string;
  filesAtTarget: string[];
  publishWould: { changed: string[]; added: string[]; removed: string[] } | null;
  build: { ok: boolean; reason?: string };
  log: string;
}

/**
 * Der Test läuft im Hintergrund (er baut wie ein Publish); der Knopf startet
 * ihn nur, `useSiteJob` wartet auf das Ergebnis. Das letzte Ergebnis liegt im
 * Cache und steht deshalb auch nach dem Neuladen noch da.
 */
export function ConnectionCard({ hasDeploy }: { hasDeploy: boolean }) {
  const t = useTranslations('site.publish.connection');
  const format = useFormatter();
  const { last, busy, start } = useSiteJob<DeployCheck>('deployCheck', { keepLast: true });

  if (!hasDeploy) return null;

  const result = busy ? null : (last?.result ?? null);
  const failure = busy ? null : (last?.error ?? null);
  const isEmpty = result !== null && result.filesAtTarget.length === 0;
  const would = result?.publishWould ?? null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-[18px]">{t('title')}</h3>
          <p className="text-[13px] text-muted-ink">{result ? t('target', { target: result.target }) : t('intro')}</p>
        </div>
        <Button
          disabled={busy}
          aria-busy={busy}
          onClick={() => start(startDeployCheckAction)}
        >
          {busy ? t('running') : t('run')}
        </Button>
      </div>

      {failure && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('failed', { message: failure })}
        </p>
      )}

      {result && (
        <section aria-label={t('resultTitle')} className="flex flex-col gap-3">
          {last && (
            <p className="text-[12px] text-muted-ink">
              {t('checkedAt', { date: format.dateTime(new Date(last.finishedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
            </p>
          )}
          <p className={`flex items-start gap-2 text-[13px] ${isEmpty ? 'text-error' : 'text-ink-2'}`}>
            {isEmpty ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
            {isEmpty ? t('empty') : t('ok', { count: result.filesAtTarget.length })}
          </p>
          {result.filesAtTarget.length > 0 && (
            <Disclosure label={t('filesTitle')} count={result.filesAtTarget.length} tone="warning">
              <ul className="flex flex-col gap-1 font-mono text-[12px]">
                {result.filesAtTarget.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Disclosure>
          )}

          <p className="text-[13px] text-ink-2">
            {would ? t('would', { changed: would.changed.length, added: would.added.length, removed: would.removed.length }) : t('buildFailed')}
          </p>
          {would && would.removed.length > 0 && (
            <Disclosure label={t('removedTitle')} count={would.removed.length} tone="warning">
              <ul className="flex flex-col gap-1 font-mono text-[12px]">
                {would.removed.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Disclosure>
          )}
          {would && (would.changed.length > 0 || would.added.length > 0) && (
            <Disclosure label={t('changedTitle')} count={would.changed.length + would.added.length}>
              <ul className="flex flex-col gap-1 font-mono text-[12px]">
                {[...would.changed, ...would.added].map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Disclosure>
          )}

          <Disclosure label={t('logTitle')}>
            <pre className="font-mono text-[12px] whitespace-pre-wrap text-ink-2">{result.log}</pre>
          </Disclosure>
        </section>
      )}
    </section>
  );
}
