'use client';

import { Check, Minus, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Disclosure } from '@/components/ui/disclosure';
import { startDeployCheckAction } from '@/app/(shell)/site/publish/actions';
import { FileList } from '@/app/(shell)/site/publish/file-list';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { LastResult, useSiteJobDetail, useStartJob } from '@/app/(shell)/site/publish/last-result';
import { BlockedHint } from '@/app/(shell)/site/publish/run-card';

/**
 * Der Test läuft im Hintergrund und braucht Sekunden; der Knopf startet ihn
 * nur, der Poller des Tabs meldet ihn. Das letzte Ergebnis liegt im Cache und
 * steht deshalb auch nach dem Neuladen noch da. Ein Ergebnis aus 0.2.5-dev
 * ohne Prüfpunkte gilt als „noch nicht getestet“.
 */
export function ConnectionCard() {
  const t = useTranslations('site.publish.connection');
  const tStep = useTranslations('site.publish.job.steps');
  const tRun = useTranslations('site.publish.run');
  const format = useFormatter();
  const { running } = useSiteJobStatus();
  const { pending, start, state: startRefusal } = useStartJob();
  const detail = useSiteJobDetail('deployCheck');

  const busy = pending || running !== null;
  const mine = running?.kind === 'deployCheck';
  const result = !mine && detail?.status === 'success' && detail.checks ? detail : null;
  const files = result?.filesAtTarget ?? null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">{t('title')}</h3>
          <p className="max-w-prose text-[13px] text-muted-ink">{result?.target ? t('target', { target: result.target }) : t('intro')}</p>
        </div>
        <Button disabled={busy} aria-busy={busy} onClick={() => start(startDeployCheckAction)}>
          {mine ? t('running') : t('run')}
        </Button>
      </div>
      <RefusalNotice action state={startRefusal} />
      <BlockedHint />
      <LastResult kind="deployCheck" onRestart={() => start(startDeployCheckAction)} restartDisabled={busy} />

      {!result && !mine ? <p className="text-[13px] text-muted-ink">{t('notTested')}</p> : null}
      {result && (
        <section aria-label={t('resultTitle')} className="flex flex-col gap-3">
          <p className="text-[12px] text-muted-ink">
            {t('checkedAt', { date: format.dateTime(new Date(result.finishedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
          <ul aria-label={t('checksLabel')} className="flex flex-col gap-1.5 text-[13px]">
            {result.checks!.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                {c.outcome === 'ok' ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : c.outcome === 'failed' ? (
                  <X className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
                ) : (
                  <Minus className="mt-0.5 size-4 shrink-0 text-muted-ink" aria-hidden />
                )}
                <span className={c.outcome === 'failed' ? 'text-error' : 'text-ink-2'}>
                  {`${tStep(c.key)}: ${c.outcome === 'failed' ? t(`problems.${c.problem ?? 'unknown'}`) : t(`outcome.${c.outcome}`)}`}
                </span>
              </li>
            ))}
          </ul>
          {result.passed && files ? <p className="text-[13px] font-semibold text-ink-2">{files.total === 0 ? t('empty') : t('ok', { count: files.total })}</p> : null}
          {files && files.total > 0 && (
            <Disclosure label={t('filesTitle')} count={files.total}>
              <FileList list={files} />
            </Disclosure>
          )}
          <Disclosure label={t('logTitle')}>
            <pre className="font-mono text-[12px] whitespace-pre-wrap text-ink-2">{result.log.text}</pre>
            {result.log.truncated ? <p className="mt-2 text-[12px] text-muted-ink">{tRun('logTruncated')}</p> : null}
          </Disclosure>
        </section>
      )}
    </section>
  );
}
