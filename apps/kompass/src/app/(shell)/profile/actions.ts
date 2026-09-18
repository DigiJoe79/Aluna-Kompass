'use server';

import { changeOwnPassword, createApiToken, revokeApiToken } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx, sessionId } = await requireSession();
  const newPassword = String(formData.get('newPassword') ?? '');
  if (newPassword !== String(formData.get('repeat') ?? '')) {
    return { status: 'error', message: t('errors.validation'), fieldErrors: { repeat: t('auth.password.mismatch') } };
  }
  const result = await changeOwnPassword(deps, ctx, sessionId, {
    currentPassword: String(formData.get('currentPassword') ?? ''),
    newPassword,
  });
  if (!result.ok && result.error.type === 'unauthorized') {
    return {
      status: 'error',
      message: t('profile.password.wrongCurrent'),
      fieldErrors: { currentPassword: t('profile.password.wrongCurrent') },
    };
  }
  return toActionState(result, t, t('profile.password.changed'));
}

export async function createTokenAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createApiToken(deps, ctx, { name: String(formData.get('name') ?? '') });
  revalidatePath('/profile');
  return toActionState(result, t);
}

export async function revokeTokenAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await revokeApiToken(deps, ctx, { id });
  revalidatePath('/profile');
  return toActionState(result, t, t('profile.tokens.revoked'));
}
