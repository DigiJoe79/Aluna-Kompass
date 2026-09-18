'use server';

import { createRole, setRolePermissions, updateRole } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createRole(deps, ctx, { name: formData.get('name'), description: formData.get('description') ?? '' });
  revalidatePath('/admin/roles');
  return toActionState(result, t, t('roles.toast.created'));
}

export async function saveRoleAction(input: { id: string; name: string; description: string; permissionKeys: string[] }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const meta = await updateRole(deps, ctx, { id: input.id, name: input.name, description: input.description });
  if (!meta.ok) return toActionState(meta, t);
  const perms = await setRolePermissions(deps, ctx, { roleId: input.id, permissionKeys: input.permissionKeys });
  revalidatePath('/admin/roles');
  return toActionState(perms, t, t('roles.toast.saved'));
}
