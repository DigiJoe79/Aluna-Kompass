'use server';

import { guardAction } from '@/lib/action-guard';
import {
  addNote,
  clearDispatch,
  createDocumentFolder,
  createDocumentFollowUp,
  createDraft,
  createReplacementDraft,
  createResponseDraft,
  canReadDocumentType,
  defaultTypeKey,
  deleteDocumentFolder,
  deleteNote,
  recordDispatch,
  linkDocument,
  moveDocuments,
  moveDocumentFolder,
  relateDocuments,
  unlinkDocument,
  unrelateDocuments,
  deleteDocument,
  deleteDraft,
  extractDocumentText,
  fileDocument,
  receiveDocument,
  previewNextNumber,
  previewReclassification,
  reclassifyDocument,
  type ReclassificationPreview,
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
import { nameOf } from '@/lib/folder-tree-model';
import { textWorker } from '@/lib/background';
import { requireSession } from '@/lib/request-context';

const orNull = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
};

/**
 * Der Ordner, den es nicht mehr gibt: Zwischen Öffnen und Speichern hat ihn
 * jemand umbenannt, verschoben oder gelöscht. Der Grund nennt ihn beim Namen
 * statt „Der Eintrag wurde nicht gefunden“.
 */
const goneFolder = (error: { type: string } & Partial<{ entity: string; id: string }>): string | null =>
  error.type === 'notFound' && error.entity === 'documentFolder' && error.id ? error.id : null;

export async function createDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#createDraftAction', async () => {
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
  });
}

export async function updateDraftAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#updateDraftAction', async () => {
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
  });
}

export async function fileDocumentAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#fileDocumentAction', async () => {
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
  });
}

export async function voidDocumentAction(id: string, reason: string, withReplacement = false): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#voidDocumentAction', async () => {
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
  });
}

/** „Antworten“ und „Folgeschreiben“: ein Entwurf aus dem Dokument, danach geht es zur Bearbeiten-Seite. */
export async function createResponseDraftAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#createResponseDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();

    const result = await createResponseDraft(deps, ctx, { id });
    if (!result.ok) return toActionState(result, t);

    revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    redirect(`/dms/${result.value.id}/edit`);
  });
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#deleteDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();

    const result = await deleteDraft(deps, ctx, { id });
    if (!result.ok) {
      return toActionState(result, t);
    }

    revalidatePath('/dms');
    redirect('/dms');
  });
}

/**
 * Die einzige Löschung, die ein festgeschriebenes Dokument kennt — sie steht
 * hinter der abgelaufenen Frist und einem Menschen, der sie bestätigt
 * (Prinzip 3, Entscheidung 10). Der Service prüft die Frist erneut.
 */
export async function deleteDocumentAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#deleteDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();

    const result = await deleteDocument(deps, ctx, { id });
    if (!result.ok) {
      return toActionState(result, t);
    }

    revalidatePath('/dms');
    revalidatePath('/admin/retention');
    redirect('/dms');
  });
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
 * schneller sein. `number: null` heißt: Die Art darf der Aufrufer nicht lesen,
 * die Nummer erfährt er erst mit der Bestätigung; `null` heißt: keine Antwort.
 */
export async function previewNumberAction(typeKey: string): Promise<{ number: string | null } | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewNextNumber(deps, ctx, { typeKey });
  return result.ok ? result.value : null;
}

export async function receiveDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#receiveDocumentAction', async () => {
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

    const links: { entityType: string; entityId: string; role: 'sender' | 'recipient' | 'about' }[] = senderId
      ? [{ entityType: 'contact', entityId: senderId, role: 'sender' }]
      : [];

    // Von der Seite eines Tiers oder Projekts aus: der Bezug reist im Formular mit.
    const aboutType = orNull(formData.get('aboutType'));
    const aboutId = orNull(formData.get('aboutId'));
    if (aboutType && aboutId) links.push({ entityType: aboutType, entityId: aboutId, role: 'about' });

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
      const state = toActionState(result, t);
      const gone = goneFolder(result.error);
      // Der Grund gehört ans Ordnerfeld; alles Getippte bleibt stehen.
      if (state.status === 'error' && gone) return { ...state, fieldErrors: { folder: t('dms.errors.folderGone', { name: nameOf(gone) }) } };
      return state;
    }

    // Nicht warten: Der Upload ist fertig, das Lesen darf dauern.
    textWorker()?.wake();

    revalidatePath('/dms');
    // Wer in eine geschützte Art ablegt, sieht das Dokument danach nicht mehr —
    // die Detailseite zeigte ihm „kein Zugriff“. Er bekommt die Nummer und die Liste.
    if (!canReadDocumentType(deps, ctx, result.value.typeKey)) redirect(`/dms?filed=${encodeURIComponent(result.value.number ?? '')}`);
    // Aus einer Warteschlange heraus führt kein Weg zum einzelnen Dokument: Die
    // nächste Datei wartet schon, und ein Sprung dorthin verlöre sie.
    if (formData.get('queued')) {
      // Befund Z: Die Detailseite zeigt das Doppel; aus der Warteschlange heraus sagt es ein Hinweis.
      const numbers = result.value.duplicateOf.map((d) => d.number ?? d.id).join(', ');
      return numbers ? { status: 'success', message: t('dms.duplicateOfToast', { numbers }) } : { status: 'success' };
    }
    redirect(`/dms/${result.value.id}`);
  });
}

export async function rereadDocumentAction(documentId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#rereadDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();

    const result = await extractDocumentText(deps, ctx, { documentId });
    if (!result.ok) {
      return toActionState(result, t);
    }

    revalidatePath(`/dms/${documentId}`);
    revalidatePath('/dms');
    return toActionState(result, t, t('dms.text.rereadQueued'));
  });
}

/**
 * Verschiebt mehrere Dokumente in einem Zug, alles oder nichts; was schon im
 * Ziel liegt, wird übersprungen. `expectedFolder` je Dokument: „Rückgängig“
 * gilt nur, solange es noch dort liegt (Spec § 9). `data`: `{ moved, skipped }`.
 */
export async function moveDocumentsAction(moves: { id: string; folder: string | null; expectedFolder?: string | null }[]): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#moveDocumentsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveDocuments(deps, ctx, { moves });
    if (!result.ok) {
      const state = toActionState(result, t);
      const gone = goneFolder(result.error);
      return state.status === 'error' && gone ? { ...state, detail: t('dms.errors.folderGone', { name: nameOf(gone) }) } : state;
    }
    for (const id of result.value.moved) revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    return toActionState(result, t);
  });
}

/** Ein Ordnerpfad aus Elternordner und Name; der Name ohne Rand, den Rest prüft der Dienst. */
const childPath = (parent: string | null, name: string) => (parent ? `${parent}/${name.trim()}` : name.trim());
const parentPath = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null);

/** Verschiebt einen Ordner samt Unterordnern unter `toParent` (`null` = oberste Ebene); `data` ist das Ergebnis des Dienstes. */
export async function moveFolderAction(from: string, toParent: string | null): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#moveFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const name = from.slice(from.lastIndexOf('/') + 1);
    const result = await moveDocumentFolder(deps, ctx, { from, to: childPath(toParent, name) });
    if (result.ok) revalidatePath('/dms');
    return toActionState(result, t);
  });
}

/** Benennt einen Ordner um: derselbe Dienst wie Verschieben, mit gleichem Elternordner. */
export async function renameFolderAction(path: string, name: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#renameFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await moveDocumentFolder(deps, ctx, { from: path, to: childPath(parentPath(path), name) });
    if (result.ok) revalidatePath('/dms');
    return toActionState(result, t);
  });
}

export async function createFolderAction(parent: string | null, name: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#createFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createDocumentFolder(deps, ctx, { path: childPath(parent, name) });
    if (result.ok) revalidatePath('/dms');
    return toActionState(result, t);
  });
}

/** Löscht einen leeren Ordner, ohne Rückfrage (Spec § 5.4); „Rückgängig“ legt ihn neu an. */
export async function deleteFolderAction(path: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#deleteFolderAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteDocumentFolder(deps, ctx, { path });
    if (result.ok) revalidatePath('/dms');
    return toActionState(result, t);
  });
}

export async function linkDocumentAction(
  id: string,
  entityType: string,
  entityId: string,
  role: 'sender' | 'recipient' | 'about',
): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#linkDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await linkDocument(deps, ctx, { documentId: id, entityType, entityId, role });
    revalidatePath(`/dms/${id}`);
    return toActionState(result, t, t('dms.toast.linked'));
  });
}

export async function unlinkDocumentAction(id: string, linkId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#unlinkDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unlinkDocument(deps, ctx, { id: linkId });
    revalidatePath(`/dms/${id}`);
    return toActionState(result, t, t('dms.toast.unlinked'));
  });
}

export async function relateDocumentsAction(id: string, relatedDocumentId: string, kind: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#relateDocumentsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await relateDocuments(deps, ctx, { documentId: id, relatedDocumentId, kind });
    revalidatePath(`/dms/${id}`);
    revalidatePath(`/dms/${relatedDocumentId}`);
    return toActionState(result, t, t('dms.toast.related'));
  });
}

export async function unrelateDocumentsAction(id: string, relationId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#unrelateDocumentsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unrelateDocuments(deps, ctx, { id: relationId });
    revalidatePath(`/dms/${id}`);
    return toActionState(result, t, t('dms.toast.unrelated'));
  });
}

export async function recordDispatchAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#recordDispatchAction', async () => {
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
  });
}

export async function clearDispatchAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#clearDispatchAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await clearDispatch(deps, ctx, { id });
    revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    return toActionState(result, t, t('dms.toast.dispatchCleared'));
  });
}

export async function createFollowUpAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#createFollowUpAction', async () => {
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
  });
}

export async function completeFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#completeFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await completeFollowUp(deps, ctx, { id: followUpId });
    revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    revalidatePath('/');
    return toActionState(result, t);
  });
}

export async function reopenFollowUpAction(id: string, followUpId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#reopenFollowUpAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reopenFollowUp(deps, ctx, { id: followUpId });
    revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    revalidatePath('/');
    return toActionState(result, t);
  });
}

export async function addNoteAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#addNoteAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await addNote(deps, ctx, { documentId: id, body: String(formData.get('body') ?? '') });
    revalidatePath(`/dms/${id}`);
    return toActionState(result, t, t('dms.toast.noteAdded'));
  });
}

export async function deleteNoteAction(id: string, noteId: string): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#deleteNoteAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteNote(deps, ctx, { id: noteId });
    revalidatePath(`/dms/${id}`);
    return toActionState(result, t, t('dms.toast.noteDeleted'));
  });
}

/** Was ein Umklassifizieren bewirken würde — für den Dialog, liest nur (Spec 2026-09-19). */
export async function previewReclassificationAction(id: string, typeKey: string, documentDate: string): Promise<ReclassificationPreview | null> {
  const { deps, ctx } = await requireSession();
  const result = await previewReclassification(deps, ctx, { id, typeKey, documentDate });
  return result.ok ? result.value : null;
}

export async function reclassifyDocumentAction(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/dms/actions.ts#reclassifyDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await reclassifyDocument(deps, ctx, {
      id,
      typeKey: String(formData.get('typeKey') ?? ''),
      subject: String(formData.get('subject') ?? ''),
      documentDate: String(formData.get('documentDate') ?? ''),
      expectedVersion: String(formData.get('expectedVersion') ?? '') || undefined,
    });
    revalidatePath(`/dms/${id}`);
    revalidatePath('/dms');
    // Umklassifiziert in eine geschützte Art: Die Detailseite zeigte „kein Zugriff“ —
    // der Aufrufer bekommt die Nummer und die Liste, wie beim Ablegen.
    if (result.ok && !canReadDocumentType(deps, ctx, result.value.typeKey)) redirect(`/dms?filed=${encodeURIComponent(result.value.number ?? '')}`);
    return toActionState(result, t, t('dms.reclassify.saved'));
  });
}
