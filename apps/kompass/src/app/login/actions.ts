'use server';

import { login } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { requestMeta, setSessionCookie } from '@/lib/request-context';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations('auth.login');
  const meta = await requestMeta();
  const result = await login(getDeps(), { email: formData.get('email'), password: formData.get('password'), ...meta });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'unauthorized' && error.reason === 'locked') return { status: 'error', message: t('locked'), fieldErrors: {} };
    if (error.type === 'unauthorized' && error.reason === 'inactive') return { status: 'error', message: t('inactive'), fieldErrors: {} };
    const attempts = error.type === 'unauthorized' && error.attemptsLeft !== undefined ? t('attemptsLeft', { count: error.attemptsLeft }) : '';
    return { status: 'error', message: `${t('invalid')} ${attempts}`.trim(), fieldErrors: {} };
  }
  await setSessionCookie(result.value.sessionId, result.value.expiresAt);
  redirect(result.value.mustChangePassword ? '/password' : '/');
}
