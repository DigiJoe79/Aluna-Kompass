import { isModuleEnabled, requirePermission } from '@kompass/core';
import { getBlockedTerms, siteCacheStatus, siteConnectionSummary } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { BlockedTermsPanel } from './blocked-terms-panel';
import { CachePanel } from './cache-panel';
import { ConnectionPanel } from './connection-panel';
import { panelFromQuery, SitePanelNav } from './panel-nav';
import { TemplatePanel } from './template-panel';

export const dynamic = 'force-dynamic';

export default async function AdminSitePage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'site')) return <ModuleInactiveCard namespace="content" />;
  // Ein Recht für die ganze Seite; die Dienste hinter Verbindung und Sperrwörtern prüfen weiter ihr eigenes.
  if (requirePermission(ctx, 'site.manage')) return <ForbiddenCard permission="site.manage" />;
  const t = await getTranslations('site.admin');
  const panel = panelFromQuery((await searchParams).panel);
  const terms = panel === 'blockedTerms' ? await getBlockedTerms(deps, ctx) : null;
  const cache = panel === 'cache' ? siteCacheStatus(deps, ctx, siteEnv()) : null;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="flex max-w-[880px] flex-col gap-4">
        <SitePanelNav active={panel} />
        {panel === 'template' ? <TemplatePanel deps={deps} /> : null}
        {cache?.ok ? <CachePanel status={cache.value} /> : null}
        {terms?.ok ? <BlockedTermsPanel terms={terms.value} canPublish={!requirePermission(ctx, 'site.publish')} /> : null}
        {panel === 'connection' ? <ConnectionPanel summary={siteConnectionSummary()} canPublish={!requirePermission(ctx, 'site.publish')} /> : null}
      </div>
    </>
  );
}
