'use client';

import { AlertTriangle, ExternalLink, Pause } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useDateFormat } from '@/components/date-format-provider';
import { Fragment, useId, type ReactNode, type Ref } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { DetailView, PendingView } from '@/lib/site-job-view';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import { BlockedNotice } from './blocked-notice';
import { endText, endTitle, type Translate } from './end-text';
import type { FlowState } from './flow-state';
import { PreviewDetails } from './preview-details';
import { PreviewSummary } from './preview-summary';
import { RunCard } from './run-card';
import { panelHref } from '@/components/panel-nav';

export { endText } from './end-text';

export interface PublishFlowCardProps {
  state: FlowState;
  env: string;
  publicUrl: string | null;
  hasDeploy: boolean;
  canManage: boolean;
  imageCacheEmpty: boolean;
  /** Ein Start ist unterwegs, aber noch nicht beim Poller angemeldet. */
  busy?: boolean;
  onRequestPublish(): void;
  onStartPreview(): void;
  onRetryPublish(): void;
  /** Öffnet das Protokoll des Laufs, der die Karte beendet hat. */
  onOpenLog(job: DetailView): void;
  headingRef?: Ref<HTMLHeadingElement>;
}

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Board Vorschläge 8d: die geänderten Datensätze mit Namen, vier davon, der Rest als Zahl; von der Webseite genommene ohne Link. */
function PendingSince({ pending }: { pending: PendingView }) {
  const tp = useTranslations('site.pending');
  const fmt = useDateFormat();
  const shown = pending.items.slice(0, 4);
  const rest = pending.count - shown.length;
  return (
    <p data-testid="site-pending-since" className="text-[14px] text-ink-2">
      {tp('since', { date: fmt.date(pending.since!) })}{' '}
      {shown.map((item, i) => (
        <Fragment key={item.key}>
          {i === 0 ? null : rest === 0 && i === shown.length - 1 ? ` ${tp('and')} ` : ', '}
          {item.href ? (
            <Link href={item.href} className="text-link underline">
              {item.label}
            </Link>
          ) : (
            item.label
          )}
          {item.kind === 'changed' ? null : ` (${tp(`kind.${item.kind}`)})`}
        </Fragment>
      ))}
      {rest > 0 ? ` ${tp('more', { count: rest })}` : null}.
    </p>
  );
}

/**
 * Die Karte der Publizieren-Seite: genau ein Zustand, höchstens ein Primärknopf.
 * Der Zustand kommt fertig abgeleitet aus `deriveFlowState`; hier wird er nur
 * gezeichnet. Läuft etwas, steckt die Laufkarte in der Karte.
 */
export function PublishFlowCard(p: PublishFlowCardProps) {
  const t = useTranslations('site.publish');
  const fmt = useDateFormat();
  const reasonId = useId();
  const { state } = p;
  const { pending } = useSiteJobStatus();
  const canPublishHere = p.env !== 'development' && p.hasDeploy;
  const host = hostOf(p.publicUrl);
  const time = (iso: string) => fmt.time(iso);
  const dateTime = (iso: string) => fmt.dateTime(iso);
  const tr = t as unknown as Translate;

  const publishLabel = p.env === 'test' ? t('flow.publish.test') : t('flow.publish.live');
  const primary = (label: string, onClick: () => void, key?: string) => (
    <Button key={key} disabled={p.busy} onClick={onClick}>
      {label}
    </Button>
  );
  const outline = (label: string, onClick: () => void) => (
    <Button variant="outline" disabled={p.busy} onClick={onClick}>
      {label}
    </Button>
  );
  const openPreview = (
    <Link href="/site/preview-frame" target="_blank" rel="noopener" className={`${buttonVariants({ variant: 'outline' })} gap-1.5 max-sm:h-[46px]`}>
      {t('flow.openPreview')}
      <ExternalLink className="size-3.5" aria-hidden />
    </Link>
  );
  /** Die Publizieren-Knöpfe: ohne Ziel oder in der Entwicklung gibt es keinen, sondern einen Satz. */
  const noPublishNote = (): ReactNode =>
    p.env === 'development' ? (
      <p className="text-[13px] text-muted-ink">{t('flow.notHere')}</p>
    ) : !p.hasDeploy ? (
      <p className="text-[13px] text-muted-ink">
        {t('flow.noTarget')}{' '}
        {p.canManage ? (
          <Link href={panelHref('/admin/site', 'connection')} className="text-link underline">
            {t('flow.noTargetLink')}
          </Link>
        ) : null}
      </p>
    ) : null;

  let eyebrow = t('flow.step1');
  let title = '';
  let titleIcon: ReactNode = null;
  let body: ReactNode = null;
  let actions: ReactNode = null;

  switch (state.kind) {
    case 'none':
      title = t('flow.none.title');
      body =
        pending && pending.count > 0 && pending.since ? (
          <PendingSince pending={pending} />
        ) : (
          <p className="text-[14px] text-ink-2">{state.lastPublishedAt ? t('flow.none.text', { date: dateTime(state.lastPublishedAt) }) : t('flow.none.textNever')}</p>
        );
      actions = primary(t('flow.startPreview'), p.onStartPreview);
      break;
    case 'outdated':
      title = t('flow.outdated.title');
      body = <p className="text-[14px] text-ink-2">{t('flow.outdated.text', { time: time(state.preview.finishedAt) })}</p>;
      actions = primary(t('flow.rebuild'), p.onStartPreview);
      break;
    case 'running': {
      const kind = state.run.kind;
      title = kind === 'preview' ? t('flow.run.preview') : kind === 'publish' ? (p.env === 'test' ? t('flow.run.publishTest') : t('flow.run.publish')) : t('flow.run.deployCheck');
      eyebrow = kind === 'publish' ? t('flow.step2') : t('flow.step1');
      body = <RunCard embedded headingRef={p.headingRef} notice={p.imageCacheEmpty && kind !== 'deployCheck' ? t('flow.run.cacheEmpty') : undefined} />;
      break;
    }
    case 'ready': {
      eyebrow = t('flow.step2');
      title = t('flow.ready.title');
      const pv = state.preview;
      const meta = pv.userName
        ? t('flow.ready.meta', { when: dateTime(pv.finishedAt), name: pv.userName, hash: (pv.contentHash ?? '').slice(0, 12) })
        : t('flow.ready.metaNoName', { when: dateTime(pv.finishedAt), hash: (pv.contentHash ?? '').slice(0, 12) });
      body = (
        <>
          <p className="text-[12px] text-muted-ink">{meta}</p>
          <PreviewSummary counts={pv.counts} />
          <PreviewDetails detail={pv} />
        </>
      );
      actions = (
        <>
          {canPublishHere ? primary(publishLabel, p.onRequestPublish) : primary(t('flow.rebuild'), p.onStartPreview)}
          {openPreview}
          {canPublishHere ? null : noPublishNote()}
        </>
      );
      break;
    }
    case 'unchanged': {
      eyebrow = t('flow.step2');
      title = t('flow.unchanged.title');
      const pv = state.preview;
      body = <p className="text-[14px] text-ink-2">{t('flow.unchanged.text', { time: time(pv.finishedAt), host: host ?? '—' })}</p>;
      actions = (
        <>
          {openPreview}
          {canPublishHere ? (
            <Button variant="link" className="h-auto px-0 underline max-sm:h-[46px]" disabled={p.busy} onClick={p.onRequestPublish}>
              {t('flow.unchanged.publishAnyway')}
            </Button>
          ) : (
            noPublishNote()
          )}
        </>
      );
      break;
    }
    case 'blocked': {
      eyebrow = t('flow.step2');
      title = t('flow.blocked.title');
      titleIcon = <AlertTriangle className="size-5 shrink-0 text-error" aria-hidden />;
      const pv = state.preview;
      body = (
        <>
          <p className="text-[14px] text-ink-2">{t('flow.blocked.text')}</p>
          <BlockedNotice violations={pv.violations ?? []} canManage={p.canManage} />
          <PreviewSummary counts={pv.counts} />
          <PreviewDetails detail={pv} />
        </>
      );
      actions = (
        <>
          {primary(t('flow.rebuild'), p.onStartPreview)}
          {canPublishHere ? (
            <>
              <Button variant="outline" aria-disabled="true" aria-describedby={reasonId} onClick={(e) => e.preventDefault()}>
                {publishLabel}
              </Button>
              <span id={reasonId} className="sr-only">
                {t('flow.blocked.text')}
              </span>
            </>
          ) : null}
        </>
      );
      break;
    }
    case 'ended': {
      const job: DetailView = state.job;
      const failed = job.status === 'failed';
      title = endTitle(job, tr);
      titleIcon = failed ? <AlertTriangle className="size-5 shrink-0 text-error" aria-hidden /> : <Pause className="size-5 shrink-0 text-muted-ink" aria-hidden />;
      if (job.status === 'success') {
        titleIcon = null;
        eyebrow = t('flow.step2');
        body = (
          <>
            <p className="text-[14px] text-ink-2">
              {t('flow.end.success.text', { when: dateTime(job.finishedAt), changed: job.counts.changed, added: job.counts.added, removed: job.counts.removed })}
            </p>
            {p.publicUrl ? (
              <a href={p.publicUrl} target="_blank" rel="noreferrer" className="w-fit text-[14px] font-medium text-link underline">
                {t('flow.end.success.open', { host: host ?? p.publicUrl })}
              </a>
            ) : null}
            <p className="text-[13px] text-muted-ink">{t('flow.end.success.consumed')}</p>
          </>
        );
        actions = outline(t('flow.startPreview'), p.onStartPreview);
      } else {
        eyebrow = job.kind === 'publish' ? t('flow.step2') : t('flow.step1');
        body = <p className={`text-[14px] ${failed ? 'text-ink' : 'text-ink-2'}`}>{endText(job, tr)}</p>;
        actions =
          state.retry === 'publish' && canPublishHere
            ? primary(t('flow.end.retryPublish'), p.onRetryPublish)
            : primary(job.status === 'failed' ? t('flow.rebuild') : t('flow.end.restart'), p.onStartPreview);
        // Ein Abbruch durch die Person hat nichts zu erklären; alles andere schon.
        if (!(job.status === 'aborted' && job.reason === 'cancelled')) {
          actions = (
            <>
              {actions}
              <Button variant="link" className="h-auto px-0 underline max-sm:h-[46px]" onClick={() => p.onOpenLog(job)}>
                {t('flow.end.log')}
              </Button>
            </>
          );
        }
      }
      break;
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 max-sm:p-4">
      <span className="sr-only" aria-live="polite">
        {title}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-semibold text-muted-ink">{eyebrow}</p>
        {state.kind === 'running' ? null : (
          <h2 ref={p.headingRef} tabIndex={-1} className="flex items-center gap-2 font-heading text-[20px] leading-[25px] outline-none">
            {titleIcon}
            {title}
          </h2>
        )}
      </div>
      {body}
      {actions ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>button]:max-sm:h-[46px] [&>button]:max-sm:w-full [&>a]:max-sm:w-full">{actions}</div> : null}
    </section>
  );
}
