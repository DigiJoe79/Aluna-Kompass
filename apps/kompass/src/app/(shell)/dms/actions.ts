'use server';

import {
  createDraft,
  deleteDraft,
  fileDocument,
  receiveDocument,
  suggestClassification,
  updateDraft,
  voidDocument,
} from '@kompass/module-dms';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  const typeKey = String(formData.get('typeKey') ?? 'letter');
  const folder = orNull(formData.get('folder'));
  const documentDate = orNull(formData.get('documentDate')) ?? undefined;
  const recipientId = orNull(formData.get('recipientId'));

  const links = recipientId
    ? [{ entityType: 'contact', entityId: recipientId, role: 'recipient' as const }]
    : [];

  const result = await createDraft(deps, ctx, {
    subject,
    body,
    typeKey,
    folder,
    documentDate,
    links,
  });

  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath('/dms');
  redirect(`/dms/${result.value.id}`);
}

export async function updateDraftAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  const folder = orNull(formData.get('folder'));
  const documentDate = orNull(formData.get('documentDate')) ?? undefined;

  const result = await updateDraft(deps, ctx, {
    id,
    subject: subject || undefined,
    body,
    folder,
    documentDate,
  });

  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.draftUpdated'));
}

export async function fileDocumentAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await fileDocument(deps, ctx, { id });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.filed'));
}

export async function voidDocumentAction(id: string, reason: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await voidDocument(deps, ctx, { id, reason });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.voided'));
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await deleteDraft(deps, ctx, { id });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath('/dms');
  redirect('/dms');
}

export async function suggestClassificationAction(
  filename: string,
  senderId?: string,
): Promise<{ typeKey: string | null; folder: string | null; documentDate: string | null } | null> {
  const { deps, ctx } = await requireSession();
  const res = await suggestClassification(deps, ctx, {
    filename,
    senderEntityType: senderId ? 'contact' : undefined,
    senderEntityId: senderId || undefined,
  });
  if (res.ok) return res.value;
  return null;
}

export async function receiveDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { status: 'error', message: t('dms.errors.noFile'), fieldErrors: { file: t('dms.errors.noFile') } };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = file.name;
  const typeKey = String(formData.get('typeKey') ?? 'authority');
  const subject = String(formData.get('subject') ?? '').trim();
  const documentDate = String(formData.get('documentDate') ?? '').trim();
  const folder = orNull(formData.get('folder'));
  const senderId = orNull(formData.get('senderId'));

  const links = senderId
    ? [{ entityType: 'contact', entityId: senderId, role: 'sender' as const }]
    : [];

  const result = await receiveDocument(deps, ctx, {
    filename,
    bytes,
    typeKey,
    subject,
    documentDate,
    folder,
    links,
  });

  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath('/dms');
  redirect(`/dms/${result.value.id}`);
}
