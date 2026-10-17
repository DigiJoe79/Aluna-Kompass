'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
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
  // React 19 setzt das Formular nach jedem Durchlauf zurück; die E-Mail bleibt als Vorgabe stehen, nur das
  // Passwort verschwindet (01 A2). Die Anmeldung bleibt bewusst ein `<form action>` (AGENTS.md, ActionForm).
  const [email, setEmail] = useState('');
  const submit = (formData: FormData) => {
    setEmail(String(formData.get('email') ?? ''));
    return action(formData);
  };
  // Der Kasten erscheint erst nach dem Import und hat keine Rolle; die Ansage macht der Toast (Designer
  // 2026-10-08, MUSTER § A). Die feste Kennung hält ihn einmalig, auch wenn der Effekt doppelt läuft.
  useEffect(() => {
    if (imported) toast.success(t('importedTitle'), { id: 'backup-imported' });
  }, [imported, t]);
  return (
    <form action={submit} className="flex flex-col gap-4">
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
          {/* Kein `aria-invalid`: Die Meldung lässt offen, welches Feld falsch ist; Rot an zwei Feldern läse sich wie zwei Fehler (01 C30). */}
          <Input id="email" name="email" type="email" required autoComplete="email" defaultValue={email} />
        </FormField>
        <FormField id="password" label={t('password')}>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </FormField>
      </FormGrid>
      <SubmitButton className="h-10 w-full">{t('submit')}</SubmitButton>
    </form>
  );
}
