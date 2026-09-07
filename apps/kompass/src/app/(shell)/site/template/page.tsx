import { requirePermission } from '@kompass/core';
import { activeTemplate } from '@kompass/module-site';
import { getFormatter, getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { SyncClient } from './sync-client';

export const dynamic = 'force-dynamic';

export default async function SiteTemplatePage() {
  const { deps, ctx } = await requireSession();
  if (requirePermission(ctx, 'site.manage')) return <ForbiddenCard permission="site.manage" />;
  const t = await getTranslations('site.template');
  const format = await getFormatter();
  const state = activeTemplate(deps);
  return (
    <>
      <PageHeader
        title={t('title')}
        description={state ? t('lastRead', { when: format.dateTime(new Date(state.readAt), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('neverRead')}
      />
      <SyncClient name={state?.name ?? null} />
    </>
  );
}
