'use server';

import { completeSetup } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { requestMeta, setSessionCookie } from '@/lib/request-context';

export async function completeSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const meta = await requestMeta();
  const result = await completeSetup(getDeps(), {
    organizationName: formData.get('organizationName'),
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    ...meta,
  });
  if (!result.ok) return toActionState(result, t);
  await setSessionCookie(result.value.sessionId, result.value.expiresAt);
  redirect('/');
}
