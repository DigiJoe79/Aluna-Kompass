'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/forms/form-field';
import { FormActionBar } from '@/components/forms/form-action-bar';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { FormGrid } from '@/components/forms/form-grid';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { strengthSegments } from '@/lib/password-strength';
import { changePasswordAction } from './actions';
import { Section } from '@/components/section';

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
    // Speichern über `FormActionBar` (`run`, ein eigener Vorgang ohne Zähler) statt eines eigenen Knopfs im Inhalt (12 B7).
    // Bleibt ein `<form action>`: Nach dem Absenden sollen die Passwörter verschwinden (AGENTS.md, ActionForm).
    <FormCard as="form" action={action}>
      <FormCardBody>
      <Section title={t('title')}>
        <div className="flex flex-col gap-4">
          {/* Runde 3, 186: Sterne an den drei Pflichtfeldern, die Leiste setzt dazu „* Pflichtfeld“. */}
          <FormGrid>
            <FormField id="currentPassword" label={t('current')} required error={errors.currentPassword}>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
              />
            </FormField>
            <FormField id="newPassword" label={t('new')} required error={errors.newPassword} hint={t('strength', { count: value.length })}>
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
            <FormField id="repeat" label={t('repeat')} required error={errors.repeat}>
              <Input id="repeat" name="repeat" type="password" required autoComplete="new-password" />
            </FormField>
          </FormGrid>
          <p className="text-hint text-muted-ink">{t('footnote')}</p>
        </div>
      </Section>
      </FormCardBody>
      <FormActionBar mode="run" saveLabel={t('submit')} state={state} />
    </FormCard>
  );
}
