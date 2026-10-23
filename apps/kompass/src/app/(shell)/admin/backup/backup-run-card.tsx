'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EMPTY } from '@/components/empty-value';
import { ConfirmDialog } from '@/components/forms/confirm-dialog';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { RunSteps, type RunStep } from '@/components/run-steps';
import { SectionHeading } from '@/components/section';
import { Button } from '@/components/ui/button';
import type { BackupRecordView, BackupRunView } from '@/lib/backup-job-view';
import { formatSize } from '@/lib/format-size';
import { cancelBackupJobAction, startBackupAction, verifyBackupAction } from './actions';
import { useBackupJob } from './backup-page-provider';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Minuten:Sekunden wie `clock()` der RunCard der Webseite. */
const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** Schritte mit Bytes zählen in Größen („312 MB von 641 MB“): Der Lauf meldet Bytes, nicht Dateien (Planer). */
const COUNTED = new Set(['files', 'verify', 'safeguard', 'replace']);

/**
 * Die Schritte eines Backup-Laufs für `RunSteps`. `t` ist der Namensraum `backup`; die Schritte des Einspielens heißen
 * wie auf der Wartungsseite (`backup.maintenance.steps.*`).
 */
export function backupRunSteps(run: Pick<BackupRunView, 'kind' | 'steps'>, t: Translate, size: (n: number) => string): RunStep[] {
  return run.steps.map((step) => {
    const known = step.total !== undefined && step.total > 0 && step.done !== undefined;
    return {
      key: step.key,
      label: run.kind === 'restore' ? t(`maintenance.steps.${step.key}`) : t(`steps.${run.kind}.${step.key}`),
      state: step.state,
      counter: known && step.state === 'running' && COUNTED.has(step.key) ? t('run.counter', { done: size(step.done!), total: size(step.total!) }) : null,
      progress: known && step.state === 'running' ? { done: step.done!, total: step.total! } : null,
    };
  });
}

/**
 * Das Backup, das gerade läuft (Board 1b) — gleich wer es gestartet hat. Rahmen und Kopf wie die RunCard der Webseite:
 * Name des Laufs mit verstrichener Zeit, Herkunft, Abbrechen mit Rückfrage, darunter die Schritte und die Dauer des
 * letzten Backups.
 */
export function BackupRunCard({ lastDurationMs }: { lastDurationMs: number | null }) {
  const t = useTranslations('backup');
  const fmt = useDateFormat();
  const lockedId = useId();
  const headingId = useId();
  const { running, refresh } = useBackupJob();
  const [confirm, setConfirm] = useState(false);
  if (!running) return null;
  const time = fmt.time(running.startedAt);
  const locked = !running.cancellable;
  const origin =
    running.source === 'system'
      ? t('run.bySystem', { time })
      : running.source === 'mcp'
        ? t('run.byAgent', { name: running.userName ?? EMPTY, time })
        : t('run.byPerson', { name: running.userName ?? EMPTY, time });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <SectionHeading id={headingId}>
            {t(`jobKinds.${running.kind}`)} <span className="text-meta font-normal text-muted-ink">{t('run.elapsed', { duration: clock(running.elapsedMs) })}</span>
          </SectionHeading>
          <p className="text-hint text-muted-ink">{origin}</p>
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
            <p id={lockedId} className="max-w-xs text-right text-hint text-muted-ink">
              {t('run.cancelLocked')}
            </p>
          ) : null}
        </div>
      </div>
      <RunSteps steps={backupRunSteps(running, t as Translate, formatSize)} />
      {lastDurationMs !== null && running.kind === 'create' ? <p className="text-hint text-muted-ink">{t('run.lastDuration', { duration: clock(lastDurationMs) })}</p> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('run.cancelConfirmTitle')}
        description={t('run.cancelConfirmText')}
        confirmLabel={t('run.cancelConfirm')}
        destructive
        action={async () => {
          const state = await cancelBackupJobAction(running.runId);
          refresh();
          return state;
        }}
      />
    </section>
  );
}

/** Der jüngere der Läufe Erstellen und Prüfen, wenn er nicht gelang, von einer Person stammt und jünger ist als das neueste Backup. */
export function failedRunToShow(last: { create: BackupRecordView | null; verify: BackupRecordView | null }, newestCreatedAt: string | null): BackupRecordView | null {
  const candidates = [last.create, last.verify].filter((r): r is BackupRecordView => r !== null);
  const latest = candidates.sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1))[0] ?? null;
  if (!latest || latest.status === 'success' || latest.userId === null) return null;
  if (newestCreatedAt !== null && latest.finishedAt <= newestCreatedAt) return null;
  return latest;
}

/**
 * Ein Lauf von Hand, der nicht zu Ende kam (wie `LastResult` der Webseite): Status, Grund, letzter Schritt und
 * „Erneut starten“. Nächtliche Fehler zeigt die Warnung über der Liste.
 */
export function BackupLastResult({ newestCreatedAt }: { newestCreatedAt: string | null }) {
  const t = useTranslations('backup');
  const { running, last, track } = useBackupJob();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const record = running ? null : failedRunToShow(last, newestCreatedAt);
  if (!record) return null;
  const reason =
    record.status === 'interrupted' ? t('reasons.interrupted') : record.reason ? t(`reasons.${record.reason}`) : (record.error?.message ?? '');
  const stepLabel = record.lastStep ? (record.kind === 'verify' ? t(`steps.verify.${record.lastStep}`) : t(`steps.create.${record.lastStep}`)) : null;
  const restart = async () => {
    setPending(true);
    const action = () => (record.kind === 'verify' && record.name ? verifyBackupAction(record.name) : startBackupAction());
    const state = await feedback.run(action, { retry: () => void restart() });
    setPending(false);
    if (state.status === 'success') track((state.data as { runId: string }).runId);
  };
  return (
    <section aria-label={t(`run.status.${record.status}`)} className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 text-meta">
      <p className="flex items-start gap-2 font-semibold text-error">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t(`run.status.${record.status}`)}
      </p>
      {reason ? <p className="text-ink-2">{reason}</p> : null}
      {stepLabel ? <p className="text-muted-ink">{t('run.lastStep', { step: stepLabel })}</p> : null}
      <RefusalNotice state={feedback.state} />
      <div>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void restart()}>
          {t('run.restart')}
        </Button>
      </div>
    </section>
  );
}
