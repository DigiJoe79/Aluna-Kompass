'use client';

import type { RestorePreview } from '@kompass/core';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ConsequenceList } from '@/components/consequence-list';
import { useDateFormat } from '@/components/date-format-provider';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { Notice } from '@/components/notice';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ActionState } from '@/lib/actions';
import type { BackupRow } from '@/lib/backup-view';
import { formatSize } from '@/lib/format-size';
import { restorePreviewAction, startRestoreAction } from './actions';

/**
 * Einspielen (Designer 3a): Dialog `md` als `alertdialog`. Was verloren geht, nennt er mit Zahlen aus dem Protokoll
 * (`restorePreview`); bestätigt wird durch Eintippen des Umgebungsnamens, der Fokus steht beim Öffnen im Feld. Nur ein
 * gestarteter Lauf führt auf die Wartungsseite; eine Ablehnung (falsche Bestätigung, Agentensperre, besetzter Platz)
 * bleibt im Dialog.
 */
export function RestoreDialog({
  row,
  environmentName,
  appVersion,
  appMigrationCount,
  onClose,
  finalFocus,
}: {
  row: BackupRow;
  environmentName: string;
  appVersion: string;
  appMigrationCount: number;
  onClose(): void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useTranslations('backup');
  const fmt = useDateFormat();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [previewState, setPreviewState] = useState<ActionState>({ status: 'idle' });
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const feedback = useActionFeedback();

  useEffect(() => {
    let active = true;
    void restorePreviewAction(row.name).then((state) => {
      if (!active) return;
      if (state.status === 'success') setPreview(state.data as RestorePreview);
      else setPreviewState(state);
    });
    return () => {
      active = false;
    };
  }, [row.name]);

  // Das Feld erscheint mit der Vorschau; dann bekommt es den Fokus.
  useEffect(() => {
    if (preview) input.current?.focus();
  }, [preview]);

  const start = async () => {
    setPending(true);
    const state = await feedback.run(() => startRestoreAction({ name: row.name, confirmation }));
    if (state.status === 'success') {
      // Ab hier landet jede Anfrage auf der Wartungsseite, auch die eigene.
      window.location.assign('/maintenance');
      return;
    }
    setPending(false);
  };

  const counts = preview?.counts ?? row.counts;
  const documents = counts?.records['dms.documents'];
  const older = row.migrationCount !== null && row.migrationCount < appMigrationCount;
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent role="alertdialog" size="md" initialFocus={input} finalFocus={finalFocus}>
        <div className="flex flex-col gap-4">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
            {t('restore.title', { when: fmt.dateTime(row.createdAt), label: row.pinnedLabel ?? 'none' })}
          </DialogTitle>
          <DialogDescription tone="body">
            {t('restore.about', {
              kind: row.kind,
              size: formatSize(row.sizeBytes),
              version: row.appVersion ?? '',
              users: counts?.users ?? 0,
              documents: documents === undefined ? 'none' : documents,
              audit: counts?.auditEntries ?? 0,
            })}
          </DialogDescription>
          <RefusalNotice state={previewState} />
          {preview ? (
            <>
              {older ? <Notice level="hint">{t('restore.older', { version: row.kind === 'preUpdate' || !row.appVersion ? 'none' : row.appVersion, current: appVersion })}</Notice> : null}
              <ConsequenceList
                items={[
                  { label: t('restore.lost', { since: fmt.stamp(preview.createdAt), changes: preview.changesSince, persons: preview.personsSince }), count: preview.changesSince },
                  { label: t('restore.safeguard') },
                  { label: t('restore.lock', { minutes: Math.max(1, Math.ceil(preview.estimatedSeconds / 60)) }) },
                ]}
                stays={[t('restore.staysSite'), t('restore.staysMail')]}
              />
              <FormField id="backup-restore-confirmation" label={t('restore.confirmLabel')}>
                <div className="flex items-center gap-2">
                  <Input ref={input} id="backup-restore-confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="font-mono" autoComplete="off" />
                  <code className="rounded-sm bg-code px-2 py-1 font-mono text-hint">{environmentName}</code>
                </div>
              </FormField>
            </>
          ) : previewState.status === 'idle' ? (
            <div aria-hidden className="h-24 animate-pulse rounded-md bg-surface-2" />
          ) : null}
          <FormActionBar
            placement="dialog"
            mode="run"
            destructive
            cancel={pending ? undefined : onClose}
            onSave={() => void start()}
            pending={pending}
            saveDisabled={!preview || confirmation !== environmentName}
            saveLabel={t('restore.confirm')}
            state={feedback.state}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
