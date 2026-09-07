'use server';

import { checkDeployTarget, exportSiteContent, runPreview, runPublish } from '@kompass/module-website';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

export async function runCheckAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const dir = await mkdtemp(path.join(tmpdir(), 'kompass-check-'));
  try {
    const result = await exportSiteContent(deps, ctx, { jobDir: dir });
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { contentHash: result.value.contentHash, gaps: result.value.gaps, violations: result.value.violations } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function runPreviewAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await runPreview(deps, ctx, siteEnv());
  if (!result.ok) return toActionState(result, t);
  const { log: _log, ...data } = result.value;
  return { status: 'success', data };
}

export async function runDeployCheckAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await checkDeployTarget(deps, ctx, siteEnv());
  if (!result.ok) return toActionState(result, t);
  return { status: 'success', data: result.value };
}

export async function runPublishAction(confirm: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await runPublish(deps, ctx, siteEnv(), { confirm });
  revalidatePath('/website/publish');
  if (!result.ok) return toActionState(result, t);
  return {
    status: 'success',
    message: t('website.publish.done', {
      changed: result.value.diff.changed.length,
      added: result.value.diff.added.length,
      removed: result.value.diff.removed.length,
    }),
    data: result.value.diff,
  };
}
