'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FileDropzone } from '@/app/(shell)/dms/receive/file-dropzone';
import { Notice } from '@/components/notice';
import { StatusBadge } from '@/components/status-badge';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { useActionFeedback } from '@/components/forms/use-action-feedback';
import { SubmitButton } from '@/components/forms/submit-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { importBackupAction, inspectBackupAction } from './actions';
import { useDateFormat } from '@/components/date-format-provider';

type Manifest = { createdAt: string; environment: string; appVersion: string; counts: { users: number; auditEntries: number; documents: number } };

export function ImportCard({ environmentName }: { environmentName: string }) {
  const t = useTranslations('backup.import');
  const c = useTranslations('common');
  const fmt = useDateFormat();
  const [file, setFile] = useState<File | null>(null);
  const [inspect, inspectAction] = useActionState(inspectBackupAction, idleState);
  const [pending, start] = useTransition();
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const feedback = useActionFeedback();
  const manifest = inspect.status === 'success' ? (inspect.data as Manifest) : null;
  useEffect(() => { if (manifest) setOpen(true); }, [manifest]);
  const error = inspect.status === 'error' ? inspect.message : null;
  const runImport = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set('archive', file);
    fd.set('confirmation', confirmation);
    await feedback.run(() => importBackupAction(idleState, fd), { retry: () => start(runImport) });
  };
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold">{t('title')}</h3><StatusBadge tone="warning">{t('badge')}</StatusBadge></div>
      <div className="mt-3"><Notice level="warn">{t('warning')}</Notice></div>
      <form action={inspectAction} className="mt-4 flex flex-col gap-3">
        <FormGrid>
          <FormField id="archive" label={t('file')} error={error ?? undefined} size="m"><FileDropzone id="archive" name="archive" accept=".tar.gz,application/gzip" hint={t('fileHint')} required onFile={setFile} /></FormField>
        </FormGrid>
        <div className="flex justify-end gap-2 border-t border-line pt-3"><SubmitButton variant="secondary" className="bg-warning text-on-brand">{t('prepare')}</SubmitButton></div>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog" size="md" className="bg-surface shadow-md">
          <div className="flex flex-col gap-4">
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-warning" aria-hidden />{t('confirmTitle', { env: environmentName })}</DialogTitle>
            <DialogDescription tone="body">{manifest ? t('confirmText', { users: manifest.counts.users, audit: manifest.counts.auditEntries, documents: manifest.counts.documents, source: `${manifest.environment}, ${fmt.dateTime(manifest.createdAt)}` }) : ''}</DialogDescription>
            {pending ? (
              <ol className="flex flex-col gap-1 text-[13px]" aria-live="polite">
                <li className="font-semibold">{t('steps.writing')}</li>
                <li className="text-muted-ink-2">{t('steps.sessions')}</li>
              </ol>
            ) : (
              <FormField id="confirmation" label={t('confirmLabel')}>
                <div className="flex items-center gap-2"><Input id="confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="font-mono" autoComplete="off" /><code className="rounded-sm bg-code px-2 py-1 font-mono text-[12px]">{environmentName}</code></div>
              </FormField>
            )}
            <p className="text-[12px] text-muted-ink">{pending ? t('noAbort') : confirmation === environmentName ? '' : t('notConfirmed')}</p>
            <FormActionBar
              placement="dialog"
              cancel={pending ? undefined : () => setOpen(false)}
              destructive
              pending={pending}
              saveDisabled={confirmation !== environmentName}
              saveLabel={t('confirm')}
              onSave={() => start(runImport)}
              state={feedback.state}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
