'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { SubmitButton } from '@/components/forms/submit-button';
import { Notice } from '@/components/notice';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { loginAction } from './actions';

export function LoginForm({ imported }: { imported: boolean }) {
  const t = useTranslations('auth.login');
  const [state, action] = useActionState(loginAction, idleState);
  const invalid = state.status === 'error';
  // Der Kasten erscheint erst nach dem Import und hat keine Rolle; die Ansage macht der Toast (Designer
  // 2026-10-08, MUSTER § A). Die feste Kennung hält ihn einmalig, auch wenn der Effekt doppelt läuft.
  useEffect(() => {
    if (imported) toast.success(t('importedTitle'), { id: 'backup-imported' });
  }, [imported, t]);
  return (
    <form action={action} className="flex flex-col gap-4">
      {imported ? (
        <Notice level="hint" title={t('importedTitle')}>
          {t('importedText')}
        </Notice>
      ) : null}
      {invalid ? (
        <Notice level="refuse">{state.message}</Notice>
      ) : null}
      <FormGrid>
        <FormField id="email" label={t('email')}>
          <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={invalid || undefined} />
        </FormField>
        <FormField id="password" label={t('password')}>
          <Input id="password" name="password" type="password" required autoComplete="current-password" aria-invalid={invalid || undefined} />
        </FormField>
      </FormGrid>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
