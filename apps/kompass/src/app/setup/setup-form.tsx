'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/forms/form-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { completeSetupAction } from './actions';
import { Select } from '@/components/ui/select';

const PRESET_LOCALES = [
  { code: 'de', label: 'Deutsch (de)' },
  { code: 'en', label: 'English (en)' },
  { code: 'fr', label: 'Français (fr)' },
  { code: 'nl', label: 'Nederlands (nl)' },
  { code: 'pl', label: 'Polski (pl)' },
];

export function SetupForm() {
  const t = useTranslations('auth.setup');
  const [state, action] = useActionState(completeSetupAction, idleState);
  const [selectedLocale, setSelectedLocale] = useState('de');
  const [isCustom, setIsCustom] = useState(false);
  const errors = state.status === 'error' ? state.fieldErrors : {};
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.status === 'error' && Object.keys(errors).length === 0 ? <p role="alert" className="rounded-md border border-error bg-error-bg p-3 text-[13px] text-error">{state.message}</p> : null}
      <FormField id="organizationName" label={t('organizationName')} error={errors.organizationName}>
        <Input id="organizationName" name="organizationName" required autoComplete="organization" />
      </FormField>
      <FormField id="locale-select" label={t('locale')} error={errors.locale}>
        <Select
          id="locale-select"

          value={isCustom ? 'custom' : selectedLocale}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setIsCustom(true);
            } else {
              setIsCustom(false);
              setSelectedLocale(e.target.value);
            }
          }}
        >
          {PRESET_LOCALES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
          <option value="custom">{t('localeOther')}</option>
        </Select>
        {isCustom ? (
          <div className="mt-2">
            <Input
              id="locale"
              name="locale"
              placeholder="z. B. es"
              required
              pattern="[a-z]{2}(-[a-z]{2})?"
              className="font-mono"
            />
          </div>
        ) : (
          <input type="hidden" name="locale" value={selectedLocale} />
        )}
      </FormField>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="name" label={t('name')} error={errors.name}>
          <Input id="name" name="name" required autoComplete="name" />
        </FormField>
        <FormField id="email" label={t('email')} error={errors.email}>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </FormField>
      </div>
      <FormField id="password" label={t('password')} hint={t('passwordHint')} error={errors.password}>
        <Input id="password" name="password" type="password" required autoComplete="new-password" minLength={12} />
      </FormField>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
