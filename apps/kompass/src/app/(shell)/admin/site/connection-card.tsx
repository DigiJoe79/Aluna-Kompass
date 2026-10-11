'use client';

import { Check, Minus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Button } from '@/components/ui/button';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Disclosure } from '@/components/ui/disclosure';
import { startDeployCheckAction } from '@/app/(shell)/site/publish/actions';
import { FileList } from '@/app/(shell)/site/publish/file-list';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { LastResult, useSiteJobDetail, useStartJob } from '@/app/(shell)/site/publish/last-result';
import { BlockedHint } from '@/app/(shell)/site/publish/run-card';
import { Section } from '@/components/section';

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
  const fmt = useDateFormat();
  const { running } = useSiteJobStatus();
  const { pending, start, state: startRefusal } = useStartJob();
  const detail = useSiteJobDetail('deployCheck');

  const busy = pending || running !== null;
  const mine = running?.kind === 'deployCheck';
  const result = !mine && detail?.status === 'success' && detail.checks ? detail : null;
  const files = result?.filesAtTarget ?? null;

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <Section
        title={t('title')}
        intro={result?.target ? t('target', { target: result.target }) : t('intro')}
        actions={
          <Button disabled={busy} aria-busy={busy} onClick={() => start(startDeployCheckAction)}>
            {mine ? t('running') : t('run')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <RefusalNotice action state={startRefusal} />
          <BlockedHint />
          <LastResult kind="deployCheck" onRestart={() => start(startDeployCheckAction)} restartDisabled={busy} />

          {!result && !mine ? <p className="text-meta text-muted-ink">{t('notTested')}</p> : null}
          {result && (
            <section aria-label={t('resultTitle')} className="flex flex-col gap-3">
              <p className="text-hint text-muted-ink">
                {t('checkedAt', { date: fmt.dateTime(result.finishedAt) })}
              </p>
              <ul aria-label={t('checksLabel')} className="flex flex-col gap-1.5 text-meta">
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
              {result.passed && files ? <p className="text-meta font-semibold text-ink-2">{files.total === 0 ? t('empty') : t('ok', { count: files.total })}</p> : null}
              {files && files.total > 0 && (
                <Disclosure label={t('filesTitle')} count={files.total}>
                  <FileList list={files} />
                </Disclosure>
              )}
              <Disclosure label={t('logTitle')}>
                <pre className="font-mono text-hint whitespace-pre-wrap text-ink-2">{result.log.text}</pre>
                {result.log.truncated ? <p className="mt-2 text-hint text-muted-ink">{tRun('logTruncated')}</p> : null}
              </Disclosure>
            </section>
          )}
        </div>
      </Section>
    </section>
  );
}
