'use server';

import { guardAction } from '@/lib/action-guard';
import { backupJobSlot, fail, isBackupName, jobRunningConflict, localizedConflict, startSetupRestore, waitForJob } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';

/** Spielt das hochgeladene Backup (`handle` = sein Name im Backup-Verzeichnis) ein und wartet auf das Ende des Laufs. */
export async function importForSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('setup/import/actions.ts#importForSetupAction', async () => {
    const t = await getTranslations();
    const deps = getDeps();
    const name = String(formData.get('handle') ?? '');
    if (!isBackupName(name)) return { status: 'error', message: t('auth.setupImport.unreadable'), fieldErrors: {} };
    const started = startSetupRestore(deps, { name });
    if (!started.ok) return toActionState(started, t);
    if (!started.value.started) return toActionState(jobRunningConflict(started.value.running), t);
    const record = await waitForJob(backupJobSlot(deps.backupPath!), started.value.runId);
    if (record?.status !== 'success') return toActionState(record?.error ? fail(record.error) : localizedConflict('jobInterrupted', 'jobs.errors.jobInterrupted'), t);
    redirect('/login?imported=1');
  });
}
