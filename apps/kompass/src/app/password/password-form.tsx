'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { strengthSegments } from '@/lib/password-strength';
import { setPasswordAction } from './actions';

export function PasswordForm() {
  const t = useTranslations('auth.password');
  const [state, action] = useActionState(setPasswordAction, idleState);
  const [value, setValue] = useState('');
  const errors = state.status === 'error' ? state.fieldErrors : {};
  const filled = strengthSegments(value);
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
      <FormField id="currentPassword" label={t('current')} error={errors.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </FormField>
      <FormField id="newPassword" label={t('new')} error={errors.newPassword} hint={t('strength', { count: value.length })}>
        <Input id="newPassword" name="newPassword" type="password" required minLength={12} autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="mt-1 flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= filled ? 'bg-success' : 'bg-line-strong'}`} />)}
        </div>
      </FormField>
      <FormField id="repeat" label={t('repeat')} error={errors.repeat}>
        <Input id="repeat" name="repeat" type="password" required autoComplete="new-password" />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
