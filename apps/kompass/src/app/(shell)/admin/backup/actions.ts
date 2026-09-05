'use server';

import { importBackup, inspectBackup } from '@kompass/core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { toActionState, type ActionState } from '@/lib/actions';
import { runtimeEnv } from '@/lib/deps';
import { environmentConfirmationName } from '@/lib/env-banner';
import { resetMcpHandler } from '@/lib/mcp';
import { clearSessionCookie, requireSession } from '@/lib/request-context';

async function stash(file: File): Promise<{ dir: string; archivePath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kompass-upload-'));
  const archivePath = path.join(dir, 'backup.tar.gz');
  await writeFile(archivePath, new Uint8Array(await file.arrayBuffer()));
  return { dir, archivePath };
}

export async function inspectBackupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  await requireSession();
  const file = formData.get('archive');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('backup.import.noFile'), fieldErrors: { archive: t('backup.import.noFile') } };
  const { dir, archivePath } = await stash(file);
  try {
    const result = await inspectBackup({ archivePath, workDir: dir });
    return toActionState(result, t);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function importBackupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const file = formData.get('archive');
  if (!(file instanceof File) || file.size === 0) return { status: 'error', message: t('backup.import.noFile'), fieldErrors: { archive: t('backup.import.noFile') } };
  const { dir, archivePath } = await stash(file);
  let result;
  try {
    result = await importBackup(deps, ctx, { archivePath, workDir: dir, confirmation: String(formData.get('confirmation') ?? ''), environmentName: environmentConfirmationName(runtimeEnv().env) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (!result.ok) return toActionState(result, t);
  await resetMcpHandler();
  await clearSessionCookie();
  redirect('/login?imported=1');
}
