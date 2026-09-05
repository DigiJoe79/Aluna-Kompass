'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { strengthSegments } from '@/lib/password-strength';
import { changePasswordAction } from './actions';

export function ProfilePasswordForm() {
  const t = useTranslations('profile.password');
  const [state, action] = useActionState(changePasswordAction, idleState);
  const [value, setValue] = useState('');
  const errors = state.status === 'error' ? state.fieldErrors : {};
  useEffect(() => {
    if (state.status === 'success' && state.message) toast.success(state.message);
  }, [state]);
  const filled = strengthSegments(value);
  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="font-heading text-[17px]">{t('title')}</h3>
      <FormField id="currentPassword" label={t('current')} error={errors.currentPassword}>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </FormField>
      <FormField id="newPassword" label={t('new')} error={errors.newPassword} hint={t('strength', { count: value.length })}>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-1 flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <span
              key={n}
              className={`h-1 flex-1 rounded-full ${n <= filled ? 'bg-success' : 'bg-line-strong'}`}
            />
          ))}
        </div>
      </FormField>
      <FormField id="repeat" label={t('repeat')} error={errors.repeat}>
        <Input id="repeat" name="repeat" type="password" required autoComplete="new-password" />
      </FormField>
      <SubmitButton className="w-fit">{t('submit')}</SubmitButton>
      <p className="text-[12px] text-muted-ink">{t('footnote')}</p>
    </form>
  );
}
