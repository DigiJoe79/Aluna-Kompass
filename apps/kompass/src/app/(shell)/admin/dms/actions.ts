'use server';

import {
  createDocumentFolder,
  createDocumentRule,
  createDocumentType,
  deleteDocumentFolder,
  deleteDocumentRule,
  updateDocumentRule,
  updateDocumentType,
} from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

export async function createDocumentTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const key = String(formData.get('key') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const prefix = String(formData.get('prefix') ?? '').trim().toUpperCase();
  const defaultDirection = String(formData.get('defaultDirection') ?? 'incoming') as 'incoming' | 'outgoing';
  const retentionClass = String(formData.get('retentionClass') ?? 'statutory10Y') as any;
  const defaultFolder = orNull(formData.get('defaultFolder'));
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  const result = await createDocumentType(deps, ctx, {
    key,
    label,
    prefix,
    defaultDirection,
    retentionClass,
    defaultFolder,
    sortOrder,
  });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.typeCreated'));
}

export async function updateDocumentTypeAction(key: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const label = String(formData.get('label') ?? '').trim();
  const defaultDirection = String(formData.get('defaultDirection') ?? 'incoming') as 'incoming' | 'outgoing';
  const retentionClass = String(formData.get('retentionClass') ?? 'statutory10Y') as any;
  const defaultFolder = orNull(formData.get('defaultFolder'));
  const isActive = formData.get('isActive') === 'on' || formData.get('isActive') === 'true';
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  const result = await updateDocumentType(deps, ctx, {
    key,
    label,
    defaultDirection,
    retentionClass,
    defaultFolder,
    isActive,
    sortOrder,
  });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.typeUpdated'));
}

export async function createDocumentFolderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const path = String(formData.get('path') ?? '').trim();
  const result = await createDocumentFolder(deps, ctx, { path });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.folderCreated'));
}

export async function deleteDocumentFolderAction(path: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await deleteDocumentFolder(deps, ctx, { path });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.folderDeleted'));
}

export async function createDocumentRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const matchField = String(formData.get('matchField') ?? 'filename') as 'filename' | 'senderName';
  const matchContains = String(formData.get('matchContains') ?? '').trim();
  const thenTypeKey = orNull(formData.get('thenTypeKey'));
  const thenFolder = orNull(formData.get('thenFolder'));
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  const result = await createDocumentRule(deps, ctx, {
    matchField,
    matchContains,
    thenTypeKey,
    thenFolder,
    sortOrder,
  });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.ruleCreated'));
}

export async function updateDocumentRuleAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const matchField = String(formData.get('matchField') ?? 'filename') as 'filename' | 'senderName';
  const matchContains = String(formData.get('matchContains') ?? '').trim();
  const thenTypeKey = orNull(formData.get('thenTypeKey'));
  const thenFolder = orNull(formData.get('thenFolder'));
  const isActive = formData.get('isActive') === 'on' || formData.get('isActive') === 'true';
  const sortOrder = Number(formData.get('sortOrder') ?? 0);

  const result = await updateDocumentRule(deps, ctx, {
    id,
    matchField,
    matchContains,
    thenTypeKey,
    thenFolder,
    isActive,
    sortOrder,
  });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.ruleUpdated'));
}

export async function deleteDocumentRuleAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await deleteDocumentRule(deps, ctx, { id });

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.ruleDeleted'));
}
