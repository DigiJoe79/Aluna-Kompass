'use client';

import { Check, Circle, Minus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState, type ReactNode, type Ref } from 'react';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { stepCounter } from '@/lib/site-job-steps';
import { cancelSiteJobAction } from './actions';
import { McpBadge } from './source-mark';

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * Der Lauf, der gerade läuft — gleich wer ihn gestartet hat und von welcher
 * Seite aus. Der Poller des Tabs liefert den Stand; hier stehen Schritte,
 * Zähler, Quelle und der Knopf zum Abbrechen. Eingebettet (`embedded`) sitzt
 * sie in der Ablaufkarte der Publizieren-Seite statt in einer eigenen Karte.
 */
export function RunCard({ embedded = false, notice, headingRef }: { embedded?: boolean; notice?: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  const t = useTranslations('site.publish');
  const format = useFormatter();
  const lockedId = useId();
  const { running, refresh } = useSiteJobStatus();
  const [confirm, setConfirm] = useState(false);
  if (!running) return null;
  const kind = t(`job.names.${running.kind}`);
  const time = format.dateTime(new Date(running.startedAt), { timeStyle: 'short' });
  const locked = !running.cancellable;

  return (
    <section aria-label={t('run.title')} className={embedded ? 'flex flex-col gap-3' : 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-5'}>
      {notice ? <p className="rounded-md border border-line bg-surface-2 p-3 text-[13px] text-ink-2">{notice}</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 ref={headingRef} tabIndex={-1} className="font-heading text-[18px] outline-none">
            {kind} <span className="text-[13px] font-normal text-muted-ink">{t('run.elapsed', { duration: clock(running.elapsedMs) })}</span>
          </h3>
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-ink">
            {running.source === 'mcp' ? (
              <>
                <McpBadge />
                {running.tokenName ? t('flow.run.byAgent', { token: running.tokenName, name: running.userName ?? '—', time }) : t('flow.run.byAgentNoToken', { name: running.userName ?? '—', time })}
              </>
            ) : running.userName ? (
              t('flow.run.byPerson', { name: running.userName, time })
            ) : (
              t('run.source.ui')
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="outline"
            aria-disabled={locked || undefined}
            aria-describedby={locked ? lockedId : undefined}
            className={locked ? 'opacity-60' : undefined}
            onClick={() => {
              if (!locked) setConfirm(true);
            }}
          >
            {t('run.cancel')}
          </Button>
          {locked ? (
            <p id={lockedId} className="max-w-xs text-right text-[12px] text-muted-ink">
              {t('flow.run.cancelLocked')}
            </p>
          ) : null}
        </div>
      </div>
      <ol className="flex flex-col gap-2 text-[14px]">
        {running.steps.map((step) => {
          const counter = stepCounter(step);
          const counterText = counter ? t(`job.count.${counter.key}`, counter.values) : null;
          const known = step.state === 'running' && step.total !== undefined && step.total > 0 && step.done !== undefined;
          return (
            <li key={step.key} data-state={step.state} aria-current={step.state === 'running' ? 'step' : undefined} className={`flex flex-col gap-1 ${step.state === 'pending' ? 'text-muted-ink' : 'text-ink'}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {step.state === 'done' ? (
                  <Check className="size-[18px] shrink-0 text-success" aria-hidden />
                ) : step.state === 'running' ? (
                  <span className="size-[18px] shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
                ) : step.state === 'skipped' ? (
                  <Minus className="size-[18px] shrink-0" aria-hidden />
                ) : (
                  <Circle className="size-[18px] shrink-0" aria-hidden />
                )}
                <span>{t(`job.steps.${step.key}`)}</span>
                {counterText ? <span className="text-[13px] text-ink-2 tabular-nums max-sm:basis-full max-sm:pl-[26px]">{counterText}</span> : null}
                <span className="ml-auto text-[13px] text-muted-ink">{t(`job.stepState.${step.state}`)}</span>
              </div>
              {step.key === 'build' && step.state === 'skipped' ? <p className="pl-7 text-[13px] text-muted-ink">{t('job.buildSkipped')}</p> : null}
              {known ? (
                <Progress
                  className="pl-7"
                  value={Math.round((step.done! / step.total!) * 100)}
                  aria-label={t(`job.steps.${step.key}`)}
                  getAriaValueText={() => counterText ?? ''}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('run.cancelConfirmTitle')}
        description={t('run.cancelConfirmText')}
        confirmLabel={t('run.cancelConfirm')}
        destructive
        action={async () => {
          const state = await cancelSiteJobAction(running.runId);
          refresh();
          return state;
        }}
      />
    </section>
  );
}

/** Warum die Startknöpfe ruhen: Es läuft gerade etwas. Ohne Lauf steht hier nichts. */
export function BlockedHint() {
  const t = useTranslations('site.publish');
  const { running } = useSiteJobStatus();
  if (!running) return null;
  return <p className="text-[12px] text-muted-ink">{t('run.blockedBy', { kind: t(`job.names.${running.kind}`) })}</p>;
}
