'use client';

import type { DownloadRecord } from '@kompass/module-website';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { LocalizedField } from '@/components/forms/localized-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { setDownloadAction } from './actions';

export function DownloadRow({ download, locales }: { download: DownloadRecord; locales: string[] }) {
  const t = useTranslations('website.downloads');
  const c = useTranslations('website.common');
  const [state, action] = useActionState(setDownloadAction, idleState);
  useEffect(() => { if (state.status === 'success') toast.success(state.message ?? ''); else if (state.status === 'error') toast.error(state.message); }, [state]);
  return (
    <tr aria-label={t(`keys.${download.key}`)} className="border-b border-line-2 align-top">
      <td className="px-4 py-3"><div className="font-semibold">{t(`keys.${download.key}`)}</div><div className="font-mono text-[11px] text-muted-ink">{download.key}</div></td>
      <td className="px-4 py-3" colSpan={2}>
        <form action={action} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input type="hidden" name="key" value={download.key} />
          <input type="hidden" name="assetId" value={download.assetId ?? ''} />
          <LocalizedField name="title" label={t('form.title')} value={download.title} required locales={locales} />
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-semibold text-ink-2">{t('form.file')}<input type="file" name="file" accept="application/pdf" aria-label={`${t('form.file')} PDF`} className="mt-1 block text-[12px]" /></label>
            {download.assetId ? <a href={`/media/${download.assetId}`} target="_blank" rel="noopener" className="text-[13px] text-link underline">{t('open')}</a> : <span className="text-[12px] text-muted-ink">{t('none')}</span>}
            <SubmitButton variant="secondary">{c('save')}</SubmitButton>
          </div>
        </form>
      </td>
    </tr>
  );
}
