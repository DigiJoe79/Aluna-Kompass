'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RunSteps, type RunStep } from '@/components/run-steps';
import { SectionHeading } from '@/components/section';
import { Button } from '@/components/ui/button';
import type { AuditPackageView } from '@/lib/finance/audit-package-view';
import { pollTextStatus } from '@/lib/poll-text-status';
import { useFileDownload } from '@/lib/use-file-download';
import { cancelPackageRunAction, startPackageRunAction } from './actions';

const STEPS = ['reports', 'folder', 'archive'] as const;
const FILES = ['reports', 'folder', 'archive'] as const;

/** Die Schritte des Laufs für `RunSteps`; ein übersprungener Schritt nennt seinen Grund. */
export function packageRunSteps(view: AuditPackageView, t: (key: string) => string): RunStep[] {
  return STEPS.map((key) => {
    const step = view.steps.find((s) => s.key === key);
    const skipped = view.skipped[key];
    const failed = view.state === 'failed' && step?.state === 'running';
    return {
      key,
      label: t(`steps.${key}`),
      state: failed ? 'failed' : skipped ? 'skipped' : (step?.state ?? 'pending'),
      progress: step?.state === 'running' && step.total ? { done: step.done ?? 0, total: step.total } : null,
      note: skipped ? t(`skipped.${skipped}`) : failed ? view.error?.message : undefined,
    };
  });
}

/**
 * Prüfpaket als Lauf (Board 4e, Spec § D1 „Prüfstand“): `RunSteps` über die Status-Route, „Prüfpaket erzeugen“ bzw.
 * „Abbrechen“, danach die Dateien zum Herunterladen. Der Stand kommt über einen Route Handler, nicht über eine Server
 * Action — Next führt Actions einer Seite nacheinander aus.
 */
export function PackageRunCard({ yearId, initial, variant = 'card' }: { yearId: string; initial: AuditPackageView; /** `step`: im Schritt 9 des Jahresabschlusses ohne Karte, Titel und Satz, „Prüfpaket erzeugen“ primär (14d A). */ variant?: 'card' | 'step' }) {
  const t = useTranslations('finance.audit.package.run');
  const tAudit = useTranslations('finance.audit');
  const fmt = useDateFormat();
  const [view, setView] = useState(initial);
  const feedback = useActionFeedback();
  const file = useFileDownload({ forbidden: tAudit('downloadRefused.forbidden'), notFound: tAudit('downloadRefused.notFound'), failed: tAudit('downloadRefused.failed') });
  const router = useRouter();
  // Abgefragt wird über `pollTextStatus` (App-B4): Ein fehlgeschlagener Abruf beendet die Kette nicht, nach dem Verlassen
  // der Seite plant sie nichts mehr. Jeder Anstoß (Erzeugen, Abbrechen) beginnt eine neue Kette.
  const [watch, setWatch] = useState(initial.state === 'running' ? 1 : 0);
  const poll = () => setWatch((n) => n + 1);

  useEffect(() => {
    if (watch === 0) return;
    return pollTextStatus({
      url: `/finance/audit/year/${encodeURIComponent(yearId)}/package/status`,
      isPending: (body) => body.state === 'running',
      onTick: (body) => setView(body as unknown as AuditPackageView),
      // Nach dem Ende des Laufs stehen neue Dateien im Abschnitt „Prüfer“ und im Stand der Seite (Plan D1d Task 2).
      onDone: () => router.refresh(),
      onUnauthorized: () => router.refresh(),
    });
  }, [watch, yearId, router]);

  const start = async () => {
    const result = await feedback.run(() => startPackageRunAction(yearId), { retry: () => void start() });
    if (result.status === 'success') poll();
  };
  const cancel = async () => {
    const result = await feedback.run(() => cancelPackageRunAction(yearId), { retry: () => void cancel() });
    if (result.status === 'success') poll();
  };

  const running = view.state === 'running';
  // Ein Lauf, der alles erzeugt hat, zeigt keine Schrittliste mehr: Haken und „erledigt“ sagten dasselbe wie der Satz
  // „Erzeugt am …“ und die Dateien darunter (Designer Runde 8, 346). Übersprungenes behält die Liste mit Grund.
  const showSteps = view.state !== 'idle' && !(view.state === 'success' && Object.keys(view.skipped).length === 0);
  // Erzeugen und Abbrechen nur mit dem Recht vom Server (Befund 11 a); Prüfer sehen Stand und Dateien.
  const action = !view.canStart ? null : running ? (
    <Button type="button" variant="outline" size="sm" disabled={!view.cancellable} onClick={() => void cancel()}>
      {t('cancel')}
    </Button>
  ) : (
    <Button type="button" variant={variant === 'step' ? 'default' : 'outline'} size={variant === 'step' ? 'default' : 'sm'} disabled={feedback.pending} aria-busy={feedback.pending || undefined} onClick={() => void start()} data-testid="package-run-start">
      {view.state === 'idle' ? t('start') : t('restart')}
    </Button>
  );
  if (variant === 'step') {
    // Im Schritt (14d A): kein Rahmen — die Karte mit Rahmen bleibt der Kassenprüfung; der Kopf nennt den Knopf
    // „Als Nächstes“, also ist er primär. Während des Laufs die Zeilen von `RunSteps`.
    return (
      <div className="flex flex-col gap-2.5" data-testid="package-run">
        {action ? <div>{action}</div> : null}
        <RefusalNotice action state={feedback.state} />
        {showSteps ? <RunSteps steps={packageRunSteps(view, t)} label={t('title')} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4" data-testid="package-run">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <SectionHeading>{t('title')}</SectionHeading>
          <p className="text-meta text-muted-ink">{view.state === 'idle' ? t('intro') : running ? t('intro') : view.state === 'outdated' ? t('state.outdated') : t(`state.${view.state}`, { date: fmt.dateTime(view.finishedAt) })}</p>
        </div>
        {action}
      </div>
      <RefusalNotice action state={feedback.state} />
      {showSteps ? <RunSteps steps={packageRunSteps(view, t)} label={t('title')} /> : null}
      {!running && view.files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {FILES.filter((f) => view.files.includes(f)).map((f) => (
            <Button key={f} type="button" variant="outline" size="sm" disabled={file.busy} onClick={() => void file.download(`/finance/audit/year/${encodeURIComponent(yearId)}/package/${f}`, `${f}.${f === 'archive' ? 'zip' : 'pdf'}`)}>
              {t(`files.${f}`)}
            </Button>
          ))}
        </div>
      ) : null}
      <RefusalNotice state={file.refusal} />
    </div>
  );
}
