'use server';

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { importBackupForSetup } from '@kompass/core';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { resolveUpload } from '@/lib/setup-uploads';

export async function importForSetupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const deps = getDeps();
  const archivePath = resolveUpload(deps.databasePath, String(formData.get('handle') ?? ''));
  if (!archivePath) return { status: 'error', message: t('auth.setupImport.unreadable'), fieldErrors: {} };
  const result = await importBackupForSetup(deps, { archivePath, workDir: tmpdir() });
  await rm(archivePath, { force: true });
  if (!result.ok) return toActionState(result, t);
  redirect('/login?imported=1');
}
