import type { MaintenanceView } from '@kompass/core';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthCard } from '@/components/auth-card';
import { RunSteps, type RunStep } from '@/components/run-steps';
import { buttonVariants } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/dates';

type Shown = Exclude<MaintenanceView, { phase: 'idle' }>;

/** Ab hier ist am Bestand etwas ersetzt: Scheitert es danach, holt Kompass den Stand von vorher zurück (Board 4d/4e). */
const TOUCHES_DATA = new Set(['replace', 'migrate', 'finish']);

/**
 * Die Schritte der Wartungsseite in der Reihenfolge des Laufs (`safeguard · verify · replace · migrate · finish`).
 * Gescheitert: der Schritt `failedStep` wird `failed`, alle danach `pending`; hatte er schon am Bestand etwas ersetzt,
 * folgt die Zeile „Stand von … zurückholen“ — erledigt bei `failed`, gescheitert bei `rollbackFailed`. Kein Zähler:
 * Der Balken genügt (das Board zeigt dort keinen).
 */
export function maintenanceSteps(view: Shown, label: (key: string) => string, rollbackLabel: string): RunStep[] {
  const failedStep = view.phase === 'failed' || view.phase === 'rollbackFailed' ? view.failedStep : null;
  const failedAt = failedStep ? view.steps.findIndex((s) => s.key === failedStep) : -1;
  const steps: RunStep[] = view.steps.map((step, i) => {
    if (failedAt >= 0 && i === failedAt) return { key: step.key, label: label(step.key), state: 'failed' };
    if (failedAt >= 0 && i > failedAt) return { key: step.key, label: label(step.key), state: 'pending' };
    // Vor dem gescheiterten Schritt war alles fertig, auch wenn der letzte Spiegel ihn noch laufend zeigte.
    const state = failedAt >= 0 && step.state === 'running' ? 'done' : step.state;
    const progress = state === 'running' && step.total !== undefined && step.total > 0 && step.done !== undefined ? { done: step.done, total: step.total } : null;
    return { key: step.key, label: label(step.key), state, counter: null, progress };
  });
  if (failedStep && TOUCHES_DATA.has(failedStep)) steps.push({ key: 'rollback', label: rollbackLabel, state: view.phase === 'rollbackFailed' ? 'failed' : 'done' });
  return steps;
}

/**
 * Wartungsseite während des Einspielens (N1, Board 4a–4e): dieselbe Karte für alle, ohne Sitzung und ohne Datenbank.
 * Zeiten in der Vereinszeitzone vom Start des Laufs; das Datumsformat ist fest `locale`, weil ohne Datenbank keine
 * Einstellung `ui.dateFormat` zu lesen ist. `now` reicht die Seite durch; die Karte braucht ihn heute nicht.
 */
export function MaintenanceCard({ view, appName }: { view: Shown; appName: string; now: Date }) {
  const t = useTranslations('backup.maintenance');
  const tz = view.timeZone;
  const createdAt = formatDateTime(view.backupCreatedAt, 'locale', tz);
  const since = formatTime(view.startedAt, tz);
  const steps = maintenanceSteps(view, (key) => t(`steps.${key}`), t('steps.rollback', { since }));
  const list = view.phase === 'done' ? null : <RunSteps steps={steps} testId="maintenance-step" />;
  const card = (title: string, footer: string, body: ReactNode) => (
    <AuthCard brand={appName} organization={view.organization ?? undefined} title={title} width={480} footer={footer}>
      {body}
    </AuthCard>
  );
  const loginLink = (href: string) => (
    <Link href={href} className={buttonVariants()}>
      {t('login')}
    </Link>
  );

  switch (view.phase) {
    case 'running': {
      const minutes = view.estimatedSeconds === null ? 'none' : String(Math.max(1, Math.ceil(view.estimatedSeconds / 60)));
      return card(
        t('running.title'),
        t('running.foot', { time: formatTime(view.backupCreatedAt, tz) }),
        <>
          <p className="text-body text-ink-2" role="status">
            {t('running.text', { name: view.startedBy ?? 'none', createdAt })}
          </p>
          {list}
          <p className="text-meta text-muted-ink">{t('running.meta', { since, minutes })}</p>
        </>,
      );
    }
    case 'done':
      return card(
        t('done.title', { createdAt }),
        t('done.foot'),
        <>
          <p className="text-body text-ink-2">{t('done.text')}</p>
          {loginLink('/login?imported=1')}
        </>,
      );
    case 'failed':
      return card(
        t('failed.title'),
        t('failed.foot'),
        <>
          <p className="text-body text-ink-2">{t('failed.text', { step: view.failedStep ? t(`steps.${view.failedStep}`) : 'none', since })}</p>
          {list}
          {loginLink('/login')}
        </>,
      );
    case 'rollbackFailed':
      return card(
        t('rollbackFailed.title'),
        t('rollbackFailed.foot'),
        <>
          <p className="text-body text-ink-2">{t('rollbackFailed.text', { since })}</p>
          {list}
          <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 p-3">
            <p className="text-body font-semibold">{t('rollbackFailed.contactTitle')}</p>
            {view.contact ? (
              <a href={`mailto:${view.contact}`} className="text-body text-brand-ink underline">
                {view.contact}
              </a>
            ) : null}
            <p className="text-meta text-muted-ink">
              {t.rich('rollbackFailed.runId', {
                runId: view.runId,
                code: (chunks) => <code className="rounded-sm bg-code px-1.5 font-mono text-hint">{chunks}</code>,
              })}
            </p>
          </div>
        </>,
      );
  }
}
