'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { importBackupAction, inspectBackupAction } from './actions';

type Manifest = { createdAt: string; environment: string; appVersion: string; counts: { users: number; auditEntries: number; documents: number } };

export function ImportCard({ environmentName }: { environmentName: string }) {
  const t = useTranslations('backup.import');
  const c = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [inspect, inspectAction] = useActionState(inspectBackupAction, idleState);
  const [pending, start] = useTransition();
  const [confirmation, setConfirmation] = useState('');
  const [open, setOpen] = useState(false);
  const manifest = inspect.status === 'success' ? (inspect.data as Manifest) : null;
  useEffect(() => { if (manifest) setOpen(true); }, [manifest]);
  const error = inspect.status === 'error' ? inspect.message : null;
  const runImport = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.set('archive', file);
    fd.set('confirmation', confirmation);
    const state = await importBackupAction(idleState, fd);
    if (state.status === 'error') toast.error(state.message);
  };
  return (
    <section className="rounded-lg border border-warning bg-surface p-5">
      <div className="flex items-center gap-2"><h3 className="font-heading text-[18px]">{t('title')}</h3><span className="rounded-sm bg-warning-bg px-2 py-0.5 text-[12px] font-semibold text-warning">{t('badge')}</span></div>
      <p className="mt-3 flex gap-2 rounded-md border border-warning bg-warning-bg p-3 text-[13px] text-ink-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span>{t('warning')}</span></p>
      <form action={inspectAction} className="mt-4 flex flex-col gap-3">
        <FormField id="archive" label={t('file')} error={error ?? undefined}><input id="archive" name="archive" type="file" accept=".tar.gz,application/gzip" required className="text-[13px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></FormField>
        <div className="flex justify-end gap-2 border-t border-warning pt-3"><SubmitButton variant="secondary" className="bg-warning text-on-brand">{t('prepare')}</SubmitButton></div>
      </form>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog" className="w-[520px] bg-surface shadow-md">
          <div className="flex flex-col gap-4">
            <DialogTitle className="flex items-center gap-2 font-heading text-[19px]"><AlertTriangle className="size-5 text-warning" aria-hidden />{t('confirmTitle', { env: environmentName })}</DialogTitle>
            <DialogDescription className="text-[14px] text-ink-2">{manifest ? t('confirmText', { users: manifest.counts.users, audit: manifest.counts.auditEntries, documents: manifest.counts.documents, source: `${manifest.environment}, ${new Date(manifest.createdAt).toLocaleString('de-DE')}` }) : ''}</DialogDescription>
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
            <DialogFooter>
              {pending ? null : <Button variant="ghost" onClick={() => setOpen(false)}>{c('cancel')}</Button>}
              <Button disabled={confirmation !== environmentName || pending} className="bg-warning text-on-brand" onClick={() => start(runImport)}>{t('confirm')}</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
