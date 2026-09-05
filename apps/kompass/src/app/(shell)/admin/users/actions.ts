'use server';

import { assignRole, createUser, removeRole, resetStartPassword, setUserActive, updateUser } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createUser(deps, ctx, {
    name: formData.get('name'),
    email: formData.get('email'),
    roleIds: formData.getAll('roleIds').map(String),
  });
  revalidatePath('/admin/users');
  return toActionState(result, t);
}

export async function setUserActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setUserActive(deps, ctx, { id, isActive });
  revalidatePath('/admin/users');
  return toActionState(result, t, t(isActive ? 'users.toast.activated' : 'users.toast.deactivated'));
}

export async function resetStartPasswordAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await resetStartPassword(deps, ctx, { id });
  revalidatePath('/admin/users');
  return toActionState(result, t);
}

export async function updateUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateUser(deps, ctx, { id: formData.get('id'), name: formData.get('name'), email: formData.get('email') });
  revalidatePath('/admin/users');
  return toActionState(result, t, t('users.toast.saved'));
}

/** Nur Differenzen schreiben: assignRole für neue, removeRole für entfernte Rollen — kein Protokoll-Rauschen. */
export async function setUserRolesAction(userId: string, roleIds: string[], previousRoleIds: string[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const add = roleIds.filter((id) => !previousRoleIds.includes(id));
  const remove = previousRoleIds.filter((id) => !roleIds.includes(id));
  for (const roleId of add) {
    const r = await assignRole(deps, ctx, { userId, roleId });
    if (!r.ok) { revalidatePath('/admin/users'); return toActionState(r, t); }
  }
  for (const roleId of remove) {
    const r = await removeRole(deps, ctx, { userId, roleId });
    if (!r.ok) { revalidatePath('/admin/users'); return toActionState(r, t); }
  }
  revalidatePath('/admin/users');
  return { status: 'success', message: t('users.toast.rolesSaved') };
}
