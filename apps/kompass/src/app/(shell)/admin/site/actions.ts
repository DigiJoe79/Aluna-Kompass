'use server';

import { clearSiteCache, setBlockedTerms } from '@kompass/module-site';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { guardAction } from '@/lib/action-guard';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

export async function clearSiteCacheAction(): Promise<ActionState> {
  return guardAction('(shell)/admin/site/actions.ts#clearSiteCacheAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const result = clearSiteCache(deps, ctx, siteEnv());
    revalidatePath('/admin/site');
    if (!result.ok) return toActionState(result, t);
    return toActionState(result, t, t('site.admin.cache.cleared', { removed: result.value.removed }));
  });
}

export async function saveBlockedTermsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return guardAction('(shell)/admin/site/actions.ts#saveBlockedTermsAction', async () => {
    const t = await getTranslations();
    const { deps, ctx } = await requireSession();
    const terms = String(formData.get('terms') ?? '').split('\n');
    const result = await setBlockedTerms(deps, ctx, { terms });
    revalidatePath('/admin/site');
    return toActionState(result, t, t('site.publish.blockedTerms.saved'));
  });
}
