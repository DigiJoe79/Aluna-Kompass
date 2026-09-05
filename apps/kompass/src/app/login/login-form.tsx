'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { loginAction } from './actions';

export function LoginForm({ imported }: { imported: boolean }) {
  const t = useTranslations('auth.login');
  const [state, action] = useActionState(loginAction, idleState);
  const invalid = state.status === 'error';
  return (
    <form action={action} className="flex flex-col gap-4">
      {imported ? (
        <p role="status" className="rounded-md border border-info bg-info-bg p-3 text-[13px] text-ink-2">
          <span className="font-semibold text-info">{t('importedTitle')}</span> {t('importedText')}
        </p>
      ) : null}
      {invalid ? (
        <p role="alert" className="flex gap-2 rounded-md border border-error bg-error-bg p-3 text-[13px] text-ink-2">
          <Info className="size-4 shrink-0 text-error" aria-hidden />
          <span>{state.message}</span>
        </p>
      ) : null}
      <FormField id="email" label={t('email')}>
        <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={invalid || undefined} />
      </FormField>
      <FormField id="password" label={t('password')}>
        <Input id="password" name="password" type="password" required autoComplete="current-password" aria-invalid={invalid || undefined} />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
