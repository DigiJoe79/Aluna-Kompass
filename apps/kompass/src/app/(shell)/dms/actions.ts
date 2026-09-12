'use server';

import {
  addNote,
  clearDispatch,
  createDocumentFollowUp,
  createDraft,
  createReplacementDraft,
  defaultTypeKey,
  deleteNote,
  recordDispatch,
  linkDocument,
  moveDocument,
  relateDocuments,
  unlinkDocument,
  unrelateDocuments,
  deleteDocument,
  deleteDraft,
  extractDocumentText,
  fileDocument,
  receiveDocument,
  previewNextNumber,
  suggestClassification,
  updateDraft,
  voidDocument,
  type Suggestion,
} from '@kompass/module-dms';
import { completeFollowUp, reopenFollowUp } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { textWorker } from '@/lib/background';
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
  const typeKey = orNull(formData.get('typeKey')) ?? defaultTypeKey(deps, 'outgoing');
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
  // In den Editor, nicht auf das fertige Dokument: Wer gerade geschrieben hat,
  // ist meist noch nicht fertig — und der erste Blick auf das gesetzte Blatt
  // findet die Tippfehler, die im Formular niemand sieht.
  redirect(`/dms/${result.value.id}/edit`);
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
    // Das Formular schickt das Feld immer mit; leer heißt „kein Empfänger“.
    recipientId: orNull(formData.get('recipientId')),
  });

  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  // Beim Schreiben mit Vorschau daneben führt kein Weg weg: Gespeichert wird,
  // damit das Blatt rechts neu entsteht.
  if (formData.get('stay')) return { status: 'success', data: { savedAt: deps.clock.now().toISOString() } };
  redirect(`/dms/${id}`);
}

export async function fileDocumentAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await fileDocument(deps, ctx, { id });
  if (!result.ok) {
    return toActionState(result, t);
  }

  // Nicht warten: Der Upload ist fertig, das Lesen darf dauern.
  textWorker()?.wake();

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.filed'));
}

export async function voidDocumentAction(id: string, reason: string, withReplacement = false): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await voidDocument(deps, ctx, { id, reason });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');

  // Der Ersatz ist ein zweiter Vorgang: Erst steht das Storno, dann entsteht
  // der neue Entwurf — scheitert er, bleibt das Storno bestehen und gesagt.
  if (withReplacement) {
    const replacement = await createReplacementDraft(deps, ctx, { voidedId: id });
    if (!replacement.ok) return toActionState(replacement, t);
    redirect(`/dms/${replacement.value.id}/edit`);
  }

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

/**
 * Die einzige Löschung, die ein festgeschriebenes Dokument kennt — sie steht
 * hinter der abgelaufenen Frist und einem Menschen, der sie bestätigt
 * (Prinzip 3, Entscheidung 10). Der Service prüft die Frist erneut.
 */
export async function deleteDocumentAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await deleteDocument(deps, ctx, { id });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath('/dms');
  revalidatePath('/admin/retention');
  redirect('/dms');
}

export async function suggestClassificationAction(
  filename: string,
  senderId?: string,
): Promise<Suggestion | null> {
  const { deps, ctx } = await requireSession();
  const res = await suggestClassification(deps, ctx, {
    filename,
    senderEntityType: senderId ? 'contact' : undefined,
    senderEntityId: senderId || undefined,
  });
  if (res.ok) return res.value;
  return null;
}

/**
 * Die Nummer, die das nächste Dokument dieser Art bekäme. Nur zum Ansehen —
 * gezogen wird sie beim Ablegen, und zwischen beidem kann jemand anders
 * schneller sein.
 */
export async function previewNumberAction(typeKey: string): Promise<string | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewNextNumber(deps, ctx, { typeKey });
  return result.ok ? result.value.number : null;
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
  const typeKey = orNull(formData.get('typeKey')) ?? defaultTypeKey(deps, 'incoming');
  const subject = String(formData.get('subject') ?? '').trim();
  const documentDate = String(formData.get('documentDate') ?? '').trim();
  const folder = orNull(formData.get('folder'));
  const senderId = orNull(formData.get('senderId'));

  const links = senderId
    ? [{ entityType: 'contact', entityId: senderId, role: 'sender' as const }]
    : [];

  // „Antwort auf“ entsteht in derselben Transaktion wie das Dokument — sonst
  // stünde die Post kurz ohne den Bezug da, der sie erklärt.
  const repliesToId = orNull(formData.get('repliesToId'));
  const relations = repliesToId ? [{ relatedDocumentId: repliesToId, kind: 'repliesTo' as const }] : [];

  const result = await receiveDocument(deps, ctx, {
    filename,
    bytes,
    typeKey,
    subject,
    documentDate,
    folder,
    links,
    relations,
  });

  if (!result.ok) {
    return toActionState(result, t);
  }

  // Nicht warten: Der Upload ist fertig, das Lesen darf dauern.
  textWorker()?.wake();

  revalidatePath('/dms');
  // Aus einer Warteschlange heraus führt kein Weg zum einzelnen Dokument: Die
  // nächste Datei wartet schon, und ein Sprung dorthin verlöre sie.
  if (formData.get('queued')) return { status: 'success' };
  redirect(`/dms/${result.value.id}`);
}

export async function rereadDocumentAction(documentId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();

  const result = await extractDocumentText(deps, ctx, { documentId });
  if (!result.ok) {
    return toActionState(result, t);
  }

  revalidatePath(`/dms/${documentId}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.text.rereadQueued'));
}

export async function moveDocumentAction(id: string, folder: string | null): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await moveDocument(deps, ctx, { id, folder });
  if (!result.ok) return toActionState(result, t);
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.moved'));
}

export async function linkDocumentAction(
  id: string,
  entityType: string,
  entityId: string,
  role: 'sender' | 'recipient' | 'about',
): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await linkDocument(deps, ctx, { documentId: id, entityType, entityId, role });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.linked'));
}

export async function unlinkDocumentAction(id: string, linkId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await unlinkDocument(deps, ctx, { id: linkId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.unlinked'));
}

export async function relateDocumentsAction(id: string, relatedDocumentId: string, kind: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await relateDocuments(deps, ctx, { documentId: id, relatedDocumentId, kind });
  revalidatePath(`/dms/${id}`);
  revalidatePath(`/dms/${relatedDocumentId}`);
  return toActionState(result, t, t('dms.toast.related'));
}

export async function unrelateDocumentsAction(id: string, relationId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await unrelateDocuments(deps, ctx, { id: relationId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.unrelated'));
}

export async function recordDispatchAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await recordDispatch(deps, ctx, {
    id,
    sentAt: String(formData.get('sentAt') ?? ''),
    sentVia: String(formData.get('sentVia') ?? ''),
    note: orNull(formData.get('note')) ?? undefined,
  });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.dispatched'));
}

export async function clearDispatchAction(id: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await clearDispatch(deps, ctx, { id });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  return toActionState(result, t, t('dms.toast.dispatchCleared'));
}

export async function createFollowUpAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createDocumentFollowUp(deps, ctx, {
    documentId: id,
    dueAt: String(formData.get('dueAt') ?? ''),
    title: String(formData.get('title') ?? '').trim(),
    assigneeUserId: orNull(formData.get('assigneeUserId')),
  });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t, t('dms.toast.followUpCreated'));
}

export async function completeFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await completeFollowUp(deps, ctx, { id: followUpId });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t);
}

export async function reopenFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await reopenFollowUp(deps, ctx, { id: followUpId });
  revalidatePath(`/dms/${id}`);
  revalidatePath('/dms');
  revalidatePath('/');
  return toActionState(result, t);
}

export async function addNoteAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await addNote(deps, ctx, { documentId: id, body: String(formData.get('body') ?? '') });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.noteAdded'));
}

export async function deleteNoteAction(id: string, noteId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await deleteNote(deps, ctx, { id: noteId });
  revalidatePath(`/dms/${id}`);
  return toActionState(result, t, t('dms.toast.noteDeleted'));
}
