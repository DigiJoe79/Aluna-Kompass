'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FileDropzone } from '@/app/(shell)/dms/receive/file-dropzone';
import { FormField } from '@/components/forms/form-field';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { Button } from '@/components/ui/button';
import { useDateFormat } from '@/components/date-format-provider';
import { idleState } from '@/lib/actions';
import { withUnplacedFieldErrors } from '@/lib/feedback';
import { importForSetupAction } from './actions';

interface Manifest {
  environment: string;
  createdAt: string;
  counts: { users: number; documents: number; mediaAssets: number };
}

export function ImportForm() {
  const t = useTranslations('auth.setupImport');
  const fmt = useDateFormat();
  const [state, submit, pending] = useActionState(importForSetupAction, idleState);
  const [handle, setHandle] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setProblem(null);
    setManifest(null);
    setHandle(null);
    try {
      const res = await fetch('/setup/import/upload', { method: 'POST', body: file });
      if (res.status === 413) {
        setProblem(t('tooLarge'));
        return;
      }
      if (!res.ok) {
        setProblem(t('unreadable'));
        return;
      }
      const body = (await res.json()) as { handle: string; manifest: Manifest };
      setHandle(body.handle);
      setManifest(body.manifest);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-[1.55] text-ink-2">{t('intro')}</p>

      <FormField id="archive" label={t('file')} error={problem ?? undefined}>
        <FileDropzone
          id="archive"
          name="archive"
          accept=".gz,.tgz,application/gzip"
          hint={t('fileHint')}
          onFile={(file) => {
            if (file && !busy && !pending) void upload(file);
          }}
        />
      </FormField>
      {busy && <p className="text-[13px] text-muted-ink">{t('uploading')}</p>}

      {manifest && handle && (
        <form action={submit} className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <input type="hidden" name="handle" value={handle} />
          <h3 className="font-heading text-[16px]">{t('manifestTitle')}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-muted-ink">{t('environment')}</dt>
            <dd className="font-mono">{manifest.environment}</dd>
            <dt className="text-muted-ink">{t('createdAt')}</dt>
            <dd className="font-mono">{fmt.dateTime(manifest.createdAt)}</dd>
            <dt className="text-muted-ink">{t('users')}</dt>
            <dd className="font-mono">{manifest.counts.users}</dd>
            <dt className="text-muted-ink">{t('documents')}</dt>
            <dd className="font-mono">{manifest.counts.documents}</dd>
            <dt className="text-muted-ink">{t('mediaAssets')}</dt>
            <dd className="font-mono">{manifest.counts.mediaAssets}</dd>
          </dl>
          <p className="text-[13px] text-ink-2">{t('credentialWarning')}</p>
          <RefusalNotice state={withUnplacedFieldErrors(state, [])} />
          <Button type="submit" disabled={pending}>
            {pending ? t('running') : t('confirm')}
          </Button>
        </form>
      )}
    </div>
  );
}
