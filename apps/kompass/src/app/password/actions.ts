'use server';

import { changeOwnPassword } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function setPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx, sessionId } = await requireSession({ allowPasswordChange: true });
  const newPassword = String(formData.get('newPassword') ?? '');
  if (newPassword !== String(formData.get('repeat') ?? '')) {
    return { status: 'error', message: t('errors.validation'), fieldErrors: { repeat: t('auth.password.mismatch') } };
  }
  const result = await changeOwnPassword(deps, ctx, sessionId, { currentPassword: formData.get('currentPassword'), newPassword });
  if (!result.ok) return toActionState(result, t);
  redirect('/');
}
