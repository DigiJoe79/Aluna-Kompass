'use server';

import { setSetting } from '@kompass/core';
import {
  createDocumentFolder,
  createSnippet,
  deleteSnippet,
  updateSnippet,
  createDocumentRule,
  createDocumentType,
  deleteDocumentFolder,
  deleteDocumentRule,
  reindexAllDocuments,
  updateDocumentRule,
  updateDocumentType,
} from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { textWorker } from '@/lib/background';
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

export async function reindexAllDocumentsAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await reindexAllDocuments(deps, ctx);
  if (!result.ok) {
    return toActionState(result, t);
  }

  textWorker()?.wake();

  revalidatePath('/admin/dms');
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.admin.textPanel.queued', { count: result.value.queued }));
}

export async function updateOcrLanguagesAction(languages: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const probe = await deps.textExtraction.probe();
  if (!probe.ok) {
    return {
      status: 'error',
      message: t('dms.text.unavailableHint'),
      fieldErrors: {},
    };
  }

  const list = languages.split('+').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) {
    return {
      status: 'error',
      message: t('errors.fields.required'),
      fieldErrors: { languages: t('errors.fields.required') },
    };
  }

  for (const lang of list) {
    if (!probe.languages.includes(lang)) {
      const missing = t('dms.admin.textPanel.languageMissing', { lang });
      return { status: 'error', message: missing, fieldErrors: { languages: missing } };
    }
  }

  const result = await setSetting(deps, ctx, { key: 'dms.ocrLanguages', value: list.join('+') });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.languagesSaved'));
}

export async function createSnippetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createSnippet(deps, ctx, {
    name: String(formData.get('name') ?? '').trim(),
    subject: orNull(formData.get('subject')),
    body: String(formData.get('body') ?? ''),
    sortOrder: Number(formData.get('sortOrder') ?? 0),
  });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetCreated'));
}

export async function updateSnippetAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await updateSnippet(deps, ctx, {
    id,
    name: String(formData.get('name') ?? '').trim(),
    subject: orNull(formData.get('subject')),
    body: String(formData.get('body') ?? ''),
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    isActive: formData.get('isActive') === 'on' || formData.get('isActive') === 'true',
  });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetUpdated'));
}

export async function deleteSnippetAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteSnippet(deps, ctx, { id });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.snippetDeleted'));
}

/** Die ganze Liste wird gesetzt — sie ist eine Einstellung, kein Datensatz je Zeile. */
export async function saveDispatchChannelsAction(channels: { key: string; label: string }[]): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await setSetting(deps, ctx, { key: 'dms.dispatchChannels', value: channels });
  revalidatePath('/admin/dms');
  return toActionState(result, t, t('dms.admin.toast.channelsSaved'));
}
