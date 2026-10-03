'use server';

import { guardAction } from '@/lib/action-guard';
import { conflict, type Result } from '@kompass/core';
import { cancelSiteJob, siteContentHash, startDeployCheck, startPreview, startPublish, type SiteJobKind, type SiteJobStart } from '@kompass/module-site';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

/** Inhalts-Hash des aktuellen Stands, ohne Dateien und ohne Originalbilder zu lesen (Sekunden statt Minuten). */
export async function checkContentHashAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#checkContentHashAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = await siteContentHash(deps, ctx);
    if (!result.ok) return toActionState(result, t);
    return { status: 'success', data: { contentHash: result.value.contentHash } };
  });
}

/**
 * Vorschau, Verbindungstest und Publish starten nur und kehren sofort zurück;
 * `data.runId` nennt den Lauf, den die Karte beim Poller anmeldet (`track`).
 * Läuft schon einer derselben Art, wartet sie auf diesen; läuft ein anderer, ist das ein Konflikt wie bisher.
 */
async function startedState(result: Result<SiteJobStart>, kind: SiteJobKind): Promise<ActionState> {
  const t = await getTranslations();
  if (!result.ok) return toActionState(result, t);
  if (result.value.started) return { status: 'success', data: { runId: result.value.runId } };
  const { running } = result.value;
  if (running.kind === kind) return { status: 'success', data: { runId: running.runId } };
  return toActionState(conflict('siteJobRunning', running.kind), t);
}

export async function startPreviewAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startPreviewAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startPreview(deps, ctx, siteEnv(), { source: 'ui' }), 'preview');
  });
}

export async function startDeployCheckAction(): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startDeployCheckAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startDeployCheck(deps, ctx, siteEnv(), { source: 'ui' }), 'deployCheck');
  });
}

export async function startPublishAction(input: { expectedContentHash: string }): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#startPublishAction', async () => {
    const { deps, ctx } = await requireSession();
    return startedState(await startPublish(deps, ctx, siteEnv(), { confirm: true, source: 'ui', expectedContentHash: input.expectedContentHash }), 'publish');
  });
}

export async function cancelSiteJobAction(runId: string): Promise<ActionState> {
  return guardAction('(shell)/site/publish/actions.ts#cancelSiteJobAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    return toActionState(cancelSiteJob(deps, ctx, siteEnv(), { runId }), t, t('site.publish.run.cancelled'));
  });
}
