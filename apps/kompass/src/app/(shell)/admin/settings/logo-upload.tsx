'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { idleState } from '@/lib/actions';
import { uploadLogoAction } from './logo-actions';

export function LogoUpload({ currentAssetId }: { currentAssetId: string | null }) {
  const t = useTranslations('settings.logo');
  const [state, action] = useActionState(uploadLogoAction, idleState);
  useEffect(() => { if (state.status === 'success' && state.message) toast.success(state.message); }, [state]);
  const error = state.status === 'error' ? (state.fieldErrors.logo ?? state.fieldErrors.bytes ?? state.message) : undefined;
  return (
    <form action={action} className="flex flex-col gap-3 md:col-span-2">
      <div className="flex items-center gap-4 rounded-md border border-dashed border-line-strong bg-surface-2 p-3">
        {currentAssetId ? <img src={`/media/${currentAssetId}`} alt={t('current')} className="size-11 rounded-sm object-contain" /> : <div className="size-11 rounded-sm border border-dashed border-line-strong" aria-hidden />}
        <FormField id="logo" label={t('file')} hint={t('hint')} error={error} className="flex-1"><input id="logo" name="logo" type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="text-[13px]" /></FormField>
        <SubmitButton variant="secondary">{t('submit')}</SubmitButton>
      </div>
    </form>
  );
}