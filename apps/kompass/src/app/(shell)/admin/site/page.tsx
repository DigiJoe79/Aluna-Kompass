import { isModuleEnabled, requirePermission } from '@kompass/core';
import { getBlockedTerms, siteCacheStatus, siteConnectionSummary } from '@kompass/module-site';
import { getTranslations } from 'next-intl/server';
import { ForbiddenCard } from '@/components/forbidden-card';
import { ModuleInactiveCard } from '@/components/module-inactive-card';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import { PanelNav, panelFromQuery } from '@/components/panel-nav';
import { requireSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';
import { BlockedTermsPanel } from './blocked-terms-panel';
import { CachePanel } from './cache-panel';
import { ConnectionPanel } from './connection-panel';
import { TemplatePanel } from './template-panel';

const PANELS = ['template', 'connection', 'cache', 'blockedTerms'] as const;

export const dynamic = 'force-dynamic';

export default async function AdminSitePage({ searchParams }: { searchParams: Promise<{ panel?: string }> }) {
  const { deps, ctx } = await requireSession();
  if (!isModuleEnabled(deps, 'site')) return <Page width="standard"><ModuleInactiveCard namespace="content" /></Page>;
  // Ein Recht für die ganze Seite; die Dienste hinter Verbindung und Sperrwörtern prüfen weiter ihr eigenes.
  if (requirePermission(ctx, 'site.manage')) return <Page width="standard"><ForbiddenCard permission="site.manage" /></Page>;
  const t = await getTranslations('site.admin');
  const panel = panelFromQuery((await searchParams).panel, PANELS, 'template');
  const terms = panel === 'blockedTerms' ? await getBlockedTerms(deps, ctx) : null;
  const cache = panel === 'cache' ? siteCacheStatus(deps, ctx, siteEnv()) : null;

  return (
    <Page width="standard" header={<PageHeader title={t('title')} description={t('description')} />}>
      <div className="flex flex-col gap-4">
        <PanelNav
          basePath="/admin/site"
          panels={PANELS}
          active={panel}
          labels={Object.fromEntries(PANELS.map((k) => [k, t(`tabs.${k}`)])) as Record<(typeof PANELS)[number], string>}
          ariaLabel={t('tabsLabel')}
        />
        {panel === 'template' ? <TemplatePanel deps={deps} /> : null}
        {cache?.ok ? <CachePanel status={cache.value} /> : null}
        {terms?.ok ? <BlockedTermsPanel terms={terms.value} canPublish={!requirePermission(ctx, 'site.publish')} /> : null}
        {panel === 'connection' ? <ConnectionPanel summary={siteConnectionSummary()} canPublish={!requirePermission(ctx, 'site.publish')} /> : null}
      </div>
    </Page>
  );
}
