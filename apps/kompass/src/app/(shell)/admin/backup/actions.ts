'use server';

import {
  cancelBackupJob,
  deleteBackup,
  jobRunningConflict,
  pinBackup,
  restorePreview,
  startBackup,
  startBackupVerification,
  startRestore,
  unpinBackup,
  type JobStart,
  type Result,
} from '@kompass/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

/*
 * Einmalige Aktionen der Backup-Seite (Plan U2). Den Laufstand fragt die Seite über den Route Handler
 * `/admin/backup/job` ab, nie über eine Server Action — Actions einer Seite laufen nacheinander.
 */

const PAGE = '/admin/backup';

/** Ein Start nennt `data.runId`; läuft schon ein Backup-Lauf, ist das eine Ablehnung mit Grund. */
async function startedState(result: Result<JobStart>): Promise<ActionState> {
  const t = await getTranslations();
  if (!result.ok) return toActionState(result, t);
  if (!result.value.started) return toActionState(jobRunningConflict(result.value.running), t);
  return { status: 'success', data: { runId: result.value.runId } };
}

export async function startBackupAction(): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#startBackupAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startBackup(deps, ctx, {}));
  });
}

export async function cancelBackupJobAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#cancelBackupJobAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await cancelBackupJob(deps, ctx, { runId }), t);
  });
}

export async function verifyBackupAction(name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#verifyBackupAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startBackupVerification(deps, ctx, { name }));
  });
}

export async function pinBackupAction(input: { name: string; label?: string }): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#pinBackupAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await pinBackup(deps, ctx, input);
    if (result.ok) revalidatePath(PAGE);
    return toActionState(result, t);
  });
}

export async function unpinBackupAction(name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#unpinBackupAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await unpinBackup(deps, ctx, { name });
    if (result.ok) revalidatePath(PAGE);
    return toActionState(result, t);
  });
}

export async function deleteBackupAction(name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#deleteBackupAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await deleteBackup(deps, ctx, { name });
    if (result.ok) revalidatePath(PAGE);
    return toActionState(result, t);
  });
}

export async function restorePreviewAction(name: string): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#restorePreviewAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(await restorePreview(deps, ctx, { name }), t);
  });
}

export async function startRestoreAction(input: { name: string; confirmation: string }): Promise<ActionState> {
  return guardAction('(shell)/admin/backup/actions.ts#startRestoreAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startRestore(deps, ctx, input));
  });
}
