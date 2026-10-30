'use server';

import { userNamesFor } from '@kompass/core';
import { answerAuditRemark, cancelAuditPackageRun, fileAuditReportFromDocument, fileAuditReportScan, createAuditRemark, createAuditReportDraft, markAuditReportReadyToSign, revokeAuditReportReadyToSign, saveAuditReportDeviation, saveAuditReportExamination, saveAuditReportResult, saveAuditReportSignatures, endAuditorAccess, followUpAuditRemark, resolveAuditRemark, fileConfidentialityDeclaration, markSectionReviewed, previewAuditor, removeAuditor, saveAuditor, setSample, startAuditPackageRun, unmarkSectionReviewed, type AuditorAccess, type AuditorIndependence, type AuditSection } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/**
 * Server Actions der Kassenprüfung (Rechenschaft D1b). Jede ruft genau einen Dienst des Finanzmoduls; Rechte, Kanal
 * und Protokoll stehen dort. Die Prüfung gilt dem Jahr: Übersicht, Abschnitte, Bericht und Buchungen bauen nach einem Erfolg neu auf —
 * nach einer Ablehnung nicht, sonst zöge die Karte den neuen Stand nach und Meldung und Eingaben wären weg (Konflikt
 * je Karte).
 */
function revalidate(): void {
  revalidatePath('/finance/audit', 'layout');
  revalidatePath('/finance/entries', 'layout');
}

// ── Prüfer ──────────────────────────────────────────────────────────────────

export interface AuditorInput {
  id?: string;
  expectedVersion?: string;
  fiscalYearId: string;
  contactId: string;
  mode: 'kompass' | 'paper';
  confidential: boolean;
  confidentialityDocumentId: string | null;
  electedOn: string | null;
  minutesDocumentId: string | null;
}

/** Eintragen oder bearbeiten (Board 12b). */
export async function saveAuditorAction(input: AuditorInput): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#saveAuditorAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAuditor(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

export interface AuditorPreview {
  access: AuditorAccess;
  independence: AuditorIndependence;
  /** Name des verknüpften Nutzers für „Verknüpft mit Nutzer …“. */
  userName: string | null;
}

/** Zugang und Unabhängigkeit, bevor gespeichert ist (Board 12b: die Hinweise stehen unter dem Feld). */
export async function previewAuditorAction(input: { fiscalYearId: string; contactId: string; mode: 'kompass' | 'paper' }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#previewAuditorAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await previewAuditor(deps, ctx, input);
    if (!result.ok) return toActionState(result, t);
    const userId = result.value.access.userId;
    const data: AuditorPreview = { ...result.value, userName: userId ? (userNamesFor(deps, [userId]).get(userId) ?? null) : null };
    return { status: 'success', data };
  });
}

/** Die Vertraulichkeitserklärung hochladen — erst am gespeicherten Eintrag. */
export async function uploadConfidentialityAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#uploadConfidentialityAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const result = await fileConfidentialityDeclaration(deps, ctx, { auditorId: String(formData.get('auditorId') ?? ''), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    if (result.ok) revalidate();
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { documentId: result.value.confidentialityDocumentId, subject: file.name, version: result.value.version } };
  });
}

export async function removeAuditorAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#removeAuditorAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await removeAuditor(deps, ctx, { id });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** „Zugang beenden …“ (Board 12h, Nachtrag Prüferzugang): entzieht die Rolle Kassenprüfer. */
export async function endAuditorAccessAction(id: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#endAuditorAccessAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await endAuditorAccess(deps, ctx, { id });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

// ── Prüfpaket ───────────────────────────────────────────────────────────────

/** „Prüfpaket erzeugen“: Prüffassungen, Mappe und Belege im Hintergrund (Stand über die Status-Route). */
export async function startPackageRunAction(fiscalYearId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#startPackageRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await startAuditPackageRun(deps, ctx, { fiscalYearId });
    return toActionState(result, t);
  });
}

/** „Abbrechen“ am laufenden Prüfpaket. */
export async function cancelPackageRunAction(fiscalYearId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#cancelPackageRunAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await cancelAuditPackageRun(deps, ctx, { fiscalYearId });
    return toActionState(result, t);
  });
}

// ── Stichproben und Durchsicht (nur in der Oberfläche) ─────────────────────

/** Das Kästchen „Stichprobe“ (N4): speichert sofort. */
export async function setSampleAction(input: { fiscalYearId: string; entryId: string; sampled: boolean }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#setSampleAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await setSample(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** „Abschnitt durchgesehen“ je Prüfer. */
export async function markReviewedAction(fiscalYearId: string, section: AuditSection): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#markReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markSectionReviewed(deps, ctx, { fiscalYearId, section });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** „Durchsicht zurücknehmen“. */
export async function unmarkReviewedAction(fiscalYearId: string, section: AuditSection): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#unmarkReviewedAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unmarkSectionReviewed(deps, ctx, { fiscalYearId, section });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

// ── Vermerke (nur in der Oberfläche) ────────────────────────────────────────

export interface RemarkInput {
  fiscalYearId: string;
  kind: 'question' | 'finding';
  targetType: 'entry' | 'document' | 'report' | 'year' | 'resolution';
  targetId: string;
  text: string;
  onBehalfOfAuditorId?: string;
}

/** „Vermerk schreiben“ (Board 4d). */
export async function createRemarkAction(input: RemarkInput): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#createRemarkAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createAuditRemark(deps, ctx, input);
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}

/** Die Schatzmeisterin antwortet (`finance.entriesWrite`). */
export async function answerRemarkAction(remarkId: string, text: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#answerRemarkAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await answerAuditRemark(deps, ctx, { remarkId, text });
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}

/** Der Prüfer fragt nach. */
export async function followUpRemarkAction(remarkId: string, text: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#followUpRemarkAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await followUpAuditRemark(deps, ctx, { remarkId, text });
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}

/** Der Prüfer markiert als geklärt. */
export async function resolveRemarkAction(remarkId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#resolveRemarkAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await resolveAuditRemark(deps, ctx, { remarkId });
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}

// ── Prüfbericht (nur in der Oberfläche, Bearbeiter) ─────────────────────────

/** Den Entwurf anlegen (Bericht oder Nachtrag). */
export async function createReportDraftAction(fiscalYearId: string, kind: 'report' | 'followUp'): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#createReportDraftAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createAuditReportDraft(deps, ctx, { fiscalYearId, kind });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/**
 * „Prüfbericht schreiben“ auf der Übersicht (Designer Runde 4, 1.2 Nr. 6): den Entwurf anlegen und öffnen, in einem
 * Schritt. Liegt er schon (`auditReportExists`, etwa nach einem zweiten Klick), wird er nur geöffnet. Jede andere
 * Ablehnung kommt zurück an den Knopf. Gebunden an das Jahr; die übrigen Argumente reicht `useActionState` durch.
 */
export async function writeAuditReportAction(fiscalYearId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#writeAuditReportAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await createAuditReportDraft(deps, ctx, { fiscalYearId, kind: 'report' });
    const exists = !result.ok && result.error.type === 'conflict' && result.error.code === 'auditReportExists';
    if (!result.ok && !exists) return toActionState(result, t);
    if (result.ok) revalidate();
    redirect(`/finance/audit/report?year=${encodeURIComponent(fiscalYearId)}`);
  });
}

/** Karte „Prüfung“ (Board 12d): eigener Stand je Karte. */
export async function saveExaminationAction(input: { reportId: string; expectedVersion: string; dates: string[]; place: string | null; notTested: string | null; cashCountId: string | null }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#saveExaminationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAuditReportExamination(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** Karte „Ergebnis“: Ergebnis und Empfehlung, dazu die eigenen abweichenden Feststellungen. */
export async function saveResultAction(input: { reportId: string; expectedVersion: string; result: 'clean' | 'withFindings' | null; recommendation: 'discharge' | 'noDischarge' | 'none' }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#saveResultAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAuditReportResult(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

export async function saveDeviationAction(input: { reportId: string; expectedVersion?: string; text: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#saveDeviationAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAuditReportDeviation(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** Karte „Unterschriften“. */
export async function saveSignaturesAction(input: { reportId: string; expectedVersion: string; mode: 'both' | 'one' | 'separate'; nonSignerAuditorId: string | null; nonSignerReason: string | null }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#saveSignaturesAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await saveAuditReportSignatures(deps, ctx, input);
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** „Zum Unterschreiben freigeben …“. */
export async function markReadyAction(reportId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#markReadyAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await markAuditReportReadyToSign(deps, ctx, { reportId });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

/** „Freigabe zurücknehmen“ — bis der erste Scan liegt. */
export async function revokeReadyAction(reportId: string): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#revokeReadyAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await revokeAuditReportReadyToSign(deps, ctx, { reportId });
    if (result.ok) revalidate();
    return toActionState(result, t);
  });
}

// ── Scan des unterschriebenen Berichts ──────────────────────────────────────

/** Den Scan hochladen (Board 12e): zum Bericht, oder ohne Bericht zum Jahr (Vordruck, nur Papier-Prüfer). */
export async function fileScanAction(formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#fileScanAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('common.uploadFailed'), fieldErrors: {} };
    const reportId = String(formData.get('reportId') ?? '');
    const fiscalYearId = String(formData.get('fiscalYearId') ?? '');
    const auditorId = String(formData.get('auditorId') ?? '');
    const result = await fileAuditReportScan(deps, ctx, { ...(reportId ? { reportId } : { fiscalYearId }), ...(auditorId ? { auditorId } : {}), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}

/** Den Scan aus der Akte wählen. */
export async function fileScanFromDocumentAction(input: { reportId?: string; fiscalYearId?: string; auditorId?: string; documentId: string }): Promise<ActionState> {
  return guardAction('(shell)/finance/audit/actions.ts#fileScanFromDocumentAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await fileAuditReportFromDocument(deps, ctx, input);
    if (result.ok) {
      revalidate();
      revalidatePath('/finance/reports', 'layout');
    }
    return toActionState(result, t);
  });
}
