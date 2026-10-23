'use client';

import { AlertTriangle, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import type { HeadlineState } from '@/lib/backup-view';
import type { ActionState } from '@/lib/actions';
import { startBackupAction } from './actions';
import { useBackupDialog, useBackupJob } from './backup-page-provider';

/** Startet ein Backup von Hand und meldet den Lauf beim Poller an; die Ablehnung hält `state` für `RefusalNotice`. */
export function useStartBackup(): { start(): void; pending: boolean; state: ActionState } {
  const { track } = useBackupJob();
  const feedback = useActionFeedback();
  const [pending, setPending] = useState(false);
  const start = async () => {
    setPending(true);
    const state = await feedback.run(() => startBackupAction(), { retry: () => void start() });
    setPending(false);
    if (state.status === 'success') track((state.data as { runId: string }).runId);
  };
  return { start: () => void start(), pending, state: feedback.state };
}

/** Der Satz im Seitenkopf (Designer § 2): Haken bei gutem Stand, sonst Warnzeichen und der letzte geprüfte Stand. */
export function BackupHeadline({ headline, schedule }: { headline: HeadlineState; schedule: { enabled: boolean; time: string } }) {
  const t = useTranslations('backup');
  const fmt = useDateFormat();
  const last = headline.lastVerified;
  const sentence =
    headline.sentence === 'none' || !last
      ? t('headline.none')
      : headline.sentence === 'ok'
        ? t('headline.ok', { when: fmt.dateTime(last.createdAt), enabled: schedule.enabled ? 'on' : 'off', time: schedule.time })
        : t('headline.lastVerified', { when: fmt.dateTime(last.createdAt), kind: t(`list.kind.${last.kind}`, { version: last.appVersion ?? '' }) });
  return (
    <span className="flex items-start gap-2">
      {headline.tone === 'ok' ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
      <span>{sentence}</span>
    </span>
  );
}

/**
 * Der Kopf der Backup-Seite: Titel, Zustand als Satz (`description`), „Backup erstellen“ als Primärknopf und
 * „Datei hochladen …“ in `more` (am Telefon im ⋯). Während eines Laufs ruht der Knopf, der Grund steht darunter.
 */
export function BackupHeader({ headline, schedule, canImport }: { headline: HeadlineState; schedule: { enabled: boolean; time: string }; canImport: boolean }) {
  const t = useTranslations('backup');
  const { running } = useBackupJob();
  const { open } = useBackupDialog();
  const { start, pending, state } = useStartBackup();
  return (
    <PageHeader
      title={t('title')}
      description={<BackupHeadline headline={headline} schedule={schedule} />}
      more={[{ key: 'upload', label: t('actions.upload'), onSelect: () => open({ kind: 'upload' }), hidden: !canImport, testId: 'backup-upload' }]}
      actions={
        <div className="relative flex flex-col items-end gap-1 max-sm:items-start">
          <RefusalNotice action state={state} />
          <Button disabled={running !== null || pending} aria-busy={pending || undefined} onClick={start} data-testid="backup-create">
            {t('actions.create')}
          </Button>
          {/* Ab `sm` steht „Datei hochladen …“ daneben, und der Kopf mittet seine Aktionen: Nähme der Grund Platz in der
              Spalte, rutschte der Nebenknopf um die halbe Zeile tiefer. Er hängt deshalb unter der Knopfzeile, rechts
              bündig wie im Board 1b. Kein Layout-Test für die Einzelstelle (gesehen in der Design-Durchsicht). */}
          {running ? <p className="text-hint whitespace-nowrap text-muted-ink sm:absolute sm:top-full sm:right-0 sm:mt-1">{t('run.blocked')}</p> : null}
        </div>
      }
    />
  );
}
