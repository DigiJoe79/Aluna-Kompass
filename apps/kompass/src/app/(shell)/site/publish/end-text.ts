import type { DetailView } from '@/lib/site-job-view';

/** Der Übersetzer des Namensraums `site.publish`; die Schlüssel hier sind relativ dazu. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const counter = (job: DetailView, t: Translate): string | null => {
  const at = job.stoppedAt;
  if (!at || at.done === undefined) return null;
  return at.total === undefined || at.total === 0 ? t('job.count.number', { count: at.done }) : t('job.count.count', { done: at.done, total: at.total });
};

/** Titel eines beendeten Laufs, der nicht „Publiziert“ heißt. */
export function endTitle(job: DetailView, t: Translate): string {
  if (job.status === 'success') return t('flow.end.success.title');
  if (job.status === 'interrupted') return t('flow.end.interrupted.title');
  if (job.status === 'aborted') return job.reason === 'timeout' ? t('flow.end.timeout.title') : t('flow.end.cancelled.title', { kind: job.kind });
  return job.kind === 'publish' ? t('flow.end.failed.title') : t('flow.end.failedPreview.title');
}

/**
 * Der Satz zu einem beendeten Lauf: was geschah, wo er stand, ob sich die
 * Webseite verändert hat und was ein neuer Start tut. Rein und ohne Rot für
 * Abbruch, Zeitlimit und Neustart.
 */
export function endText(job: DetailView, t: Translate): string {
  const step = job.lastStep ? t(`job.steps.${job.lastStep}`) : '';
  const cache = t('flow.end.cache');
  if (job.status === 'interrupted') return `${t('flow.end.interrupted.text', { step })} ${cache}`;
  if (job.status === 'aborted') {
    if (job.reason !== 'timeout') return `${t('flow.end.cancelled.text', { step })} ${cache}`;
    const limit = job.timeout;
    const count = counter(job, t);
    const values = { step, minutes: Math.round((limit?.limitMs ?? 0) / 60_000), hasCount: count ? 'yes' : 'no', count: count ?? '' };
    return `${t(limit?.stalled ? 'flow.end.timeout.textStalled' : 'flow.end.timeout.text', values)} ${cache}`;
  }
  if (job.status === 'failed') {
    if (job.kind !== 'publish') return job.error?.message ?? t('flow.end.reason.unknown');
    const reason = t(`flow.end.reason.${job.failure ?? 'unknown'}`);
    const touched = job.lastStep === 'transfer' || job.lastStep === 'record';
    return `${reason} ${t(touched ? 'flow.end.failed.partial' : 'flow.end.failed.untouched')}`;
  }
  return '';
}
