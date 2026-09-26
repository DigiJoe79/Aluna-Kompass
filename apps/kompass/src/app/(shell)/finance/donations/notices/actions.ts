'use server';

import { attachNoticeDocument, createNotificationLetterDraft, saveNotice, saveSigner, supersedeNotice, uploadFacsimile, voidNotice } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Bescheide und des maschinellen Verfahrens (C3, F6a
 * Task 8). Jede ruft genau einen Dienst des Finanzmoduls; Prüfung, Rechte und
 * Protokoll stehen dort. Neu aufgebaut werden auch die Einrichtung (Schritte
 * „Bescheid“ und „Maschinelles Verfahren“), die Vereinsdaten (E22) und die
 * Bestätigungen (Prüfliste, „Zu korrigieren“).
 */
function revalidate(): void {
  revalidatePath('/finance/donations', 'layout');
  revalidatePath('/admin/finance');
  revalidatePath('/admin/settings');
}

export interface NoticeInput {
  id?: string;
  kind: 'section60a' | 'exemptionNotice' | 'corporateTaxNoticeAttachment';
  taxOffice: string;
  taxNumber: string;
  noticeDate: string;
  /** „Steuerbefreiung ab“ — Pflicht; leer bleibt es `undefined`, damit der Dienst „Pflichtfeld“ meldet. */
  exemptFrom?: string;
  assessmentPeriod?: string | null;
  purposesText: string;
  /** Im Akkusativ; Pflicht nur bei § 60a (N8) — der Dienst prüft es. */
  purposesTextAccusative?: string | null;
  documentId?: string | null;
}

export async function saveNoticeAction(input: NoticeInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveNotice(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t(input.documentId ? 'finance.donations.notices.toast.linked' : 'finance.donations.notices.toast.saved'));
}

/**
 * Zweiter Schritt „Dokument nachreichen“: das PDF als Eingang der Akte im
 * Namen des Bescheids. `FormData` statt eines Uint8Array-Arguments (N9,
 * Befundliste 0.2.0) — React begrenzt Typed-Array-Bytes in
 * Server-Action-Argumenten auf rund 1 MB, die Bytes entstehen deshalb erst
 * auf dem Server (Muster: `dms/actions.ts`).
 */
export async function attachNoticeDocumentAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
  const id = String(formData.get('id') ?? '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await attachNoticeDocument(deps, ctx, { id, bytes });
  revalidate();
  if (!result.ok) return toActionState(result, t);
  const number = result.value.documentNumber;
  return toActionState(result, t, number ? t('finance.donations.notices.toast.attached', { number }) : t('finance.donations.notices.toast.attachedWithoutNumber'));
}

export async function supersedeNoticeAction(input: { id: string; supersededOn: string; documentId?: string | null }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await supersedeNotice(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.notices.toast.superseded'));
}

export async function voidNoticeAction(input: { id: string; note: string }): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await voidNotice(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.notices.toast.voided'));
}

export interface SignerInput {
  id?: string;
  validFrom: string;
  validTo?: string | null;
  signerName: string;
  notifiedOn?: string | null;
}

export async function saveSignerAction(input: SignerInput): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await saveSigner(deps, ctx, input);
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.machine.toast.saved'));
}

export async function uploadFacsimileAction(formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
  const signerId = String(formData.get('signerId') ?? '');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadFacsimile(deps, ctx, { signerId, bytes, mimeType: file.type });
  revalidate();
  if (!result.ok) return toActionState(result, t);
  return toActionState(result, t, t('finance.donations.machine.toast.facsimile'));
}

export async function createNotificationLetterAction(signerId: string): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await createNotificationLetterDraft(deps, ctx, { signerId });
  if (!result.ok) return toActionState(result, t);
  revalidatePath('/dms');
  return { status: 'success', message: t('finance.donations.machine.toast.letter'), data: { id: result.value.id } };
}
