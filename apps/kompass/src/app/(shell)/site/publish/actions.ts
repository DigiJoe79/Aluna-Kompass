'use server';

import { guardAction } from '@/lib/action-guard';
import { conflict, type Result } from '@kompass/core';
import { exportSiteContent, setBlockedTerms, startDeployCheck, startPreview, startPublish, type SiteJobKind, type SiteJobStart } from '@kompass/module-site';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

export async function runCheckAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#runCheckAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const dir = await mkdtemp(path.join(tmpdir(), 'kompass-check-'));
    try {
      const result = await exportSiteContent(deps, ctx, { jobDir: dir });
      if (!result.ok) return toActionState(result, t);
      return { status: 'success', data: { contentHash: result.value.contentHash, gaps: result.value.gaps, violations: result.value.violations, stale: result.value.stale, pendingReview: result.value.pendingReview } };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/**
 * Vorschau, Verbindungstest und Publish starten nur und kehren sofort zurück;
 * `data.runId` sagt der Karte, auf welchen Lauf sie in /site/job/[kind]
 * wartet. Läuft schon einer derselben Art, wartet sie auf diesen; läuft ein
 * anderer, ist das ein Konflikt wie bisher.
 */
async function startedState(result: Result<SiteJobStart>, kind: SiteJobKind): Promise<ActionState> {
  const t = await getTranslations();
  if (!result.ok) return toActionState(result, t);
  if (result.value.started) return { status: 'success', data: { runId: result.value.runId } };
  const { running } = result.value;
  if (running.name === kind) return { status: 'success', data: { runId: running.runId } };
  return toActionState(conflict('siteJobRunning', running.name), t);
}

export async function startPreviewAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startPreviewAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startPreview(deps, ctx, siteEnv()), 'preview');
  });
}

export async function startDeployCheckAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startDeployCheckAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startDeployCheck(deps, ctx, siteEnv()), 'deployCheck');
  });
}

export async function startPublishAction(confirm: boolean): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startPublishAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startPublish(deps, ctx, siteEnv(), { confirm }), 'publish');
  });
}

export async function saveBlockedTermsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#saveBlockedTermsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const terms = String(formData.get('terms') ?? '').split('\n');
    const result = await setBlockedTerms(deps, ctx, { terms });
    revalidatePath('/site/publish');
    return toActionState(result, t, t('site.publish.blockedTerms.saved'));
  });
}
